import { type sheets_v4 } from "googleapis";
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
 * Google Sheets service for Judgment (الأحكام) records
 * with strict per-office isolation, permanent stable IDs, read-only GETs,
 * write serialization, and soft-delete / restore support.
 *
 * Columns A..J (0..9): canonical Arabic Judgment columns.
 * Column K (10): `_meta_json` metadata cell (includes `rulingOutcome` & `judgmentType`).
 */

const JUDGMENT_SHEET_NAME = "Judgment";
const LEGACY_JUDGMENTS_SHEET_NAME = "Judgments";
const MAX_BOUNDED_ROWS = 2000;

export const JUDGMENT_SHEET_COLUMNS = [
  "رقم القضية",
  "المحكمة المختصة",
  "المدعي",
  "المدعى عليه",
  "المحامي المكلف",
  "رقم الصك",
  "تاريخ الحكم",
  "ملخص الحكم",
  "الحكم",
  "تاريخ الإنشاء",
] as const;

export const JUDGMENT_COLS = JUDGMENT_SHEET_COLUMNS.length; // 10 (A..J)
const JUDGMENT_META_COL_INDEX = JUDGMENT_COLS; // 10 (K)
const COL_DATA_LAST = "J";
const COL_WITH_META_LAST = "K";

export type JudgmentRow = string[];

export interface StoredJudgmentRecord {
  id: number;
  physicalRowNumber: number;
  values: JudgmentRow;
  meta: SheetRowMeta;
}

const judgmentDataCacheMap = new Map<
  string,
  { syncedAt: string; time: number; records: StoredJudgmentRecord[] }
>();
const JUDGMENT_CACHE_TTL_MS = 10_000;

export function invalidateJudgmentCache(officeOrUserId?: string): void {
  if (!officeOrUserId) {
    judgmentDataCacheMap.clear();
    return;
  }
  for (const key of judgmentDataCacheMap.keys()) {
    if (key.includes(officeOrUserId)) {
      judgmentDataCacheMap.delete(key);
    }
  }
}

function padJudgmentCells(values: JudgmentRow): JudgmentRow {
  const copy = [...values];
  while (copy.length < JUDGMENT_COLS) {
    copy.push("");
  }
  return copy.slice(0, JUDGMENT_COLS);
}

async function resolveJudgmentTabTitle(context: {
  sheets: sheets_v4.Sheets;
  spreadsheetId: string;
}): Promise<string> {
  const spreadsheet = await context.sheets.spreadsheets.get({
    spreadsheetId: context.spreadsheetId,
  });
  const titles =
    spreadsheet.data.sheets?.map((s) => s.properties?.title || "").filter(Boolean) || [];
  if (titles.includes(JUDGMENT_SHEET_NAME)) return JUDGMENT_SHEET_NAME;
  if (titles.includes(LEGACY_JUDGMENTS_SHEET_NAME)) return LEGACY_JUDGMENTS_SHEET_NAME;
  return JUDGMENT_SHEET_NAME;
}

/**
 * Ensures the Judgment sheet tab exists with canonical headers.
 * IMPORTANT: Called ONLY before write operations — NEVER during GET reads!
 */
export async function ensureJudgmentSheetReady(userId?: string): Promise<string> {
  const context = await getGoogleContext(userId);
  if (!context) return JUDGMENT_SHEET_NAME;

  try {
    const spreadsheet = await context.sheets.spreadsheets.get({
      spreadsheetId: context.spreadsheetId,
    });
    const titles =
      spreadsheet.data.sheets?.map((s) => s.properties?.title || "").filter(Boolean) || [];
    let tabTitle = JUDGMENT_SHEET_NAME;

    if (titles.includes(JUDGMENT_SHEET_NAME)) {
      tabTitle = JUDGMENT_SHEET_NAME;
    } else if (titles.includes(LEGACY_JUDGMENTS_SHEET_NAME)) {
      tabTitle = LEGACY_JUDGMENTS_SHEET_NAME;
    } else {
      await context.sheets.spreadsheets.batchUpdate({
        spreadsheetId: context.spreadsheetId,
        requestBody: {
          requests: [{ addSheet: { properties: { title: JUDGMENT_SHEET_NAME } } }],
        },
      });
    }

    const headerRes = await context.sheets.spreadsheets.values.get({
      spreadsheetId: context.spreadsheetId,
      range: `${tabTitle}!A1:${COL_DATA_LAST}1`,
    });
    const currentHeader = headerRes.data.values?.[0] ?? [];
    if (currentHeader.length < JUDGMENT_COLS || currentHeader[0] !== JUDGMENT_SHEET_COLUMNS[0]) {
      await context.sheets.spreadsheets.values.update({
        spreadsheetId: context.spreadsheetId,
        range: `${tabTitle}!A1:${COL_DATA_LAST}1`,
        valueInputOption: "RAW",
        requestBody: { values: [[...JUDGMENT_SHEET_COLUMNS]] },
      });
    }
    return tabTitle;
  } catch (err: any) {
    logger.error({ code: err?.code, officeId: context.officeId }, "ensureJudgmentSheetReady failed");
    throw new ExternalServiceError("تعذر تهيئة ورقة الأحكام في Google Sheets.");
  }
}

