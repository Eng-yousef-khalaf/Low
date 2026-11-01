import { Router, type IRouter } from "express";
import { z } from "@workspace/api-zod";
import {
  attachAuthUser,
  requireAuth,
  requireActiveSubscription,
  requirePermission,
} from "../middlewares/auth.middleware";
import {
  listClients,
  getClientById,
  createClient,
  updateClient,
  deleteClient,
} from "../services/clients.service";
import {
  listCases,
  listCaseFinancialEntries,
} from "../services/cases.service";
import { listPoaRows } from "../services/poa.sheets.service";
import { normalizeNumericDigits } from "../utils/dateNormalize";
import { recordAuditEvent } from "../services/audit.service";
import {
  NotFoundError,
  ValidationError,
  formatZodErrorArabic,
} from "../lib/errors";

const router: IRouter = Router();

router.use(attachAuthUser, requireAuth, requireActiveSubscription);

const ClientCreateSchema = z.object({
  name: z.string().trim().min(1, "اسم العميل حقل إلزامي.").max(180),
  type: z.enum(["individual", "company"]).optional().default("individual"),
  identityNumber: z.string().trim().max(50).optional().nullable(),
  phone: z.string().trim().max(40).optional().nullable(),
  email: z.string().trim().max(150).optional().nullable(),
  address: z.string().trim().max(300).optional().nullable(),
  contactPerson: z.string().trim().max(150).optional().nullable(),
  notes: z.string().trim().max(3000).optional().nullable(),
  status: z.enum(["active", "archived"]).optional().default("active"),
});

const ClientUpdateSchema = ClientCreateSchema.partial();

router.get("/clients", async (req, res, next) => {
  try {
    const officeId = req.officeId!;
    const [clients, allCases] = await Promise.all([
      listClients(officeId),
      listCases(officeId),
    ]);

    const canSeeFinances =
      req.userRole === "admin" ||
      req.officeRole === "office_manager" ||
      Boolean(req.userPermissions?.canAccessFinances);

    const enriched = clients.map((c) => {
      const linkedCases = allCases.filter(
        (cs) => cs.clientId === c.id || cs.clientName === c.name,
      );
      const totalFees = linkedCases.reduce((sum, cs) => sum + (cs.totalFees || 0), 0);
      const paidFees = linkedCases.reduce((sum, cs) => sum + (cs.paidFees || 0), 0);
      return {
        ...c,
        caseCount: linkedCases.length,
        totalFees: canSeeFinances ? totalFees : 0,
        paidFees: canSeeFinances ? paidFees : 0,
        remainingFees: canSeeFinances ? Math.max(0, totalFees - paidFees) : 0,
      };
    });

    res.json(enriched);
  } catch (err) {
    next(err);
  }
});

router.get("/clients/:id", async (req, res, next) => {
  try {
    const officeId = req.officeId!;
    const client = await getClientById(req.params.id, officeId);
    if (!client) {
      throw new NotFoundError("العميل غير موجود أو لا يتبع لهذا المكتب.");
    }

    const [allCases, poaRows, financialEntries] = await Promise.all([
      listCases(officeId),
      listPoaRows(false, req.userId).catch(() => []),
      listCaseFinancialEntries(officeId, { clientId: client.id }).catch(() => []),
    ]);

    const linkedCases = allCases.filter(
      (cs) => cs.clientId === client.id || cs.clientName === client.name,
    );

    const linkedPoas = poaRows
      .map((p) => ({
        id: p.id,
        clientName: p.values[0] || "",
        poaNumber: p.values[1] || "",
        issueDateHijri: p.values[2] || "",
        expiryDateHijri: p.values[3] || "",
        daysRemaining: p.values[4] || "",
        notes: p.values[5] || "",
        createdAt: p.values[6] || "",
      }))
      .filter((p) => p.clientName && p.clientName.includes(client.name));

    const canSeeFinances =
      req.userRole === "admin" ||
      req.officeRole === "office_manager" ||
      Boolean(req.userPermissions?.canAccessFinances);

    const totalFees = linkedCases.reduce((sum, cs) => sum + (cs.totalFees || 0), 0);
    const paidFees = linkedCases.reduce((sum, cs) => sum + (cs.paidFees || 0), 0);

    res.json({
      ...client,
      cases: linkedCases,
      poas: linkedPoas,
      financialEntries: canSeeFinances ? financialEntries : [],
      totalFees: canSeeFinances ? totalFees : 0,
      paidFees: canSeeFinances ? paidFees : 0,
      remainingFees: canSeeFinances ? Math.max(0, totalFees - paidFees) : 0,
    });
  } catch (err) {
    next(err);
  }
});

router.post("/clients", requirePermission("canEditCases"), async (req, res, next) => {
  try {
    const parsed = ClientCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError(formatZodErrorArabic(parsed.error));
    }

    const newClient = await createClient({
      ...parsed.data,
      identityNumber: parsed.data.identityNumber
        ? normalizeNumericDigits(parsed.data.identityNumber)
        : null,
      phone: parsed.data.phone ? normalizeNumericDigits(parsed.data.phone) : null,
      officeId: req.officeId!,
    });

    await recordAuditEvent({
      actorId: req.userId!,
      actorUsername: req.user || "",
      officeId: req.officeId!,
      action: "client.create",
      entityType: "client",
      entityId: newClient.id,
      summary: `إضافة ملف موكل جديد (${newClient.name})`,
    });

    res.status(201).json(newClient);
  } catch (err) {
    next(err);
  }
});

router.patch("/clients/:id", requirePermission("canEditCases"), async (req, res, next) => {
  try {
    const parsed = ClientUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError(formatZodErrorArabic(parsed.error));
    }

    const updated = await updateClient(String(req.params.id), req.officeId!, parsed.data);
    if (!updated) {
      throw new NotFoundError("العميل غير موجود.");
    }

    await recordAuditEvent({
      actorId: req.userId!,
      actorUsername: req.user || "",
      officeId: req.officeId!,
      action: "client.update",
      entityType: "client",
      entityId: updated.id,
      summary: `تحديث بيانات الموكل (${updated.name})`,
    });

    res.json(updated);
  } catch (err) {
    next(err);
  }
});

router.delete("/clients/:id", requirePermission("canEditCases"), async (req, res, next) => {
  try {
    const clientId = String(req.params.id);
    const ok = await deleteClient(clientId, req.officeId!, req.userId);
    if (!ok) {
      throw new NotFoundError("العميل غير موجود.");
    }

    await recordAuditEvent({
      actorId: req.userId!,
      actorUsername: req.user || "",
      officeId: req.officeId!,
      action: "client.delete",
      entityType: "client",
      entityId: clientId,
      summary: `نقل ملف الموكل (${clientId}) إلى سلة المحذوفات`,
    });

    res.json({ message: "تم نقل ملف العميل إلى سلة المحذوفات بنجاح." });
  } catch (err) {
    next(err);
  }
});

export default router;
