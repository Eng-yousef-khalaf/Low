/**
 * settings-store.ts
 *
 * Durable store for platform-level runtime settings.
 * Priority:
 *   1. Durable Supabase `platform_settings` (when Supabase is configured)
 *   2. Persistent local `.data/settings.json` / `settings.json` (on non-ephemeral servers)
 *   3. Environment variables (`process.env.*`)
 *
 * Ephemeral `/tmp` is NEVER treated as durable production persistence.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { logger } from "../lib/logger";
import { ExternalServiceError } from "../lib/errors";

export interface AppSettings {
  aiApiKey?: string;
  aiBaseUrl?: string;
  aiModel?: string;
  googleSpreadsheetId?: string;
  googleSheetName?: string;
  hfApiToken?: string;
  hfModel?: string;
  whatsappNumber?: string;
  whatsappApiUrl?: string;
  whatsappToken?: string;
  whatsappInstanceId?: string;
  supabaseUrl?: string;
  supabaseKey?: string;
  supabaseTableName?: string;
}

const DATA_SETTINGS_PATH = resolve(process.cwd(), ".data", "settings.json");
const LOCAL_SETTINGS_PATH = resolve(process.cwd(), "settings.json");
const ALT_SETTINGS_PATH = resolve(process.cwd(), "artifacts", "api-server", "settings.json");

const isStatelessServerlessProd =
  process.env.NODE_ENV === "production" &&
  (Boolean(process.env.VERCEL) || Boolean(process.env.AWS_LAMBDA_FUNCTION_NAME));

function loadFromPersistentDisk(): AppSettings {
  const pathsToTry = [
    DATA_SETTINGS_PATH,
    LOCAL_SETTINGS_PATH,
    ALT_SETTINGS_PATH,
  ];
  let result: AppSettings = {};
  for (const p of pathsToTry) {
    try {
      if (existsSync(p)) {
        const raw = readFileSync(p, "utf-8");
        const parsed = JSON.parse(raw) as AppSettings;
        if (parsed && typeof parsed === "object") {
          result = { ...parsed, ...result };
        }
      }
    } catch {
      // ignore unreadable candidate
    }
  }
  return result;
}

function writeToPersistentDisk(settings: AppSettings): boolean {
  if (isStatelessServerlessProd) {
    // Stateless serverless disk is read-only / ephemeral; do NOT write to /tmp and pretend it is durable
    return false;
  }
  const content = JSON.stringify(settings, null, 2);
  try {
    const dir = dirname(DATA_SETTINGS_PATH);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(DATA_SETTINGS_PATH, content, "utf-8");
    return true;
  } catch (err) {
    logger.warn({ err }, "Failed to write .data/settings.json");
  }
  try {
    writeFileSync(LOCAL_SETTINGS_PATH, content, "utf-8");
    return true;
  } catch (err) {
    logger.warn({ err }, "Failed to write settings.json");
    return false;
  }
}

let _cache: AppSettings = loadFromPersistentDisk();
let _hydratedFromRemote = false;

function resolveSupabaseCredentials(candidate?: Partial<AppSettings>): { url?: string; key?: string } {
  const url =
    candidate?.supabaseUrl ||
    _cache.supabaseUrl ||
    process.env.SUPABASE_URL ||
    undefined;
  const key =
    candidate?.supabaseKey ||
    _cache.supabaseKey ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_KEY ||
    undefined;
  return { url: url?.trim() || undefined, key: key?.trim() || undefined };
}

export async function hydrateSettingsFromRemote(): Promise<void> {
  if (_hydratedFromRemote) return;
  const { url, key } = resolveSupabaseCredentials();
  if (!url || !key) return;

  try {
    const client = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await client
      .from("platform_settings")
      .select("payload")
      .eq("id", "global")
      .maybeSingle();

    if (!error && data?.payload && typeof data.payload === "object") {
      _cache = { ..._cache, ...(data.payload as AppSettings) };
      _hydratedFromRemote = true;
    }
  } catch {
    // platform_settings table may not exist yet; ignore on boot
  }
}

export function getSettings(): AppSettings {
  const disk = isStatelessServerlessProd ? {} : loadFromPersistentDisk();
  const merged = { ...disk, ..._cache };

  return {
    hfApiToken:          merged.hfApiToken          || process.env.HF_API_TOKEN          || process.env.HF_TOKEN             || undefined,
    hfModel:             merged.hfModel              || process.env.HF_MODEL               || undefined,
    whatsappNumber:      merged.whatsappNumber       || process.env.WHATSAPP_NUMBER        || undefined,
    whatsappApiUrl:      merged.whatsappApiUrl       || process.env.WHATSAPP_API_URL       || undefined,
    whatsappToken:       merged.whatsappToken         || process.env.WHATSAPP_TOKEN         || undefined,
    whatsappInstanceId:  merged.whatsappInstanceId   || process.env.WHATSAPP_INSTANCE_ID   || undefined,
    aiApiKey:            merged.aiApiKey             || process.env.AI_API_KEY             || process.env.OPENAI_API_KEY      || undefined,
    aiBaseUrl:           merged.aiBaseUrl            || process.env.AI_BASE_URL            || undefined,
    aiModel:             merged.aiModel              || process.env.AI_MODEL               || undefined,
    googleSpreadsheetId: merged.googleSpreadsheetId  || process.env.GOOGLE_SPREADSHEET_ID  || undefined,
    googleSheetName:     merged.googleSheetName      || process.env.GOOGLE_SHEET_NAME      || undefined,
    supabaseUrl:         merged.supabaseUrl          || process.env.SUPABASE_URL           || undefined,
    supabaseKey:         merged.supabaseKey          || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || undefined,
    supabaseTableName:   merged.supabaseTableName    || process.env.SUPABASE_TABLE_NAME    || "app_users",
  };
}

function applyPatchToNextCache(patch: Partial<AppSettings>): AppSettings {
  const next: AppSettings = { ..._cache };
  const keys: Array<keyof AppSettings> = [
    "aiApiKey",
    "aiBaseUrl",
    "aiModel",
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
  ];
  for (const key of keys) {
    const val = patch[key];
    if (val === "") {
      delete next[key];
    } else if (val !== undefined) {
      next[key] = val;
    }
  }
  return next;
}

/**
 * Persists settings durably (Supabase `platform_settings` when configured, plus persistent disk when available).
 * Explicitly fails in production if durable persistence cannot be confirmed.
 */
