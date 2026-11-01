import { Router, type IRouter } from "express";
import { z } from "@workspace/api-zod";
import moment from "moment-hijri";
import {
  attachAuthUser,
  requireAuth,
  requireActiveSubscription,
} from "../middlewares/auth.middleware";
import {
  listPoaRecordsWithMeta,
  appendPoaRow,
  updatePoaRow,
  deletePoaRow,
} from "../services/poa.sheets.service";
import {
  normalizeNumericDigits,
  validateAndNormalizeCourtDate,
} from "../utils/dateNormalize";
import {
  getIdempotentResult,
  setIdempotentResult,
} from "../utils/sheetMeta";
import { recordAuditEvent } from "../services/audit.service";
import {
  NotFoundError,
  ValidationError,
  formatZodErrorArabic,
} from "../lib/errors";

const router: IRouter = Router();

router.use(attachAuthUser, requireAuth, requireActiveSubscription);

interface PoaRecord {
  id: number;
  sheetRowId: number;
  recordId?: string;
  clientName: string;
  poaNumber: string;
  issueDateHijri: string;
  expiryDateHijri: string;
  daysRemaining: number;
  notes?: string;
  createdAt: string;
}

const PoaCreateSchema = z.object({
  clientName: z.string().trim().min(1, "اسم العميل مطلوب.").max(150, "اسم العميل يتجاوز الحد المسموح."),
  poaNumber: z.string().trim().min(1, "رقم الوكالة مطلوب.").max(60, "رقم الوكالة يتجاوز الحد المسموح."),
  issueDateHijri: z.string().max(40).optional().default(""),
  expiryDateHijri: z.string().max(40).optional().default(""),
  daysRemaining: z.number().optional(),
  notes: z.string().max(2000).optional().default(""),
});

const PoaUpdateSchema = PoaCreateSchema.partial();

function parseStableId(raw: string): number {
  const normalized = normalizeNumericDigits(String(raw || "")).trim();
  if (!/^\d+$/.test(normalized)) {
    throw new ValidationError("معرّف الوكالة غير صالح.");
  }
  const id = Number(normalized);
  if (!Number.isSafeInteger(id) || id < 1) {
    throw new ValidationError("معرّف الوكالة خارج النطاق المسموح.");
  }
  return id;
}

