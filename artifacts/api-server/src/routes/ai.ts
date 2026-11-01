import { Router, type IRouter } from "express";
import { AnalyzeMessageBody } from "@workspace/api-zod";
import {
  analyzeCourtMessage,
  AiExtractionError,
  AiQuotaExceededError,
  InsufficientSessionDataError,
} from "../services/ai.service";
import { logger } from "../lib/logger";
import {
  attachAuthUser,
  requireAuth,
  requireActiveSubscription,
} from "../middlewares/auth.middleware";
import { generateReferenceCode } from "../lib/errors";

const router: IRouter = Router();

/**
 * POST /api/ai/analyze
 * Analyzes a raw court SMS with atomic per-user monthly quota reservation and automatic rollback on failure.
 * Separates HTTP 400 (empty input), HTTP 422 (non-judicial/insufficient text),
 * HTTP 403 (quota/subscription exhausted), and HTTP 503 (service error) cleanly without leaking internal field names.
 */
router.post(
  "/ai/analyze",
  attachAuthUser,
  requireAuth,
  requireActiveSubscription,
  async (req, res) => {
    const parseResult = AnalyzeMessageBody.safeParse(req.body);
    if (!parseResult.success || !parseResult.data.message?.trim()) {
      res.status(400).json({
        error: "يرجى لصق نص إشعار الجلسة القضائية أولاً قبل الضغط على زر التحليل.",
        code: "INVALID_INPUT",
        isInputError: true,
      });
      return;
    }

    try {
      const extraction = await analyzeCourtMessage(parseResult.data.message, req.userId);
      res.json(extraction);
    } catch (err: any) {
      if (err instanceof InsufficientSessionDataError) {
        res.status(422).json({
          error: err.message,
          code: "INSUFFICIENT_SESSION_DATA",
          isInsufficientData: true,
          hint: "تأكد من نسخ رسالة التبليغ القضائي كاملةً متضمنةً رقم القضية أو اسم المحكمة أو موعد الجلسة.",
        });
        return;
      }

      if (err instanceof AiQuotaExceededError) {
        res.status(403).json({
          error: err.message,
          code: "AI_QUOTA_EXCEEDED",
          isQuotaExceeded: true,
          hint: "تواصل مع المشرف العام لترقية الباقة أو انتظار التجديد الشهري التلقائي للرصيد.",
        });
        return;
      }

      const refCode =
        err instanceof AiExtractionError && err.referenceCode
          ? err.referenceCode
          : generateReferenceCode("AI");

      logger.error(
        { referenceCode: refCode, userId: req.userId },
        "AI extraction service error",
      );

      res.status(503).json({
        error: "تعذر إتمام التحليل الذكي حالياً بسبب انقطاع مؤقت في الخدمة. لم يتم خصم أي نقطة من حصتك.",
        code: "AI_SERVICE_UNAVAILABLE",
        referenceCode: refCode,
        canRetry: true,
      });
    }
  },
);

export default router;
