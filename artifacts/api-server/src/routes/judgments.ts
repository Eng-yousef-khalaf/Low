import { Router, type IRouter } from "express";
import { z } from "@workspace/api-zod";
import {
  attachAuthUser,
  requireAuth,
  requireActiveSubscription,
} from "../middlewares/auth.middleware";
import {
  listJudgmentRowsWithHeaders,
  appendJudgmentRow,
  updateJudgmentRow,
  deleteJudgmentRow,
} from "../services/judgment.sheets.service";
import {
  normalizeNumericDigits,
  validateAndNormalizeCourtDate,
} from "../utils/dateNormalize";
import {
  getIdempotentResult,
  setIdempotentResult,
  type SheetRowMeta,
} from "../utils/sheetMeta";
import { recordAuditEvent } from "../services/audit.service";
import {
  NotFoundError,
  ValidationError,
  formatZodErrorArabic,
} from "../lib/errors";

const router: IRouter = Router();

router.use(attachAuthUser, requireAuth, requireActiveSubscription);

export interface JudgmentRecord {
  id: number;
  caseNumber: string;
  court: string;
  plaintiff: string;
  defendant: string;
  assignedLawyer: string;
  assigneeId?: string | null;
  judgmentNumber: string;
  judgmentDate: string;
  summary: string;
  /** Finality degree: نهائي | ابتدائي */
  judgmentType: "نهائي" | "ابتدائي";
  /** Ruling direction for dashboard stats & legal outcome: لصالحنا | ضدنا | قيد الدراسة */
  rulingOutcome: "لصالحنا" | "ضدنا" | "قيد الدراسة";
  /** Kept for backward compatibility with existing frontend components */
  isFavorable: "نهائي" | "ابتدائي";
  createdAt: string;
}

const VALID_TYPES = ["نهائي", "ابتدائي"] as const;
const VALID_OUTCOMES = ["لصالحنا", "ضدنا", "قيد الدراسة"] as const;

const JudgmentCreateSchema = z.object({
  caseNumber: z.string().trim().max(80).optional().default(""),
  court: z.string().trim().max(150).optional().default(""),
  plaintiff: z.string().trim().max(150).optional().default(""),
  defendant: z.string().trim().max(150).optional().default(""),
  assignedLawyer: z.string().trim().max(150).optional().default(""),
  assigneeId: z.string().trim().max(120).optional().nullable(),
  judgmentNumber: z.string().trim().min(1, "رقم الصك مطلوب.").max(100, "رقم الصك طويل جداً (الحد الأقصى 100 حرف)."),
  judgmentDate: z.string().trim().max(40).optional().default(""),
  summary: z.string().trim().max(4000).optional().default(""),
  isFavorable: z.string().trim().optional(),
  judgmentType: z.enum(VALID_TYPES).optional(),
  rulingOutcome: z.enum(VALID_OUTCOMES).optional(),
});

const JudgmentUpdateSchema = JudgmentCreateSchema.partial();

function normalizeJudgmentType(val?: string): "نهائي" | "ابتدائي" {
  const trimmed = (val || "").trim();
  if (trimmed === "ابتدائي" || trimmed === "لا") return "ابتدائي";
  return "نهائي";
}

function normalizeRulingOutcome(val?: string): "لصالحنا" | "ضدنا" | "قيد الدراسة" {
  const trimmed = (val || "").trim();
  if (trimmed === "لصالحنا" || trimmed.toLowerCase() === "favorable") return "لصالحنا";
  if (trimmed === "ضدنا" || trimmed.toLowerCase() === "unfavorable") return "ضدنا";
  return "قيد الدراسة";
}

const FIELD_KEYS: Record<string, string> = {
  "رقم القضية": "caseNumber",
  "المحكمة المختصة": "court",
  "المدعي": "plaintiff",
  "المدعى عليه": "defendant",
  "المحامي المكلف": "assignedLawyer",
  "رقم الصك": "judgmentNumber",
  "تاريخ الحكم": "judgmentDate",
  "ملخص الحكم": "summary",
  "الحكم": "rawRulingCell",
  "تاريخ الإنشاء": "createdAt",
};

function parseStableId(raw: string): number {
  const normalized = normalizeNumericDigits(String(raw || "")).trim();
  if (!/^\d+$/.test(normalized)) {
    throw new ValidationError("معرّف الحكم غير صالح.");
  }
  const id = Number(normalized);
  if (!Number.isSafeInteger(id) || id < 1) {
    throw new ValidationError("معرّف الحكم خارج النطاق المسموح.");
  }
  return id;
}