export async function saveSettingsDurable(patch: Partial<AppSettings>): Promise<AppSettings> {
  const nextCache = applyPatchToNextCache(patch);
  let persistedRemote = false;

  const { url, key } = resolveSupabaseCredentials(nextCache);
  if (url && key) {
    try {
      const client = createClient(url, key, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      // Do not store supabaseKey inside remote payload for defense-in-depth
      const remotePayload = { ...nextCache };
      delete remotePayload.supabaseKey;

      const { error } = await client.from("platform_settings").upsert(
        {
          id: "global",
          payload: remotePayload,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "id" },
      );
      if (!error) {
        persistedRemote = true;
      } else {
        logger.warn({ code: error.code }, "Could not upsert platform_settings in Supabase");
      }
    } catch (err) {
      logger.warn({ err }, "Failed to persist settings to Supabase");
    }
  }

  const persistedDisk = writeToPersistentDisk(nextCache);

  if (!persistedRemote && !persistedDisk) {
    throw new ExternalServiceError(
      "تعذر تثبيت الإعدادات في مخزن دائم. في بيئة الإنتاج السحابية يلزم ربط جدول platform_settings في Supabase أو ضبط متغيرات البيئة مباشرة.",
      "STORAGE_UNAVAILABLE",
    );
  }

  _cache = nextCache;
  return getSettings();
}

/**
 * Synchronous wrapper kept for local/test compatibility; throws in stateless production if disk isn't writable.
 */
export function saveSettings(patch: Partial<AppSettings>): AppSettings {
  const nextCache = applyPatchToNextCache(patch);
  const persistedDisk = writeToPersistentDisk(nextCache);
  if (!persistedDisk && isStatelessServerlessProd) {
    throw new ExternalServiceError(
      "لا يمكن حفظ الإعدادات محلياً في بيئة الإنتاج غير الدائمة. يرجى استخدام الحفظ الدائم عبر قاعدة البيانات.",
      "STORAGE_UNAVAILABLE",
    );
  }
  _cache = nextCache;
  return getSettings();
}
