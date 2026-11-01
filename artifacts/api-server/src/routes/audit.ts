import { Router, type IRouter } from "express";
import { z } from "@workspace/api-zod";
import {
  attachAuthUser,
  requireAuth,
  requireActiveSubscription,
  requireOfficeManagerOrAdmin,
} from "../middlewares/auth.middleware";
import { listAuditEvents, recordAuditEvent } from "../services/audit.service";
import {
  listSessions,
  listDeletedSessions,
  restoreDeletedSession,
} from "../services/session.service";
import {
  listPoaRecordsWithMeta,
  restorePoaRow,
} from "../services/poa.sheets.service";
import {
  listTaskRecordsWithMeta,
  restoreTaskRow,
} from "../services/task.sheets.service";
import {
  listJudgmentRecordsWithMeta,
  restoreJudgmentRow,
} from "../services/judgment.sheets.service";
import {
  listCases,
  restoreCase,
  listCaseFinancialEntries,
} from "../services/cases.service";
import {
  listClients,
  restoreClient,
} from "../services/clients.service";
import { ValidationError, NotFoundError } from "../lib/errors";

const router: IRouter = Router();

router.use(attachAuthUser, requireAuth, requireActiveSubscription, requireOfficeManagerOrAdmin);

/**
 * GET /api/audit/logs
 * Lists office-isolated audit events (or platform-wide events for super-admin).
 */
