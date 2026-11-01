import { Router, type IRouter } from "express";
import {
  getSettings,
  saveSettingsDurable,
  type AppSettings,
} from "../config/settings-store";
import { attachAuthUser, requireAdmin } from "../middlewares/auth.middleware";
import { logger } from "../lib/logger";
import { WhatsappReminderChannel } from "../services/reminder/channels/whatsappChannel";
import { testGoogleSheetsConnection } from "../services/googleSheets.service";
import { getSupabaseClient } from "../services/supabase.service";
import { env, isSupabaseConfigured } from "../config/env";
import { recordAuditEvent } from "../services/audit.service";

const router: IRouter = Router();

// Strictly Platform Super-Admin ONLY (Audit Finding #31)
router.use(attachAuthUser, requireAdmin);

type SettingsPatch = Partial<
  Pick<
    AppSettings,
    | "aiApiKey"
    | "aiModel"
    | "aiBaseUrl"
    | "googleSpreadsheetId"
    | "googleSheetName"
    | "hfApiToken"
    | "hfModel"
    | "whatsappNumber"
    | "whatsappApiUrl"
    | "whatsappToken"
    | "whatsappInstanceId"
    | "supabaseUrl"
    | "supabaseKey"
    | "supabaseTableName"
  >
>;

function parseBody(body: unknown): { ok: true; data: SettingsPatch } | { ok: false } {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false };
  const b = body as Record<string, unknown>;
  const allowed = [
    "aiApiKey",
    "aiModel",
    "aiBaseUrl",
    "googleSpreadsheetId",
    "googleSheetName",
    "hfApiToken",
    "hfModel",
    "whatsappNumber",
    "whatsappApiUrl",
    "whatsappToken",
    "whatsappInstanceId",
    "supabaseUrl",
    "supabaseKey",
    "supabaseTableName",
  ] as const;
  const data: SettingsPatch = {};
  for (const key of allowed) {
    const val = b[key];
    if (val !== undefined) {
      if (typeof val !== "string") return { ok: false };
      (data as Record<string, string>)[key] = val;
    }
  }
  return { ok: true, data };
}

function maskToken(token: string): string {
  if (token.length <= 6) return "***";
  return token.slice(0, 6) + "***";
}

function buildSettingsResponse(s: AppSettings) {
  return {
    aiApiKey: s.aiApiKey ? maskToken(s.aiApiKey) : "",
    aiApiKeyIsSet: Boolean(s.aiApiKey),
    aiModel: s.aiModel ?? "",
    aiBaseUrl: s.aiBaseUrl ?? "",
    googleSpreadsheetId: s.googleSpreadsheetId ?? "",
    googleSheetName: s.googleSheetName ?? "",
    hfApiToken: s.hfApiToken ? maskToken(s.hfApiToken) : "",
    hfApiTokenIsSet: Boolean(s.hfApiToken),
    hfModel: s.hfModel ?? "",
    whatsappNumber: s.whatsappNumber ?? "",
    whatsappApiUrl: s.whatsappApiUrl ?? "",
    whatsappToken: s.whatsappToken ? maskToken(s.whatsappToken) : "",
    whatsappTokenIsSet: Boolean(s.whatsappToken),
    whatsappInstanceId: s.whatsappInstanceId ?? "",
    supabaseUrl: s.supabaseUrl ?? "",
    supabaseKey: s.supabaseKey ? maskToken(s.supabaseKey) : "",
    supabaseKeyIsSet: Boolean(s.supabaseKey),
    supabaseTableName: s.supabaseTableName ?? "app_users",
    cronSecretIsSet: Boolean(env.cronSecret && env.cronSecret.length >= 12),
  };
}

router.get("/settings", (_req, res) => {
  const s = getSettings();
  res.json(buildSettingsResponse(s));
});

router.put("/settings", async (req, res, next) => {
  const parsed = parseBody(req.body);
  if (!parsed.ok) {
    res.status(400).json({ error: "بيانات الإعدادات غير صالحة.", code: "VALIDATION_ERROR" });
    return;
  }

  try {
    const updated = await saveSettingsDurable(parsed.data);
    await recordAuditEvent({
      actorId: req.userId!,
      actorUsername: req.user || "",
      officeId: req.officeId || "platform-admin",
      action: "settings.update",
      entityType: "settings",
      entityId: "global",
      summary: "تحديث وتثبيت إعدادات المنصة المركزية",
    });
    res.json(buildSettingsResponse(updated));
  } catch (err) {
    next(err);
  }
});