function rowToRecord(
  id: number,
  values: string[],
  headers: string[],
  meta?: SheetRowMeta,
): JudgmentRecord {
  const rawMap: Record<string, string> = {};
  headers.forEach((header, colIdx) => {
    const fieldKey = FIELD_KEYS[header.trim()];
    if (fieldKey) {
      rawMap[fieldKey] = (values[colIdx] ?? "").trim();
    }
  });

  const cellValue = rawMap.rawRulingCell || "";
  const judgmentType = meta?.judgmentType
    ? normalizeJudgmentType(String(meta.judgmentType))
    : normalizeJudgmentType(cellValue);

  const rulingOutcome = meta?.rulingOutcome
    ? normalizeRulingOutcome(String(meta.rulingOutcome))
    : cellValue === "لصالحنا" || cellValue === "ضدنا"
      ? normalizeRulingOutcome(cellValue)
      : "لصالحنا";

  return {
    id,
    caseNumber: rawMap.caseNumber || "",
    court: rawMap.court || "",
    plaintiff: rawMap.plaintiff || "",
    defendant: rawMap.defendant || "",
    assignedLawyer: rawMap.assignedLawyer || "",
    assigneeId: typeof meta?.assigneeId === "string" ? meta.assigneeId : null,
    judgmentNumber: rawMap.judgmentNumber || "",
    judgmentDate: rawMap.judgmentDate || "",
    summary: rawMap.summary || "",
    judgmentType,
    rulingOutcome,
    isFavorable: judgmentType,
    createdAt: rawMap.createdAt || meta?.createdAt || new Date().toISOString(),
  };
}

function recordToRow(record: Omit<JudgmentRecord, "id">): string[] {
  return [
    record.caseNumber || "",
    record.court || "",
    record.plaintiff || "",
    record.defendant || "",
    record.assignedLawyer || "",
    record.judgmentNumber || "",
    record.judgmentDate || "",
    record.summary || "",
    record.judgmentType, // Column I: الحكم (نهائي / ابتدائي)
    record.createdAt || new Date().toISOString(),
  ];
}

/**
 * GET /api/judgments
 * Pure read-only fetch (never triggers header writes during GET).
 */
router.get("/judgments", async (req, res, next) => {
  try {
    const forceRefresh = req.query.refresh === "true";
    const { headers, rows, syncedAt } = await listJudgmentRowsWithHeaders(forceRefresh, req.userId);
    const records = rows.map(({ id, values, meta }) => rowToRecord(id, values, headers, meta));
    res.setHeader("X-Synced-At", syncedAt);
    res.json(records);
  } catch (err) {
    next(err);
  }
});

router.get("/judgments/:id", async (req, res, next) => {
  try {
    const id = parseStableId(req.params.id);
    const { headers, rows } = await listJudgmentRowsWithHeaders(false, req.userId);
    const match = rows.find((r) => r.id === id);
    if (!match) {
      throw new NotFoundError("الحكم غير موجود.");
    }
    res.json(rowToRecord(match.id, match.values, headers, match.meta));
  } catch (err) {
    next(err);
  }
});

router.post("/judgments", async (req, res, next) => {
  try {
    const idempotencyKey = String(req.headers["x-idempotency-key"] || "").trim();
    if (idempotencyKey && req.officeId) {
      const cached = getIdempotentResult(`judgment:${req.officeId}:${idempotencyKey}`);
      if (cached) {
        res.status(201).json(cached);
        return;
      }
    }

    const parsed = JudgmentCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError(formatZodErrorArabic(parsed.error));
    }

    const normalizedDate = parsed.data.judgmentDate
      ? validateAndNormalizeCourtDate(parsed.data.judgmentDate, {
          fieldName: "تاريخ الحكم",
          required: false,
        }) || ""
      : "";

    const judgmentType = normalizeJudgmentType(
      parsed.data.judgmentType || parsed.data.isFavorable || "نهائي",
    );
    const rulingOutcome = normalizeRulingOutcome(
      parsed.data.rulingOutcome ||
        (parsed.data.isFavorable === "لصالحنا" || parsed.data.isFavorable === "ضدنا"
          ? parsed.data.isFavorable
          : "لصالحنا"),
    );

    const recordPayload: Omit<JudgmentRecord, "id"> = {
      caseNumber: normalizeNumericDigits(parsed.data.caseNumber || ""),
      court: parsed.data.court || "",
      plaintiff: parsed.data.plaintiff || "",
      defendant: parsed.data.defendant || "",
      assignedLawyer: parsed.data.assignedLawyer || "",
      assigneeId: parsed.data.assigneeId || null,
      judgmentNumber: normalizeNumericDigits(parsed.data.judgmentNumber),
      judgmentDate: normalizedDate,
      summary: parsed.data.summary || "",
      judgmentType,
      rulingOutcome,
      isFavorable: judgmentType,
      createdAt: new Date().toISOString(),
    };

    const stableId = await appendJudgmentRow(recordToRow(recordPayload), req.userId, {
      judgmentType,
      rulingOutcome,
      assigneeId: parsed.data.assigneeId || null,
    });

    const responseBody: JudgmentRecord = { id: stableId, ...recordPayload };
    if (idempotencyKey && req.officeId) {
      setIdempotentResult(`judgment:${req.officeId}:${idempotencyKey}`, responseBody);
    }

    await recordAuditEvent({
      actorId: req.userId!,
      actorUsername: req.user || "",
      officeId: req.officeId!,
      action: "judgment.create",
      entityType: "judgment",
      entityId: String(stableId),
      summary: `إضافة صك حكم رقم (${recordPayload.judgmentNumber}) — (${rulingOutcome} / ${judgmentType})`,
    });

    res.status(201).json(responseBody);
  } catch (err) {
    next(err);
  }
});

