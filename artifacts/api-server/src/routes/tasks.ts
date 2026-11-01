import { Router, type IRouter } from "express";
import { z } from "@workspace/api-zod";
import moment from "moment-hijri";
import {
  attachAuthUser,
  requireAuth,
  requireActiveSubscription,
} from "../middlewares/auth.middleware";
import {
  listTaskRowsWithHeaders,
  appendTaskRow,
  updateTaskRow,
  deleteTaskRow,
} from "../services/task.sheets.service";
import { WhatsappReminderChannel } from "../services/reminder/channels/whatsappChannel";
import {
  normalizeNumericDigits,
  validateAndNormalizeCourtDate,
} from "../utils/dateNormalize";
import {
  getIdempotentResult,
  setIdempotentResult,
} from "../utils/sheetMeta";
import { recordAuditEvent } from "../services/audit.service";
import {
  NotFoundError,
  ValidationError,
  formatZodErrorArabic,
} from "../lib/errors";

const router: IRouter = Router();

router.use(attachAuthUser, requireAuth, requireActiveSubscription);

export interface TaskRecord {
  id: number;
  title: string;
  assignee: string;
  assigneeId?: string | null;
  priority: "عاجلة" | "عادية";
  dueDate: string;
  remainingDays: string;
  status: "قيد التنفيذ" | "مكتملة" | "مؤجلة" | "معلقة";
  notes: string;
  createdAt: string;
}

const VALID_PRIORITIES = ["عاجلة", "عادية"] as const;
const VALID_STATUSES = ["قيد التنفيذ", "مكتملة", "مؤجلة", "معلقة"] as const;

const TaskCreateSchema = z.object({
  title: z.string().trim().min(1, "عنوان المهمة مطلوب.").max(200, "عنوان المهمة طويل جداً (الحد الأقصى 200 حرف)."),
  assignee: z.string().trim().max(150).optional().default(""),
  assigneeId: z.string().trim().max(120).optional().nullable(),
  priority: z.enum(VALID_PRIORITIES, { errorMap: () => ({ message: "قيمة الأولوية غير صالحة." }) }).optional().default("عادية"),
  dueDate: z.string().trim().max(40).optional().default(""),
  status: z.enum(VALID_STATUSES, { errorMap: () => ({ message: "حالة المهمة غير صالحة." }) }).optional().default("قيد التنفيذ"),
  notes: z.string().trim().max(2000).optional().default(""),
});

const TaskUpdateSchema = TaskCreateSchema.partial();

const FIELD_KEYS: Record<string, keyof Omit<TaskRecord, "id" | "assigneeId">> = {
  "عنوان المهمة": "title",
  "المكلف": "assignee",
  "الأولوية": "priority",
  "تاريخ التسليم": "dueDate",
  "عدد الأيام المتبقية": "remainingDays",
  "الحالة": "status",
  "ملاحظات": "notes",
  "تاريخ الإنشاء": "createdAt",
};

function parseStableId(raw: string): number {
  const normalized = normalizeNumericDigits(String(raw || "")).trim();
  if (!/^\d+$/.test(normalized)) {
    throw new ValidationError("معرّف المهمة غير صالح.");
  }
  const id = Number(normalized);
  if (!Number.isSafeInteger(id) || id < 1) {
    throw new ValidationError("معرّف المهمة خارج النطاق المسموح.");
  }
  return id;
}

