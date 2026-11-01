import crypto from "crypto";
import { Router, type IRouter } from "express";
import { env } from "../config/env";
import { logger } from "../lib/logger";
import { runReminderSweep } from "../scheduler/reminderScheduler";

const router: IRouter = Router();

function safeCompareSecret(provided: string | null, expected: string): boolean {
  if (!provided || !expected) return false;
  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/**
 * GET /api/cron/reminders
 *
 * Protected by constant-time CRON_SECRET verification (`crypto.timingSafeEqual`).
 * Fails closed whenever CRON_SECRET is unset in production (or when unset without admin session).
 */
router.get("/cron/reminders", async (req, res) => {
  const secret = env.cronSecret;

  if (!secret || secret.length < 12) {
    logger.error("CRON_SECRET is missing or too short; rejecting cron invocation");
    res.status(503).json({
      ok: false,
      error: "مسار الجدولة محمي ويتطلب ضبط متغير CRON_SECRET (12 حرفاً على الأقل) على الخادم.",
      code: "CRON_SECRET_MISSING",
    });
    return;
  }

  const authHeader = req.headers["authorization"] ?? "";
  const provided = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : null;

  if (!safeCompareSecret(provided, secret)) {
    logger.warn({ ip: req.ip }, "Cron reminder endpoint: unauthorized request rejected");
    res.status(401).json({ ok: false, error: "غير مصرح بتشغيل مهمة الجدولة.", code: "UNAUTHORIZED" });
    return;
  }

  const startedAt = Date.now();
  try {
    const summary = await runReminderSweep();
    const durationMs = Date.now() - startedAt;
    logger.info({ durationMs, ...summary }, "Cron reminder sweep completed");
    res.json({ ok: true, durationMs, summary });
  } catch (err: any) {
    const durationMs = Date.now() - startedAt;
    logger.error({ reason: err?.message, durationMs }, "Cron reminder sweep failed");
    res.status(500).json({ ok: false, error: "فشل تنفيذ فحص التنبيهات المجدول." });
  }
});

export default router;
