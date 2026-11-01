import { Router, type IRouter } from "express";
import { z } from "@workspace/api-zod";
import {
  attachAuthUser,
  requireAuth,
  requireActiveSubscription,
  requireOfficeManagerOrAdmin,
} from "../middlewares/auth.middleware";
import {
  listSupabaseUsers,
  createSupabaseUser,
  updateSupabaseUser,
  deleteSupabaseUser,
  type AppUser,
  type OfficeRole,
} from "../services/supabase.service";
import { listCases } from "../services/cases.service";
import { recordAuditEvent } from "../services/audit.service";
import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
  formatZodErrorArabic,
} from "../lib/errors";
import { normalizeNumericDigits } from "../utils/dateNormalize";

const router: IRouter = Router();

router.use(attachAuthUser, requireAuth, requireActiveSubscription);

export interface TeamMember {
  id: string;
  name: string;
  username: string;
  role: "manager" | "lawyer" | "paralegal" | "accountant";
  email?: string;
  phone?: string;
  assignedCasesCount?: number;
  status: "active" | "inactive";
  canAccessFinances: boolean;
  canEditCases: boolean;
  canManageSettings: boolean;
  createdAt: string;
}

function mapOfficeRoleToUi(role?: OfficeRole): TeamMember["role"] {
  if (role === "office_manager") return "manager";
  if (role === "paralegal") return "paralegal";
  if (role === "accountant") return "accountant";
  return "lawyer";
}

function mapUiRoleToOfficeRole(role?: string): OfficeRole {
  if (role === "manager" || role === "office_manager") return "office_manager";
  if (role === "paralegal") return "paralegal";
  if (role === "accountant") return "accountant";
  return "lawyer";
}

function userToTeamMember(u: AppUser, assignedCasesCount = 0): TeamMember {
  const uiRole = mapOfficeRoleToUi(u.office_role);
  const perms = u.permissions || {
    canAccessFinances: uiRole === "manager" || uiRole === "accountant",
    canEditCases: uiRole === "manager" || uiRole === "lawyer",
    canManageSettings: uiRole === "manager",
  };
  return {
    id: u.id,
    name: u.display_name || u.username,
    username: u.username,
    role: uiRole,
    email: u.email || undefined,
    phone: u.whatsapp_number || undefined,
    assignedCasesCount,
    status: u.status === "suspended" ? "inactive" : "active",
    canAccessFinances: perms.canAccessFinances,
    canEditCases: perms.canEditCases,
    canManageSettings: perms.canManageSettings,
    createdAt: u.created_at || new Date().toISOString(),
  };
}

/**
 * GET /api/team
 * Lists ONLY the authenticated users belonging to the caller's office (`office_id === req.officeId`).
 * Used across Sessions, Tasks, Judgments, and Cases for team assignment dropdowns.
 */
router.get("/team", async (req, res, next) => {
  try {
    const officeId = req.officeId!;
    const [allUsers, officeCases] = await Promise.all([
      listSupabaseUsers(),
      listCases(officeId).catch(() => []),
    ]);

    const officeUsers = allUsers.filter((u) => (u.office_id || u.id) === officeId);
    const members = officeUsers.map((u) => {
      const displayName = (u.display_name || u.username).toLowerCase();
      const count = officeCases.filter(
        (c) =>
          c.assigneeId === u.id ||
          (c.assignedLawyer && c.assignedLawyer.toLowerCase() === displayName),
      ).length;
      return userToTeamMember(u, count);
    });

    res.json(members);
  } catch (err) {
    next(err);
  }
});

const CreateTeamMemberSchema = z.object({
  name: z.string().trim().min(1, "اسم عضو الفريق مطلوب.").max(150),
  username: z.string().trim().min(3, "اسم المستخدم يجب ألا يقل عن 3 أحرف.").max(60),
  password: z.string().min(8, "كلمة المرور مطلوبة (8 أحرف على الأقل تشمل حروفاً وأرقاماً)."),
  role: z.enum(["manager", "lawyer", "paralegal", "accountant"]).optional().default("lawyer"),
  email: z.string().trim().max(150).optional(),
  phone: z.string().trim().max(40).optional(),
  canAccessFinances: z.boolean().optional(),
  canEditCases: z.boolean().optional(),
  canManageSettings: z.boolean().optional(),
});

/**
 * POST /api/team
 * Creates a real authenticated team member inside the caller's office (`office_id = req.officeId`).
 * Restricted to `office_manager` or platform `admin`.
 */