/** Calculates remaining days from either Gregorian (YYYY-MM-DD / DD/MM/YYYY) or Hijri date string. */
function calcRemainingDays(rawDueDate: string): string {
  const cleaned = normalizeNumericDigits(rawDueDate || "").trim();
  if (!cleaned) return "";

  // Check ISO YYYY-MM-DD first
  if (/^\d{4}-\d{2}-\d{2}$/.test(cleaned)) {
    const due = new Date(`${cleaned}T23:59:59`);
    if (!Number.isNaN(due.getTime())) {
      const days = Math.ceil((due.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
      if (days < 0) return `متأخر ${Math.abs(days)} يوم`;
      if (days === 0) return "اليوم";
      return `${days} يوم`;
    }
  }

  const parts = cleaned.split(/[\/\-]/);
  if (parts.length === 3) {
    let year: number, month: number, day: number;
    if (parts[0].length === 4) {
      year = Number(parts[0]);
      month = Number(parts[1]);
      day = Number(parts[2]);
    } else {
      day = Number(parts[0]);
      month = Number(parts[1]);
      year = Number(parts[2]);
    }
    if (year >= 1300 && year <= 1550) {
      const m = moment(`${year}/${month}/${day}`, "iYYYY/iM/iD");
      if (m.isValid()) {
        const days = m.diff(moment().startOf("day"), "days");
        if (days < 0) return `متأخر ${Math.abs(days)} يوم`;
        if (days === 0) return "اليوم";
        return `${days} يوم`;
      }
    } else if (year >= 1900 && year <= 2100) {
      const due = new Date(year, month - 1, day, 23, 59, 59);
      if (!Number.isNaN(due.getTime())) {
        const days = Math.ceil((due.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
        if (days < 0) return `متأخر ${Math.abs(days)} يوم`;
        if (days === 0) return "اليوم";
        return `${days} يوم`;
      }
    }
  }

  return "";
}

function rowToRecord(
  id: number,
  values: string[],
  headers: string[],
  assigneeId?: string | null,
): TaskRecord {
  const record: Partial<Omit<TaskRecord, "id">> = {};
  headers.forEach((header, colIdx) => {
    const fieldKey = FIELD_KEYS[header.trim()];
    if (fieldKey) {
      (record as Record<string, string>)[fieldKey] = (values[colIdx] ?? "").trim();
    }
  });

  const dueDate = record.dueDate || "";
  return {
    id,
    title: record.title || "",
    assignee: record.assignee || "",
    assigneeId: assigneeId || null,
    priority: VALID_PRIORITIES.includes(record.priority as any)
      ? (record.priority as TaskRecord["priority"])
      : "عادية",
    dueDate,
    remainingDays: dueDate ? calcRemainingDays(dueDate) : record.remainingDays || "",
    status: VALID_STATUSES.includes(record.status as any)
      ? (record.status as TaskRecord["status"])
      : "قيد التنفيذ",
    notes: record.notes || "",
    createdAt: record.createdAt || new Date().toISOString(),
  };
}

function recordToRow(record: Omit<TaskRecord, "id" | "assigneeId">): string[] {
  return [
    record.title || "",
    record.assignee || "",
    record.priority || "عادية",
    record.dueDate || "",
    calcRemainingDays(record.dueDate),
    record.status || "قيد التنفيذ",
    record.notes || "",
    record.createdAt || new Date().toISOString(),
  ];
}

/**
 * GET /api/tasks
 * Pure read-only fetch (never triggers header writes during GET).
 */
router.get("/tasks", async (req, res, next) => {
  try {
    const forceRefresh = req.query.refresh === "true";
    const { headers, rows, syncedAt } = await listTaskRowsWithHeaders(forceRefresh, req.userId);
    const records = rows.map(({ id, values, meta }) =>
      rowToRecord(id, values, headers, typeof meta.assigneeId === "string" ? meta.assigneeId : null),
    );
    res.setHeader("X-Synced-At", syncedAt);
    res.json(records);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/tasks
 * Creates a task record with strict validation and permanent stable ID.
 */
router.post("/tasks", async (req, res, next) => {
  try {
    const idempotencyKey = String(req.headers["x-idempotency-key"] || "").trim();
    if (idempotencyKey && req.officeId) {
      const cached = getIdempotentResult(`task:${req.officeId}:${idempotencyKey}`);
      if (cached) {
        res.status(201).json(cached);
        return;
      }
    }

    const parsed = TaskCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError(formatZodErrorArabic(parsed.error));
    }

    let normalizedDueDate = "";
    if (parsed.data.dueDate) {
      normalizedDueDate =
        validateAndNormalizeCourtDate(parsed.data.dueDate, {
          fieldName: "تاريخ تسليم المهمة",
          required: false,
        }) || "";
    }

    const recordPayload: Omit<TaskRecord, "id" | "assigneeId"> = {
      title: parsed.data.title,
      assignee: parsed.data.assignee || "",
      priority: parsed.data.priority,
      dueDate: normalizedDueDate,
      remainingDays: calcRemainingDays(normalizedDueDate),
      status: parsed.data.status,
      notes: parsed.data.notes || "",
      createdAt: new Date().toISOString(),
    };

    const stableId = await appendTaskRow(recordToRow(recordPayload), req.userId, {
      assigneeId: parsed.data.assigneeId || null,
    });

    const responseBody: TaskRecord = {
      id: stableId,
      assigneeId: parsed.data.assigneeId || null,
      ...recordPayload,
    };

    if (idempotencyKey && req.officeId) {
      setIdempotentResult(`task:${req.officeId}:${idempotencyKey}`, responseBody);
    }

    await recordAuditEvent({
      actorId: req.userId!,
      actorUsername: req.user || "",
      officeId: req.officeId!,
      action: "task.create",
      entityType: "task",
      entityId: String(stableId),
      summary: `إضافة مهمة قانونية (${recordPayload.title})`,
    });

    res.status(201).json(responseBody);
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /api/tasks/:id
 * Updates an existing Task record by its permanent stable ID.
 */
router.put("/tasks/:id", async (req, res, next) => {
  try {
    const id = parseStableId(req.params.id);
    const parsed = TaskUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError(formatZodErrorArabic(parsed.error));
    }

    const { headers, rows } = await listTaskRowsWithHeaders(false, req.userId);
    const existing = rows.find((r) => r.id === id);
    if (!existing) {
      throw new NotFoundError("المهمة غير موجودة.");
    }

    const existingRecord = rowToRecord(
      id,
      existing.values,
      headers,
      typeof existing.meta.assigneeId === "string" ? existing.meta.assigneeId : null,
    );

    const nextDueDate =
      parsed.data.dueDate !== undefined
        ? parsed.data.dueDate
          ? validateAndNormalizeCourtDate(parsed.data.dueDate, {
              fieldName: "تاريخ تسليم المهمة",
              required: false,
            }) || ""
          : ""
        : existingRecord.dueDate;

    const updatedPayload: Omit<TaskRecord, "id" | "assigneeId"> = {
      title: parsed.data.title ?? existingRecord.title,
      assignee: parsed.data.assignee ?? existingRecord.assignee,
      priority: parsed.data.priority ?? existingRecord.priority,
      dueDate: nextDueDate,
      remainingDays: calcRemainingDays(nextDueDate),
      status: parsed.data.status ?? existingRecord.status,
      notes: parsed.data.notes ?? existingRecord.notes,
      createdAt: existingRecord.createdAt,
    };

    const nextAssigneeId =
      parsed.data.assigneeId !== undefined ? parsed.data.assigneeId : existingRecord.assigneeId;

    await updateTaskRow(id, recordToRow(updatedPayload), req.userId, {
      assigneeId: nextAssigneeId || null,
    });

    await recordAuditEvent({
      actorId: req.userId!,
      actorUsername: req.user || "",
      officeId: req.officeId!,
      action: "task.update",
      entityType: "task",
      entityId: String(id),
      summary: `تحديث المهمة (${updatedPayload.title})`,
    });

    res.json({ id, assigneeId: nextAssigneeId || null, ...updatedPayload });
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/tasks/:id
 * Soft-deletes a Task record by its permanent stable ID.
 */
router.delete("/tasks/:id", async (req, res, next) => {
  try {
    const id = parseStableId(req.params.id);
    const deleted = await deleteTaskRow(id, req.userId);
    if (!deleted) {
      throw new NotFoundError("المهمة غير موجودة.");
    }

    await recordAuditEvent({
      actorId: req.userId!,
      actorUsername: req.user || "",
      officeId: req.officeId!,
      action: "task.delete",
      entityType: "task",
      entityId: String(id),
      summary: `نقل المهمة #${id} إلى سلة المحذوفات`,
    });

    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/tasks/:id/send-whatsapp
 * Dispatches an instant WhatsApp reminder to the office's configured WhatsApp phone.
 */
router.post("/tasks/:id/send-whatsapp", async (req, res, next) => {
  try {
    const id = parseStableId(req.params.id);
    const { headers, rows } = await listTaskRowsWithHeaders(false, req.userId);
    const existing = rows.find((r) => r.id === id);
    if (!existing) {
      throw new NotFoundError("المهمة غير موجودة.");
    }
    const task = rowToRecord(id, existing.values, headers);

    const remainingText = calcRemainingDays(task.dueDate);
    const lines: string[] = [
      `🔔 *تذكير بموعد مهمة قانونية* (${remainingText || "تذكير فوري"})`,
      "",
      `📌 *عنوان المهمة:* ${task.title}`,
    ];

    if (task.assignee) lines.push(`👤 *المكلف:* ${task.assignee}`);
    if (task.status) lines.push(`📋 *الحالة:* ${task.status}`);
    if (task.priority) lines.push(`🚩 *الأولوية:* ${task.priority}`);
    if (task.dueDate) lines.push(`📅 *تاريخ التسليم:* ${task.dueDate}`);
    if (task.notes) lines.push(`📝 *ملاحظات:* ${task.notes}`);

    lines.push("", "الرجاء الإنجاز والمتابعة في الموعد المحدد.");

    const channel = new WhatsappReminderChannel();
    await channel.sendRaw(lines.join("\n"), req.userRecord?.whatsapp_number || null);

    res.json({ message: "تم إرسال تذكير المهمة عبر الواتساب بنجاح!" });
  } catch (err: any) {
    if (err instanceof ValidationError || err instanceof NotFoundError) {
      next(err);
      return;
    }
    res.status(400).json({
      error: err?.message || "فشل إرسال تذكير الواتساب للمهمة.",
      code: "WHATSAPP_SEND_FAILED",
    });
  }
});

export default router;
