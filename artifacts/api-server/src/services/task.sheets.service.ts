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
 * Google Sheets service for Tasks (المهام) records
 * with strict per-office isolation, permanent stable IDs, read-only GETs,
 * write serialization, and soft-delete / restore support.
 *
 * Columns A..H (0..7): canonical Arabic Task columns.
 * Column I (8): `_meta_json` metadata cell.
 */

const TASK_SHEET_NAME = "Tasks";
const MAX_BOUNDED_ROWS = 2000;

export const TASK_SHEET_COLUMNS = [
  "عنوان المهمة",
  "المكلف",
  "الأولوية",
  "تاريخ التسليم",
  "عدد الأيام المتبقية",
  "الحالة",
  "ملاحظات",
  "تاريخ الإنشاء",
] as const;

export const TASK_COLS = TASK_SHEET_COLUMNS.length; // 8 (A..H)
const TASK_META_COL_INDEX = TASK_COLS; // 8 (I)
const COL_DATA_LAST = "H";
const COL_WITH_META_LAST = "I";

export type TaskRow = string[];

export interface StoredTaskRecord {
  id: number;
  physicalRowNumber: number;
  values: TaskRow;
  meta: SheetRowMeta;
}

const taskDataCacheMap = new Map<
  string,
  { syncedAt: string; time: number; records: StoredTaskRecord[] }
>();
const TASK_CACHE_TTL_MS = 10_000;

export function invalidateTaskCache(officeOrUserId?: string): void {
  if (!officeOrUserId) {
    taskDataCacheMap.clear();
    return;
  }
  for (const key of taskDataCacheMap.keys()) {
    if (key.includes(officeOrUserId)) {
      taskDataCacheMap.delete(key);
    }
  }
}

function padTaskCells(values: TaskRow): TaskRow {
  const copy = [...values];
  while (copy.length < TASK_COLS) {
    copy.push("");
  }
  return copy.slice(0, TASK_COLS);
}

/**
 * Ensures the "Tasks" sheet tab exists with canonical headers.
 * IMPORTANT: Called ONLY before write operations — NEVER during GET reads!
 */
export async function ensureTaskSheetReady(userId?: string): Promise<void> {
  const context = await getGoogleContext(userId);
  if (!context) return;

  try {
    const spreadsheet = await context.sheets.spreadsheets.get({
      spreadsheetId: context.spreadsheetId,
    });
    const existing = spreadsheet.data.sheets?.find(
      (s) => s.properties?.title === TASK_SHEET_NAME,
    );

    if (!existing) {
      await context.sheets.spreadsheets.batchUpdate({
        spreadsheetId: context.spreadsheetId,
        requestBody: {
          requests: [{ addSheet: { properties: { title: TASK_SHEET_NAME } } }],
        },
      });
    }

    const headerRes = await context.sheets.spreadsheets.values.get({
      spreadsheetId: context.spreadsheetId,
      range: `${TASK_SHEET_NAME}!A1:${COL_DATA_LAST}1`,
    });
    const currentHeader = headerRes.data.values?.[0] ?? [];
    if (currentHeader.length < TASK_COLS || currentHeader[0] !== TASK_SHEET_COLUMNS[0]) {
      await context.sheets.spreadsheets.values.update({
        spreadsheetId: context.spreadsheetId,
        range: `${TASK_SHEET_NAME}!A1:${COL_DATA_LAST}1`,
        valueInputOption: "RAW",
        requestBody: { values: [[...TASK_SHEET_COLUMNS]] },
      });
    }
  } catch (err: any) {
    logger.error({ code: err?.code, officeId: context.officeId }, "ensureTaskSheetReady failed");
    throw new ExternalServiceError("تعذر تهيئة ورقة المهام في Google Sheets.");
  }
}

