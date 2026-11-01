import { logger } from "../lib/logger";
import { ExternalServiceError, NotFoundError } from "../lib/errors";
import {
  getGoogleContext,
  resolveOfficeScope,
  readOfficeLocalRows,
  writeOfficeLocalRows,
} from "./googleSheets.service";
import {
  createNewRowMeta,
  parseRowMeta,
  serializeRowMeta,
  withSheetLock,
  isRowOwnedByOffice,
  type SheetRowMeta,
} from "../utils/sheetMeta";

/**
 * Google Sheets service for Power of Attorney (Wakala) records
 * with strict per-office isolation, permanent stable IDs, read-only GETs,
 * write serialization, and soft-delete / restore support.
 *
 * Columns A..G (0..6): canonical Arabic POA columns.
 * Column H (7): `_meta_json` metadata cell.
 */

const POA_SHEET_NAME = "Attorney";
const MAX_BOUNDED_ROWS = 2000;

export const POA_SHEET_COLUMNS = [
  "اسم العميل",
  "رقم الوكالة",
  "تاريخ الإصدار هجري",
  "تاريخ الانتهاء هجري",
  "الأيام المتبقية",
  "ملاحظات",
  "تاريخ الإنشاء",
] as const;

export const POA_COLS = POA_SHEET_COLUMNS.length; // 7 (A..G)
const POA_META_COL_INDEX = POA_COLS; // 7 (H)
const COL_DATA_LAST = "G";
const COL_WITH_META_LAST = "H";

export type PoaRow = string[];

export interface StoredPoaRecord {
  id: number;
  physicalRowNumber: number;
  values: PoaRow;
  meta: SheetRowMeta;
}

const poaDataCacheMap = new Map<
  string,
  { syncedAt: string; time: number; records: StoredPoaRecord[] }
>();
const POA_CACHE_TTL_MS = 10_000;

export function invalidatePoaCache(officeOrUserId?: string): void {
  if (!officeOrUserId) {
    poaDataCacheMap.clear();
    return;
  }
  for (const key of poaDataCacheMap.keys()) {
    if (key.includes(officeOrUserId)) {
      poaDataCacheMap.delete(key);
    }
  }
}

function padPoaCells(values: PoaRow): PoaRow {
  const copy = [...values];
  while (copy.length < POA_COLS) {
    copy.push("");
  }
  return copy.slice(0, POA_COLS);
}

/**
 * Ensures the "Attorney" sheet tab exists with canonical headers.
 * IMPORTANT: Called ONLY before write operations — NEVER during GET reads!
 */
export async function ensurePoaSheetReady(userId?: string): Promise<void> {
  const context = await getGoogleContext(userId);
  if (!context) return;

  try {
    const spreadsheet = await context.sheets.spreadsheets.get({
      spreadsheetId: context.spreadsheetId,
    });
    const existing = spreadsheet.data.sheets?.find(
      (s) => s.properties?.title === POA_SHEET_NAME,
    );

    if (!existing) {
      await context.sheets.spreadsheets.batchUpdate({
        spreadsheetId: context.spreadsheetId,
        requestBody: {
          requests: [{ addSheet: { properties: { title: POA_SHEET_NAME } } }],
        },
      });
    }

    const headerRes = await context.sheets.spreadsheets.values.get({
      spreadsheetId: context.spreadsheetId,
      range: `${POA_SHEET_NAME}!A1:${COL_DATA_LAST}1`,
    });
    const currentHeader = headerRes.data.values?.[0] ?? [];
    if (currentHeader.length < POA_COLS || currentHeader[0] !== POA_SHEET_COLUMNS[0]) {
      await context.sheets.spreadsheets.values.update({
        spreadsheetId: context.spreadsheetId,
        range: `${POA_SHEET_NAME}!A1:${COL_DATA_LAST}1`,
        valueInputOption: "RAW",
        requestBody: { values: [[...POA_SHEET_COLUMNS]] },
      });
    }
  } catch (err: any) {
    logger.error({ code: err?.code, officeId: context.officeId }, "ensurePoaSheetReady failed");
    throw new ExternalServiceError("تعذر تهيئة ورقة الوكالات في Google Sheets.");
  }
}

