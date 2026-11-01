import { google, type sheets_v4 } from "googleapis";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { resolve, dirname } from "path";
import { env, isGoogleSheetsConfigured } from "../config/env";
import { logger } from "../lib/logger";
import {
  ExternalServiceError,
  NotFoundError,
  OfficeLinkIncompleteError,
} from "../lib/errors";
import {
  findSupabaseUserById,
  getUserGoogleCredentials,
} from "./supabase.service";
import {
  createNewRowMeta,
  parseRowMeta,
  serializeRowMeta,
  withSheetLock,
  isRowOwnedByOffice,
  type SheetRowMeta,
} from "../utils/sheetMeta";

/**
 * Google Sheets API service with strict per-office isolation, stable record IDs,
 * write serialization, read-only GETs, and explicit error propagation.
 *
 * Columns A..Q (0..16) hold the 17 canonical Arabic session columns.
 * Column R (17) holds `_meta_json` with permanent `id`, `recordId`, `officeId`, and `deletedAt`.
 */

export const SHEET_COLUMNS = [
  "رقم القضية",
  "المدعي",
  "المدعى عليه",
  "المحكمة",
  "الدائرة القضائية",
  "موضوع القضية",
  "نوع الجلسة",
  "تاريخ الجلسة هجري",
  "يوم الجلسة",
  "وقت الجلسة",
  "الأيام المتبقية",
  "ملاحظات",
  "حالة الجلسة",
  "تذكير 24 ساعة",
  "تذكير 6 ساعات",
  "تاريخ الإنشاء",
  "التقرير",
] as const;

export const SESSION_DATA_COLS = SHEET_COLUMNS.length; // 17 (A..Q)
export const SESSION_META_COL_INDEX = SESSION_DATA_COLS; // 17 (R)
const MAX_BOUNDED_ROWS = 2000;

export type SheetRow = string[];

export interface StoredSheetRecord {
  /** Permanent stable integer ID (never shifts when rows are deleted) */
  id: number;
  /** Physical 1-based row number in Google Sheets (internal use only) */
  physicalRowNumber: number;
  values: SheetRow;
  meta: SheetRowMeta;
}

export interface GoogleContext {
  sheets: sheets_v4.Sheets;
  spreadsheetId: string;
  sheetName: string;
  officeId: string;
  isGlobalAdminSheet?: boolean;
}

export interface OfficeScope {
  userId: string;
  officeId: string;
  isAdmin: boolean;
}

export interface SheetsConnectionDiagnostic {
  success: boolean;
  stage: "credentials" | "connection" | "permissions" | "tabs" | "ready";
  message: string;
  clientEmail?: string;
  spreadsheetId?: string;
  sheetsFound?: string[];
  recommendation?: string;
}

let defaultSheetsClient: sheets_v4.Sheets | null = null;
let defaultClientFingerprint = "";
const userClientsMap = new Map<string, { fingerprint: string; client: sheets_v4.Sheets }>();

const SESSIONS_CACHE_TTL_MS = 10_000;
const sessionsCache = new Map<
  string,
  { syncedAt: string; expiresAt: number; records: StoredSheetRecord[] }
>();

export function invalidateSessionsCache(officeOrUserId?: string): void {
  if (!officeOrUserId) {
    sessionsCache.clear();
    return;
  }
  for (const key of sessionsCache.keys()) {
    if (key.includes(officeOrUserId)) {
      sessionsCache.delete(key);
    }
  }
}

function isStatelessServerlessProd(): boolean {
  return Boolean(
    env.isProd &&
      (process.env.VERCEL === "1" ||
        process.env.AWS_LAMBDA_FUNCTION_NAME ||
        process.env.NETLIFY === "true"),
  );
}

function getDurableDataDir(): string {
  const dir = resolve(process.cwd(), ".data");
  if (!existsSync(dir)) {
    try {
      mkdirSync(dir, { recursive: true });
    } catch {
      // Handled when writing
    }
  }
  return dir;
}

export function getOfficeLocalStorePath(kind: string, officeId: string): string {
  const safeOffice = (officeId || "unassigned").replace(/[^a-zA-Z0-9_-]/g, "_");
  const safeKind = kind.replace(/[^a-zA-Z0-9_-]/g, "_");
  return resolve(getDurableDataDir(), `office_${safeOffice}_${safeKind}.json`);
}

