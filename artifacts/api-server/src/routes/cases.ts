import { Router, type IRouter } from "express";
import { z } from "@workspace/api-zod";
import {
  attachAuthUser,
  requireAuth,
  requireActiveSubscription,
  requirePermission,
} from "../middlewares/auth.middleware";
import {
  listCases,
  getCaseById,
  createCase,
  updateCase,
  deleteCase,
  listCaseDocuments,
  addOrVersionCaseDocument,
  deleteCaseDocument,
  listCaseFinancialEntries,
  addCaseFinancialEntry,
} from "../services/cases.service";
import { getClientById } from "../services/clients.service";
import { listSessions } from "../services/session.service";
import { listJudgmentRows } from "../services/judgment.sheets.service";
import { listTaskRows } from "../services/task.sheets.service";
import {
  normalizeNumericDigits,
  validateAndNormalizeCourtDate,
} from "../utils/dateNormalize";
import { recordAuditEvent } from "../services/audit.service";
import {
  NotFoundError,
  ValidationError,
  formatZodErrorArabic,
} from "../lib/errors";

const router: IRouter = Router();

router.use(attachAuthUser, requireAuth, requireActiveSubscription);

const VALID_STAGES = ["ابتدائية", "استئناف", "تنفيذ", "عليا", "صلح وتسوية"] as const;
const VALID_STATUSES = ["active", "closed", "appealed", "suspended"] as const;

const CaseCreateSchema = z.object({
  internalNumber: z.string().trim().max(60).optional(),
  courtCaseNumber: z.string().trim().min(1, "رقم القضية في المحكمة حقل إلزامي.").max(80),
  title: z.string().trim().min(1, "عنوان أو موضوع الدعوى حقل إلزامي.").max(300),
  clientId: z.string().trim().max(120).optional().default(""),
  clientName: z.string().trim().max(150).optional().default("موكل المكتب"),
  opponentName: z.string().trim().max(150).optional().default("الطرف الآخر"),
  court: z.string().trim().max(150).optional().default("المحكمة المختصة"),
  circuit: z.string().trim().max(150).optional().nullable(),
  assignedLawyer: z.string().trim().max(150).optional(),
  assigneeId: z.string().trim().max(120).optional().nullable(),
  stage: z.enum(VALID_STAGES).optional().default("ابتدائية"),
  status: z.enum(VALID_STATUSES).optional().default("active"),
  filingDateHijri: z.string().trim().max(40).optional().nullable(),
  nextHearing: z.string().trim().max(120).optional().nullable(),
  lastAction: z.string().trim().max(2000).optional().nullable(),
  requiredAction: z.string().trim().max(2000).optional().nullable(),
  missingDocuments: z.array(z.string().max(250)).optional().default([]),
  totalFees: z.coerce.number().min(0).optional().default(0),
  paidFees: z.coerce.number().min(0).optional().default(0),
  notes: z.string().trim().max(4000).optional().nullable(),
});

const CaseUpdateSchema = CaseCreateSchema.partial();

