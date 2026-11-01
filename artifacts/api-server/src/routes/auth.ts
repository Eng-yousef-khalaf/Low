import { Router, type IRouter } from "express";
import { LoginBody } from "@workspace/api-zod";
import { isAiConfigured, isGoogleSheetsConfigured, isSupabaseConfigured } from "../config/env";
import { getSettings } from "../config/settings-store";
import { logger } from "../lib/logger";
import {
  attachAuthUser,
  clearSession,
  createSession,
  requireAuth,
  requireAdmin,
} from "../middlewares/auth.middleware";
import {
  loginRateLimiter,
  adminLoginRateLimiter,
  clearRateLimitForLogin,
} from "../middlewares/rate-limiter.middleware";
import {
  verifySupabaseUser,
  ensureDefaultAdmin,
  ensureUserMonthlyQuotaFresh,
} from "../services/supabase.service";
import { getOfficeGoogleLinkState } from "../services/googleSheets.service";
import { recordAuditEvent } from "../services/audit.service";

const router: IRouter = Router();

const ARABIC_MONTHS_NAMES = [
  "يناير",
  "فبراير",
  "مارس",
  "أبريل",
  "مايو",
  "يونيو",
  "يوليو",
  "أغسطس",
  "سبتمبر",
  "أكتوبر",
  "نوفمبر",
  "ديسمبر",
];

function formatSubscriptionFriendlyDate(dateStr: string | null | undefined): {
  formattedDate: string;
  summaryText: string;
} {
  if (!dateStr) return { formattedDate: "غير محدد", summaryText: "اشتراك مفتوح دائم" };
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return { formattedDate: dateStr, summaryText: dateStr };
    const formatted = `${d.getDate()} ${ARABIC_MONTHS_NAMES[d.getMonth()]} ${d.getFullYear()}`;
    const diffMs = d.getTime() - Date.now();
    const days = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
    if (days < 0) {
      return {
        formattedDate: formatted,
        summaryText: `انتهى الاشتراك في ${formatted} (منذ ${Math.abs(days)} يوم)`,
      };
    }
    return {
      formattedDate: formatted,
      summaryText: `ينتهي الاشتراك في ${formatted} — متبقي ${days} يوماً`,
    };
  } catch {
    return { formattedDate: dateStr, summaryText: dateStr };
  }
}

/**
 * POST /api/auth/login
 * Authenticates a lawyer/office user strictly against the authoritative user store.
 * Zero hardcoded or static fallback credentials!
 */
