import { Router, type IRouter } from "express";
import {
  z,
  CreateSessionBody,
  ListSessionsQueryParams,
  UpdateSessionBody,
} from "@workspace/api-zod";
import {
  createSession,
  deleteSession,
  detectSessionConflicts,
  getSessionById,
  listSessions,
  updateSession,
  computeDaysRemainingStr,
} from "../services/session.service";
import {
  attachAuthUser,
  requireAuth,
  requireActiveSubscription,
} from "../middlewares/auth.middleware";
import { WhatsappReminderChannel } from "../services/reminder/channels/whatsappChannel";
import { computeHearingDateTime } from "../utils/hijri";
import {
  normalizeNumericDigits,
  validateAndNormalizeCourtDate,
} from "../utils/dateNormalize";
import {
  getIdempotentResult,
  setIdempotentResult,
} from "../utils/sheetMeta";
import { recordAuditEvent } from "../services/audit.service";
import { NotFoundError, ValidationError, formatZodErrorArabic } from "../lib/errors";

const router: IRouter = Router();

router.use(attachAuthUser, requireAuth, requireActiveSubscription);

function parsePositiveId(raw: unknown): number {
  const str = Array.isArray(raw) ? raw[0] : raw;
  const normalized = normalizeNumericDigits(String(str || "")).trim();
  if (!/^\d+$/.test(normalized)) {
    throw new ValidationError("معرّف الجلسة غير صالح.");
  }
  const id = Number(normalized);
  if (!Number.isSafeInteger(id) || id < 1) {
    throw new ValidationError("معرّف الجلسة خارج النطاق المسموح.");
  }
  return id;
}

const ExtraSessionFieldsSchema = z.object({
  assignedLawyer: z.string().max(150).optional().nullable(),
  assigneeId: z.string().max(120).optional().nullable(),
  caseId: z.string().max(120).optional().nullable(),
});

