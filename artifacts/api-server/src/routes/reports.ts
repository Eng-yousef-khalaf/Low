import { Router, type IRouter } from "express";
import {
  attachAuthUser,
  requireAuth,
  requireActiveSubscription,
} from "../middlewares/auth.middleware";
import { getSessionReport, saveSessionReport } from "../services/session.service";
import { normalizeNumericDigits } from "../utils/dateNormalize";
import { recordAuditEvent } from "../services/audit.service";
import { NotFoundError, ValidationError } from "../lib/errors";
import { logger } from "../lib/logger";

const router: IRouter = Router();

router.use(attachAuthUser, requireAuth, requireActiveSubscription);

function parseSessionId(raw: string): number {
  const normalized = normalizeNumericDigits(String(raw || "")).trim();
  if (!/^\d+$/.test(normalized)) {
    throw new ValidationError("معرّف الجلسة غير صالح.");
  }
  const id = Number(normalized);
  if (!Number.isSafeInteger(id) || id < 1) {
    throw new ValidationError("معرّف الجلسة خارج النطاق المسموح.");
  }
  return id;
}

/** GET /api/sessions/:id/report — fetch the saved report (null if none) */
router.get("/sessions/:id/report", async (req, res, next) => {
  try {
    const id = parseSessionId(req.params.id);
    const report = await getSessionReport(id, req.userId);
    if (!report) {
      res.status(200).json(null);
      return;
    }
    res.json(report);
  } catch (err) {
    next(err);
  }
});

/** PUT /api/sessions/:id/report — create or update the report (PII redacted from logs) */
router.put("/sessions/:id/report", async (req, res, next) => {
  try {
    const id = parseSessionId(req.params.id);
    // Audit Finding #30: NEVER log req.body (contains confidential judicial session reports!)
    logger.info({ sessionId: id, officeId: req.officeId }, "Updating session report");

    const reportText =
      typeof req.body === "string"
        ? req.body
        : req.body && typeof req.body === "object"
          ? JSON.stringify(req.body)
          : "";

    if (reportText.length > 100_000) {
      throw new ValidationError("حجم محضر الجلسة يتجاوز الحد الأقصى المسموح.");
    }

    const updated = await saveSessionReport(id, reportText, req.userId);
    if (!updated) {
      throw new NotFoundError("الجلسة غير موجودة.");
    }

    await recordAuditEvent({
      actorId: req.userId!,
      actorUsername: req.user || "",
      officeId: req.officeId!,
      action: "report.save",
      entityType: "session",
      entityId: String(id),
      summary: `حفظ وتحديث محضر الجلسة #${id}`,
    });

    res.json(updated);
  } catch (err) {
    next(err);
  }
});

export default router;