function calcDaysFromDate(rawDateStr: string): number {
  const cleaned = normalizeNumericDigits(rawDateStr || "").trim();
  if (!cleaned) return 0;
  try {
    const parts = cleaned.split(/[\/\.-]/);
    if (parts.length === 3) {
      let day: number, month: number, year: number;
      if (parts[0].length === 4) {
        year = parseInt(parts[0], 10);
        month = parseInt(parts[1], 10);
        day = parseInt(parts[2], 10);
      } else {
        day = parseInt(parts[0], 10);
        month = parseInt(parts[1], 10);
        year = parseInt(parts[2], 10);
      }
      if (year >= 1300 && year <= 1600 && month >= 1 && month <= 12 && day >= 1 && day <= 30) {
        const mExpiry = moment(`${year}/${month}/${day}`, "iYYYY/iM/iD");
        if (mExpiry.isValid()) {
          return mExpiry.diff(moment().startOf("day"), "days");
        }
      }
      if (year >= 1900 && year <= 2100 && month >= 1 && month <= 12 && day >= 1 && day <= 31) {
        const greg = new Date(year, month - 1, day, 23, 59, 59);
        if (!Number.isNaN(greg.getTime())) {
          return Math.ceil((greg.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
        }
      }
    }
  } catch {
    // ignore
  }
  return 0;
}

function rowToRecord(id: number, values: string[], recordId?: string): PoaRecord {
  const expiry = values[3] || "";
  return {
    id,
    sheetRowId: id,
    recordId,
    clientName: values[0] || "",
    poaNumber: values[1] || "",
    issueDateHijri: values[2] || "",
    expiryDateHijri: expiry,
    daysRemaining: expiry ? calcDaysFromDate(expiry) : Number(values[4]) || 0,
    notes: values[5] || "",
    createdAt: values[6] || new Date().toISOString(),
  };
}

function recordToRow(record: Omit<PoaRecord, "id" | "sheetRowId">): string[] {
  return [
    record.clientName,
    record.poaNumber,
    record.issueDateHijri,
    record.expiryDateHijri,
    String(record.daysRemaining ?? 0),
    record.notes || "",
    record.createdAt || new Date().toISOString(),
  ];
}

/**
 * GET /api/poa
 * Pure read-only fetch (never triggers header writes during GET).
 */
router.get("/poa", async (req, res, next) => {
  try {
    const forceRefresh = req.query.refresh === "true";
    const { records, syncedAt } = await listPoaRecordsWithMeta(forceRefresh, req.userId, false);
    const list = records.map((r) => rowToRecord(r.id, r.values, r.meta.recordId));
    res.setHeader("X-Synced-At", syncedAt);
    res.json(list);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/poa
 * Creates a POA record, confirms durable persistence, and returns permanent `id` + `sheetRowId`.
 */
router.post("/poa", async (req, res, next) => {
  try {
    const idempotencyKey = String(req.headers["x-idempotency-key"] || "").trim();
    if (idempotencyKey && req.officeId) {
      const cached = getIdempotentResult(`poa:${req.officeId}:${idempotencyKey}`);
      if (cached) {
        res.status(201).json(cached);
        return;
      }
    }

    const parsed = PoaCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError(formatZodErrorArabic(parsed.error));
    }

    const issueDate = parsed.data.issueDateHijri
      ? validateAndNormalizeCourtDate(parsed.data.issueDateHijri, {
          fieldName: "تاريخ إصدار الوكالة",
          required: false,
        }) || ""
      : "";
    const expiryDate = parsed.data.expiryDateHijri
      ? validateAndNormalizeCourtDate(parsed.data.expiryDateHijri, {
          fieldName: "تاريخ انتهاء الوكالة",
          required: false,
        }) || ""
      : "";

    const createdAt = new Date().toISOString();
    const daysRemaining = expiryDate
      ? calcDaysFromDate(expiryDate)
      : Number(parsed.data.daysRemaining) || 0;

    const payload = {
      clientName: parsed.data.clientName,
      poaNumber: normalizeNumericDigits(parsed.data.poaNumber),
      issueDateHijri: issueDate,
      expiryDateHijri: expiryDate,
      daysRemaining,
      notes: parsed.data.notes || "",
      createdAt,
    };

    const stableId = await appendPoaRow(recordToRow(payload), req.userId);
    // Re-read after write to confirm persistence
    const { records } = await listPoaRecordsWithMeta(true, req.userId, false);
    const confirmed = records.find((r) => r.id === stableId);
    const responseBody: PoaRecord = confirmed
      ? rowToRecord(confirmed.id, confirmed.values, confirmed.meta.recordId)
      : { id: stableId, sheetRowId: stableId, ...payload };

    if (idempotencyKey && req.officeId) {
      setIdempotentResult(`poa:${req.officeId}:${idempotencyKey}`, responseBody);
    }

    await recordAuditEvent({
      actorId: req.userId!,
      actorUsername: req.user || "",
      officeId: req.officeId!,
      action: "poa.create",
      entityType: "poa",
      entityId: String(stableId),
      summary: `إضافة وكالة رقم (${payload.poaNumber}) للعميل (${payload.clientName})`,
    });

    res.status(201).json(responseBody);
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /api/poa/:rowId
 * Updates a POA record by its permanent stable ID.
 */
router.put("/poa/:rowId", async (req, res, next) => {
  try {
    const stableId = parseStableId(req.params.rowId);
    const parsed = PoaUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError(formatZodErrorArabic(parsed.error));
    }

    const { records } = await listPoaRecordsWithMeta(false, req.userId, false);
    const existing = records.find((r) => r.id === stableId);
    if (!existing) {
      throw new NotFoundError("الوكالة غير موجودة.");
    }

    const current = rowToRecord(existing.id, existing.values, existing.meta.recordId);

    const nextIssue =
      parsed.data.issueDateHijri !== undefined
        ? parsed.data.issueDateHijri
          ? validateAndNormalizeCourtDate(parsed.data.issueDateHijri, {
              fieldName: "تاريخ إصدار الوكالة",
              required: false,
            }) || ""
          : ""
        : current.issueDateHijri;

    const nextExpiry =
      parsed.data.expiryDateHijri !== undefined
        ? parsed.data.expiryDateHijri
          ? validateAndNormalizeCourtDate(parsed.data.expiryDateHijri, {
              fieldName: "تاريخ انتهاء الوكالة",
              required: false,
            }) || ""
          : ""
        : current.expiryDateHijri;

    const updatedPayload = {
      clientName: parsed.data.clientName ?? current.clientName,
      poaNumber:
        parsed.data.poaNumber !== undefined
          ? normalizeNumericDigits(parsed.data.poaNumber)
          : current.poaNumber,
      issueDateHijri: nextIssue,
      expiryDateHijri: nextExpiry,
      daysRemaining: nextExpiry
        ? calcDaysFromDate(nextExpiry)
        : parsed.data.daysRemaining ?? current.daysRemaining,
      notes: parsed.data.notes ?? current.notes,
      createdAt: current.createdAt,
    };

    await updatePoaRow(stableId, recordToRow(updatedPayload), req.userId);

    await recordAuditEvent({
      actorId: req.userId!,
      actorUsername: req.user || "",
      officeId: req.officeId!,
      action: "poa.update",
      entityType: "poa",
      entityId: String(stableId),
      summary: `تحديث الوكالة رقم (${updatedPayload.poaNumber})`,
    });

    res.json({ id: stableId, sheetRowId: stableId, ...updatedPayload });
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/poa/:rowId
 * Soft-deletes a POA record by its permanent stable ID.
 */
router.delete("/poa/:rowId", async (req, res, next) => {
  try {
    const stableId = parseStableId(req.params.rowId);
    const deleted = await deletePoaRow(stableId, req.userId);
    if (!deleted) {
      throw new NotFoundError("الوكالة غير موجودة.");
    }

    await recordAuditEvent({
      actorId: req.userId!,
      actorUsername: req.user || "",
      officeId: req.officeId!,
      action: "poa.delete",
      entityType: "poa",
      entityId: String(stableId),
      summary: `نقل الوكالة #${stableId} إلى سلة المحذوفات`,
    });

    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

export default router;