export async function listPoaRecordsWithMeta(
  forceRefresh = false,
  userId?: string,
  includeDeleted = false,
): Promise<{ records: StoredPoaRecord[]; syncedAt: string }> {
  const scope = await resolveOfficeScope(userId);
  const cacheKey = scope.officeId;
  const now = Date.now();
  const cached = poaDataCacheMap.get(cacheKey);

  if (!forceRefresh && cached && now - cached.time < POA_CACHE_TTL_MS) {
    const filtered = includeDeleted
      ? cached.records
      : cached.records.filter((r) => !r.meta.deletedAt);
    return { records: filtered, syncedAt: cached.syncedAt };
  }

  const context = await getGoogleContext(userId);
  if (context) {
    try {
      const response = await context.sheets.spreadsheets.values.get({
        spreadsheetId: context.spreadsheetId,
        range: `${POA_SHEET_NAME}!A2:${COL_WITH_META_LAST}${MAX_BOUNDED_ROWS}`,
      });
      const rows = response.data.values ?? [];
      const records: StoredPoaRecord[] = [];

      for (let i = 0; i < rows.length; i++) {
        const fullRow = rows[i] as string[];
        const dataCells = padPoaCells(fullRow);
        const hasContent = dataCells.some((cell) => cell !== undefined && cell !== "");
        const rawMetaCell = fullRow[POA_META_COL_INDEX];
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
      poaDataCacheMap.set(cacheKey, { syncedAt, time: now, records });
      const filtered = includeDeleted
        ? records
        : records.filter((r) => !r.meta.deletedAt);
      return { records: filtered, syncedAt };
    } catch (err: any) {
      const msg = String(err?.message || "");
      if (msg.includes("Unable to parse range") || err?.code === 400) {
        const syncedAt = new Date().toISOString();
        return { records: [], syncedAt };
      }
      logger.error({ code: err?.code, officeId: scope.officeId }, "Failed to fetch POA rows from Google Sheets");
      throw new ExternalServiceError(
        "تعذر قراءة سجل الوكالات من Google Sheets. يرجى التحقق من اتصال الجدول وصلاحيات الوصول.",
      );
    }
  }

  const stored = readOfficeLocalRows<{ id: number; values: PoaRow; meta?: SheetRowMeta }>(
    "poa",
    scope.officeId,
  );
  const records: StoredPoaRecord[] = stored
    .map((item, idx) => {
      const dataCells = padPoaCells(item.values || []);
      const meta =
        item.meta ??
        parseRowMeta(item.values?.[POA_META_COL_INDEX], dataCells, scope.officeId);
      if (item.id && !item.meta) meta.id = item.id;
      return {
        id: meta.id,
        physicalRowNumber: idx + 2,
        values: dataCells,
        meta,
      };
    })
    .filter((r) => isRowOwnedByOffice(r.meta, scope.officeId));

  const syncedAt = new Date().toISOString();
  poaDataCacheMap.set(cacheKey, { syncedAt, time: now, records });
  const filtered = includeDeleted
    ? records
    : records.filter((r) => !r.meta.deletedAt);
  return { records: filtered, syncedAt };
}

export async function listPoaRows(
  forceRefresh = false,
  userId?: string,
): Promise<{ id: number; values: PoaRow; meta: SheetRowMeta }[]> {
  const { records } = await listPoaRecordsWithMeta(forceRefresh, userId, false);
  return records.map((r) => ({ id: r.id, values: r.values, meta: r.meta }));
}

export async function appendPoaRow(
  values: PoaRow,
  userId?: string,
  extraMeta?: Partial<SheetRowMeta>,
): Promise<number> {
  const scope = await resolveOfficeScope(userId);
  const lockKey = `poa:${scope.officeId}`;

  return withSheetLock(lockKey, async () => {
    invalidatePoaCache(scope.officeId);
    const meta = createNewRowMeta(scope.officeId, scope.userId, extraMeta);
    const dataCells = padPoaCells(values);
    const rowWithMeta = [...dataCells, serializeRowMeta(meta)];

    const context = await getGoogleContext(userId);
    if (context) {
      await ensurePoaSheetReady(userId);
      try {
        await context.sheets.spreadsheets.values.append({
          spreadsheetId: context.spreadsheetId,
          range: `${POA_SHEET_NAME}!A:${COL_WITH_META_LAST}`,
          valueInputOption: "RAW",
          insertDataOption: "INSERT_ROWS",
          requestBody: { values: [rowWithMeta] },
        });
        invalidatePoaCache(scope.officeId);
        return meta.id;
      } catch (err: any) {
        logger.error({ code: err?.code, officeId: scope.officeId }, "Google Sheets appendPoaRow failed");
        throw new ExternalServiceError("فشل حفظ الوكالة في Google Sheets.");
      }
    }

    const local = readOfficeLocalRows<{ id: number; values: PoaRow; meta: SheetRowMeta }>(
      "poa",
      scope.officeId,
    );
    local.push({ id: meta.id, values: dataCells, meta });
    writeOfficeLocalRows("poa", scope.officeId, local);
    invalidatePoaCache(scope.officeId);
    return meta.id;
  });
}

export async function updatePoaRow(
  stableId: number,
  values: PoaRow,
  userId?: string,
  metaPatch?: Partial<SheetRowMeta>,
): Promise<void> {
  const scope = await resolveOfficeScope(userId);
  const lockKey = `poa:${scope.officeId}`;

  await withSheetLock(lockKey, async () => {
    invalidatePoaCache(scope.officeId);
    const { records } = await listPoaRecordsWithMeta(true, userId, true);
    const target = records.find((r) => r.id === stableId);
    if (!target) {
      throw new NotFoundError("الوكالة غير موجودة أو لا تتبع لهذا المكتب.");
    }

    const updatedMeta: SheetRowMeta = {
      ...target.meta,
      ...metaPatch,
      id: target.meta.id,
      recordId: target.meta.recordId,
      officeId: scope.officeId,
      updatedAt: new Date().toISOString(),
    };
    const dataCells = padPoaCells(values);
    const rowWithMeta = [...dataCells, serializeRowMeta(updatedMeta)];

    const context = await getGoogleContext(userId);
    if (context) {
      try {
        const rowNum = target.physicalRowNumber;
        await context.sheets.spreadsheets.values.update({
          spreadsheetId: context.spreadsheetId,
          range: `${POA_SHEET_NAME}!A${rowNum}:${COL_WITH_META_LAST}${rowNum}`,
          valueInputOption: "RAW",
          requestBody: { values: [rowWithMeta] },
        });
        invalidatePoaCache(scope.officeId);
        return;
      } catch (err: any) {
        logger.error({ code: err?.code, officeId: scope.officeId }, "Google Sheets updatePoaRow failed");
        throw new ExternalServiceError("فشل تحديث بيانات الوكالة في Google Sheets.");
      }
    }

    const local = readOfficeLocalRows<{ id: number; values: PoaRow; meta: SheetRowMeta }>(
      "poa",
      scope.officeId,
    );
    const idx = local.findIndex((r) => (r.meta?.id ?? r.id) === stableId);
    if (idx === -1) {
      throw new NotFoundError("الوكالة غير موجودة.");
    }
    local[idx] = { id: stableId, values: dataCells, meta: updatedMeta };
    writeOfficeLocalRows("poa", scope.officeId, local);
    invalidatePoaCache(scope.officeId);
  });
}

export async function deletePoaRow(stableId: number, userId?: string): Promise<boolean> {
  const scope = await resolveOfficeScope(userId);
  const { records } = await listPoaRecordsWithMeta(true, userId, false);
  const target = records.find((r) => r.id === stableId);
  if (!target) {
    return false;
  }
  await updatePoaRow(stableId, target.values, userId, {
    deletedAt: new Date().toISOString(),
    deletedBy: scope.userId,
  });
  return true;
}

export async function restorePoaRow(stableId: number, userId?: string): Promise<boolean> {
  const { records } = await listPoaRecordsWithMeta(true, userId, true);
  const target = records.find((r) => r.id === stableId && Boolean(r.meta.deletedAt));
  if (!target) {
    return false;
  }
  await updatePoaRow(stableId, target.values, userId, {
    deletedAt: null,
    deletedBy: null,
  });
  return true;
}
