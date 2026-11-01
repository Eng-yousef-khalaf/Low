import { Router, type IRouter } from "express";
import { attachAuthUser, requireAdmin } from "../middlewares/auth.middleware";
import {
  listSupabaseUsers,
  createSupabaseUser,
  deleteSupabaseUser,
  updateSupabaseUser,
  toggleUserStatus,
  resetUserAiUsage,
} from "../services/supabase.service";
import { isSupabaseConfigured } from "../config/env";
import { recordAuditEvent } from "../services/audit.service";
import { invalidateSessionsCache } from "../services/googleSheets.service";
import { invalidatePoaCache } from "../services/poa.sheets.service";
import { invalidateTaskCache } from "../services/task.sheets.service";
import { invalidateJudgmentCache } from "../services/judgment.sheets.service";

const router: IRouter = Router();

router.use(attachAuthUser, requireAdmin);

router.get("/users", async (_req, res, next) => {
  try {
    const isConfigured = isSupabaseConfigured();
    const users = await listSupabaseUsers();
    res.json({
      isSupabaseConfigured: isConfigured,
      users,
    });
  } catch (err) {
    next(err);
  }
});

router.post("/users", async (req, res, next) => {
  try {
    const {
      username,
      email,
      password,
      role,
      office_id,
      office_role,
      permissions,
      display_name,
      whatsapp_number,
      status,
      subscription_end_date,
      subscription_notes,
      plan_tier,
      billing_cycle,
      ai_quota_limit,
      google_service_account_json,
      google_spreadsheet_id,
      google_sheet_name,
    } = req.body;

    if (!username?.trim() || !password) {
      res.status(400).json({
        error: "اسم المستخدم وكلمة المرور مطلوبان.",
        code: "VALIDATION_ERROR",
      });
      return;
    }

    const newUser = await createSupabaseUser({
      username: username.trim(),
      email,
      password,
      role: role === "admin" ? "admin" : "staff",
      office_id,
      office_role,
      permissions,
      display_name,
      whatsapp_number,
      status: status || "active",
      subscription_end_date: subscription_end_date || null,
      subscription_notes: subscription_notes || null,
      plan_tier: plan_tier || (role === "admin" ? "pro" : "plus"),
      billing_cycle: billing_cycle || "annual",
      ai_quota_limit: ai_quota_limit !== undefined ? Number(ai_quota_limit) : undefined,
      google_service_account_json,
      google_spreadsheet_id,
      google_sheet_name,
    });

    await recordAuditEvent({
      actorId: req.userId!,
      actorUsername: req.user || "",
      officeId: newUser.office_id,
      action: "user.create",
      entityType: "user",
      entityId: newUser.id,
      summary: `إنشاء حساب مستخدم جديد (${newUser.username}) بدور (${newUser.role})`,
    });

    res.status(201).json(newUser);
  } catch (err) {
    next(err);
  }
});

router.patch("/users/:id", async (req, res, next) => {
  try {
    const id = String(req.params.id);
    const {
      password,
      role,
      office_id,
      office_role,
      permissions,
      display_name,
      whatsapp_number,
      email,
      status,
      subscription_end_date,
      subscription_notes,
      plan_tier,
      billing_cycle,
      ai_quota_limit,
      ai_usage_count,
      google_service_account_json,
      google_spreadsheet_id,
      google_sheet_name,
    } = req.body;

    const updatedUser = await updateSupabaseUser(id, {
      password,
      role,
      office_id,
      office_role,
      permissions,
      display_name,
      whatsapp_number,
      email,
      status,
      subscription_end_date,
      subscription_notes,
      plan_tier,
      billing_cycle,
      ai_quota_limit: ai_quota_limit !== undefined ? Number(ai_quota_limit) : undefined,
      ai_usage_count: ai_usage_count !== undefined ? Number(ai_usage_count) : undefined,
      google_service_account_json,
      google_spreadsheet_id,
      google_sheet_name,
    });

    invalidateSessionsCache(updatedUser.office_id);
    invalidatePoaCache(updatedUser.office_id);
    invalidateTaskCache(updatedUser.office_id);
    invalidateJudgmentCache(updatedUser.office_id);

    await recordAuditEvent({
      actorId: req.userId!,
      actorUsername: req.user || "",
      officeId: updatedUser.office_id,
      action: "user.update",
      entityType: "user",
      entityId: updatedUser.id,
      summary: `تحديث بيانات وصلاحيات الحساب (${updatedUser.username})`,
    });

    res.json(updatedUser);
  } catch (err) {
    next(err);
  }
});

router.post("/users/:id/reset-ai-usage", async (req, res, next) => {
  try {
    const id = String(req.params.id);
    const updated = await resetUserAiUsage(id);

    await recordAuditEvent({
      actorId: req.userId!,
      actorUsername: req.user || "",
      officeId: updated.office_id,
      action: "user.reset_ai_quota",
      entityType: "user",
      entityId: id,
      summary: `تصفير عداد الذكاء الاصطناعي للحساب (${updated.username})`,
    });

    res.json(updated);
  } catch (err) {
    next(err);
  }
});

router.post("/users/:id/toggle-status", async (req, res, next) => {
  try {
    const id = String(req.params.id);
    const { status } = req.body;
    const updated = await toggleUserStatus(id, status);

    await recordAuditEvent({
      actorId: req.userId!,
      actorUsername: req.user || "",
      officeId: updated.office_id,
      action: `user.status_${updated.status}`,
      entityType: "user",
      entityId: id,
      summary: `تغيير حالة اشتراك الحساب (${updated.username}) إلى (${updated.status})`,
    });

    res.json(updated);
  } catch (err) {
    next(err);
  }
});

router.delete("/users/:id", async (req, res, next) => {
  try {
    const id = String(req.params.id);
    if (req.userId === id) {
      res.status(400).json({
        error: "لا يمكنك حذف الحساب الذي قمت بتسجيل الدخول به حالياً.",
        code: "VALIDATION_ERROR",
      });
      return;
    }

    await deleteSupabaseUser(id);

    await recordAuditEvent({
      actorId: req.userId!,
      actorUsername: req.user || "",
      officeId: req.officeId || "platform-admin",
      action: "user.delete",
      entityType: "user",
      entityId: id,
      summary: `حذف الحساب (${id}) وإبطال جلساته الفعالة فوراً`,
    });

    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

export default router;