router.get("/cases", async (req, res, next) => {
  try {
    const officeId = req.officeId!;
    const { status, stage, clientId } = req.query as Record<string, string>;
    let cases = await listCases(officeId, clientId);

    if (status && status !== "all") {
      cases = cases.filter((c) => c.status === status);
    }
    if (stage && stage !== "all") {
      cases = cases.filter((c) => c.stage === stage);
    }

    // Redact financial amounts if user lacks `canAccessFinances`
    const canSeeFinances =
      req.userRole === "admin" ||
      req.officeRole === "office_manager" ||
      Boolean(req.userPermissions?.canAccessFinances);

    if (!canSeeFinances) {
      cases = cases.map((c) => ({ ...c, totalFees: undefined, paidFees: undefined }));
    }

    res.json(cases);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/cases/:id
 * Unified Case File strictly isolated to caller's `officeId`:
 * aggregates client, sessions, judgments, tasks, documents (with version history),
 * financial ledger (fees, payments, expenses), and chronological timeline.
 */
router.get("/cases/:id", async (req, res, next) => {
  try {
    const officeId = req.officeId!;
    const userId = req.userId!;
    const id = String(req.params.id);

    const caseFile = await getCaseById(id, officeId);
    if (!caseFile) {
      throw new NotFoundError("ملف القضية غير موجود أو لا يتبع لهذا المكتب.");
    }

    const client = caseFile.clientId ? await getClientById(caseFile.clientId, officeId) : null;

    const [sessionsRes, judgmentsRes, tasksRes, documents, financialEntries] = await Promise.all([
      listSessions(undefined, userId).catch((): any[] => []),
      listJudgmentRows(false, userId).catch((): any[] => []),
      listTaskRows(false, userId).catch((): any[] => []),
      listCaseDocuments(caseFile.id, officeId),
      listCaseFinancialEntries(officeId, { caseId: caseFile.id }),
    ]);

    const linkedSessions = sessionsRes.filter(
      (s: any) =>
        s.caseId === caseFile.id ||
        (s.caseNumber &&
          (s.caseNumber === caseFile.courtCaseNumber ||
            s.caseNumber === caseFile.internalNumber)),
    );

    const linkedJudgments = judgmentsRes
      .map((j) => ({
        id: j.id,
        caseNumber: j.values[0] || "",
        court: j.values[1] || "",
        plaintiff: j.values[2] || "",
        defendant: j.values[3] || "",
        assignedLawyer: j.values[4] || "",
        judgmentNumber: j.values[5] || "",
        judgmentDateHijri: j.values[6] || "",
        judgmentSummary: j.values[7] || "",
        judgmentType: j.values[8] || "نهائي",
        rulingOutcome: j.meta?.rulingOutcome || "لصالحنا",
        judgmentStatus: "صادر",
      }))
      .filter(
        (j) =>
          j.caseNumber &&
          (j.caseNumber === caseFile.courtCaseNumber ||
            j.caseNumber === caseFile.internalNumber),
      );

    const linkedTasks = tasksRes
      .map((t) => ({
        id: t.id,
        title: t.values[0] || "",
        assignee: t.values[1] || "",
        priority: t.values[2] || "",
        dueDate: t.values[3] || "",
        remainingDays: t.values[4] || "",
        status: t.values[5] || "",
        notes: t.values[6] || "",
      }))
      .filter(
        (t) =>
          t.title.includes(caseFile.courtCaseNumber) ||
          t.title.includes(caseFile.internalNumber) ||
          (caseFile.title && t.title.includes(caseFile.title.slice(0, 15))),
      );

    const timeline: Array<{
      date: string;
      title: string;
      type: "session" | "judgment" | "task" | "document" | "action";
      description?: string;
      status?: string;
    }> = [];

    for (const s of linkedSessions) {
      timeline.push({
        date: s.sessionDateHijri || "غير محدد",
        title: `جلسة قضائية — ${s.court || caseFile.court}`,
        type: "session",
        description: s.notes || `جلسة ${s.sessionType || "مرافعة"} الساعة ${s.sessionTime || ""}`,
        status: s.status,
      });
    }

    for (const j of linkedJudgments) {
      timeline.push({
        date: j.judgmentDateHijri || "غير محدد",
        title: `صك حكم (${j.judgmentType} — ${j.rulingOutcome})`,
        type: "judgment",
        description: j.judgmentSummary || `رقم الصك: ${j.judgmentNumber}`,
        status: j.judgmentStatus,
      });
    }

    for (const t of linkedTasks) {
      timeline.push({
        date: t.dueDate || "غير محدد",
        title: `مهمة: ${t.title}`,
        type: "task",
        description: `المكلف: ${t.assignee || "غير محدد"} — الأولوية: ${t.priority}`,
        status: t.status,
      });
    }

    for (const d of documents) {
      timeline.push({
        date: d.updatedAt.slice(0, 10),
        title: `مستند (${d.category}): ${d.title} — إصدار v${d.currentVersion}`,
        type: "document",
        description: d.versions[0]?.fileName || "",
      });
    }

    if (caseFile.lastAction) {
      timeline.push({
        date: "الإجراء الأخير",
        title: "آخر إجراء متخذ بالملف",
        type: "action",
        description: caseFile.lastAction,
      });
    }

    const canSeeFinances =
      req.userRole === "admin" ||
      req.officeRole === "office_manager" ||
      Boolean(req.userPermissions?.canAccessFinances);

    const totalExpenses = financialEntries
      .filter((e) => e.entryType === "expense")
      .reduce((sum, e) => sum + e.amount, 0);

    res.json({
      ...caseFile,
      totalFees: canSeeFinances ? caseFile.totalFees || 0 : undefined,
      paidFees: canSeeFinances ? caseFile.paidFees || 0 : undefined,
      client,
      sessions: linkedSessions,
      judgments: linkedJudgments,
      tasks: linkedTasks,
      documents,
      financialEntries: canSeeFinances ? financialEntries : [],
      timeline,
      financialSummary: canSeeFinances
        ? {
            totalFees: caseFile.totalFees || 0,
            paidFees: caseFile.paidFees || 0,
            totalExpenses,
            remainingFees: Math.max(0, (caseFile.totalFees || 0) - (caseFile.paidFees || 0)),
          }
        : null,
    });
  } catch (err) {
    next(err);
  }
});

router.post("/cases", requirePermission("canEditCases"), async (req, res, next) => {
  try {
    const parsed = CaseCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError(formatZodErrorArabic(parsed.error));
    }

    const filingDate = parsed.data.filingDateHijri
      ? validateAndNormalizeCourtDate(parsed.data.filingDateHijri, {
          fieldName: "تاريخ قيد الدعوى",
          required: false,
        })
      : null;

    const newCase = await createCase({
      ...parsed.data,
      courtCaseNumber: normalizeNumericDigits(parsed.data.courtCaseNumber),
      filingDateHijri: filingDate,
      assignedLawyer:
        parsed.data.assignedLawyer?.trim() ||
        req.userRecord?.display_name ||
        req.user ||
        "المحامي المكلف",
      officeId: req.officeId!,
    });

    await recordAuditEvent({
      actorId: req.userId!,
      actorUsername: req.user || "",
      officeId: req.officeId!,
      action: "case.create",
      entityType: "case",
      entityId: newCase.id,
      summary: `فتح ملف قضية موحد رقم (${newCase.courtCaseNumber}) — ${newCase.title}`,
    });

    res.status(201).json(newCase);
  } catch (err) {
    next(err);
  }
});

router.patch("/cases/:id", requirePermission("canEditCases"), async (req, res, next) => {
  try {
    const parsed = CaseUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError(formatZodErrorArabic(parsed.error));
    }

    const patchData: any = { ...parsed.data };
    if (patchData.filingDateHijri) {
      patchData.filingDateHijri = validateAndNormalizeCourtDate(patchData.filingDateHijri, {
        fieldName: "تاريخ قيد الدعوى",
        required: false,
      });
    }

    const updated = await updateCase(String(req.params.id), req.officeId!, patchData);
    if (!updated) {
      throw new NotFoundError("ملف القضية غير موجود.");
    }

    await recordAuditEvent({
      actorId: req.userId!,
      actorUsername: req.user || "",
      officeId: req.officeId!,
      action: "case.update",
      entityType: "case",
      entityId: updated.id,
      summary: `تحديث ملف القضية (${updated.courtCaseNumber})`,
    });

    res.json(updated);
  } catch (err) {
    next(err);
  }
});

router.delete("/cases/:id", requirePermission("canEditCases"), async (req, res, next) => {
  try {
    const caseId = String(req.params.id);
    const ok = await deleteCase(caseId, req.officeId!, req.userId);
    if (!ok) {
      throw new NotFoundError("ملف القضية غير موجود.");
    }

    await recordAuditEvent({
      actorId: req.userId!,
      actorUsername: req.user || "",
      officeId: req.officeId!,
      action: "case.delete",
      entityType: "case",
      entityId: caseId,
      summary: `نقل ملف القضية (${caseId}) إلى سلة المحذوفات`,
    });

    res.json({ message: "تم نقل ملف القضية إلى سلة المحذوفات بنجاح." });
  } catch (err) {
    next(err);
  }
});

// ── Case Documents & Versioning Endpoints ────────────────────────────────────

const DocumentSchema = z.object({
  documentId: z.string().optional(),
  title: z.string().trim().min(1, "عنوان المستند مطلوب.").max(200),
  category: z
    .enum(["مذكرة", "صك حكم", "عقد", "مستند إثبات", "تقرير خبرة", "أخرى"])
    .optional()
    .default("أخرى"),
  fileName: z.string().trim().min(1, "اسم الملف مطلوب.").max(255),
  mimeType: z.string().max(120).optional(),
  sizeBytes: z.coerce.number().min(0).max(10 * 1024 * 1024).optional(),
  notes: z.string().max(1000).optional().nullable(),
  contentUrlOrBase64: z.string().max(6_000_000).optional().nullable(),
});

router.get("/cases/:id/documents", async (req, res, next) => {
  try {
    const caseFile = await getCaseById(String(req.params.id), req.officeId!);
    if (!caseFile) throw new NotFoundError("ملف القضية غير موجود.");
    const docs = await listCaseDocuments(caseFile.id, req.officeId!);
    res.json(docs);
  } catch (err) {
    next(err);
  }
});

router.post("/cases/:id/documents", requirePermission("canEditCases"), async (req, res, next) => {
  try {
    const caseFile = await getCaseById(String(req.params.id), req.officeId!);
    if (!caseFile) throw new NotFoundError("ملف القضية غير موجود.");

    const parsed = DocumentSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError(formatZodErrorArabic(parsed.error));
    }

    const doc = await addOrVersionCaseDocument({
      caseId: caseFile.id,
      officeId: req.officeId!,
      documentId: parsed.data.documentId,
      title: parsed.data.title,
      category: parsed.data.category,
      fileName: parsed.data.fileName,
      mimeType: parsed.data.mimeType,
      sizeBytes: parsed.data.sizeBytes,
      notes: parsed.data.notes,
      contentUrlOrBase64: parsed.data.contentUrlOrBase64,
      uploadedBy: req.userRecord?.display_name || req.user || "محامي المكتب",
    });

    await recordAuditEvent({
      actorId: req.userId!,
      actorUsername: req.user || "",
      officeId: req.officeId!,
      action: parsed.data.documentId ? "document.version_add" : "document.create",
      entityType: "document",
      entityId: doc.id,
      summary: `رفع مستند (${doc.title}) الإصدار v${doc.currentVersion} في القضية ${caseFile.courtCaseNumber}`,
    });

    res.status(201).json(doc);
  } catch (err) {
    next(err);
  }
});

