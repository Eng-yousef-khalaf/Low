/**
 * Centralized, lazy access to environment variables & runtime settings.
 * Zero hardcoded fallback passwords or predictable static production secrets.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { getSettings } from "./settings-store";
import { logger } from "../lib/logger";

export class MissingEnvVarError extends Error {
  constructor(public readonly key: string, hint?: string) {
    super(
      `Missing required environment variable "${key}".${hint ? ` ${hint}` : ""}`,
    );
    this.name = "MissingEnvVarError";
  }
}

function readEnv(key: string): string | undefined {
  const value = process.env[key];
  return value && value.trim().length > 0 ? value.trim() : undefined;
}

// Ephemeral per-process random secret ONLY for local dev/test when SESSION_SECRET is unset
const DEV_EPHEMERAL_SECRET = crypto.randomBytes(48).toString("hex");
let warnedDevSessionSecret = false;

export const env = {
  /**
   * Optional bootstrap admin credentials ONLY read from explicit env vars (never hardcoded defaults!).
   */
  get bootstrapAdminUsername(): string | undefined {
    return readEnv("ADMIN_USERNAME");
  },
  get bootstrapAdminPassword(): string | undefined {
    return readEnv("ADMIN_PASSWORD");
  },

  /**
   * Cryptographic HMAC secret for session cookies.
   * Never falls back to a public static string.
   */
  get sessionSecret(): string {
    const explicit = readEnv("SESSION_SECRET");
    if (explicit && explicit.length >= 32) {
      return explicit;
    }
    if (explicit && explicit.length > 0 && process.env.NODE_ENV !== "production") {
      return crypto.createHash("sha256").update(explicit).digest("hex");
    }
    if (process.env.NODE_ENV === "production") {
      // In production, if SESSION_SECRET is missing or too short, derive deterministically ONLY if a strong private service key exists; otherwise throw!
      const serviceKey = readEnv("SUPABASE_SERVICE_ROLE_KEY");
      if (serviceKey && serviceKey.length >= 32) {
        return crypto
          .createHmac("sha256", serviceKey)
          .update("court-session-signing-key-v2")
          .digest("hex");
      }
      throw new MissingEnvVarError(
        "SESSION_SECRET",
        "يجب تعيين متغير البيئة SESSION_SECRET بقيمة سرية عشوائية لا تقل عن 32 حرفاً في بيئة الإنتاج.",
      );
    }
    if (!warnedDevSessionSecret) {
      warnedDevSessionSecret = true;
      logger.warn(
        "SESSION_SECRET is not set; using an ephemeral random secret for this development process.",
      );
    }
    return DEV_EPHEMERAL_SECRET;
  },

  // --- Platform-level Google Sheets (used ONLY when explicitly authorized for platform admin diagnostics) ---
  get googleSpreadsheetId(): string {
    const stored = getSettings().googleSpreadsheetId;
    if (stored && stored.trim()) return stored.trim();
    return readEnv("GOOGLE_SPREADSHEET_ID") ?? "";
  },

  get googleServiceAccountJson(): Record<string, unknown> | null {
    try {
      const candidates = [
        path.resolve(process.cwd(), "service-account.json"),
        path.resolve(process.cwd(), "..", "..", "service-account.json"),
        path.resolve(process.cwd(), "artifacts", "api-server", "service-account.json"),
      ];
      for (const p of candidates) {
        if (fs.existsSync(p)) {
          return JSON.parse(fs.readFileSync(p, "utf-8")) as Record<string, unknown>;
        }
      }
    } catch {
      // Fall through to env var
    }

    const raw = readEnv("GOOGLE_SERVICE_ACCOUNT_JSON");
    if (raw) {
      try {
        return JSON.parse(raw) as Record<string, unknown>;
      } catch {
        return null;
      }
    }
    return null;
  },

  get googleSheetName(): string {
    const stored = getSettings().googleSheetName;
    if (stored && stored.trim()) return stored.trim();
    return readEnv("GOOGLE_SHEET_NAME") ?? "Sessions";
  },

  // --- AI Settings ---
  get aiApiKey(): string {
    const stored = getSettings().aiApiKey;
    if (stored && stored.trim()) return stored.trim();
    return readEnv("AI_API_KEY") ?? readEnv("OPENAI_API_KEY") ?? "";
  },
  get aiBaseUrl(): string {
    const stored = getSettings().aiBaseUrl;
    if (stored && stored.trim()) return stored.trim();
    return readEnv("AI_BASE_URL") ?? "https://openrouter.ai/api/v1";
  },
  get aiModel(): string {
    const stored = getSettings().aiModel;
    if (stored && stored.trim()) return stored.trim();
    return readEnv("AI_MODEL") ?? "qwen/qwen-2.5-7b-instruct";
  },

  // --- Supabase Settings ---
  get supabaseUrl(): string | undefined {
    const stored = getSettings().supabaseUrl;
    if (stored && stored.trim()) return stored.trim();
    return readEnv("SUPABASE_URL");
  },
  get supabaseKey(): string | undefined {
    const stored = getSettings().supabaseKey;
    if (stored && stored.trim()) return stored.trim();
    return readEnv("SUPABASE_SERVICE_ROLE_KEY") ?? readEnv("SUPABASE_KEY");
  },
  get supabaseServiceKey(): string {
    return this.supabaseKey ?? "";
  },
  get supabaseTableName(): string {
    const stored = getSettings().supabaseTableName;
    if (stored && stored.trim()) return stored.trim();
    return readEnv("SUPABASE_TABLE_NAME") ?? "app_users";
  },

  // --- Scheduler ---
  get reminderCronExpression(): string {
    return readEnv("REMINDER_CRON_EXPRESSION") ?? "*/15 * * * *";
  },
  get cronSecret(): string | undefined {
    return readEnv("CRON_SECRET");
  },
  get courtTimezoneOffsetHours(): number {
    const raw = readEnv("COURT_TIMEZONE_OFFSET_HOURS");
    const parsed = raw ? Number(raw) : 3;
    return Number.isFinite(parsed) ? parsed : 3;
  },

  get isProduction(): boolean {
    return process.env.NODE_ENV === "production";
  },
  get isProd(): boolean {
    return process.env.NODE_ENV === "production";
  },
  get isTest(): boolean {
    return process.env.NODE_ENV === "test" || Boolean(process.env.VITEST);
  },
};

export function isGoogleSheetsConfigured(): boolean {
  const stored = getSettings().googleSpreadsheetId;
  const hasSpreadsheetId = Boolean(
    (stored && stored.trim()) || readEnv("GOOGLE_SPREADSHEET_ID"),
  );
  return Boolean(hasSpreadsheetId && env.googleServiceAccountJson);
}

export function isAuthConfigured(): boolean {
  return Boolean(isSupabaseConfigured() || !env.isProduction);
}

export function isAiConfigured(): boolean {
  return Boolean(env.aiApiKey && env.aiApiKey.trim().length > 0);
}

export function isSupabaseConfigured(): boolean {
  const settings = getSettings();
  const hasUrl = Boolean((settings.supabaseUrl && settings.supabaseUrl.trim()) || readEnv("SUPABASE_URL"));
  const hasKey = Boolean(
    (settings.supabaseKey && settings.supabaseKey.trim()) ||
      readEnv("SUPABASE_SERVICE_ROLE_KEY") ||
      readEnv("SUPABASE_KEY"),
  );
  return hasUrl && hasKey;
}