router.get("/sessions", async (req, res, next) => {
  try {
    const parseResult = ListSessionsQueryParams.safeParse(req.query);
    if (!parseResult.success) {
      throw new ValidationError("معيار تصفية حالة الجلسة غير صالح.");
    }
    const sessions = await listSessions(parseResult.data.status, req.userId);
    res.setHeader("X-Synced-At", new Date().toISOString());
    res.json(sessions);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/sessions/check-conflicts
 * Live conflict check before saving a session.
 */
router.post("/sessions/check-conflicts", async (req, res, next) => {
  try {
    const { sessionDateHijri, sessionTime, assignedLawyer, excludeId } = req.body || {};
    const conflicts = await detectSessionConflicts(req.userId, {
      sessionDateHijri: sessionDateHijri ? String(sessionDateHijri) : null,
      sessionTime: sessionTime ? String(sessionTime) : null,
      assignedLawyer: assignedLawyer ? String(assignedLawyer) : null,
      excludeId: excludeId ? Number(excludeId) : undefined,
    });
    res.json({ hasConflict: conflicts.length > 0, conflicts });
  } catch (err) {
    next(err);
  }
});

router.post("/sessions", async (req, res, next) => {
  try {
    const idempotencyKey = String(req.headers["x-idempotency-key"] || "").trim();
    if (idempotencyKey && req.officeId) {
      const cached = getIdempotentResult(`session:${req.officeId}:${idempotencyKey}`);
      if (cached) {
        res.status(201).json(cached);
        return;
      }
    }

    const parseResult = CreateSessionBody.safeParse(req.body);
    if (!parseResult.success) {
      throw new ValidationError(formatZodErrorArabic(parseResult.error));
    }
    const extra = ExtraSessionFieldsSchema.safeParse(req.body);
    const { caseNumber, court, sessionDateHijri } = parseResult.data;

    if (!caseNumber?.trim() || !court?.trim() || !sessionDateHijri?.trim()) {
      throw new ValidationError(
        "رقم القضية، المحكمة، وتاريخ الجلسة حقول إلزامية لحفظ الجلسة في النظام.",
      );
    }

    const validatedDate = validateAndNormalizeCourtDate(sessionDateHijri, {
      fieldName: "تاريخ الجلسة",
      required: true,
    });

    const payload = {
      ...parseResult.data,
      caseNumber: normalizeNumericDigits(caseNumber.trim()),
      court: court.trim(),
      sessionDateHijri: validatedDate || normalizeNumericDigits(sessionDateHijri.trim()),
      sessionTime: parseResult.data.sessionTime
        ? normalizeNumericDigits(parseResult.data.sessionTime.trim())
        : null,
      assignedLawyer: extra.success ? extra.data.assignedLawyer : null,
      assigneeId: extra.success ? extra.data.assigneeId : null,
      caseId: extra.success ? extra.data.caseId : null,
    };

    const session = await createSession(payload, req.userId);

    if (idempotencyKey && req.officeId) {
      setIdempotentResult(`session:${req.officeId}:${idempotencyKey}`, session);
    }

    await recordAuditEvent({
      actorId: req.userId!,
      actorUsername: req.user || "",
      officeId: req.officeId!,
      action: "session.create",
      entityType: "session",
      entityId: String(session.id),
      summary: `إضافة جلسة قضائية للقضية (${session.caseNumber})`,
    });

    res.status(201).json(session);
  } catch (err) {
    next(err);
  }
});

router.get("/sessions/:id", async (req, res, next) => {
  try {
    const id = parsePositiveId(req.params.id);
    const session = await getSessionById(id, req.userId);
    if (!session) {
      throw new NotFoundError("الجلسة غير موجودة.");
    }
    res.json(session);
  } catch (err) {
    next(err);
  }
});

router.patch("/sessions/:id", async (req, res, next) => {
  try {
    const id = parsePositiveId(req.params.id);
    const parseResult = UpdateSessionBody.safeParse(req.body);
    if (!parseResult.success) {
      throw new ValidationError(formatZodErrorArabic(parseResult.error));
    }
    const extra = ExtraSessionFieldsSchema.safeParse(req.body);

    const patchData: any = { ...parseResult.data };
    if (patchData.sessionDateHijri !== undefined && patchData.sessionDateHijri !== null) {
      patchData.sessionDateHijri = validateAndNormalizeCourtDate(patchData.sessionDateHijri, {
        fieldName: "تاريخ الجلسة",
        required: true,
      });
    }
    if (extra.success) {
      if (extra.data.assignedLawyer !== undefined) patchData.assignedLawyer = extra.data.assignedLawyer;
      if (extra.data.assigneeId !== undefined) patchData.assigneeId = extra.data.assigneeId;
      if (extra.data.caseId !== undefined) patchData.caseId = extra.data.caseId;
    }

    const session = await updateSession(id, patchData, req.userId);
    if (!session) {
      throw new NotFoundError("الجلسة غير موجودة.");
    }

    await recordAuditEvent({
      actorId: req.userId!,
      actorUsername: req.user || "",
      officeId: req.officeId!,
      action: "session.update",
      entityType: "session",
      entityId: String(id),
      summary: `تحديث بيانات الجلسة #${id}`,
    });

    res.json(session);
  } catch (err) {
    next(err);
  }
});

router.delete("/sessions/:id", async (req, res, next) => {
  try {
    const id = parsePositiveId(req.params.id);
    const deleted = await deleteSession(id, req.userId);
    if (!deleted) {
      throw new NotFoundError("الجلسة غير موجودة.");
    }

    await recordAuditEvent({
      actorId: req.userId!,
      actorUsername: req.user || "",
      officeId: req.officeId!,
      action: "session.delete",
      entityType: "session",
      entityId: String(id),
      summary: `نقل الجلسة #${id} إلى سلة المحذوفات`,
    });

    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

router.post("/sessions/:id/send-whatsapp", async (req, res, next) => {
  try {
    const id = parsePositiveId(req.params.id);
    const session = await getSessionById(id, req.userId);
    if (!session) {
      throw new NotFoundError("الجلسة غير موجودة.");
    }

    const hearingAt = computeHearingDateTime(session.sessionDateHijri, session.sessionTime);
    let remainingText = "تذكير فوري";

    if (hearingAt) {
      const diffMs = hearingAt.getTime() - Date.now();
      if (diffMs > 0) {
        const hours = Math.floor(diffMs / (1000 * 60 * 60));
        const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
        if (hours >= 24) {
          const days = Math.floor(hours / 24);
          const remHours = hours % 24;
          remainingText = `متبقي ${days} يوم و ${remHours} ساعة`;
        } else if (hours > 0) {
          remainingText = `متبقي ${hours} ساعة و ${minutes} دقيقة`;
        } else {
          remainingText = `متبقي ${minutes} دقيقة`;
        }
      } else {
        remainingText = "موعد الجلسة الآن أو انتهى";
      }
    } else {
      const daysStr = computeDaysRemainingStr(session.sessionDateHijri, session.sessionTime);
      remainingText = `متبقي ${daysStr}`;
    }

    const recipientPhone = req.userRecord?.whatsapp_number || null;
    const channel = new WhatsappReminderChannel();
    await channel.send({
      sessionId: session.id,
      officeId: req.officeId,
      userId: req.userId,
      recipientPhone,
      caseNumber: session.caseNumber,
      sessionDateHijri: session.sessionDateHijri,
      sessionTime: session.sessionTime,
      kind: "instant",
      remainingText,
      court: session.court,
      courtCircuit: session.courtCircuit,
      plaintiff: session.plaintiff,
      defendant: session.defendant,
      caseSubject: session.caseSubject,
    });

    res.json({ message: "تم إرسال تذكير الواتساب بنجاح!" });
  } catch (err: any) {
    res.status(400).json({
      error: err?.message || "فشل إرسال تذكير الواتساب.",
      code: "WHATSAPP_SEND_FAILED",
    });
  }
});

export default router;
