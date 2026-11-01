import { HfInference } from "@huggingface/inference";
import { getSettings } from "../config/settings-store";
import { logger } from "../lib/logger";
import {
  SESSION_EXTRACTION_SYSTEM_PROMPT,
  buildExtractionUserPrompt,
} from "../prompts/extraction.prompt";
import { normalizeNumericDigits } from "../utils/dateNormalize";
import {
  ForbiddenError,
  ValidationError,
  generateReferenceCode,
} from "../lib/errors";
import {
  reserveUserAiQuota,
  releaseUserAiQuota,
} from "./supabase.service";
import type { SessionExtraction } from "@workspace/api-client-react";

export class AiExtractionError extends Error {
  constructor(
    message: string,
    public readonly referenceCode: string = generateReferenceCode("AI"),
    public readonly statusCode: number = 503,
  ) {
    super(message);
    this.name = "AiExtractionError";
  }
}

export class AiQuotaExceededError extends ForbiddenError {
  constructor(message: string) {
    super(message, "AI_QUOTA_EXCEEDED");
    this.name = "AiQuotaExceededError";
  }
}

export class InsufficientSessionDataError extends ValidationError {
  constructor(
    message = "لا توجد بيانات جلسة كافية في النص المدخل. يرجى التأكد من إدخال نص إشعار جلسة قضائية يتضمن رقم القضية أو المحكمة أو التاريخ.",
  ) {
    super(message);
    this.name = "InsufficientSessionDataError";
  }
}

/** Checks whether a message is explicitly non-judicial or conversational */
export function isNonJudicialOrNegated(message: string): boolean {
  const trimmed = normalizeNumericDigits(message || "").trim();
  if (!trimmed) return true;
  if (
    /(?:ليست|ليس|غير|لا\s+تحتوي|ولا\s+تحتوي|لا\s+يوجد|بدون)\s+(?:رسالة\s+محكمة|قضية|جلسة|موعد)/i.test(
      trimmed,
    )
  ) {
    return true;
  }
  const judicialKeywords =
    /(?:دعوى|قضية|جلسة|محكمة|صك|دائرة|مدعي|مدعى\s+عليه|حضور|موعد|استئناف|بداية|صلح|تنفيذ|مرافعة|نطق|حكم|موكل|خصم|رقم)/i;
  if (!judicialKeywords.test(trimmed)) {
    return true;
  }
  return false;
}

/** Checks whether extracted data has minimum required fields to constitute a court session */
export function hasSufficientSessionData(data?: SessionExtraction | null): boolean {
  if (!data) return false;
  const hasCase = Boolean(data.case_number && data.case_number.trim().length > 0);
  const hasCourt = Boolean(data.court && data.court.trim().length > 0);
  const hasDate = Boolean(data.session_date_hijri && data.session_date_hijri.trim().length > 0);
  const hasParties = Boolean(
    (data.plaintiff && data.plaintiff.trim().length > 0) ||
      (data.defendant && data.defendant.trim().length > 0),
  );
  const hasTime = Boolean(data.session_time && data.session_time.trim().length > 0);

  return hasCase || (hasCourt && hasDate) || (hasCourt && hasParties) || (hasDate && hasTime);
}

function emptyExtraction(): SessionExtraction {
  return {
    case_number: null,
    plaintiff: null,
    defendant: null,
    court: null,
    court_circuit: null,
    case_subject: null,
    session_type: null,
    session_date_hijri: null,
    session_time: null,
    notes: null,
  };
}

/**
 * Smart rule-based Arabic court SMS extractor fallback.
 * Normalizes Eastern Arabic / Persian numerals first so dates & case numbers parse reliably.
 */
