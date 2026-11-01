import crypto from "node:crypto";

export interface RowMeta {
  id: number;
  recordId: string;
  officeId?: string;
  createdBy?: string | null;
  createdAt?: string;
  deletedAt?: string | null;
  deletedBy?: string | null;
  updatedAt?: string;
  // Extended optional domain metadata
  assignedLawyer?: string | null;
  assigneeId?: string | null;
  caseId?: string | null;
  clientId?: string | null;
  rulingOutcome?: string | null;
  judgmentType?: string | null;
}

export type SheetRowMeta = RowMeta;

// Per-spreadsheet/tenant serialized async mutex queue to prevent concurrent row-selection/write races
const lockQueues = new Map<string, Promise<unknown>>();

export async function withSheetLock<T>(lockKey: string, task: () => Promise<T>): Promise<T> {
  const key = lockKey || "default";
  const previous = lockQueues.get(key) ?? Promise.resolve();
  let release!: () => void;
  const nextGate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const chained = previous.catch(() => undefined).then(() => nextGate);
  lockQueues.set(key, chained);

  await previous.catch(() => undefined);
  try {
    return await task();
  } finally {
    release();
    if (lockQueues.get(key) === chained) {
      lockQueues.delete(key);
    }
  }
}

// Short-lived idempotency cache to prevent duplicate double-clicks / retries within 60 seconds
const idempotencyStore = new Map<string, { expiresAt: number; result: unknown }>();

export function getIdempotentResult<T>(key: string | undefined): T | undefined {
  if (!key) return undefined;
  const entry = idempotencyStore.get(key);
  if (!entry) return undefined;
  if (Date.now() > entry.expiresAt) {
    idempotencyStore.delete(key);
    return undefined;
  }
  return entry.result as T;
}

export function setIdempotentResult<T>(key: string | undefined, result: T, ttlMs = 60_000): void {
  if (!key) return;
  if (idempotencyStore.size > 2000) {
    const now = Date.now();
    for (const [k, v] of idempotencyStore.entries()) {
      if (now > v.expiresAt) idempotencyStore.delete(k);
    }
  }
  idempotencyStore.set(key, { expiresAt: Date.now() + ttlMs, result });
}

let monotonicSeq = Math.floor(Math.random() * 900);

/**
 * Generates a unique, permanent positive safe integer ID (fits comfortably in JS 53-bit Number & OpenAPI integer).
 */
export function generateStableIntId(): number {
  monotonicSeq = (monotonicSeq + 1) % 1000;
  // ~13 digits max: (epochSeconds % 1_000_000_000) * 1000 + seq => ~1.7e12 < 9e15 MAX_SAFE_INTEGER
  const sec = Math.floor(Date.now() / 1000) % 1_000_000_000;
  return sec * 1000 + monotonicSeq;
}

/**
 * Deterministically computes a stable positive integer ID for pre-existing legacy spreadsheet rows
 * that do not yet have a `_meta_json` cell, using immutable row content rather than shifting row indices!
 */
export function deriveLegacyStableIntId(immutableSeed: string): number {
  const digest = crypto.createHash("sha256").update(immutableSeed).digest();
  // Read 32-bit unsigned int and keep in 10_000_000 .. 999_999_999 range so it never collides with small legacy indices or epoch IDs
  const raw = digest.readUInt32BE(0);
  return 10_000_000 + (raw % 900_000_000);
}

export function createNewRowMeta(
  officeId?: string,
  createdByOrExtra?: string | null | Partial<RowMeta>,
  maybeExtra?: Partial<RowMeta>,
): RowMeta {
  const createdBy =
    typeof createdByOrExtra === "string" ? createdByOrExtra : undefined;
  const extra =
    createdByOrExtra && typeof createdByOrExtra === "object"
      ? createdByOrExtra
      : maybeExtra;
  const nowIso = new Date().toISOString();
  return {
    id: extra?.id && Number.isInteger(extra.id) && extra.id > 0 ? extra.id : generateStableIntId(),
    recordId: extra?.recordId || crypto.randomUUID(),
    officeId: officeId || extra?.officeId || undefined,
    createdBy: createdBy ?? extra?.createdBy ?? null,
    createdAt: extra?.createdAt || nowIso,
    deletedAt: null,
    updatedAt: nowIso,
    ...extra,
  };
}

export function parseRowMeta(
  rawCell: string | undefined,
  fallbackSeed: string | readonly string[],
  defaultOfficeId?: string,
): RowMeta {
  const seedStr = Array.isArray(fallbackSeed)
    ? fallbackSeed.join("|")
    : String(fallbackSeed || "");

  if (rawCell && rawCell.trim().startsWith("{")) {
    try {
      const parsed = JSON.parse(rawCell.trim()) as Partial<RowMeta>;
      if (parsed && typeof parsed === "object") {
        const id =
          typeof parsed.id === "number" && Number.isFinite(parsed.id) && parsed.id > 0
            ? parsed.id
            : deriveLegacyStableIntId(seedStr);
        return {
          ...parsed,
          id,
          recordId:
            typeof parsed.recordId === "string" && parsed.recordId
              ? parsed.recordId
              : `legacy_${id}`,
          officeId: parsed.officeId || defaultOfficeId,
          deletedAt: parsed.deletedAt ?? null,
        };
      }
    } catch {
      // Fall through to deterministic legacy ID
    }
  }
  const id = deriveLegacyStableIntId(seedStr);
  return {
    id,
    recordId: `legacy_${id}`,
    officeId: defaultOfficeId,
    deletedAt: null,
  };
}

export function serializeRowMeta(meta: RowMeta): string {
  return JSON.stringify({
    ...meta,
    updatedAt: new Date().toISOString(),
  });
}

/**
 * Checks whether a row belongs to the requesting office.
 * - Platform admin ('admin') with no explicit office scope can inspect if needed,
 *   otherwise strict officeId match is enforced whenever row has an officeId.
 */
export function isRowOwnedByOffice(
  meta: RowMeta,
  callerOfficeId: string | undefined,
  isPlatformAdmin = false,
): boolean {
  if (isPlatformAdmin && !callerOfficeId) return true;
  if (!callerOfficeId) return false;
  if (!meta.officeId) {
    // Legacy rows inside a dedicated per-office spreadsheet belong to that spreadsheet's office
    return true;
  }
  return meta.officeId === callerOfficeId;
}