router.post("/team", requireOfficeManagerOrAdmin, async (req, res, next) => {
  try {
    const parsed = CreateTeamMemberSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError(formatZodErrorArabic(parsed.error));
    }

    const caller = req.userRecord!;
    const officeId = req.officeId!;
    const officeRole = mapUiRoleToOfficeRole(parsed.data.role);

    const created = await createSupabaseUser({
      username: parsed.data.username,
      password: parsed.data.password,
      role: "staff",
      office_id: officeId,
      office_role: officeRole,
      display_name: parsed.data.name,
      email: parsed.data.email,
      whatsapp_number: parsed.data.phone ? normalizeNumericDigits(parsed.data.phone) : undefined,
      status: "active",
      plan_tier: caller.plan_tier,
      billing_cycle: caller.billing_cycle,
      subscription_end_date: caller.subscription_end_date || undefined,
      ai_quota_limit: caller.ai_quota_limit,
      permissions: {
        canAccessFinances:
          parsed.data.canAccessFinances ??
          (officeRole === "office_manager" || officeRole === "accountant"),
        canEditCases:
          parsed.data.canEditCases ?? (officeRole === "office_manager" || officeRole === "lawyer"),
        canManageSettings: parsed.data.canManageSettings ?? officeRole === "office_manager",
      },
    });

    await recordAuditEvent({
      actorId: req.userId!,
      actorUsername: req.user || "",
      officeId,
      action: "team.member_create",
      entityType: "user",
      entityId: created.id,
      summary: `إضافة عضو فريق جديد (${created.display_name || created.username}) بدور (${parsed.data.role})`,
    });

    res.status(201).json(userToTeamMember(created));
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /api/team/:id
 * Updates a team member belonging strictly to the caller's office (immediately revoking old permissions/sessions).
 */
router.patch("/team/:id", requireOfficeManagerOrAdmin, async (req, res, next) => {
  try {
    const targetId = String(req.params.id);
    const officeId = req.officeId!;
    const allUsers = await listSupabaseUsers();
    const target = allUsers.find((u) => u.id === targetId);

    if (!target || (target.office_id || target.id) !== officeId) {
      throw new NotFoundError("عضو الفريق غير موجود في هذا المكتب.");
    }
    if (target.role === "admin" && req.userRole !== "admin") {
      throw new ForbiddenError("لا يمكن تعديل حساب المشرف العام من داخل إعدادات المكتب.");
    }

    const body = req.body || {};
    const nextOfficeRole = body.role ? mapUiRoleToOfficeRole(body.role) : target.office_role;
    const currentPerms = target.permissions || {
      canAccessFinances: false,
      canEditCases: true,
      canManageSettings: false,
    };

    const updated = await updateSupabaseUser(targetId, {
      display_name: body.name !== undefined ? String(body.name).trim() : undefined,
      email: body.email !== undefined ? String(body.email).trim() : undefined,
      whatsapp_number:
        body.phone !== undefined ? normalizeNumericDigits(String(body.phone).trim()) : undefined,
      password: body.password ? String(body.password) : undefined,
      office_role: nextOfficeRole,
      status:
        body.status === "inactive"
          ? "suspended"
          : body.status === "active"
            ? "active"
            : undefined,
      permissions: {
        canAccessFinances:
          body.canAccessFinances !== undefined
            ? Boolean(body.canAccessFinances)
            : currentPerms.canAccessFinances,
        canEditCases:
          body.canEditCases !== undefined ? Boolean(body.canEditCases) : currentPerms.canEditCases,
        canManageSettings:
          body.canManageSettings !== undefined
            ? Boolean(body.canManageSettings)
            : currentPerms.canManageSettings,
      },
    });

    await recordAuditEvent({
      actorId: req.userId!,
      actorUsername: req.user || "",
      officeId,
      action: "team.member_update",
      entityType: "user",
      entityId: updated.id,
      summary: `تحديث صلاحيات وبيانات عضو الفريق (${updated.username})`,
    });

    res.json(userToTeamMember(updated));
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/team/:id
 * Removes a team member from the caller's office and immediately revokes their session.
 */
router.delete("/team/:id", requireOfficeManagerOrAdmin, async (req, res, next) => {
  try {
    const targetId = String(req.params.id);
    const officeId = req.officeId!;

    if (targetId === req.userId) {
      throw new ValidationError("لا يمكنك إزالة حسابك الشخصي الحالي من الفريق.");
    }

    const allUsers = await listSupabaseUsers();
    const target = allUsers.find((u) => u.id === targetId);
    if (!target || (target.office_id || target.id) !== officeId) {
      throw new NotFoundError("عضو الفريق غير موجود في هذا المكتب.");
    }
    if (target.role === "admin") {
      throw new ForbiddenError("لا يمكن حذف حساب المشرف العام.");
    }

    await deleteSupabaseUser(targetId);

    await recordAuditEvent({
      actorId: req.userId!,
      actorUsername: req.user || "",
      officeId,
      action: "team.member_delete",
      entityType: "user",
      entityId: targetId,
      summary: `إزالة عضو الفريق (${target.username}) وإبطال جلسته فوراً`,
    });

    res.json({ message: "تم إزالة عضو الفريق وإبطال جلسته بنجاح." });
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /api/team/office-preferences
 * Dedicated Office Manager preferences endpoint (completely separate from Platform Admin `/api/settings`!).
 */
router.put("/team/office-preferences", requireOfficeManagerOrAdmin, async (req, res, next) => {
  try {
    const { whatsapp_number, display_name } = req.body || {};
    const updated = await updateSupabaseUser(req.userId!, {
      whatsapp_number:
        whatsapp_number !== undefined
          ? normalizeNumericDigits(String(whatsapp_number).trim())
          : undefined,
      display_name: display_name !== undefined ? String(display_name).trim() : undefined,
    });

    await recordAuditEvent({
      actorId: req.userId!,
      actorUsername: req.user || "",
      officeId: req.officeId!,
      action: "office.preferences_update",
      entityType: "settings",
      entityId: req.officeId!,
      summary: "تحديث إعدادات تنبيهات وبيانات المكتب",
    });

    res.json({
      message: "تم حفظ إعدادات المكتب بنجاح.",
      whatsapp_number: updated.whatsapp_number,
      displayName: updated.display_name,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