export async function listJudgmentRecordsWithMeta(
  forceRefresh = false,
  userId?: string,
  includeDeleted = false,
): Promise<{ records: StoredJudgmentRecord[]; syncedAt: string }> {
  const scope = await resolveOfficeScope(userId);
  const cacheKey = scope.officeId;
  const now = Date.now();
  const cached = judgmentDataCacheMap.get(cacheKey);

  if (!forceRefresh && cached && now - cached.time < JUDGMENT_CACHE_TTL_MS) {
    const filtered = includeDeleted
      ? cached.records
      : cached.records.filter((r) => !r.meta.deletedAt);
    return { records: filtered, syncedAt: cached.syncedAt };
  }

  const context = await getGoogleContext(userId);
  if (context) {
    try {
      const tabTitle = await resolveJudgmentTabTitle(context);
      const response = await context.sheets.spreadsheets.values.get({
        spreadsheetId: context.spreadsheetId,
        range: `${tabTitle}!A2:${COL_WITH_META_LAST}${MAX_BOUNDED_ROWS}`,
      });
      const rows = response.data.values ?? [];
      const records: StoredJudgmentRecord[] = [];

      for (let i = 0; i < rows.length; i++) {
        const fullRow = rows[i] as string[];
        const dataCells = padJudgmentCells(fullRow);
        const hasContent = dataCells.some((cell) => cell !== undefined && cell !== "");
        const rawMetaCell = fullRow[JUDGMENT_META_COL_INDEX];
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
      judgmentDataCacheMap.set(cacheKey, { syncedAt, time: now, records });
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
      logger.error(
        { code: err?.code, officeId: scope.officeId },
        "Failed to fetch judgment rows from Google Sheets",
      );
      throw new ExternalServiceError(
        "تعذر قراءة سجل الأحكام من Google Sheets. يرجى التحقق من اتصال الجدول وصلاحيات الوصول.",
      );
    }
  }

  const stored = readOfficeLocalRows<{ id: number; values: JudgmentRow; meta?: SheetRowMeta }>(
    "judgments",
    scope.officeId,
  );
  const records: StoredJudgmentRecord[] = stored
    .map((item, idx) => {
      const dataCells = padJudgmentCells(item.values || []);
      const meta =
        item.meta ??
        parseRowMeta(item.values?.[JUDGMENT_META_COL_INDEX], dataCells, scope.officeId);
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
  judgmentDataCacheMap.set(cacheKey, { syncedAt, time: now, records });
  const filtered = includeDeleted
    ? records
    : records.filter((r) => !r.meta.deletedAt);
  return { records: filtered, syncedAt };
}

export async function listJudgmentRows(
  forceRefresh = false,
  userId?: string,
): Promise<{ id: number; values: JudgmentRow; meta: SheetRowMeta }[]> {
  const { records } = await listJudgmentRecordsWithMeta(forceRefresh, userId, false);
  return records.map((r) => ({ id: r.id, values: r.values, meta: r.meta }));
}

export async function listJudgmentRowsWithHeaders(
  forceRefresh = false,
  userId?: string,
): Promise<{
  headers: string[];
  rows: { id: number; values: JudgmentRow; meta: SheetRowMeta }[];
  syncedAt: string;
}> {
  const { records, syncedAt } = await listJudgmentRecordsWithMeta(forceRefresh, userId, false);
  return {
    headers: [...JUDGMENT_SHEET_COLUMNS],
    rows: records.map((r) => ({ id: r.id, values: r.values, meta: r.meta })),
    syncedAt,
  };
}

export async function appendJudgmentRow(
  values: JudgmentRow,
  userId?: string,
  extraMeta?: Partial<SheetRowMeta>,
): Promise<number> {
  const scope = await resolveOfficeScope(userId);
  const lockKey = `judgments:${scope.officeId}`;

  return withSheetLock(lockKey, async () => {
    invalidateJudgmentCache(scope.officeId);
    const meta = createNewRowMeta(scope.officeId, scope.userId, extraMeta);
    const dataCells = padJudgmentCells(values);
    const rowWithMeta = [...dataCells, serializeRowMeta(meta)];

    const context = await getGoogleContext(userId);
    if (context) {
      const tabTitle = await ensureJudgmentSheetReady(userId);
      try {
        await context.sheets.spreadsheets.values.append({
          spreadsheetId: context.spreadsheetId,
          range: `${tabTitle}!A:${COL_WITH_META_LAST}`,
          valueInputOption: "RAW",
          insertDataOption: "INSERT_ROWS",
          requestBody: { values: [rowWithMeta] },
        });
        invalidateJudgmentCache(scope.officeId);
        return meta.id;
      } catch (err: any) {
        logger.error(
          { code: err?.code, officeId: scope.officeId },
          "Google Sheets appendJudgmentRow failed",
        );
        throw new ExternalServiceError("فشل حفظ الحكم في Google Sheets.");
      }
    }

    const local = readOfficeLocalRows<{ id: number; values: JudgmentRow; meta: SheetRowMeta }>(
      "judgments",
      scope.officeId,
    );
    local.push({ id: meta.id, values: dataCells, meta });
    writeOfficeLocalRows("judgments", scope.officeId, local);
    invalidateJudgmentCache(scope.officeId);
    return meta.id;
  });
}

export async function updateJudgmentRow(
  stableId: number,
  values: JudgmentRow,
  userId?: string,
  metaPatch?: Partial<SheetRowMeta>,
): Promise<void> {
  const scope = await resolveOfficeScope(userId);
  const lockKey = `judgments:${scope.officeId}`;

  await withSheetLock(lockKey, async () => {
    invalidateJudgmentCache(scope.officeId);
    const { records } = await listJudgmentRecordsWithMeta(true, userId, true);
    const target = records.find((r) => r.id === stableId);
    if (!target) {
      throw new NotFoundError("الحكم غير موجود أو لا يتبع لهذا المكتب.");
    }

    const updatedMeta: SheetRowMeta = {
      ...target.meta,
      ...metaPatch,
      id: target.meta.id,
      recordId: target.meta.recordId,
      officeId: scope.officeId,
      updatedAt: new Date().toISOString(),
    };
    const dataCells = padJudgmentCells(values);
    const rowWithMeta = [...dataCells, serializeRowMeta(updatedMeta)];

    const context = await getGoogleContext(userId);
    if (context) {
      try {
        const tabTitle = await resolveJudgmentTabTitle(context);
        const rowNum = target.physicalRowNumber;
        await context.sheets.spreadsheets.values.update({
          spreadsheetId: context.spreadsheetId,
          range: `${tabTitle}!A${rowNum}:${COL_WITH_META_LAST}${rowNum}`,
          valueInputOption: "RAW",
          requestBody: { values: [rowWithMeta] },
        });
        invalidateJudgmentCache(scope.officeId);
        return;
      } catch (err: any) {
        logger.error(
          { code: err?.code, officeId: scope.officeId },
          "Google Sheets updateJudgmentRow failed",
        );
        throw new ExternalServiceError("فشل تحديث بيانات الحكم في Google Sheets.");
      }
    }

    const local = readOfficeLocalRows<{ id: number; values: JudgmentRow; meta: SheetRowMeta }>(
      "judgments",
      scope.officeId,
    );
    const idx = local.findIndex((r) => (r.meta?.id ?? r.id) === stableId);
    if (idx === -1) {
      throw new NotFoundError("الحكم غير موجود.");
    }
    local[idx] = { id: stableId, values: dataCells, meta: updatedMeta };
    writeOfficeLocalRows("judgments", scope.officeId, local);
    invalidateJudgmentCache(scope.officeId);
  });
}

export async function deleteJudgmentRow(stableId: number, userId?: string): Promise<boolean> {
  const scope = await resolveOfficeScope(userId);
  const { records } = await listJudgmentRecordsWithMeta(true, userId, false);
  const target = records.find((r) => r.id === stableId);
  if (!target) {
    return false;
  }
  await updateJudgmentRow(stableId, target.values, userId, {
    deletedAt: new Date().toISOString(),
    deletedBy: scope.userId,
  });
  return true;
}

export async function restoreJudgmentRow(stableId: number, userId?: string): Promise<boolean> {
  const { records } = await listJudgmentRecordsWithMeta(true, userId, true);
  const target = records.find((r) => r.id === stableId && Boolean(r.meta.deletedAt));
  if (!target) {
    return false;
  }
  await updateJudgmentRow(stableId, target.values, userId, {
    deletedAt: null,
    deletedBy: null,
  });
  return true;
}