router.post("/auth/login", loginRateLimiter, attachAuthUser, async (req, res, next) => {
  try {
    const parseResult = LoginBody.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({ error: "اسم المستخدم وكلمة المرور مطلوبان.", code: "VALIDATION_ERROR" });
      return;
    }

    const username = parseResult.data.username.trim();
    const password = parseResult.data.password;

    await ensureDefaultAdmin();
    const verifiedUser = await verifySupabaseUser(username, password);

    if (!verifiedUser) {
      res.status(401).json({
        error: "اسم المستخدم أو كلمة المرور غير صحيحة.",
        code: "INVALID_CREDENTIALS",
      });
      return;
    }

    if (verifiedUser.role !== "admin") {
      if (verifiedUser.status === "suspended") {
        res.status(403).json({
          error:
            "تم إيقاف اشتراك هذا الحساب مؤقتاً من قِبل إدارة المنظومة. يرجى التواصل مع المشرف العام لإعادة التفعيل.",
          code: "SUBSCRIPTION_INACTIVE",
          isSuspended: true,
        });
        return;
      }

      if (verifiedUser.subscription_end_date) {
        const isDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(verifiedUser.subscription_end_date.trim());
        const rawEnd = new Date(verifiedUser.subscription_end_date).getTime();
        const expiryTime = isDateOnly ? rawEnd + 24 * 3600 * 1000 - 1 : rawEnd;
        if (Number.isNaN(expiryTime) || Date.now() > expiryTime) {
          res.status(403).json({
            error:
              "عذراً، انتهت فترة اشتراكك في المنظومة. يرجى التواصل مع المشرف العام لتجديد الاشتراك.",
            code: "SUBSCRIPTION_INACTIVE",
            isExpired: true,
            subscription_end_date: verifiedUser.subscription_end_date,
          });
          return;
        }
      }
    }

    let subscriptionWarning: string | null = null;
    let daysRemaining: number | null = null;
    if (verifiedUser.subscription_end_date) {
      const diffMs = new Date(verifiedUser.subscription_end_date).getTime() - Date.now();
      daysRemaining = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
      if (daysRemaining <= 7 && daysRemaining >= 0) {
        subscriptionWarning = `تنبيه: ينتهي اشتراكك خلال ${
          daysRemaining === 0
            ? "اليوم"
            : `${daysRemaining} ${daysRemaining === 1 ? "يوم" : daysRemaining === 2 ? "يومين" : "أيام"}`
        }. يرجى التواصل مع الإدارة للتجديد.`;
      }
    }

    await clearRateLimitForLogin(req, username);
    createSession(res, verifiedUser);

    await recordAuditEvent({
      actorId: verifiedUser.id,
      actorUsername: verifiedUser.username,
      officeId: verifiedUser.office_id,
      action: "auth.login",
      entityType: "auth",
      entityId: verifiedUser.id,
      summary: `تسجيل دخول ناجح للحساب (${verifiedUser.username})`,
    });

    res.json({
      id: verifiedUser.id,
      username: verifiedUser.username,
      role: verifiedUser.role,
      officeId: verifiedUser.office_id,
      officeRole: verifiedUser.office_role || "office_manager",
      permissions: verifiedUser.permissions,
      displayName: verifiedUser.display_name,
      status: verifiedUser.status || "active",
      subscription_end_date: verifiedUser.subscription_end_date,
      subscriptionWarning,
      daysRemaining,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/auth/admin-login
 * Dedicated Admin Portal Login — permits ONLY verified `role === 'admin'` accounts from the authoritative store.
 * Zero hardcoded or static fallback credentials!
 */
router.post("/auth/admin-login", adminLoginRateLimiter, attachAuthUser, async (req, res, next) => {
  try {
    const parseResult = LoginBody.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({ error: "اسم المستخدم وكلمة المرور مطلوبان.", code: "VALIDATION_ERROR" });
      return;
    }

    const username = parseResult.data.username.trim();
    const password = parseResult.data.password;

    await ensureDefaultAdmin();
    const verifiedAdmin = await verifySupabaseUser(username, password);

    if (!verifiedAdmin) {
      res.status(401).json({
        error: "بيانات دخول المشرف غير صحيحة.",
        code: "INVALID_CREDENTIALS",
      });
      return;
    }

    if (verifiedAdmin.role !== "admin" || verifiedAdmin.status === "suspended") {
      res.status(403).json({
        error: "عذراً، هذا الحساب ليس لديه صلاحيات الإدارة للدخول لبوابة المشرف.",
        code: "FORBIDDEN",
      });
      return;
    }

    await clearRateLimitForLogin(req, username);
    createSession(res, verifiedAdmin);

    await recordAuditEvent({
      actorId: verifiedAdmin.id,
      actorUsername: verifiedAdmin.username,
      officeId: verifiedAdmin.office_id,
      action: "auth.admin_login",
      entityType: "auth",
      entityId: verifiedAdmin.id,
      summary: `تسجيل دخول للمشرف العام (${verifiedAdmin.username})`,
    });

    res.json({
      id: verifiedAdmin.id,
      username: verifiedAdmin.username,
      role: verifiedAdmin.role,
      officeId: verifiedAdmin.office_id,
      displayName: verifiedAdmin.display_name,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/auth/logout
 * Clears cookie AND revokes session server-side immediately.
 */
router.post("/auth/logout", attachAuthUser, async (req, res, next) => {
  try {
    await clearSession(res, req);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/auth/me
 * Reuses `req.userRecord` resolved once by `attachAuthUser` (never calls `listSupabaseUsers()`).
 * Automatically refreshes monthly AI quota period and reports unified office connection state.
 */
router.get("/auth/me", attachAuthUser, requireAuth, async (req, res) => {
  try {
    const freshUser = (await ensureUserMonthlyQuotaFresh(req.userRecord!.id)) || req.userRecord!;
    const linkState = await getOfficeGoogleLinkState(freshUser.id);
    const settings = getSettings();

    const status = freshUser.status || "active";
    const isSuspended = status === "suspended";
    const plan_tier = freshUser.plan_tier || (freshUser.role === "admin" ? "pro" : "plus");
    const billing_cycle = freshUser.billing_cycle || "annual";
    const ai_quota_limit =
      freshUser.ai_quota_limit !== undefined
        ? freshUser.ai_quota_limit
        : freshUser.role === "admin"
          ? -1
          : plan_tier === "pro"
            ? 300
            : 50;
    const ai_usage_count = freshUser.ai_usage_count || 0;
    const subscription_end_date = freshUser.subscription_end_date || null;

    let subscription_formatted = "اشتراك مفتوح دائم";
    let subscriptionWarning: string | null = null;
    let daysRemaining: number | null = null;
    let isExpired = false;

    if (subscription_end_date) {
      const friendly = formatSubscriptionFriendlyDate(subscription_end_date);
      subscription_formatted = friendly.summaryText;

      const diffMs = new Date(subscription_end_date).getTime() - Date.now();
      daysRemaining = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
      if (daysRemaining < 0) {
        isExpired = true;
      } else if (daysRemaining <= 14) {
        subscriptionWarning = `تنبيه: ينتهي اشتراكك خلال ${
          daysRemaining === 0
            ? "اليوم"
            : `${daysRemaining} ${daysRemaining === 1 ? "يوم" : daysRemaining === 2 ? "يومين" : "أيام"}`
        }. يرجى التجديد لضمان استمرار كافة الخدمات.`;
      }
    }

    const now = new Date();
    const nextRenewal = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const formattedNextRenewal = `${nextRenewal.getDate()} ${ARABIC_MONTHS_NAMES[nextRenewal.getMonth()]} ${nextRenewal.getFullYear()}`;
    const isAiConnected = Boolean(
      isAiConfigured() || settings.hfApiToken || process.env.HF_API_TOKEN,
    );
    const isGoogleConnected =
      linkState.status === "connected" || linkState.status === "local_isolated";

    res.json({
      id: freshUser.id,
      userId: freshUser.id,
      username: freshUser.username,
      role: freshUser.role,
      officeId: freshUser.office_id,
      officeRole: freshUser.office_role || "office_manager",
      permissions: freshUser.permissions,
      displayName: freshUser.display_name || freshUser.username,
      whatsapp_number: freshUser.whatsapp_number || null,
      status,
      isSuspended,
      isExpired,
      subscription_end_date,
      subscription_formatted,
      subscriptionWarning,
      daysRemaining,
      plan_tier,
      billing_cycle,
      ai_quota_limit,
      ai_usage_count,
      ai_remaining: ai_quota_limit === -1 ? -1 : Math.max(0, ai_quota_limit - ai_usage_count),
      ai_quota_period: freshUser.ai_quota_period,
      ai_renewal_date: formattedNextRenewal,
      isAiConnected,
      isGoogleConnected,
      googleLinkStatus: linkState.status,
      googleLinkMessage: "message" in linkState ? linkState.message : "متصل بـ Google Sheets",
      storage_mode:
        linkState.status === "connected"
          ? "google_sheets"
          : isGoogleSheetsConfigured()
            ? "google_sheets"
            : "local_storage",
      isSupabase: isSupabaseConfigured(),
    });
  } catch (err) {
    logger.error({ err }, "Failed to serialize current user");
    res.status(500).json({ error: "تعذر تحميل بيانات الحساب الحالي." });
  }
});

export default router;
export { attachAuthUser, requireAuth, requireAdmin };