export function readOfficeLocalRows<T>(kind: string, officeId: string): T[] {
  const filePath = getOfficeLocalStorePath(kind, officeId);
  if (!existsSync(filePath)) {
    return [];
  }
  try {
    const raw = readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch (err) {
    logger.error({ err, kind, officeId }, "Failed to parse isolated office local store");
    throw new ExternalServiceError("تعذر قراءة مخزن بيانات المكتب المحلي.");
  }
}

export function writeOfficeLocalRows<T>(kind: string, officeId: string, rows: T[]): void {
  if (isStatelessServerlessProd()) {
    throw new ExternalServiceError(
      "التخزين الدائم غير مهيأ لهذا المكتب في بيئة الإنتاج السحابية. يرجى إكمال ربط Google Sheets للمكتب.",
    );
  }
  const filePath = getOfficeLocalStorePath(kind, officeId);
  try {
    const dir = dirname(filePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(filePath, JSON.stringify(rows, null, 2), "utf-8");
  } catch (err) {
    logger.error({ err, kind, officeId }, "Failed to write isolated office local store");
    throw new ExternalServiceError("فشل تثبيت البيانات في وحدة التخزين الدائمة.");
  }
}

/**
 * Resolves the authenticated user's canonical office scope.
 * Never falls back to a shared global tenant for non-admin accounts.
 */
export async function resolveOfficeScope(userId?: string): Promise<OfficeScope> {
  if (!userId) {
    throw new OfficeLinkIncompleteError("لا يمكن تنفيذ العملية بدون تحديد هوية الحساب والمكتب.");
  }

  const user = await findSupabaseUserById(userId);
  if (!user) {
    throw new OfficeLinkIncompleteError("تعذر التحقق من حساب المكتب المرتبط بالعملية.");
  }

  const isAdmin = user.role === "admin";
  const officeId = user.office_id || (isAdmin ? "platform-admin" : user.id);
  return {
    userId: user.id,
    officeId,
    isAdmin,
  };
}

function buildJwtSheetsClient(credentials: {
  client_email: string;
  private_key: string;
}): sheets_v4.Sheets {
  const privateKey = credentials.private_key.replace(/\\n/g, "\n");
  const auth = new google.auth.JWT({
    email: credentials.client_email,
    key: privateKey,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  return google.sheets({ version: "v4", auth });
}

function getDefaultClient(): sheets_v4.Sheets {
  const credentials = env.googleServiceAccountJson as {
    client_email?: string;
    private_key?: string;
  } | null;
  if (!credentials?.client_email || !credentials?.private_key) {
    throw new OfficeLinkIncompleteError(
      "ملف اعتماد Google Service Account غير مهيأ في إعدادات المنصة.",
    );
  }
  const fp = `${credentials.client_email}:${credentials.private_key.length}`;
  if (!defaultSheetsClient || defaultClientFingerprint !== fp) {
    defaultSheetsClient = buildJwtSheetsClient({
      client_email: credentials.client_email,
      private_key: credentials.private_key,
    });
    defaultClientFingerprint = fp;
  }
  return defaultSheetsClient;
}

export type OfficeGoogleLinkState =
  | { status: "connected"; spreadsheetId: string; sheetName: string }
  | { status: "local_isolated"; message: string }
  | { status: "unlinked"; message: string }
  | { status: "incomplete"; message: string };

/**
 * Inspects an office's Google Sheets connection state without throwing,
 * used by `/api/auth/me` so sidebar and dashboard display one unified truth.
 */
export async function getOfficeGoogleLinkState(userId: string): Promise<OfficeGoogleLinkState> {
  try {
    const scope = await resolveOfficeScope(userId);
    const creds = await getUserGoogleCredentials(scope.userId, scope.officeId);

    const spreadsheetId = creds?.spreadsheetId?.trim() || "";
    const sa = creds?.serviceAccountJson as { client_email?: string; private_key?: string } | null;
    const hasSa = Boolean(sa?.client_email && sa?.private_key);

    if (spreadsheetId && hasSa) {
      return {
        status: "connected",
        spreadsheetId,
        sheetName: creds?.sheetName?.trim() || "Sessions",
      };
    }

    if ((spreadsheetId && !hasSa) || (!spreadsheetId && hasSa)) {
      return {
        status: "incomplete",
        message: "ربط المكتب غير مكتمل (يرجى استكمال معرّف الشيت وملف الخدمة معاً).",
      };
    }

    if (scope.isAdmin && isGoogleSheetsConfigured()) {
      return {
        status: "connected",
        spreadsheetId: env.googleSpreadsheetId,
        sheetName: env.googleSheetName || "Sessions",
      };
    }

    const requireCloudLink =
      process.env.REQUIRE_OFFICE_GOOGLE_LINK === "true" ||
      isGoogleSheetsConfigured() ||
      isStatelessServerlessProd();

    if (requireCloudLink) {
      return {
        status: "unlinked",
        message: "ربط المكتب غير مكتمل",
      };
    }

    return {
      status: "local_isolated",
      message: "تخزين محلي معزول للمكتب",
    };
  } catch {
    return {
      status: "unlinked",
      message: "ربط المكتب غير مكتمل",
    };
  }
}

/**
 * Resolves the Google Sheets context strictly for the caller's office.
 * - Never falls back from a non-admin office to the global spreadsheet.
 * - Throws `OfficeLinkIncompleteError` ("ربط المكتب غير مكتمل") when an office has
 *   partial credentials or when Google Sheets mode is active and the office is unlinked.
 * - Returns `null` ONLY in isolated local/dev mode where no cloud sheet is configured.
 */
export async function getGoogleContext(userId?: string): Promise<GoogleContext | null> {
  const scope = await resolveOfficeScope(userId);
  const userCreds = await getUserGoogleCredentials(scope.userId, scope.officeId);

  const officeSpreadsheetId = userCreds?.spreadsheetId?.trim() || "";
  const officeSa = userCreds?.serviceAccountJson as {
    client_email?: string;
    private_key?: string;
  } | null;
  const hasOfficeSa = Boolean(officeSa?.client_email && officeSa?.private_key);

  if (officeSpreadsheetId && hasOfficeSa) {
    const fp = `${officeSa!.client_email}:${officeSa!.private_key!.length}`;
    const cacheEntry = userClientsMap.get(scope.officeId);
    let client: sheets_v4.Sheets;
    if (cacheEntry && cacheEntry.fingerprint === fp) {
      client = cacheEntry.client;
    } else {
      client = buildJwtSheetsClient({
        client_email: officeSa!.client_email!,
        private_key: officeSa!.private_key!,
      });
      userClientsMap.set(scope.officeId, { fingerprint: fp, client });
    }
    return {
      sheets: client,
      spreadsheetId: officeSpreadsheetId,
      sheetName: userCreds?.sheetName?.trim() || "Sessions",
      officeId: scope.officeId,
    };
  }

  // Partial configuration on the office is ALWAYS an explicit error
  if ((officeSpreadsheetId && !hasOfficeSa) || (!officeSpreadsheetId && hasOfficeSa)) {
    throw new OfficeLinkIncompleteError(
      "ربط المكتب غير مكتمل: يجب توفير كلٍ من معرّف جدول البيانات (Spreadsheet ID) وملف حساب الخدمة (Service Account JSON) للمكتب.",
    );
  }

  // Platform Admin (and ONLY Platform Admin) is explicitly authorized to use the global sheet
  if (scope.isAdmin && isGoogleSheetsConfigured()) {
    return {
      sheets: getDefaultClient(),
      spreadsheetId: env.googleSpreadsheetId,
      sheetName: env.googleSheetName || "Sessions",
      officeId: scope.officeId,
      isGlobalAdminSheet: true,
    };
  }

  // Non-admin office without Google Sheets link:
  // If platform runs in Google Sheets mode, stateless serverless prod, or explicit enforcement, REJECT!
  const requireCloudLink =
    process.env.REQUIRE_OFFICE_GOOGLE_LINK === "true" ||
    isGoogleSheetsConfigured() ||
    isStatelessServerlessProd();

  if (!scope.isAdmin && requireCloudLink) {
    throw new OfficeLinkIncompleteError(
      "ربط المكتب غير مكتمل: لم يتم ربط حساب المكتب بجدول بيانات مخصص بعد. يرجى مراجعة مسؤول المنصة لإتمام الربط.",
    );
  }

  return null;
}

function padRowValues(values: SheetRow, length: number): SheetRow {
  const copy = [...values];
  while (copy.length < length) {
    copy.push("");
  }
  return copy.slice(0, length);
}

/**
 * Ensures the target sheet tab exists with the expected header row.
 * IMPORTANT: Called ONLY before write operations or explicit diagnostics — NEVER during GET reads!
 */
export async function ensureSheetReady(userId?: string): Promise<void> {
  const ctx = await getGoogleContext(userId);
  if (!ctx) return;

  try {
    const spreadsheet = await ctx.sheets.spreadsheets.get({
      spreadsheetId: ctx.spreadsheetId,
    });
    const existing = spreadsheet.data.sheets?.find(
      (s) => s.properties?.title === ctx.sheetName,
    );

    if (!existing) {
      await ctx.sheets.spreadsheets.batchUpdate({
        spreadsheetId: ctx.spreadsheetId,
        requestBody: {
          requests: [{ addSheet: { properties: { title: ctx.sheetName } } }],
        },
      });
    }

    // Check header first before writing to avoid unnecessary writes
    const headerRes = await ctx.sheets.spreadsheets.values.get({
      spreadsheetId: ctx.spreadsheetId,
      range: `${ctx.sheetName}!A1:Q1`,
    });
    const currentHeader = headerRes.data.values?.[0] ?? [];
    if (currentHeader.length < SHEET_COLUMNS.length || currentHeader[0] !== SHEET_COLUMNS[0]) {
      await ctx.sheets.spreadsheets.values.update({
        spreadsheetId: ctx.spreadsheetId,
        range: `${ctx.sheetName}!A1:Q1`,
        valueInputOption: "RAW",
        requestBody: { values: [[...SHEET_COLUMNS]] },
      });
    }
  } catch (err: any) {
    logger.error(
      { code: err?.code, officeId: ctx.officeId },
      "ensureSheetReady failed on Google Sheets",
    );
    throw new ExternalServiceError(
      "تعذر تهيئة ورقة الجلسات في Google Sheets. يرجى التحقق من صلاحيات المحرر (Editor) ومعرّف الجدول.",
    );
  }
}

export async function listSessionRecordsRaw(
  userId?: string,
  options?: { includeDeleted?: boolean; forceRefresh?: boolean },
): Promise<{ records: StoredSheetRecord[]; syncedAt: string }> {
  const scope = await resolveOfficeScope(userId);
  const cacheKey = scope.officeId;
  const now = Date.now();
  const cached = sessionsCache.get(cacheKey);

  if (!options?.forceRefresh && cached && cached.expiresAt > now) {
    const filtered = options?.includeDeleted
      ? cached.records
      : cached.records.filter((r) => !r.meta.deletedAt);
    return { records: filtered, syncedAt: cached.syncedAt };
  }

  const ctx = await getGoogleContext(userId);
  if (ctx) {
    try {
      const response = await ctx.sheets.spreadsheets.values.get({
        spreadsheetId: ctx.spreadsheetId,
        range: `${ctx.sheetName}!A2:R${MAX_BOUNDED_ROWS}`,
      });
      const rawRows = response.data.values ?? [];
      const records: StoredSheetRecord[] = [];

      for (let i = 0; i < rawRows.length; i++) {
        const fullRow = rawRows[i] as string[];
        const dataCells = padRowValues(fullRow, SESSION_DATA_COLS);
        const hasContent = dataCells.some((c) => c !== undefined && c !== "");
        const rawMetaCell = fullRow[SESSION_META_COL_INDEX];
        if (!hasContent && !rawMetaCell) continue;

        const meta = parseRowMeta(rawMetaCell, dataCells, scope.officeId);
        if (!isRowOwnedByOffice(meta, scope.officeId)) continue;

        records.push({
          id: meta.id,
          physicalRowNumber: i + 2,
          values: dataCells,
          meta,
        });
      }

      const syncedAt = new Date().toISOString();
      sessionsCache.set(cacheKey, {
        syncedAt,
        expiresAt: now + SESSIONS_CACHE_TTL_MS,
        records,
      });

      const filtered = options?.includeDeleted
        ? records
        : records.filter((r) => !r.meta.deletedAt);
      return { records: filtered, syncedAt };
    } catch (err: any) {
      // If the tab itself doesn't exist yet on a fresh spreadsheet, return empty list cleanly
      const msg = String(err?.message || "");
      if (msg.includes("Unable to parse range") || err?.code === 400) {
        const syncedAt = new Date().toISOString();
        return { records: [], syncedAt };
      }
      logger.error(
        { code: err?.code, officeId: scope.officeId },
        "Google Sheets listSessionRecordsRaw failed",
      );
      throw new ExternalServiceError(
        "تعذر استرجاع الجلسات من Google Sheets. يرجى التحقق من اتصال الجدول وصلاحيات الوصول.",
      );
    }
  }

  // Isolated per-office local durable store (dev / local / test mode)
  const stored = readOfficeLocalRows<{ id: number; values: SheetRow; meta?: SheetRowMeta }>(
    "sessions",
    scope.officeId,
  );
  const records: StoredSheetRecord[] = stored
    .map((item, idx) => {
      const dataCells = padRowValues(item.values || [], SESSION_DATA_COLS);
      const meta =
        item.meta ??
        parseRowMeta(item.values?.[SESSION_META_COL_INDEX], dataCells, scope.officeId);
      if (item.id && !item.meta) {
        meta.id = item.id;
      }
      return {
        id: meta.id,
        physicalRowNumber: idx + 2,
        values: dataCells,
        meta,
      };
    })
    .filter((r) => isRowOwnedByOffice(r.meta, scope.officeId));

  const syncedAt = new Date().toISOString();
  sessionsCache.set(cacheKey, {
    syncedAt,
    expiresAt: now + SESSIONS_CACHE_TTL_MS,
    records,
  });

  const filtered = options?.includeDeleted
    ? records
    : records.filter((r) => !r.meta.deletedAt);
  return { records: filtered, syncedAt };
}

/** Returns every active data row (excluding soft-deleted rows) as `{ id, values, meta }`. */
export async function listRows(
  userId?: string,
): Promise<{ id: number; values: SheetRow; meta: SheetRowMeta }[]> {
  const { records } = await listSessionRecordsRaw(userId);
  return records.map((r) => ({ id: r.id, values: r.values, meta: r.meta }));
}

/** Appends a new session row with a permanent stable ID inside an office write lock. */
export async function appendRow(
  values: SheetRow,
  userId?: string,
  extraMeta?: Partial<SheetRowMeta>,
): Promise<{ id: number; meta: SheetRowMeta }> {
  const scope = await resolveOfficeScope(userId);
  const lockKey = `sessions:${scope.officeId}`;

  return withSheetLock(lockKey, async () => {
    invalidateSessionsCache(scope.officeId);
    const meta = createNewRowMeta(scope.officeId, scope.userId, extraMeta);
    const dataCells = padRowValues(values, SESSION_DATA_COLS);
    const rowWithMeta = [...dataCells, serializeRowMeta(meta)];

    const ctx = await getGoogleContext(userId);
    if (ctx) {
      await ensureSheetReady(userId);
      try {
        await ctx.sheets.spreadsheets.values.append({
          spreadsheetId: ctx.spreadsheetId,
          range: `${ctx.sheetName}!A:R`,
          valueInputOption: "RAW",
          insertDataOption: "INSERT_ROWS",
          requestBody: { values: [rowWithMeta] },
        });
        invalidateSessionsCache(scope.officeId);
        return { id: meta.id, meta };
      } catch (err: any) {
        logger.error({ code: err?.code, officeId: scope.officeId }, "Google Sheets appendRow failed");
        throw new ExternalServiceError("فشل حفظ الجلسة في Google Sheets.");
      }
    }

    const local = readOfficeLocalRows<{ id: number; values: SheetRow; meta: SheetRowMeta }>(
      "sessions",
      scope.officeId,
    );
    local.push({ id: meta.id, values: dataCells, meta });
    writeOfficeLocalRows("sessions", scope.officeId, local);
    invalidateSessionsCache(scope.officeId);
    return { id: meta.id, meta };
  });
}

/** Updates a session row by its permanent stable `id` (looking up the exact physical row under lock). */
export async function updateRow(
  stableId: number,
  values: SheetRow,
  userId?: string,
  metaPatch?: Partial<SheetRowMeta>,
): Promise<SheetRowMeta> {
  const scope = await resolveOfficeScope(userId);
  const lockKey = `sessions:${scope.officeId}`;

  return withSheetLock(lockKey, async () => {
    invalidateSessionsCache(scope.officeId);
    const { records } = await listSessionRecordsRaw(userId, {
      includeDeleted: true,
      forceRefresh: true,
    });
    const target = records.find((r) => r.id === stableId);
    if (!target) {
      throw new NotFoundError("الجلسة المطلوبة غير موجودة أو لا تتبع لهذا المكتب.");
    }

    const updatedMeta: SheetRowMeta = {
      ...target.meta,
      ...metaPatch,
      id: target.meta.id,
      recordId: target.meta.recordId,
      officeId: scope.officeId,
      updatedAt: new Date().toISOString(),
    };
    const dataCells = padRowValues(values, SESSION_DATA_COLS);
    const rowWithMeta = [...dataCells, serializeRowMeta(updatedMeta)];

    const ctx = await getGoogleContext(userId);
    if (ctx) {
      try {
        const rowNum = target.physicalRowNumber;
        await ctx.sheets.spreadsheets.values.update({
          spreadsheetId: ctx.spreadsheetId,
          range: `${ctx.sheetName}!A${rowNum}:R${rowNum}`,
          valueInputOption: "RAW",
          requestBody: { values: [rowWithMeta] },
        });
        invalidateSessionsCache(scope.officeId);
        return updatedMeta;
      } catch (err: any) {
        logger.error({ code: err?.code, officeId: scope.officeId }, "Google Sheets updateRow failed");
        throw new ExternalServiceError("فشل تحديث بيانات الجلسة في Google Sheets.");
      }
    }

    const local = readOfficeLocalRows<{ id: number; values: SheetRow; meta: SheetRowMeta }>(
      "sessions",
      scope.officeId,
    );
    const idx = local.findIndex((r) => (r.meta?.id ?? r.id) === stableId);
    if (idx === -1) {
      throw new NotFoundError("الجلسة المطلوبة غير موجودة.");
    }
    local[idx] = { id: stableId, values: dataCells, meta: updatedMeta };
    writeOfficeLocalRows("sessions", scope.officeId, local);
    invalidateSessionsCache(scope.officeId);
    return updatedMeta;
  });
}

/** Overwrites specific columns on a row identified by its permanent `stableId`. */
export async function updateRowCells(
  stableId: number,
  updates: Record<number, string>,
  userId?: string,
  metaPatch?: Partial<SheetRowMeta>,
): Promise<void> {
  const scope = await resolveOfficeScope(userId);
  const lockKey = `sessions:${scope.officeId}`;

  await withSheetLock(lockKey, async () => {
    invalidateSessionsCache(scope.officeId);
    const { records } = await listSessionRecordsRaw(userId, {
      includeDeleted: true,
      forceRefresh: true,
    });
    const target = records.find((r) => r.id === stableId && !r.meta.deletedAt);
    if (!target) {
      throw new NotFoundError("الجلسة المطلوبة غير موجودة.");
    }

    const mergedCells = padRowValues(target.values, SESSION_DATA_COLS);
    for (const [colIdx, val] of Object.entries(updates)) {
      const idxNum = Number(colIdx);
      if (idxNum >= 0 && idxNum < SESSION_DATA_COLS) {
        mergedCells[idxNum] = val;
      }
    }
    const updatedMeta: SheetRowMeta = {
      ...target.meta,
      ...metaPatch,
      updatedAt: new Date().toISOString(),
    };

    const ctx = await getGoogleContext(userId);
    if (ctx) {
      try {
        const rowNum = target.physicalRowNumber;
        await ctx.sheets.spreadsheets.values.update({
          spreadsheetId: ctx.spreadsheetId,
          range: `${ctx.sheetName}!A${rowNum}:R${rowNum}`,
          valueInputOption: "RAW",
          requestBody: { values: [[...mergedCells, serializeRowMeta(updatedMeta)]] },
        });
        invalidateSessionsCache(scope.officeId);
        return;
      } catch (err: any) {
        logger.error({ code: err?.code, officeId: scope.officeId }, "Google Sheets updateRowCells failed");
        throw new ExternalServiceError("فشل تحديث حقول الجلسة في Google Sheets.");
      }
    }

    const local = readOfficeLocalRows<{ id: number; values: SheetRow; meta: SheetRowMeta }>(
      "sessions",
      scope.officeId,
    );
    const idx = local.findIndex((r) => (r.meta?.id ?? r.id) === stableId);
    if (idx !== -1) {
      local[idx] = { id: stableId, values: mergedCells, meta: updatedMeta };
      writeOfficeLocalRows("sessions", scope.officeId, local);
    }
    invalidateSessionsCache(scope.officeId);
  });
}

/**
 * Soft-deletes a session by its permanent `stableId` (preserving row order and allowing trash restore).
 * Never shifts subsequent row IDs!
 */
export async function deleteRow(stableId: number, userId?: string): Promise<boolean> {
  const scope = await resolveOfficeScope(userId);
  const { records } = await listSessionRecordsRaw(userId, {
    includeDeleted: false,
    forceRefresh: true,
  });
  const target = records.find((r) => r.id === stableId);
  if (!target) {
    return false;
  }

  await updateRow(stableId, target.values, userId, {
    deletedAt: new Date().toISOString(),
    deletedBy: scope.userId,
  });
  return true;
}

export async function restoreSessionRow(stableId: number, userId?: string): Promise<boolean> {
  const { records } = await listSessionRecordsRaw(userId, {
    includeDeleted: true,
    forceRefresh: true,
  });
  const target = records.find((r) => r.id === stableId && Boolean(r.meta.deletedAt));
  if (!target) {
    return false;
  }
  await updateRow(stableId, target.values, userId, {
    deletedAt: null,
    deletedBy: null,
  });
  return true;
}

// ── Google Sheets Diagnostic & Health Test ───────────────────────────────────

export async function testGoogleSheetsConnection(userId?: string): Promise<SheetsConnectionDiagnostic> {
  let credentials = env.googleServiceAccountJson as {
    client_email?: string;
    private_key?: string;
  } | null;
  let spreadsheetId = env.googleSpreadsheetId;

  if (userId) {
    try {
      const scope = await resolveOfficeScope(userId);
      const userCreds = await getUserGoogleCredentials(scope.userId, scope.officeId);
      if (userCreds?.spreadsheetId || userCreds?.serviceAccountJson) {
        spreadsheetId = userCreds.spreadsheetId || "";
        credentials = (userCreds.serviceAccountJson as any) || null;
      } else if (!scope.isAdmin) {
        return {
          success: false,
          stage: "credentials",
          message: "ربط المكتب غير مكتمل: لم يتم تعيين جدول بيانات خاص بهذا المكتب.",
          recommendation: "يرجى التواصل مع المشرف العام لربط جدول Google Sheets الخاص بمكتبكم.",
        };
      }
    } catch {
      // Proceed to check credentials below
    }
  }

  if (!credentials || !credentials.client_email || !credentials.private_key) {
    return {
      success: false,
      stage: "credentials",
      message: "ملف Google Service Account JSON غير موجود أو غير مكتمل (ينقصه client_email أو private_key).",
      recommendation: "يرجى نسخ محتوى ملف الاعتماد (service-account.json) بالكامل وإضافته في الإعدادات.",
    };
  }

  if (!spreadsheetId || !spreadsheetId.trim()) {
    return {
      success: false,
      stage: "connection",
      clientEmail: credentials.client_email,
      message: "معرّف الجدول (Spreadsheet ID) فارغ ولم يتم تحديده.",
      recommendation: "يرجى نسخ معرّف الجدول من رابط الشيت (بين /d/ و /edit) ولصقه في خانة Spreadsheet ID.",
    };
  }

  try {
    const client = buildJwtSheetsClient({
      client_email: credentials.client_email,
      private_key: credentials.private_key,
    });
    const spreadsheet = await client.spreadsheets.get({
      spreadsheetId: spreadsheetId.trim(),
    });

    const sheetsFound =
      spreadsheet.data.sheets?.map((s) => s.properties?.title || "").filter(Boolean) || [];

    // Canonical tab names matching poa.sheets, judgment.sheets ("Judgment"), and task.sheets
    const requiredTabs = ["Sessions", "Attorney", "Judgment", "Tasks"];
    const missingTabs = requiredTabs.filter((t) => !sheetsFound.includes(t));

    if (missingTabs.length > 0) {
      try {
        await client.spreadsheets.batchUpdate({
          spreadsheetId: spreadsheetId.trim(),
          requestBody: {
            requests: missingTabs.map((title) => ({
              addSheet: { properties: { title } },
            })),
          },
        });
        sheetsFound.push(...missingTabs);
      } catch (tabErr) {
        logger.warn({ code: (tabErr as any)?.code }, "Could not auto-create missing tabs");
      }
    }

    try {
      await client.spreadsheets.values.update({
        spreadsheetId: spreadsheetId.trim(),
        range: "Sessions!A1:Q1",
        valueInputOption: "RAW",
        requestBody: { values: [[...SHEET_COLUMNS]] },
      });
    } catch (writeErr: any) {
      if (writeErr?.code === 403 || String(writeErr?.message).includes("permission")) {
        return {
          success: false,
          stage: "permissions",
          clientEmail: credentials.client_email,
          spreadsheetId: spreadsheetId.trim(),
          message: "الحساب البرمجي لديه صلاحية قراءة فقط ولا يمتلك صلاحية التعديل (Editor).",
          recommendation: `افتح الشيت في Google Drive، واضغط مشاركة (Share)، وأعطِ البريد (${credentials.client_email}) صلاحية محرر (Editor).`,
        };
      }
    }

    return {
      success: true,
      stage: "ready",
      clientEmail: credentials.client_email,
      spreadsheetId: spreadsheetId.trim(),
      sheetsFound,
      message: "تم فحص الاتصال بـ Google Sheets بنجاح! الشيت متصل وصلاحيات المحرر متوفرة، وجميع أوراق العمل جاهزة.",
    };
  } catch (err: any) {
    const errStr = String(err?.message || "");
    const code = err?.code || err?.status;

    if (code === 404 || errStr.includes("not found")) {
      return {
        success: false,
        stage: "connection",
        clientEmail: credentials.client_email,
        spreadsheetId: spreadsheetId.trim(),
        message: "لم يتم العثور على ملف جدول Google Spreadsheet بالمعرّف المدخل.",
        recommendation: "تأكد من صحة الـ Spreadsheet ID المنسوخ من رابط الشيت.",
      };
    }

    if (code === 403 || errStr.includes("permission") || errStr.includes("The caller does not have permission")) {
      return {
        success: false,
        stage: "permissions",
        clientEmail: credentials.client_email,
        spreadsheetId: spreadsheetId.trim(),
        message: "الحساب البرمجي لا يمتلك صلاحية الوصول إلى الشيت.",
        recommendation: `افتح الشيت في Google Drive، اضغط على زر مشاركة (Share) في الأعلى، وأضف البريد التالي بصلاحية محرر (Editor):\n${credentials.client_email}`,
      };
    }

    if (errStr.includes("invalid_grant")) {
      return {
        success: false,
        stage: "credentials",
        clientEmail: credentials.client_email,
        spreadsheetId: spreadsheetId.trim(),
        message: "فشل التفويض الأمني (invalid_grant) مع سيرفرات Google.",
        recommendation: "تأكد من صحة Private Key وتزامن ساعة الخادم مع التوقيت العالمي.",
      };
    }

    return {
      success: false,
      stage: "connection",
      clientEmail: credentials.client_email,
      spreadsheetId: spreadsheetId.trim(),
      message: `تعذر الاتصال بـ Google Sheets: ${err?.message || "خطأ غير معروف"}`,
      recommendation: "يرجى مراجعة إعدادات الشبكة ومفتاح الاعتماد.",
    };
  }
}