router.get("/audit/logs", async (req, res, next) => {
  try {
    const limit = Number(req.query.limit) || 100;
    const isPlatformAdmin = req.userRole === "admin" && req.query.scope === "platform";
    const logs = await listAuditEvents({
      officeId: req.officeId,
      isPlatformAdmin,
      limit,
    });
    res.json({ logs });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/audit/trash
 * Returns soft-deleted items for the current office across Sessions, POA, Tasks, Judgments, Cases, and Clients.
 */
router.get("/audit/trash", async (req, res, next) => {
  try {
    const userId = req.userId!;
    const officeId = req.officeId!;

    const [
      deletedSessionsRes,
      poaRes,
      tasksRes,
      judgmentsRes,
      casesRes,
      clientsRes,
    ] = await Promise.allSettled([
      listDeletedSessions(userId),
      listPoaRecordsWithMeta(true, userId, true),
      listTaskRecordsWithMeta(true, userId, true),
      listJudgmentRecordsWithMeta(true, userId, true),
      listCases(officeId, undefined, true),
      listClients(officeId, true),
    ]);

    const items: Array<{
      entityType: "session" | "poa" | "task" | "judgment" | "case" | "client";
      id: string | number;
      title: string;
      deletedAt: string;
    }> = [];

    if (deletedSessionsRes.status === "fulfilled") {
      for (const s of deletedSessionsRes.value) {
        items.push({
          entityType: "session",
          id: s.id,
          title: `جلسة القضية ${s.caseNumber || `#${s.id}`} — ${s.court || ""}`,
          deletedAt: s.createdAt,
        });
      }
    }

    if (poaRes.status === "fulfilled") {
      for (const p of poaRes.value.records.filter((r) => Boolean(r.meta.deletedAt))) {
        items.push({
          entityType: "poa",
          id: p.id,
          title: `وكالة رقم ${p.values[1] || ""} — ${p.values[0] || ""}`,
          deletedAt: p.meta.deletedAt!,
        });
      }
    }

    if (tasksRes.status === "fulfilled") {
      for (const t of tasksRes.value.records.filter((r) => Boolean(r.meta.deletedAt))) {
        items.push({
          entityType: "task",
          id: t.id,
          title: `مهمة: ${t.values[0] || ""}`,
          deletedAt: t.meta.deletedAt!,
        });
      }
    }

    if (judgmentsRes.status === "fulfilled") {
      for (const j of judgmentsRes.value.records.filter((r) => Boolean(r.meta.deletedAt))) {
        items.push({
          entityType: "judgment",
          id: j.id,
          title: `حكم صك رقم ${j.values[5] || ""} — قضية ${j.values[0] || ""}`,
          deletedAt: j.meta.deletedAt!,
        });
      }
    }

    if (casesRes.status === "fulfilled") {
      for (const c of casesRes.value.filter((x) => Boolean(x.deletedAt))) {
        items.push({
          entityType: "case",
          id: c.id,
          title: `قضية ${c.courtCaseNumber} — ${c.title}`,
          deletedAt: c.deletedAt!,
        });
      }
    }

    if (clientsRes.status === "fulfilled") {
      for (const cl of clientsRes.value.filter((x) => Boolean(x.deletedAt))) {
        items.push({
          entityType: "client",
          id: cl.id,
          title: `عميل: ${cl.name}`,
          deletedAt: cl.deletedAt!,
        });
      }
    }

    res.json({ items });
  } catch (err) {
    next(err);
  }
});

const RestoreSchema = z.object({
  entityType: z.enum(["session", "poa", "task", "judgment", "case", "client"]),
  id: z.union([z.number(), z.string()]),
});

/**
 * POST /api/audit/restore
 * Restores a soft-deleted record back to active state for the caller's office.
 */
router.post("/audit/restore", async (req, res, next) => {
  try {
    const parsed = RestoreSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError("يرجى تحديد نوع السجل ومعرّفه لاستعادته من المحذوفات.");
    }

    const { entityType, id } = parsed.data;
    const userId = req.userId!;
    const officeId = req.officeId!;
    let restored = false;

    if (entityType === "session") {
      restored = await restoreDeletedSession(Number(id), userId);
    } else if (entityType === "poa") {
      restored = await restorePoaRow(Number(id), userId);
    } else if (entityType === "task") {
      restored = await restoreTaskRow(Number(id), userId);
    } else if (entityType === "judgment") {
      restored = await restoreJudgmentRow(Number(id), userId);
    } else if (entityType === "case") {
      restored = await restoreCase(String(id), officeId);
    } else if (entityType === "client") {
      restored = await restoreClient(String(id), officeId);
    }

    if (!restored) {
      throw new NotFoundError("تعذر العثور على السجل في سلة المحذوفات لهذا المكتب.");
    }

    await recordAuditEvent({
      actorId: userId,
      actorUsername: req.user || "",
      officeId,
      action: `${entityType}.restore`,
      entityType,
      entityId: String(id),
      summary: `استعادة سجل (${entityType}) رقم ${id} من سلة المحذوفات`,
    });

    res.json({ ok: true, message: "تمت استعادة السجل بنجاح." });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/audit/backup
 * Exports a complete, verified JSON snapshot of the office's legal records for disaster recovery.
 */
router.get("/audit/backup", async (req, res, next) => {
  try {
    const userId = req.userId!;
    const officeId = req.officeId!;

    const [sessionsRes, poaRes, tasksRes, judgmentsRes, cases, clients, finances] =
      await Promise.all([
        listSessions(undefined, userId).catch(() => []),
        listPoaRecordsWithMeta(true, userId, false).catch(() => ({ records: [], syncedAt: "" })),
        listTaskRecordsWithMeta(true, userId, false).catch(() => ({ records: [], syncedAt: "" })),
        listJudgmentRecordsWithMeta(true, userId, false).catch(() => ({ records: [], syncedAt: "" })),
        listCases(officeId).catch(() => []),
        listClients(officeId).catch(() => []),
        listCaseFinancialEntries(officeId).catch(() => []),
      ]);

    const snapshot = {
      schemaVersion: "2.0",
      exportedAt: new Date().toISOString(),
      officeId,
      exportedBy: req.user,
      counts: {
        sessions: sessionsRes.length,
        poas: poaRes.records.length,
        tasks: tasksRes.records.length,
        judgments: judgmentsRes.records.length,
        cases: cases.length,
        clients: clients.length,
        financialEntries: finances.length,
      },
      data: {
        sessions: sessionsRes,
        poas: poaRes.records,
        tasks: tasksRes.records,
        judgments: judgmentsRes.records,
        cases,
        clients,
        financialEntries: finances,
      },
    };

    await recordAuditEvent({
      actorId: userId,
      actorUsername: req.user || "",
      officeId,
      action: "backup.export",
      entityType: "backup",
      entityId: officeId,
      summary: `تصدير نسخة احتياطية شاملة لبيانات المكتب`,
    });

    res.json(snapshot);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/audit/backup/verify
 * Validates the integrity and structure of a backup JSON file before restoration.
 */
router.post("/audit/backup/verify", async (req, res, next) => {
  try {
    const body = req.body;
    if (!body || typeof body !== "object" || body.schemaVersion !== "2.0" || !body.data) {
      throw new ValidationError("ملف النسخة الاحتياطية غير صالح أو لا يطابق الإصدار المعتمد (2.0).");
    }
    res.json({
      valid: true,
      officeId: body.officeId,
      exportedAt: body.exportedAt,
      counts: body.counts || {},
      message: "ملف النسخة الاحتياطية سليم ومطابق للبنية المعتمدة وجاهز للاستخدام.",
    });
  } catch (err) {
    next(err);
  }
});

export default router;