router.get("/settings/connection-status", async (_req, res) => {
  try {
    const s = getSettings();
    const hasSheets = Boolean(s.googleSpreadsheetId || env.googleSpreadsheetId);
    const hasServiceAccount = Boolean(env.googleServiceAccountJson);
    const hasSupabase = isSupabaseConfigured();
    const hasAi = Boolean(s.aiApiKey || process.env.AI_API_KEY || s.hfApiToken);
    const hasWhatsapp = Boolean(s.whatsappNumber && s.whatsappApiUrl);
    const hasCronSecret = Boolean(env.cronSecret && env.cronSecret.length >= 12);

    res.json({
      googleSheets: {
        isConfigured: hasSheets && hasServiceAccount,
        hasSpreadsheetId: Boolean(s.googleSpreadsheetId || env.googleSpreadsheetId),
        hasServiceAccount,
        spreadsheetId: s.googleSpreadsheetId || env.googleSpreadsheetId || null,
        storageMode: hasSheets && hasServiceAccount ? "google_sheets" : "local_storage",
      },
      supabase: {
        isConfigured: hasSupabase,
        url: s.supabaseUrl || env.supabaseUrl || null,
        storageMode: hasSupabase ? "supabase_cloud" : "durable_local_json",
      },
      ai: {
        isConfigured: hasAi,
        model: s.aiModel || "qwen/qwen-2.5-7b-instruct",
        provider: s.aiApiKey
          ? "OpenRouter/OpenAI"
          : s.hfApiToken
            ? "HuggingFace"
            : "RulesFallback",
      },
      whatsapp: {
        isConfigured: hasWhatsapp,
        number: s.whatsappNumber || null,
        hasGatewayUrl: Boolean(s.whatsappApiUrl),
      },
      cron: {
        isProtected: hasCronSecret,
        schedule: "*/15 * * * *",
      },
    });
  } catch {
    res.status(500).json({ error: "فشل استعلام حالة الاتصال." });
  }
});

router.post("/settings/test-google-sheets", async (req, res) => {
  try {
    const result = await testGoogleSheetsConnection(req.userId);

    const stages = [
      {
        stage: "1. بيانات ومفاتيح الاعتماد (Service Account JSON)",
        status: (result.stage === "credentials" ? "failed" : "success") as "failed" | "success",
        message:
          result.stage === "credentials"
            ? result.message
            : "بيانات الاعتماد صالحة ومكتملة (Client Email & Private Key).",
        solution: result.stage === "credentials" ? result.recommendation : undefined,
      },
      {
        stage: "2. إصدار رمز المصادقة (Google OAuth2 JWT Token)",
        status: (result.stage === "credentials" ? "failed" : "success") as "failed" | "success",
        message:
          result.stage === "credentials"
            ? "بانتظار ضبط مفاتيح الاعتماد."
            : "تم إصدار رمز الدخول بنجاح وتوثيقه مع خوادم Google.",
      },
      {
        stage: "3. العثور على ملف الجدول (Spreadsheet ID)",
        status: (
          result.stage === "connection"
            ? "failed"
            : result.stage === "credentials"
              ? "warning"
              : "success"
        ) as "failed" | "warning" | "success",
        message:
          result.stage === "connection"
            ? result.message
            : result.spreadsheetId
              ? `تم الوصول للملف (${result.spreadsheetId}).`
              : "يرجى تحديد معرّف الجدول في الإعدادات.",
        solution: result.stage === "connection" ? result.recommendation : undefined,
      },
      {
        stage: "4. صلاحيات المحرر (Editor Permissions)",
        status: (
          result.stage === "permissions"
            ? "failed"
            : result.stage === "ready"
              ? "success"
              : "warning"
        ) as "failed" | "warning" | "success",
        message:
          result.stage === "permissions"
            ? result.message
            : result.stage === "ready"
              ? "صلاحيات القراءة والكتابة (Editor) متوفرة بالكامل."
              : "يتطلب مشاركة الملف مع إيميل الخدمة البرمجي.",
        solution: result.stage === "permissions" ? result.recommendation : undefined,
      },
      {
        stage: "5. أوراق العمل المطلوبة (Sessions, Attorney, Judgment, Tasks)",
        status: (result.stage === "ready" ? "success" : "warning") as "warning" | "success",
        message:
          result.sheetsFound && result.sheetsFound.length > 0
            ? `الأوراق المتوفرة: ${result.sheetsFound.join(", ")}`
            : "جاهزة للتزامن التلقائي.",
      },
    ];

    res.json({
      success: result.success,
      spreadsheetId: result.spreadsheetId || "",
      sheetName: "Sessions",
      stages,
      serviceAccountEmail: result.clientEmail || null,
      summary: result.message,
    });
  } catch (err: any) {
    logger.error({ reason: err?.message }, "Google Sheets diagnostic failed");
    res.status(500).json({
      success: false,
      spreadsheetId: "",
      sheetName: "Sessions",
      stages: [
        {
          stage: "فحص الاتصال",
          status: "failed",
          message: err?.message || "فشل فحص اتصال Google Sheets.",
          solution: "يرجى مراجعة إعدادات الشبكة ومفتاح الاعتماد.",
        },
      ],
      serviceAccountEmail: null,
      summary: err?.message || "فشل تشخيص اتصال Google Sheets.",
    });
  }
});