router.put("/judgments/:id", async (req, res, next) => {
  try {
    const id = parseStableId(req.params.id);
    const parsed = JudgmentUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError(formatZodErrorArabic(parsed.error));
    }

    const { headers, rows } = await listJudgmentRowsWithHeaders(false, req.userId);
    const existing = rows.find((r) => r.id === id);
    if (!existing) {
      throw new NotFoundError("الحكم غير موجود.");
    }

    const existingRecord = rowToRecord(id, existing.values, headers, existing.meta);

    const nextDate =
      parsed.data.judgmentDate !== undefined
        ? parsed.data.judgmentDate
          ? validateAndNormalizeCourtDate(parsed.data.judgmentDate, {
              fieldName: "تاريخ الحكم",
              required: false,
            }) || ""
          : ""
        : existingRecord.judgmentDate;

    const nextType =
      parsed.data.judgmentType !== undefined
        ? normalizeJudgmentType(parsed.data.judgmentType)
        : parsed.data.isFavorable !== undefined
          ? normalizeJudgmentType(parsed.data.isFavorable)
          : existingRecord.judgmentType;

    const nextOutcome =
      parsed.data.rulingOutcome !== undefined
        ? normalizeRulingOutcome(parsed.data.rulingOutcome)
        : existingRecord.rulingOutcome;

    const updatedPayload: Omit<JudgmentRecord, "id"> = {
      caseNumber:
        parsed.data.caseNumber !== undefined
          ? normalizeNumericDigits(parsed.data.caseNumber)
          : existingRecord.caseNumber,
      court: parsed.data.court ?? existingRecord.court,
      plaintiff: parsed.data.plaintiff ?? existingRecord.plaintiff,
      defendant: parsed.data.defendant ?? existingRecord.defendant,
      assignedLawyer: parsed.data.assignedLawyer ?? existingRecord.assignedLawyer,
      assigneeId:
        parsed.data.assigneeId !== undefined ? parsed.data.assigneeId : existingRecord.assigneeId,
      judgmentNumber:
        parsed.data.judgmentNumber !== undefined
          ? normalizeNumericDigits(parsed.data.judgmentNumber)
          : existingRecord.judgmentNumber,
      judgmentDate: nextDate,
      summary: parsed.data.summary ?? existingRecord.summary,
      judgmentType: nextType,
      rulingOutcome: nextOutcome,
      isFavorable: nextType,
      createdAt: existingRecord.createdAt,
    };

    await updateJudgmentRow(id, recordToRow(updatedPayload), req.userId, {
      judgmentType: nextType,
      rulingOutcome: nextOutcome,
      assigneeId: updatedPayload.assigneeId || null,
    });

    await recordAuditEvent({
      actorId: req.userId!,
      actorUsername: req.user || "",
      officeId: req.officeId!,
      action: "judgment.update",
      entityType: "judgment",
      entityId: String(id),
      summary: `تحديث صك الحكم رقم (${updatedPayload.judgmentNumber})`,
    });

    res.json({ id, ...updatedPayload });
  } catch (err) {
    next(err);
  }
});

router.delete("/judgments/:id", async (req, res, next) => {
  try {
    const id = parseStableId(req.params.id);
    const deleted = await deleteJudgmentRow(id, req.userId);
    if (!deleted) {
      throw new NotFoundError("الحكم غير موجود.");
    }

    await recordAuditEvent({
      actorId: req.userId!,
      actorUsername: req.user || "",
      officeId: req.officeId!,
      action: "judgment.delete",
      entityType: "judgment",
      entityId: String(id),
      summary: `نقل الحكم #${id} إلى سلة المحذوفات`,
    });

    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

export default router;