router.delete(
  "/cases/:id/documents/:docId",
  requirePermission("canEditCases"),
  async (req, res, next) => {
    try {
      const caseFile = await getCaseById(String(req.params.id), req.officeId!);
      if (!caseFile) throw new NotFoundError("ملف القضية غير موجود.");
      const ok = await deleteCaseDocument(String(req.params.docId), caseFile.id, req.officeId!);
      if (!ok) throw new NotFoundError("المستند غير موجود.");
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  },
);

// ── Case Financial Ledger Endpoints ──────────────────────────────────────────

const FinanceEntrySchema = z.object({
  entryType: z.enum(["payment", "expense", "invoice"]),
  amount: z.coerce.number().positive("يجب أن يكون المبلغ أكبر من صفر."),
  description: z.string().trim().min(1, "بيان العملية المالية مطلوب.").max(300),
  date: z.string().trim().max(40).optional().default(""),
  referenceNumber: z.string().trim().max(80).optional().nullable(),
});

router.get(
  "/cases/:id/finances",
  requirePermission("canAccessFinances"),
  async (req, res, next) => {
    try {
      const caseFile = await getCaseById(String(req.params.id), req.officeId!);
      if (!caseFile) throw new NotFoundError("ملف القضية غير موجود.");
      const entries = await listCaseFinancialEntries(req.officeId!, { caseId: caseFile.id });
      res.json(entries);
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  "/cases/:id/finances",
  requirePermission("canAccessFinances"),
  async (req, res, next) => {
    try {
      const caseFile = await getCaseById(String(req.params.id), req.officeId!);
      if (!caseFile) throw new NotFoundError("ملف القضية غير موجود.");

      const parsed = FinanceEntrySchema.safeParse(req.body);
      if (!parsed.success) {
        throw new ValidationError(formatZodErrorArabic(parsed.error));
      }

      const normalizedDate = parsed.data.date
        ? validateAndNormalizeCourtDate(parsed.data.date, {
            fieldName: "تاريخ العملية المالية",
            required: false,
          }) || new Date().toISOString().slice(0, 10)
        : new Date().toISOString().slice(0, 10);

      const entry = await addCaseFinancialEntry({
        caseId: caseFile.id,
        clientId: caseFile.clientId,
        officeId: req.officeId!,
        entryType: parsed.data.entryType,
        amount: parsed.data.amount,
        description: parsed.data.description,
        date: normalizedDate,
        referenceNumber: parsed.data.referenceNumber,
        recordedBy: req.userRecord?.display_name || req.user || "المحاسب",
      });

      await recordAuditEvent({
        actorId: req.userId!,
        actorUsername: req.user || "",
        officeId: req.officeId!,
        action: `finance.${entry.entryType}`,
        entityType: "finance",
        entityId: entry.id,
        summary: `تسجيل حركة مالية (${entry.entryType}) بمبلغ ${entry.amount} للقضية ${caseFile.courtCaseNumber}`,
      });

      res.status(201).json(entry);
    } catch (err) {
      next(err);
    }
  },
);

export default router;