router.post("/settings/test-supabase", async (_req, res) => {
  if (!isSupabaseConfigured()) {
    res.json({
      success: false,
      isConfigured: false,
      message:
        "بيانات Supabase (URL / Key) غير مكتملة في الإعدادات. النظام يعمل حالياً بمخزن محلي دائم ومعزول.",
      recommendation: "أدخل Project URL و Service Role Key من لوحة تحكم Supabase.",
    });
    return;
  }

  try {
    const client = getSupabaseClient();
    if (!client) {
      res.json({
        success: false,
        message: "تعذر تهيئة عميل Supabase بمفاتيح الاعتماد الحالية.",
      });
      return;
    }

    const tableName = env.supabaseTableName || "app_users";
    const { count, error } = await client
      .from(tableName)
      .select("*", { count: "exact", head: true });

    if (error) {
      res.json({
        success: false,
        message: `تم الاتصال بمشروع Supabase ولكن تعذر الوصول للجدول (${tableName}): ${error.message}`,
        recommendation:
          "تأكد من تنفيذ سكربت إنشاء الجدول في Supabase SQL Editor وتفعيل صلاحيات المفتاح.",
      });
      return;
    }

    res.json({
      success: true,
      message: `تم الاتصال بقاعدة بيانات Supabase بنجاح! تم التحقق من جدول ${tableName} (عدد السجلات: ${count ?? 0}).`,
      count,
    });
  } catch (err: any) {
    res.status(500).json({
      success: false,
      message: `فشل الاتصال بـ Supabase: ${err?.message || "خطأ غير متوقع"}`,
    });
  }
});

router.post("/settings/test-whatsapp", async (_req, res) => {
  const s = getSettings();
  if (!s.whatsappNumber?.trim()) {
    res.status(400).json({ error: "يرجى كتابة رقم الواتساب وتحديد بوابة الإرسال أولاً." });
    return;
  }

  try {
    const channel = new WhatsappReminderChannel();
    await channel.send({
      sessionId: 999,
      officeId: "platform-admin",
      recipientPhone: s.whatsappNumber.trim(),
      caseNumber: "1448/اختباري/01",
      court: "المحكمة العامة بالرياض",
      courtCircuit: "دائرة الدعاوى الحقوقية الأولى",
      sessionDateHijri: "15/02/1448",
      sessionTime: "10:30 صباحا",
      plaintiff: "اختبار النظام",
      defendant: "بوابة التنبيهات",
      caseSubject: "تجربة إرسال تنبيهات الواتساب للجلسات",
      kind: "24h",
    });

    res.json({ message: "تمت تجربة إرسال تنبيه الواتساب وتأكيد استلام البوابة بنجاح!" });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "فشل إجراء تجربة التنبيه عبر الواتساب.";
    res.status(400).json({ error: msg });
  }
});

export default router;