export function extractWithRules(rawMessage: string): SessionExtraction {
  const result: SessionExtraction = emptyExtraction();
  const message = normalizeNumericDigits(rawMessage || "");

  if (isNonJudicialOrNegated(message)) {
    return result;
  }

  const caseMatch = message.match(/(?:دعوى|قضية|طلب|ملف)?\s*(?:رقم|الرقم)[:\s]+([0-9\/\-]+)/);
  if (caseMatch) result.case_number = caseMatch[1].trim();

  const courtMatch = message.match(
    /(?:لدى\s+|في\s+)?((?:المحكمة|محكمة)\s+[^\n،,.]+?(?=\s+الدائرة|\s+بين|\s+ضد|\s+بتاريخ|\s+يوم|[،,.\n]|$))/,
  );
  if (courtMatch) {
    const candidate = courtMatch[1].trim();
    if (
      !/(?:ليست|ليس|لا\s+تحتوي|ولا\s+تحتوي|غير|بدون|مرحباً|كيف\s+حالك|اختبار)/i.test(
        candidate,
      )
    ) {
      result.court = candidate;
    }
  }

  const circuitMatch = message.match(
    /(?:الدائرة|دائرة)\s+([^\n،,.]+?(?=\s+بين|\s+ضد|\s+بتاريخ|\s+يوم|[،,.\n]|$))/,
  );
  if (circuitMatch) result.court_circuit = `الدائرة ${circuitMatch[1].trim()}`;

  const plaintiffMatch = message.match(
    /(?:المدعي|المحيل|المستدعي)[:\s]+([^\n،,.]+?)(?=\s+و?(?:المدعى|المحال|المستدعى\s+ضده)|\s+ضد|\s+بتاريخ|\s+يوم|[،,.\n]|$)/,
  );
  if (plaintiffMatch) result.plaintiff = plaintiffMatch[1].trim();

  const defendantMatch = message.match(
    /(?:المدعى\s+عليه|المحال\s+إليه|المستدعى\s+ضده)[:\s]+([^\n،,.]+?)(?=\s+هو|\s+بتاريخ|\s+يوم|\s+الساعة|[،,.\n]|$)/,
  );
  if (defendantMatch) result.defendant = defendantMatch[1].trim();

  const dateMatch = message.match(
    /(?:بتاريخ|يوم)\s+[^\d]*(\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2}|\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4})/,
  );
  if (dateMatch) {
    result.session_date_hijri = dateMatch[1].trim().replace(/-/g, "/");
  } else {
    const anyDateMatch = message.match(
      /(\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2}|\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4})/,
    );
    if (anyDateMatch) {
      result.session_date_hijri = anyDateMatch[1].trim().replace(/-/g, "/");
    }
  }

  const timeMatch = message.match(
    /(?:الساعة|في\s+تمام\s+الساعة)?[:\s]*([0-9]{1,2}:[0-9]{2}(?:\s*(?:صباحاً|صباحا|مساءً|مساء|ص|م))?)/,
  );
  if (timeMatch && timeMatch[1].includes(":")) {
    result.session_time = timeMatch[1].trim();
  }

  const typeMatch = message.match(
    /(مرافعة|جلسة\s+استماع|نطق\s+بالحكم|تحقيق|شهادة|قرار|جلسة\s+أولى)/,
  );
  if (typeMatch) result.session_type = typeMatch[1].trim();

  const subjectMatch = message.match(/(?:موضوع\s+الدعوى|الموضوع)[:\s]+([^\n،,.]+)/);
  if (subjectMatch) result.case_subject = subjectMatch[1].trim();

  result.notes = "تم الاستخراج والتحليل بدقة من نص الرسالة القضائية.";
  return result;
}

/**
 * Sends a raw court SMS message to the configured AI API (with resilient rule-based fallback).
 * Uses atomic per-user quota reservation (`reserveUserAiQuota`) and rolls back via
 * `releaseUserAiQuota` if validation or analysis fails so failed requests NEVER deduct quota!
 */
export async function analyzeCourtMessage(
  message: string,
  userId?: string,
): Promise<
  SessionExtraction & {
    ai_usage_count?: number;
    ai_quota_limit?: number;
    plan_tier?: string;
    ai_renewal_date?: string | null;
    source?: "ai" | "rules";
    referenceCode?: string;
  }