export async function listTaskRecordsWithMeta(
  forceRefresh = false,
  userId?: string,
  includeDeleted = false,
): Promise<{ records: StoredTaskRecord[]; syncedAt: string }> {
  const scope = await resolveOfficeScope(userId);
  const cacheKey = scope.officeId;
  const now = Date.now();
  const cached = taskDataCacheMap.get(cacheKey);

  if (!forceRefresh && cached && now - cached.time < TASK_CACHE_TTL_MS) {
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
        range: `${TASK_SHEET_NAME}!A2:${COL_WITH_META_LAST}${MAX_BOUNDED_ROWS}`,
      });
      const rows = response.data.values ?? [];
      const records: StoredTaskRecord[] = [];

      for (let i = 0; i < rows.length; i++) {
        const fullRow = rows[i] as string[];
        const dataCells = padTaskCells(fullRow);
        const hasContent = dataCells.some((cell) => cell !== undefined && cell !== "");
        const rawMetaCell = fullRow[TASK_META_COL_INDEX];
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
      taskDataCacheMap.set(cacheKey, { syncedAt, time: now, records });
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
      logger.error({ code: err?.code, officeId: scope.officeId }, "Failed to fetch task rows from Google Sheets");
      throw new ExternalServiceError(
        "تعذر قراءة سجل المهام من Google Sheets. يرجى التحقق من اتصال الجدول وصلاحيات الوصول.",
      );
    }
  }

  const stored = readOfficeLocalRows<{ id: number; values: TaskRow; meta?: SheetRowMeta }>(
    "tasks",
    scope.officeId,
  );
  const records: StoredTaskRecord[] = stored
    .map((item, idx) => {
      const dataCells = padTaskCells(item.values || []);
      const meta =
        item.meta ??
        parseRowMeta(item.values?.[TASK_META_COL_INDEX], dataCells, scope.officeId);
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
  taskDataCacheMap.set(cacheKey, { syncedAt, time: now, records });
  const filtered = includeDeleted
    ? records
    : records.filter((r) => !r.meta.deletedAt);
  return { records: filtered, syncedAt };
}

export async function listTaskRows(
  forceRefresh = false,
  userId?: string,
): Promise<{ id: number; values: TaskRow; meta: SheetRowMeta }[]> {
  const { records } = await listTaskRecordsWithMeta(forceRefresh, userId, false);
  return records.map((r) => ({ id: r.id, values: r.values, meta: r.meta }));
}

export async function listTaskRowsWithHeaders(
  forceRefresh = false,
  userId?: string,
): Promise<{
  headers: string[];
  rows: { id: number; values: TaskRow; meta: SheetRowMeta }[];
  syncedAt: string;
}> {
  const { records, syncedAt } = await listTaskRecordsWithMeta(forceRefresh, userId, false);
  return {
    headers: [...TASK_SHEET_COLUMNS],
    rows: records.map((r) => ({ id: r.id, values: r.values, meta: r.meta })),
    syncedAt,
  };
}

export async function appendTaskRow(
  values: TaskRow,
  userId?: string,
  extraMeta?: Partial<SheetRowMeta>,
): Promise<number> {
  const scope = await resolveOfficeScope(userId);
  const lockKey = `tasks:${scope.officeId}`;

  return withSheetLock(lockKey, async () => {
    invalidateTaskCache(scope.officeId);
    const meta = createNewRowMeta(scope.officeId, scope.userId, extraMeta);
    const dataCells = padTaskCells(values);
    const rowWithMeta = [...dataCells, serializeRowMeta(meta)];

    const context = await getGoogleContext(userId);
    if (context) {
      await ensureTaskSheetReady(userId);
      try {
        await context.sheets.spreadsheets.values.append({
          spreadsheetId: context.spreadsheetId,
          range: `${TASK_SHEET_NAME}!A:${COL_WITH_META_LAST}`,
          valueInputOption: "RAW",
          insertDataOption: "INSERT_ROWS",
          requestBody: { values: [rowWithMeta] },
        });
        invalidateTaskCache(scope.officeId);
        return meta.id;
      } catch (err: any) {
        logger.error({ code: err?.code, officeId: scope.officeId }, "Google Sheets appendTaskRow failed");
        throw new ExternalServiceError("فشل حفظ المهمة في Google Sheets.");
      }
    }

    const local = readOfficeLocalRows<{ id: number; values: TaskRow; meta: SheetRowMeta }>(
      "tasks",
      scope.officeId,
    );
    local.push({ id: meta.id, values: dataCells, meta });
    writeOfficeLocalRows("tasks", scope.officeId, local);
    invalidateTaskCache(scope.officeId);
    return meta.id;
  });
}

export async function updateTaskRow(
  stableId: number,
  values: TaskRow,
  userId?: string,
  metaPatch?: Partial<SheetRowMeta>,
): Promise<void> {
  const scope = await resolveOfficeScope(userId);
  const lockKey = `tasks:${scope.officeId}`;

  await withSheetLock(lockKey, async () => {
    invalidateTaskCache(scope.officeId);
    const { records } = await listTaskRecordsWithMeta(true, userId, true);
    const target = records.find((r) => r.id === stableId);
    if (!target) {
      throw new NotFoundError("المهمة غير موجودة أو لا تتبع لهذا المكتب.");
    }

    const updatedMeta: SheetRowMeta = {
      ...target.meta,
      ...metaPatch,
      id: target.meta.id,
      recordId: target.meta.recordId,
      officeId: scope.officeId,
      updatedAt: new Date().toISOString(),
    };
    const dataCells = padTaskCells(values);
    const rowWithMeta = [...dataCells, serializeRowMeta(updatedMeta)];

    const context = await getGoogleContext(userId);
    if (context) {
      try {
        const rowNum = target.physicalRowNumber;
        await context.sheets.spreadsheets.values.update({
          spreadsheetId: context.spreadsheetId,
          range: `${TASK_SHEET_NAME}!A${rowNum}:${COL_WITH_META_LAST}${rowNum}`,
          valueInputOption: "RAW",
          requestBody: { values: [rowWithMeta] },
        });
        invalidateTaskCache(scope.officeId);
        return;
      } catch (err: any) {
        logger.error({ code: err?.code, officeId: scope.officeId }, "Google Sheets updateTaskRow failed");
        throw new ExternalServiceError("فشل تحديث بيانات المهمة في Google Sheets.");
      }
    }

    const local = readOfficeLocalRows<{ id: number; values: TaskRow; meta: SheetRowMeta }>(
      "tasks",
      scope.officeId,
    );
    const idx = local.findIndex((r) => (r.meta?.id ?? r.id) === stableId);
    if (idx === -1) {
      throw new NotFoundError("المهمة غير موجودة.");
    }
    local[idx] = { id: stableId, values: dataCells, meta: updatedMeta };
    writeOfficeLocalRows("tasks", scope.officeId, local);
    invalidateTaskCache(scope.officeId);
  });
}

export async function deleteTaskRow(stableId: number, userId?: string): Promise<boolean> {
  const scope = await resolveOfficeScope(userId);
  const { records } = await listTaskRecordsWithMeta(true, userId, false);
  const target = records.find((r) => r.id === stableId);
  if (!target) {
    return false;
  }
  await updateTaskRow(stableId, target.values, userId, {
    deletedAt: new Date().toISOString(),
    deletedBy: scope.userId,
  });
  return true;
}

export async function restoreTaskRow(stableId: number, userId?: string): Promise<boolean> {
  const { records } = await listTaskRecordsWithMeta(true, userId, true);
  const target = records.find((r) => r.id === stableId && Boolean(r.meta.deletedAt));
  if (!target) {
    return false;
  }
  await updateTaskRow(stableId, target.values, userId, {
    deletedAt: null,
    deletedBy: null,
  });
  return true;
}