> {
  const normalizedMsg = normalizeNumericDigits(message || "").trim();
  if (!normalizedMsg) {
    throw new InsufficientSessionDataError("يرجى إدخال نص رسالة قضائية صالحة للتحليل.");
  }

  // Validate input semantics BEFORE reserving quota so invalid user text costs 0 quota
  if (isNonJudicialOrNegated(normalizedMsg)) {
    throw new InsufficientSessionDataError(
      "النص المدخل لا يبدو إشعار جلسة قضائية. يرجى لصق نص رسالة المحكمة متضمناً رقم القضية أو اسم المحكمة أو موعد الجلسة.",
    );
  }

  // ── 1. Atomically reserve 1 unit of monthly AI quota (with auto monthly renewal) ──
  let quotaReserved = false;
  let currentUsage = 0;
  let quotaLimit = 50;
  let userPlanTier = "plus";
  let renewalDate: string | null = null;

  if (userId) {
    const reservation = await reserveUserAiQuota(userId);
    if (!reservation.reserved) {
      throw new AiQuotaExceededError(
        `تم استهلاك الحد الشهري لتحليلات الذكاء الاصطناعي (${reservation.ai_usage_count}/${reservation.ai_quota_limit}).` +
          (reservation.ai_renewal_date ? ` يتجدد الرصيد في: ${reservation.ai_renewal_date.slice(0, 10)}.` : ""),
      );
    }
    quotaReserved = true;
    currentUsage = reservation.ai_usage_count;
    quotaLimit = reservation.ai_quota_limit;
    userPlanTier = reservation.plan_tier;
    renewalDate = reservation.ai_renewal_date;
  }

  try {
    // ── 2. Initialize safe baseline extraction (never undefined!) ───────────
    let result: SessionExtraction = extractWithRules(normalizedMsg);
    let extractionSource: "ai" | "rules" = "rules";

    // ── 3. Call External AI Provider if configured ──────────────────────────
    const settings = getSettings();
    const openAiKey = (settings.aiApiKey || process.env.AI_API_KEY || "").trim();
    const hfToken = (settings.hfApiToken || process.env.HF_API_TOKEN || "").trim();

    let rawAiContent: string | undefined;

    if (openAiKey) {
      try {
        const baseUrl = (
          settings.aiBaseUrl ||
          process.env.AI_BASE_URL ||
          "https://openrouter.ai/api/v1"
        ).replace(/\/+$/, "");
        const model = settings.aiModel || process.env.AI_MODEL || "qwen/qwen-2.5-7b-instruct";

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 18_000);

        const res = await fetch(`${baseUrl}/chat/completions`, {
          method: "POST",
          signal: controller.signal,
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${openAiKey}`,
          },
          body: JSON.stringify({
            model,
            messages: [
              { role: "system", content: SESSION_EXTRACTION_SYSTEM_PROMPT },
              { role: "user", content: buildExtractionUserPrompt(normalizedMsg) },
            ],
            temperature: 0.1,
            max_tokens: 512,
          }),
        });

        clearTimeout(timeoutId);

        if (res.ok) {
          const json: any = await res.json().catch(() => null);
          const content = json?.choices?.[0]?.message?.content;
          if (typeof content === "string" && content.trim().length > 0) {
            rawAiContent = content;
          }
        } else {
          logger.warn({ status: res.status }, "External AI provider returned non-200; using rule fallback");
        }
      } catch (err: any) {
        logger.warn({ reason: err?.name || "fetch_error" }, "External AI call failed; using rule fallback");
      }
    }

    if (!rawAiContent && hfToken) {
      try {
        const hfModel = settings.hfModel || "meta-llama/Llama-3.1-8B-Instruct";
        const hf = new HfInference(hfToken);
        const response = await hf.chatCompletion({
          model: hfModel,
          messages: [
            { role: "system", content: SESSION_EXTRACTION_SYSTEM_PROMPT },
            { role: "user", content: buildExtractionUserPrompt(normalizedMsg) },
          ],
          parameters: { temperature: 0.1, max_new_tokens: 512 },
        });
        const content = response?.choices?.[0]?.message?.content;
        if (typeof content === "string" && content.trim().length > 0) {
          rawAiContent = content;
        }
      } catch {
        logger.warn("Hugging Face AI extraction failed; using rule fallback");
      }
    }

    // ── 4. Safely parse AI JSON response without crashing on null/garbage ───
    if (rawAiContent) {
      let jsonStr: string | null = null;
      const mdMatch = rawAiContent.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (mdMatch && mdMatch[1]) {
        jsonStr = mdMatch[1].trim();
      } else {
        const braceStart = rawAiContent.indexOf("{");
        const braceEnd = rawAiContent.lastIndexOf("}");
        if (braceStart !== -1 && braceEnd > braceStart) {
          jsonStr = rawAiContent.substring(braceStart, braceEnd + 1).trim();
        }
      }

      if (jsonStr) {
        try {
          const parsed = JSON.parse(jsonStr) as Record<string, unknown> | null;
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            const pickStr = (val: unknown, fallback: string | null): string | null =>
              typeof val === "string" && val.trim().length > 0
                ? normalizeNumericDigits(val.trim())
                : fallback;

            result = {
              case_number: pickStr(parsed.case_number, result.case_number),
              plaintiff: pickStr(parsed.plaintiff, result.plaintiff),
              defendant: pickStr(parsed.defendant, result.defendant),
              court: pickStr(parsed.court, result.court),
              court_circuit: pickStr(parsed.court_circuit, result.court_circuit),
              case_subject: pickStr(parsed.case_subject, result.case_subject),
              session_type: pickStr(parsed.session_type, result.session_type),
              session_date_hijri: pickStr(parsed.session_date_hijri, result.session_date_hijri),
              session_time: pickStr(parsed.session_time, result.session_time),
              notes: pickStr(parsed.notes, result.notes),
            };
            extractionSource = "ai";
          }
        } catch {
          logger.info("AI returned non-JSON text; keeping safe rule-based extraction");
        }
      }
    }

    // ── 5. Verify sufficient extracted fields ────────────────────────────────
    if (!result || !hasSufficientSessionData(result)) {
      throw new InsufficientSessionDataError(
        "لم يتم العثور على بيانات كافية في نص الرسالة. يرجى التأكد من تضمين رقم القضية أو اسم المحكمة أو تاريخ ووقت الجلسة.",
      );
    }

    return {
      ...result,
      ai_usage_count: currentUsage,
      ai_quota_limit: quotaLimit,
      plan_tier: userPlanTier,
      ai_renewal_date: renewalDate,
      source: extractionSource,
    };
  } catch (err) {
    // Roll back quota reservation on ANY failure so failed calls never consume user quota
    if (quotaReserved && userId) {
      await releaseUserAiQuota(userId);
    }
    throw err;
  }
}
