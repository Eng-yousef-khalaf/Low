import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import bcrypt from "bcryptjs";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import crypto from "node:crypto";
import { env, isSupabaseConfigured } from "../config/env";
import { logger } from "../lib/logger";
import {
  ConflictError,
  ExternalServiceError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "../lib/errors";
import { validatePasswordStrength } from "../utils/dateNormalize";
import { withSheetLock } from "../utils/sheetMeta";

export type PlatformRole = "admin" | "staff";
export type OfficeRole = "office_manager" | "lawyer" | "paralegal" | "accountant";

export interface UserPermissions {
  canAccessFinances: boolean;
  canEditCases: boolean;
  canManageSettings: boolean;
}

export interface AppUser {
  id: string;
  username: string;
  email?: string | null;
  role: PlatformRole;
  office_id: string;
  office_role?: OfficeRole;
  permissions?: UserPermissions;
  display_name?: string | null;
  status?: "active" | "suspended";
  subscription_end_date?: string | null;
  subscription_notes?: string | null;
  plan_tier?: "plus" | "pro";
  billing_cycle?: "monthly" | "annual";
  ai_quota_limit?: number;
  ai_usage_count?: number;
  ai_quota_period?: string;
  ai_renewal_date?: string | null;
  whatsapp_number?: string | null;
  google_service_account_json?: string | null;
  google_spreadsheet_id?: string | null;
  google_sheet_name?: string | null;
  has_google_service?: boolean;
  session_version?: number;
  session_fingerprint?: string;
  created_at?: string;
}

export interface AppUserWithHash extends AppUser {
  password_hash: string;
}

export interface UserGoogleCredentials {
  serviceAccountJson?: Record<string, unknown>;
  spreadsheetId?: string;
  sheetName?: string;
  officeId?: string;
}

export { isSupabaseConfigured };

let _supabaseClient: SupabaseClient | null = null;
let _lastUrl: string | undefined = undefined;
let _lastKey: string | undefined = undefined;

const userGoogleCredsCache = new Map<string, { data: UserGoogleCredentials; timestamp: number }>();
const CACHE_TTL_MS = 60 * 1000;

export function invalidateUserGoogleCache(userId?: string): void {
  if (userId) {
    userGoogleCredsCache.delete(userId);
  } else {
    userGoogleCredsCache.clear();
  }
}

const isStatelessServerlessProd =
  process.env.NODE_ENV === "production" &&
  (Boolean(process.env.VERCEL) || Boolean(process.env.AWS_LAMBDA_FUNCTION_NAME));

const DATA_USERS_FILE = resolve(process.cwd(), ".data", "local_users.json");
const LOCAL_USERS_FILE = resolve(process.cwd(), "artifacts", "api-server", "local_users.json");
const ALT_LOCAL_USERS_FILE = resolve(process.cwd(), "local_users.json");

let _localUsersCache: AppUserWithHash[] | null = null;

/**
 * Current billing period YYYY-MM and next renewal ISO timestamp in Asia/Riyadh (UTC+3).
 */
export function getCurrentRiyadhQuotaCycle(nowMs = Date.now()): {
  period: string;
  nextRenewalIso: string;
} {
  const offsetMs = 3 * 3600 * 1000;
  const riyadhNow = new Date(nowMs + offsetMs);
  const year = riyadhNow.getUTCFullYear();
  const monthIdx = riyadhNow.getUTCMonth(); // 0..11
  const period = `${year}-${String(monthIdx + 1).padStart(2, "0")}`;
  const nextMonthUtc = Date.UTC(year, monthIdx + 1, 1, 0, 0, 0) - offsetMs;
  return {
    period,
    nextRenewalIso: new Date(nextMonthUtc).toISOString(),
  };
}

export function defaultPermissionsForOfficeRole(
  role: PlatformRole,
  officeRole?: OfficeRole,
): UserPermissions {
  if (role === "admin" || officeRole === "office_manager") {
    return { canAccessFinances: true, canEditCases: true, canManageSettings: true };
  }
  if (officeRole === "accountant") {
    return { canAccessFinances: true, canEditCases: false, canManageSettings: false };
  }
  if (officeRole === "paralegal") {
    return { canAccessFinances: false, canEditCases: true, canManageSettings: false };
  }
  return { canAccessFinances: true, canEditCases: true, canManageSettings: false };
}

export function computeSessionFingerprint(record: {
  id: string;
  role?: string;
  status?: string;
  password_hash?: string;
  session_version?: number;
}): string {
  const raw = [
    record.id,
    record.role || "staff",
    record.status || "active",
    record.password_hash || "",
    String(record.session_version ?? 1),
  ].join("|");
  return crypto.createHash("sha256").update(raw).digest("hex").slice(0, 20);
}

function normalizeUserRecord(raw: Record<string, any>, includeHash = false): AppUser | AppUserWithHash {
  const role: PlatformRole = raw.role === "admin" ? "admin" : "staff";
  const officeRole: OfficeRole =
    raw.office_role ||
    (role === "admin" ? "office_manager" : "office_manager");
  const officeId: string =
    raw.office_id && String(raw.office_id).trim()
      ? String(raw.office_id).trim()
      : role === "admin"
        ? "platform-admin"
        : `office-${raw.id}`;

  const planTier: "plus" | "pro" = raw.plan_tier === "pro" || role === "admin" ? "pro" : "plus";
  const quotaLimit =
    raw.ai_quota_limit !== undefined && raw.ai_quota_limit !== null
      ? Number(raw.ai_quota_limit)
      : role === "admin"
        ? -1
        : planTier === "pro"
          ? 300
          : 50;

  const { period, nextRenewalIso } = getCurrentRiyadhQuotaCycle();
  const storedPeriod = raw.ai_quota_period ? String(raw.ai_quota_period) : period;
  const usageCount =
    storedPeriod !== period ? 0 : Math.max(0, Number(raw.ai_usage_count || 0));

  const hasGoogle = Boolean(
    raw.has_google_service ||
      (typeof raw.google_service_account_json === "string" &&
        raw.google_service_account_json.trim().length > 10),
  );

  const sessionVersion = Number(raw.session_version ?? 1);
  const fingerprint = computeSessionFingerprint({
    id: String(raw.id),
    role,
    status: raw.status || "active",
    password_hash: raw.password_hash || "",
    session_version: sessionVersion,
  });

  const permissions: UserPermissions =
    raw.permissions && typeof raw.permissions === "object"
      ? {
          canAccessFinances: Boolean(raw.permissions.canAccessFinances),
          canEditCases: Boolean(raw.permissions.canEditCases),
          canManageSettings: Boolean(raw.permissions.canManageSettings),
        }
      : defaultPermissionsForOfficeRole(role, officeRole);

  const user: AppUser = {
    id: String(raw.id),
    username: String(raw.username),
    email: raw.email ?? null,
    role,
    office_id: officeId,
    office_role: officeRole,
    permissions,
    display_name: raw.display_name ?? null,
    status: raw.status === "suspended" ? "suspended" : "active",
    subscription_end_date: raw.subscription_end_date ?? null,
    subscription_notes: raw.subscription_notes ?? null,
    plan_tier: planTier,
    billing_cycle: raw.billing_cycle === "monthly" ? "monthly" : "annual",
    ai_quota_limit: quotaLimit,
    ai_usage_count: usageCount,
    ai_quota_period: period,
    ai_renewal_date: raw.ai_renewal_date && storedPeriod === period ? raw.ai_renewal_date : nextRenewalIso,
    whatsapp_number: raw.whatsapp_number ?? null,
    google_spreadsheet_id: raw.google_spreadsheet_id ?? null,
    google_sheet_name: raw.google_sheet_name ?? null,
    has_google_service: hasGoogle,
    session_version: sessionVersion,
    session_fingerprint: fingerprint,
    created_at: raw.created_at || new Date().toISOString(),
  };

  if (includeHash) {
    return {
      ...user,
      google_service_account_json: raw.google_service_account_json ?? null,
      password_hash: String(raw.password_hash || ""),
    };
  }
  return user;
}

export function loadLocalUsers(): AppUserWithHash[] {
  if (isSupabaseConfigured()) {
    // Never use local file fallback when Supabase is configured
    return [];
  }
  if (_localUsersCache) {
    return _localUsersCache;
  }

  if (!isStatelessServerlessProd) {
    const paths = [DATA_USERS_FILE, LOCAL_USERS_FILE, ALT_LOCAL_USERS_FILE];
    for (const p of paths) {
      try {
        if (existsSync(p)) {
          const raw = readFileSync(p, "utf-8");
          const list = JSON.parse(raw);
          if (Array.isArray(list) && list.length > 0) {
            const normalized = list.map(
              (u: Record<string, unknown>) => normalizeUserRecord(u, true) as AppUserWithHash,
            );
            _localUsersCache = normalized;
            return normalized;
          }
        }
      } catch {
        // try next candidate
      }
    }
  }

  if (env.isProduction) {
    // Zero default/hardcoded accounts in production!
    _localUsersCache = [];
    return [];
  }

  // Development/test bootstrap ONLY when explicit env vars are set
  const seeded: AppUserWithHash[] = [];
  if (env.bootstrapAdminUsername && env.bootstrapAdminPassword) {
    const { period, nextRenewalIso } = getCurrentRiyadhQuotaCycle();
    seeded.push({
      id: "local-bootstrap-admin",
      username: env.bootstrapAdminUsername.toLowerCase(),
      email: "admin@law.local",
      role: "admin",
      office_id: "platform-admin",
      office_role: "office_manager",
      permissions: { canAccessFinances: true, canEditCases: true, canManageSettings: true },
      display_name: "المشرف العام",
      status: "active",
      subscription_end_date: null,
      subscription_notes: "حساب مشرف مهيأ من متغيرات البيئة",
      plan_tier: "pro",
      billing_cycle: "annual",
      ai_quota_limit: -1,
      ai_usage_count: 0,
      ai_quota_period: period,
      ai_renewal_date: nextRenewalIso,
      has_google_service: false,
      google_spreadsheet_id: null,
      google_sheet_name: null,
      session_version: 1,
      password_hash: bcrypt.hashSync(env.bootstrapAdminPassword, 10),
      created_at: new Date().toISOString(),
    });
    saveLocalUsers(seeded);
  }

  _localUsersCache = seeded;
  return seeded;
}

export function saveLocalUsers(users: AppUserWithHash[]): void {
  if (isStatelessServerlessProd) {
    throw new ExternalServiceError(
      "لا يمكن حفظ الحسابات في ملفات محلية مؤقتة ببيئة الإنتاج. يلزم ربط قاعدة بيانات Supabase الدائمة.",
      "STORAGE_UNAVAILABLE",
    );
  }
  _localUsersCache = users;
  const content = JSON.stringify(users, null, 2);
  let saved = false;

  try {
    const dir = dirname(DATA_USERS_FILE);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(DATA_USERS_FILE, content, "utf-8");
    saved = true;
  } catch (err) {
    logger.warn({ err }, "Failed to write .data/local_users.json");
  }

  try {
    writeFileSync(LOCAL_USERS_FILE, content, "utf-8");
    saved = true;
  } catch {
    // optional secondary path
  }

  if (!saved && env.isProduction) {
    throw new ExternalServiceError(
      "تعذر تثبيت بيانات الحساب في التخزين الدائم.",
      "STORAGE_UNAVAILABLE",
    );
  }
}

export function resetLocalUsersForTesting(seed: AppUserWithHash[] = []): void {
  _localUsersCache = seed;
}

export function getSupabaseClient(): SupabaseClient | null {
  if (!isSupabaseConfigured()) {
    return null;
  }

  const url = env.supabaseUrl!;
  const key = env.supabaseKey!;

  if (_supabaseClient && _lastUrl === url && _lastKey === key) {
    return _supabaseClient;
  }

  try {
    _supabaseClient = createClient(url, key, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });
    _lastUrl = url;
    _lastKey = key;
    return _supabaseClient;
  } catch (err) {
    logger.error({ err }, "Failed to initialize Supabase client");
    throw new ExternalServiceError(
      "تعذر تهيئة الاتصال بقاعدة بيانات الحسابات.",
      "STORAGE_UNAVAILABLE",
    );
  }
}

/**
 * Seeds a bootstrap admin ONLY if the users table is completely empty AND explicit ADMIN_USERNAME + ADMIN_PASSWORD env vars are configured.
 */
export async function ensureDefaultAdmin(): Promise<void> {
  const client = getSupabaseClient();
  if (!client) return;
  if (!env.bootstrapAdminUsername || !env.bootstrapAdminPassword) return;

  try {
    const tableName = env.supabaseTableName;
    const { count, error } = await client
      .from(tableName)
      .select("*", { count: "exact", head: true });

    if (error || count === null || count > 0) {
      return;
    }

    const password_hash = await bcrypt.hash(env.bootstrapAdminPassword, 10);
    await client.from(tableName).insert([
      {
        username: env.bootstrapAdminUsername.toLowerCase(),
        email: `${env.bootstrapAdminUsername.toLowerCase()}@law.local`,
        password_hash,
        role: "admin",
        display_name: "المشرف العام",
        status: "active",
      },
    ]);
  } catch (err) {
    logger.warn({ err }, "Bootstrap admin check skipped");
  }
}

/**
 * Verifies user credentials against the single authoritative account store.
 * Never falls back to hardcoded passwords or secondary local files when Supabase is active.
 */
export async function verifySupabaseUser(
  usernameOrEmail: string,
  plainPassword: string,
): Promise<AppUser | null> {
  const cleanIdentifier = usernameOrEmail.trim().toLowerCase();
  if (!cleanIdentifier || !plainPassword) return null;

  const client = getSupabaseClient();

  if (!client) {
    if (isStatelessServerlessProd) {
      throw new ExternalServiceError(
        "خدمة التحقق من الحسابات غير مهيأة في بيئة الإنتاج (يلزم ضبط قاعدة البيانات الدائمة).",
        "STORAGE_UNAVAILABLE",
      );
    }
    const localUsers = loadLocalUsers();
    const user = localUsers.find(
      (u) =>
        u.username.toLowerCase() === cleanIdentifier ||
        (u.email && u.email.toLowerCase() === cleanIdentifier),
    );
    if (!user || !user.password_hash) return null;

    const isBcrypt =
      user.password_hash.startsWith("$2a$") ||
      user.password_hash.startsWith("$2b$") ||
      user.password_hash.startsWith("$2y$");
    if (!isBcrypt) return null;

    const isValid = await bcrypt.compare(plainPassword, user.password_hash);
    if (!isValid) return null;

    const fresh = await ensureUserMonthlyQuotaFresh(user.id);
    return fresh ?? (normalizeUserRecord(user, false) as AppUser);
  }

  const tableName = env.supabaseTableName;
  const { data, error } = await client
    .from(tableName)
    .select("*")
    .or(`username.ilike.${cleanIdentifier},email.ilike.${cleanIdentifier}`)
    .limit(1);

  if (error) {
    logger.error({ code: error.code }, "Database error during credential verification");
    throw new ExternalServiceError(
      "تعذر الاتصال بقاعدة بيانات الحسابات للتحقق من الدخول. يرجى المحاولة لاحقاً.",
      "STORAGE_UNAVAILABLE",
    );
  }

  if (!data || data.length === 0) {
    return null;
  }

  const record = data[0] as Record<string, any>;
  if (!record.password_hash || typeof record.password_hash !== "string") {
    return null;
  }

  const isBcrypt =
    record.password_hash.startsWith("$2a$") ||
    record.password_hash.startsWith("$2b$") ||
    record.password_hash.startsWith("$2y$");

  if (!isBcrypt) {
    return null;
  }

  const isValid = await bcrypt.compare(plainPassword, record.password_hash);
  if (!isValid) {
    return null;
  }

  const fresh = await ensureUserMonthlyQuotaFresh(String(record.id));
  return fresh ?? (normalizeUserRecord(record, false) as AppUser);
}

/**
 * Resolves Google Sheets credentials strictly for a user or their owning office.
 * Works identically for both Supabase and persistent local store.
 */
export async function getUserGoogleCredentials(
  userId?: string,
  officeId?: string,
): Promise<UserGoogleCredentials | null> {
  if (!userId && !officeId) {
    return null;
  }

  const cacheKey = `${userId || ""}:${officeId || ""}`;
  const cached = userGoogleCredsCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.data;
  }

  const client = getSupabaseClient();
  let rawUser: Record<string, any> | null = null;

  if (!client) {
    const local = loadLocalUsers();
    rawUser =
      local.find((u) => u.id === userId) ||
      (officeId
        ? local.find(
            (u) =>
              u.office_id === officeId &&
              Boolean(u.google_spreadsheet_id || u.google_service_account_json),
          )
        : undefined) ||
      null;
  } else {
    const tableName = env.supabaseTableName;
    if (userId) {
      const { data, error } = await client
        .from(tableName)
        .select("*")
        .eq("id", userId)
        .maybeSingle();
      if (error) {
        throw new ExternalServiceError(
          "تعذر قراءة إعدادات ربط المكتب من قاعدة البيانات.",
          "STORAGE_UNAVAILABLE",
        );
      }
      rawUser = data;
    }

    // If team member doesn't directly hold spreadsheet credentials, inherit from their office manager
    if (
      (!rawUser || (!rawUser.google_spreadsheet_id && !rawUser.google_service_account_json)) &&
      (officeId || rawUser?.office_id)
    ) {
      const targetOffice = officeId || rawUser?.office_id;
      if (targetOffice && targetOffice !== "platform-admin") {
        try {
          const { data: officeOwners } = await client
            .from(tableName)
            .select("*")
            .eq("office_id", targetOffice)
            .not("google_spreadsheet_id", "is", null)
            .limit(1);
          if (officeOwners && officeOwners.length > 0) {
            rawUser = officeOwners[0];
          }
        } catch {
          // office_id column may not exist on older schema; ignore
        }
      }
    }
  }

  if (!rawUser) {
    return null;
  }

  let parsedJson: Record<string, unknown> | undefined = undefined;
  if (rawUser.google_service_account_json) {
    try {
      parsedJson =
        typeof rawUser.google_service_account_json === "string"
          ? JSON.parse(rawUser.google_service_account_json)
          : rawUser.google_service_account_json;
    } catch {
      logger.warn({ userId }, "Invalid JSON in user google_service_account_json");
    }
  }

  const creds: UserGoogleCredentials = {
    serviceAccountJson: parsedJson,
    spreadsheetId: rawUser.google_spreadsheet_id?.trim() || undefined,
    sheetName: rawUser.google_sheet_name?.trim() || undefined,
    officeId: rawUser.office_id || `office-${rawUser.id}`,
  };

  userGoogleCredsCache.set(cacheKey, { data: creds, timestamp: Date.now() });
  return creds;
}

export async function listSupabaseUsers(): Promise<AppUser[]> {
  const client = getSupabaseClient();
  if (!client) {
    if (isStatelessServerlessProd) {
      throw new ExternalServiceError(
        "قاعدة بيانات الحسابات غير متصلة حالياً.",
        "STORAGE_UNAVAILABLE",
      );
    }
    return loadLocalUsers().map((u) => normalizeUserRecord(u, false) as AppUser);
  }

  const tableName = env.supabaseTableName;
  const { data, error } = await client
    .from(tableName)
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    logger.error({ code: error.code }, "Failed to list users from Supabase");
    throw new ExternalServiceError(
      "تعذر استرجاع قائمة الحسابات من قاعدة البيانات.",
      "STORAGE_UNAVAILABLE",
    );
  }

  return (data || []).map((u: Record<string, any>) => normalizeUserRecord(u, false) as AppUser);
}

/**
 * Direct single-row lookup by ID.
 * Throws ExternalServiceError if the store is unreachable; returns null if user was deleted.
 * NEVER falls back to local files when Supabase is configured.
 */
export async function findSupabaseUserById(id: string): Promise<AppUser | null> {
  if (!id) return null;

  const client = getSupabaseClient();
  if (!client) {
    if (isStatelessServerlessProd) {
      throw new ExternalServiceError(
        "خدمة الحسابات غير متاحة حالياً.",
        "STORAGE_UNAVAILABLE",
      );
    }
    const local = loadLocalUsers();
    const u = local.find((x) => x.id === id);
    if (!u) return null;
    return normalizeUserRecord(u, false) as AppUser;
  }

  const tableName = env.supabaseTableName;
  const { data, error } = await client
    .from(tableName)
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    logger.error({ code: error.code, id }, "Failed to query user by ID in Supabase");
    throw new ExternalServiceError(
      "تعذر التحقق من صلاحية الحساب حالياً.",
      "STORAGE_UNAVAILABLE",
    );
  }

  if (!data) {
    return null;
  }

  return normalizeUserRecord(data as Record<string, any>, false) as AppUser;
}

export async function findSupabaseUserByUsername(username: string): Promise<AppUser | null> {
  const clean = username.trim().toLowerCase();
  if (!clean) return null;

  const client = getSupabaseClient();
  if (!client) {
    if (isStatelessServerlessProd) {
      throw new ExternalServiceError(
        "خدمة الحسابات غير متاحة حالياً.",
        "STORAGE_UNAVAILABLE",
      );
    }
    const local = loadLocalUsers();
    const u = local.find((x) => x.username.toLowerCase() === clean);
    if (!u) return null;
    return normalizeUserRecord(u, false) as AppUser;
  }

  const tableName = env.supabaseTableName;
  const { data, error } = await client
    .from(tableName)
    .select("*")
    .ilike("username", clean)
    .maybeSingle();

  if (error) {
    throw new ExternalServiceError(
      "تعذر الاستعلام عن الحساب في قاعدة البيانات.",
      "STORAGE_UNAVAILABLE",
    );
  }

  if (!data) return null;
  return normalizeUserRecord(data as Record<string, any>, false) as AppUser;
}

function sanitizeGoogleServiceJson(raw?: string | null): string | null {
  if (!raw || !raw.trim()) return null;
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw.trim()) : raw;
    if (!parsed || typeof parsed !== "object") {
      throw new ValidationError("صيغة ملف Google Service Account JSON غير صالحة.");
    }
    if (!parsed.client_email || !parsed.private_key) {
      throw new ValidationError(
        "ملف Service Account JSON يجب أن يحتوي على حقلي client_email و private_key.",
      );
    }
    return JSON.stringify(parsed);
  } catch (err) {
    if (err instanceof ValidationError) throw err;
    throw new ValidationError("صيغة Google Service Account JSON غير صحيحة.");
  }
}

export async function createSupabaseUser(input: {
  username: string;
  email?: string;
  password: string;
  role?: PlatformRole;
  office_id?: string;
  office_role?: OfficeRole;
  permissions?: UserPermissions;
  display_name?: string;
  status?: "active" | "suspended";
  subscription_end_date?: string;
  subscription_notes?: string;
  plan_tier?: "plus" | "pro";
  billing_cycle?: "monthly" | "annual";
  ai_quota_limit?: number;
  whatsapp_number?: string;
  google_service_account_json?: string;
  google_spreadsheet_id?: string;
  google_sheet_name?: string;
}): Promise<AppUser> {
  const username = (input.username || "").trim().toLowerCase();
  const password = (input.password || "").trim();

  if (!username || username.length < 3 || username.length > 64) {
    throw new ValidationError("اسم المستخدم مطلوب ويجب أن يكون بين 3 و 64 خانة.");
  }

  const pwCheck = validatePasswordStrength(password);
  if (!pwCheck.valid) {
    throw new ValidationError(pwCheck.error!);
  }

  const sanitizedGoogleJson = sanitizeGoogleServiceJson(input.google_service_account_json);
  const password_hash = await bcrypt.hash(password, 10);
  const status = input.status || "active";
  const subscription_end_date = input.subscription_end_date?.trim() || null;
  const subscription_notes = input.subscription_notes?.trim() || null;
  const role: PlatformRole = input.role === "admin" ? "admin" : "staff";
  const office_role: OfficeRole = input.office_role || "office_manager";
  const plan_tier: "plus" | "pro" = input.plan_tier || (role === "admin" ? "pro" : "plus");
  const billing_cycle: "monthly" | "annual" = input.billing_cycle || "annual";
  const ai_quota_limit =
    input.ai_quota_limit !== undefined
      ? input.ai_quota_limit
      : role === "admin"
        ? -1
        : plan_tier === "pro"
          ? 300
          : 50;

  const { period, nextRenewalIso } = getCurrentRiyadhQuotaCycle();
  const client = getSupabaseClient();

  if (!client) {
    const local = loadLocalUsers();
    if (local.some((u) => u.username.toLowerCase() === username)) {
      throw new ConflictError(`اسم المستخدم "${username}" مسجل مسبقاً.`);
    }

    const newId = `user-${crypto.randomUUID()}`;
    const office_id =
      input.office_id?.trim() ||
      (role === "admin" ? "platform-admin" : `office-${newId}`);

    const newUser: AppUserWithHash = {
      id: newId,
      username,
      email: input.email?.trim() || null,
      role,
      office_id,
      office_role,
      permissions: input.permissions ?? defaultPermissionsForOfficeRole(role, office_role),
      display_name: input.display_name?.trim() || username,
      status,
      subscription_end_date,
      subscription_notes,
      plan_tier,
      billing_cycle,
      ai_quota_limit,
      ai_usage_count: 0,
      ai_quota_period: period,
      ai_renewal_date: nextRenewalIso,
      whatsapp_number: input.whatsapp_number?.trim() || null,
      google_service_account_json: sanitizedGoogleJson,
      google_spreadsheet_id: input.google_spreadsheet_id?.trim() || null,
      google_sheet_name: input.google_sheet_name?.trim() || null,
      has_google_service: Boolean(sanitizedGoogleJson),
      session_version: 1,
      password_hash,
      created_at: new Date().toISOString(),
    };

    local.unshift(newUser);
    saveLocalUsers(local);
    return normalizeUserRecord(newUser, false) as AppUser;
  }

  const tableName = env.supabaseTableName;
  const { data: existing, error: checkError } = await client
    .from(tableName)
    .select("id")
    .ilike("username", username)
    .limit(1);

  if (checkError) {
    throw new ExternalServiceError("تعذر فحص تكرار اسم المستخدم في قاعدة البيانات.", "STORAGE_UNAVAILABLE");
  }
  if (existing && existing.length > 0) {
    throw new ConflictError(`اسم المستخدم "${username}" مسجل مسبقاً.`);
  }

  const corePayload: Record<string, unknown> = {
    username,
    email: input.email?.trim() || null,
    password_hash,
    role,
    display_name: input.display_name?.trim() || username,
    status,
    subscription_end_date,
    subscription_notes,
    plan_tier,
    billing_cycle,
    ai_quota_limit,
    ai_usage_count: 0,
    google_service_account_json: sanitizedGoogleJson,
    google_spreadsheet_id: input.google_spreadsheet_id?.trim() || null,
    google_sheet_name: input.google_sheet_name?.trim() || null,
  };

  const extendedPayload: Record<string, unknown> = {
    ...corePayload,
    ...(input.office_id ? { office_id: input.office_id.trim() } : {}),
    office_role,
    session_version: 1,
    ai_quota_period: period,
    ai_renewal_date: nextRenewalIso,
    ...(input.whatsapp_number ? { whatsapp_number: input.whatsapp_number.trim() } : {}),
    ...(input.permissions ? { permissions: input.permissions } : {}),
  };

  let { data, error } = await client
    .from(tableName)
    .insert([extendedPayload])
    .select("*")
    .single();

  if (error && (error.code === "PGRST204" || error.message?.includes("column"))) {
    // Fallback cleanly if optional new columns haven't been migrated yet in Supabase
    const retry = await client
      .from(tableName)
      .insert([corePayload])
      .select("*")
      .single();
    data = retry.data;
    error = retry.error;
  }

  if (error || !data) {
    logger.error({ code: error?.code }, "Failed to insert user into Supabase");
    throw new ExternalServiceError("تعذر إنشاء الحساب في قاعدة البيانات.", "STORAGE_UNAVAILABLE");
  }

  return normalizeUserRecord(data as Record<string, any>, false) as AppUser;
}

export async function countActiveAdmins(excludeUserId?: string): Promise<number> {
  const client = getSupabaseClient();
  if (!client) {
    const local = loadLocalUsers();
    return local.filter(
      (u) => u.role === "admin" && u.status === "active" && u.id !== excludeUserId,
    ).length;
  }

  const tableName = env.supabaseTableName;
  let query = client
    .from(tableName)
    .select("id", { count: "exact", head: true })
    .eq("role", "admin")
    .eq("status", "active");
  if (excludeUserId) {
    query = query.neq("id", excludeUserId);
  }
  const { count, error } = await query;
  if (error || count === null) {
    throw new ExternalServiceError("تعذر التحقق من عدد المشرفين النشطين.", "STORAGE_UNAVAILABLE");
  }
  return count;
}

export async function deleteSupabaseUser(id: string): Promise<void> {
  invalidateUserGoogleCache();
  const client = getSupabaseClient();

  if (!client) {
    const local = loadLocalUsers();
    const userToDelete = local.find((u) => u.id === id);
    if (!userToDelete) {
      throw new NotFoundError("المستخدم غير موجود.");
    }
    if (userToDelete.role === "admin" && userToDelete.status === "active") {
      const otherAdmins = await countActiveAdmins(id);
      if (otherAdmins === 0) {
        throw new ValidationError(
          "لا يمكن حذف المشرف الوحيد النشط في المنظومة لضمان استمرارية لوحة التحكم.",
        );
      }
    }
    saveLocalUsers(local.filter((u) => u.id !== id));
    return;
  }

  const tableName = env.supabaseTableName;
  const { data: targetUser, error: findErr } = await client
    .from(tableName)
    .select("id, role, status")
    .eq("id", id)
    .maybeSingle();

  if (findErr) {
    throw new ExternalServiceError("تعذر الوصول لبيانات المستخدم قبل الحذف.", "STORAGE_UNAVAILABLE");
  }
  if (!targetUser) {
    throw new NotFoundError("المستخدم غير موجود.");
  }

  if (targetUser.role === "admin" && targetUser.status === "active") {
    const otherAdmins = await countActiveAdmins(id);
    if (otherAdmins === 0) {
      throw new ValidationError(
        "لا يمكن حذف المشرف الوحيد النشط في المنظومة لضمان استمرارية لوحة التحكم.",
      );
    }
  }

  const { error } = await client.from(tableName).delete().eq("id", id);
  if (error) {
    logger.error({ code: error.code, id }, "Failed to delete user from Supabase");
    throw new ExternalServiceError("فشل حذف المستخدم من قاعدة البيانات.", "STORAGE_UNAVAILABLE");
  }
}

export async function updateSupabaseUser(
  id: string,
  input: {
    password?: string;
    role?: PlatformRole;
    office_id?: string;
    office_role?: OfficeRole;
    permissions?: UserPermissions;
    display_name?: string;
    email?: string;
    status?: "active" | "suspended";
    subscription_end_date?: string | null;
    subscription_notes?: string | null;
    plan_tier?: "plus" | "pro";
    billing_cycle?: "monthly" | "annual";
    ai_quota_limit?: number;
    ai_usage_count?: number;
    ai_quota_period?: string;
    ai_renewal_date?: string | null;
    whatsapp_number?: string | null;
    google_service_account_json?: string;
    google_spreadsheet_id?: string;
    google_sheet_name?: string;
    bump_session_version?: boolean;
  },
): Promise<AppUser> {
  invalidateUserGoogleCache();
  const client = getSupabaseClient();

  // Validate password strength identically on updates!
  if (input.password !== undefined && input.password.trim() !== "") {
    const pwCheck = validatePasswordStrength(input.password);
    if (!pwCheck.valid) {
      throw new ValidationError(pwCheck.error!);
    }
  }

  if (input.role === "staff" || input.status === "suspended") {
    const existing = await findSupabaseUserById(id);
    if (existing && existing.role === "admin" && existing.status === "active") {
      const remainingAdmins = await countActiveAdmins(id);
      if (remainingAdmins === 0) {
        throw new ValidationError(
          input.role === "staff"
            ? "لا يمكن تنزيل صلاحية المشرف الوحيد النشط إلى محامٍ. يجب تعيين مشرف آخر أولاً."
            : "لا يمكن إيقاف المشرف الوحيد النشط في المنظومة. يجب أن يتوفر مشرف فعّال آخر أولاً.",
        );
      }
    }
  }

  const shouldBumpSession = Boolean(
    input.bump_session_version ||
      (input.password && input.password.trim()) ||
      input.role !== undefined ||
      input.status !== undefined ||
      input.office_role !== undefined ||
      input.permissions !== undefined,
  );

  if (!client) {
    const local = loadLocalUsers();
    const index = local.findIndex((u) => u.id === id);
    if (index === -1) {
      throw new NotFoundError("المستخدم غير موجود.");
    }
    const user = local[index];

    if (input.password && input.password.trim()) {
      user.password_hash = await bcrypt.hash(input.password.trim(), 10);
    }
    if (input.role) user.role = input.role;
    if (input.office_id !== undefined) user.office_id = input.office_id.trim();
    if (input.office_role !== undefined) user.office_role = input.office_role;
    if (input.permissions !== undefined) user.permissions = input.permissions;
    if (input.display_name !== undefined) user.display_name = input.display_name.trim() || null;
    if (input.email !== undefined) user.email = input.email.trim() || null;
    if (input.status !== undefined) user.status = input.status;
    if (input.subscription_end_date !== undefined) {
      user.subscription_end_date = input.subscription_end_date || null;
    }
    if (input.subscription_notes !== undefined) {
      user.subscription_notes = input.subscription_notes?.trim() || null;
    }
    if (input.plan_tier !== undefined) {
      user.plan_tier = input.plan_tier;
      if (input.ai_quota_limit === undefined) {
        user.ai_quota_limit = user.role === "admin" ? -1 : user.plan_tier === "pro" ? 300 : 50;
      }
    }
    if (input.billing_cycle !== undefined) user.billing_cycle = input.billing_cycle;
    if (input.ai_quota_limit !== undefined) user.ai_quota_limit = input.ai_quota_limit;
    if (input.ai_usage_count !== undefined) user.ai_usage_count = input.ai_usage_count;
    if (input.ai_quota_period !== undefined) user.ai_quota_period = input.ai_quota_period;
    if (input.ai_renewal_date !== undefined) user.ai_renewal_date = input.ai_renewal_date;
    if (input.whatsapp_number !== undefined) user.whatsapp_number = input.whatsapp_number?.trim() || null;

    if (input.google_service_account_json !== undefined) {
      if (input.google_service_account_json.trim() === "") {
        // Empty string leaves existing JSON untouched unless explicitly cleared
      } else {
        user.google_service_account_json = sanitizeGoogleServiceJson(input.google_service_account_json);
        user.has_google_service = Boolean(user.google_service_account_json);
      }
    }
    if (input.google_spreadsheet_id !== undefined) {
      user.google_spreadsheet_id = input.google_spreadsheet_id.trim() || null;
    }
    if (input.google_sheet_name !== undefined) {
      user.google_sheet_name = input.google_sheet_name.trim() || null;
    }

    if (shouldBumpSession) {
      user.session_version = (user.session_version ?? 1) + 1;
    }

    saveLocalUsers(local);
    return normalizeUserRecord(user, false) as AppUser;
  }

  const currentUser = await findSupabaseUserById(id);
  if (!currentUser) {
    throw new NotFoundError("المستخدم غير موجود.");
  }

  const tableName = env.supabaseTableName;
  const coreUpdates: Record<string, unknown> = {};
  const extendedUpdates: Record<string, unknown> = {};

  if (input.password && input.password.trim()) {
    coreUpdates.password_hash = await bcrypt.hash(input.password.trim(), 10);
  }
  if (input.role) coreUpdates.role = input.role;
  if (input.display_name !== undefined) coreUpdates.display_name = input.display_name.trim() || null;
  if (input.email !== undefined) coreUpdates.email = input.email.trim() || null;
  if (input.status !== undefined) coreUpdates.status = input.status;
  if (input.subscription_end_date !== undefined) {
    coreUpdates.subscription_end_date = input.subscription_end_date || null;
  }
  if (input.subscription_notes !== undefined) {
    coreUpdates.subscription_notes = input.subscription_notes?.trim() || null;
  }
  if (input.plan_tier !== undefined) coreUpdates.plan_tier = input.plan_tier;
  if (input.billing_cycle !== undefined) coreUpdates.billing_cycle = input.billing_cycle;
  if (input.ai_quota_limit !== undefined) coreUpdates.ai_quota_limit = input.ai_quota_limit;
  if (input.ai_usage_count !== undefined) coreUpdates.ai_usage_count = input.ai_usage_count;

  if (input.google_service_account_json !== undefined && input.google_service_account_json.trim() !== "") {
    coreUpdates.google_service_account_json = sanitizeGoogleServiceJson(input.google_service_account_json);
  }
  if (input.google_spreadsheet_id !== undefined) {
    coreUpdates.google_spreadsheet_id = input.google_spreadsheet_id.trim() || null;
  }
  if (input.google_sheet_name !== undefined) {
    coreUpdates.google_sheet_name = input.google_sheet_name.trim() || null;
  }

  if (input.office_id !== undefined) extendedUpdates.office_id = input.office_id.trim();
  if (input.office_role !== undefined) extendedUpdates.office_role = input.office_role;
  if (input.permissions !== undefined) extendedUpdates.permissions = input.permissions;
  if (input.ai_quota_period !== undefined) extendedUpdates.ai_quota_period = input.ai_quota_period;
  if (input.ai_renewal_date !== undefined) extendedUpdates.ai_renewal_date = input.ai_renewal_date;
  if (input.whatsapp_number !== undefined) extendedUpdates.whatsapp_number = input.whatsapp_number?.trim() || null;
  if (shouldBumpSession) {
    extendedUpdates.session_version = (currentUser.session_version ?? 1) + 1;
  }

  const allUpdates = { ...coreUpdates, ...extendedUpdates };
  if (Object.keys(allUpdates).length === 0) {
    return currentUser;
  }

  let { data, error } = await client
    .from(tableName)
    .update(allUpdates)
    .eq("id", id)
    .select("*")
    .single();

  if (error && (error.code === "PGRST204" || error.message?.includes("column"))) {
    if (Object.keys(coreUpdates).length === 0) {
      return currentUser;
    }
    const retry = await client
      .from(tableName)
      .update(coreUpdates)
      .eq("id", id)
      .select("*")
      .single();
    data = retry.data;
    error = retry.error;
  }

  if (error || !data) {
    logger.error({ code: error?.code, id }, "Failed to update user in Supabase");
    throw new ExternalServiceError("تعذر حفظ التعديلات على الحساب.", "STORAGE_UNAVAILABLE");
  }

  return normalizeUserRecord(data as Record<string, any>, false) as AppUser;
}

/**
 * Ensures the user's monthly AI quota counter is automatically reset if a new calendar month started.
 */
export async function ensureUserMonthlyQuotaFresh(userId: string): Promise<AppUser | null> {
  const { period, nextRenewalIso } = getCurrentRiyadhQuotaCycle();
  const client = getSupabaseClient();

  if (!client) {
    const local = loadLocalUsers();
    const u = local.find((x) => x.id === userId);
    if (!u) return null;
    if (u.ai_quota_period !== period || (u.ai_renewal_date && Date.now() >= new Date(u.ai_renewal_date).getTime())) {
      u.ai_usage_count = 0;
      u.ai_quota_period = period;
      u.ai_renewal_date = nextRenewalIso;
      if (!isStatelessServerlessProd) {
        saveLocalUsers(local);
      }
    }
    return normalizeUserRecord(u, false) as AppUser;
  }

  const tableName = env.supabaseTableName;
  const { data, error } = await client
    .from(tableName)
    .select("*")
    .eq("id", userId)
    .maybeSingle();

  if (error || !data) return null;
  const raw = data as Record<string, any>;
  const needsReset =
    (raw.ai_quota_period && raw.ai_quota_period !== period) ||
    (raw.ai_renewal_date && Date.now() >= new Date(raw.ai_renewal_date).getTime());

  if (needsReset && Number(raw.ai_usage_count || 0) > 0) {
    return updateSupabaseUser(userId, {
      ai_usage_count: 0,
      ai_quota_period: period,
      ai_renewal_date: nextRenewalIso,
    });
  }

  return normalizeUserRecord(raw, false) as AppUser;
}

/**
 * Sweeps all active users to reset monthly AI quotas when the month rolls over (invoked by cron).
 */
export async function sweepMonthlyAiQuotaRenewals(): Promise<number> {
  const { period, nextRenewalIso } = getCurrentRiyadhQuotaCycle();
  let renewedCount = 0;

  try {
    const users = await listSupabaseUsers();
    for (const u of users) {
      if (u.role === "admin") continue;
      const expiredCycle =
        (u.ai_renewal_date && Date.now() >= new Date(u.ai_renewal_date).getTime()) ||
        (u.ai_quota_period && u.ai_quota_period !== period);
      if (expiredCycle) {
        await updateSupabaseUser(u.id, {
          ai_usage_count: 0,
          ai_quota_period: period,
          ai_renewal_date: nextRenewalIso,
        });
        renewedCount++;
      }
    }
  } catch (err) {
    logger.warn({ err }, "Monthly AI quota sweep encountered an error");
  }
  return renewedCount;
}

/**
 * Atomically checks and reserves 1 unit of AI quota BEFORE invoking the AI provider,
 * preventing concurrent requests from bypassing the user's monthly limit.
 */
export async function reserveUserAiQuota(userId: string): Promise<{
  reserved: boolean;
  unlimited: boolean;
  ai_usage_count: number;
  ai_quota_limit: number;
  plan_tier: string;
  ai_renewal_date: string | null;
}> {
  return withSheetLock(`ai_quota:${userId}`, async () => {
    const { period, nextRenewalIso } = getCurrentRiyadhQuotaCycle();
    const client = getSupabaseClient();

    if (!client) {
      const local = loadLocalUsers();
      const u = local.find((x) => x.id === userId);
      if (!u) {
        throw new ForbiddenError("الحساب غير موجود أو غير مصرح له.", "SUBSCRIPTION_INACTIVE");
      }
      if (u.ai_quota_period !== period) {
        u.ai_usage_count = 0;
        u.ai_quota_period = period;
        u.ai_renewal_date = nextRenewalIso;
      }

      const limit =
        u.ai_quota_limit !== undefined
          ? u.ai_quota_limit
          : u.role === "admin"
            ? -1
            : u.plan_tier === "pro"
              ? 300
              : 50;

      if (u.role === "admin" || limit === -1) {
        return {
          reserved: false,
          unlimited: true,
          ai_usage_count: u.ai_usage_count || 0,
          ai_quota_limit: -1,
          plan_tier: u.plan_tier || "pro",
          ai_renewal_date: u.ai_renewal_date ?? nextRenewalIso,
        };
      }

      const used = u.ai_usage_count || 0;
      if (used >= limit) {
        throw new ForbiddenError(
          `لقد استنفدت حصتك الشهرية من التحليل الذكي (${used} من ${limit}). تتجدد الحصة تلقائياً مطلع الشهر القادم أو عبر تصفيرها من المشرف.`,
          "QUOTA_EXCEEDED",
          {
            quotaExceeded: true,
            used,
            limit,
            planTier: u.plan_tier || "plus",
            renewalDate: u.ai_renewal_date ?? nextRenewalIso,
          },
        );
      }

      u.ai_usage_count = used + 1;
      u.ai_quota_period = period;
      u.ai_renewal_date = u.ai_renewal_date || nextRenewalIso;
      saveLocalUsers(local);

      return {
        reserved: true,
        unlimited: false,
        ai_usage_count: u.ai_usage_count,
        ai_quota_limit: limit,
        plan_tier: u.plan_tier || "plus",
        ai_renewal_date: u.ai_renewal_date,
      };
    }

    const tableName = env.supabaseTableName;
    for (let attempt = 0; attempt < 3; attempt++) {
      const user = await ensureUserMonthlyQuotaFresh(userId);
      if (!user) {
        throw new ForbiddenError("الحساب غير موجود أو غير مصرح له.", "SUBSCRIPTION_INACTIVE");
      }

      const limit =
        user.ai_quota_limit !== undefined
          ? user.ai_quota_limit
          : user.role === "admin"
            ? -1
            : user.plan_tier === "pro"
              ? 300
              : 50;

      if (user.role === "admin" || limit === -1) {
        return {
          reserved: false,
          unlimited: true,
          ai_usage_count: user.ai_usage_count || 0,
          ai_quota_limit: -1,
          plan_tier: user.plan_tier || "pro",
          ai_renewal_date: user.ai_renewal_date ?? nextRenewalIso,
        };
      }

      const used = user.ai_usage_count || 0;
      if (used >= limit) {
        throw new ForbiddenError(
          `لقد استنفدت حصتك الشهرية من التحليل الذكي (${used} من ${limit}). تتجدد الحصة تلقائياً مطلع الشهر القادم أو عبر تصفيرها من المشرف.`,
          "QUOTA_EXCEEDED",
          {
            quotaExceeded: true,
            used,
            limit,
            planTier: user.plan_tier || "plus",
            renewalDate: user.ai_renewal_date ?? nextRenewalIso,
          },
        );
      }

      // Optimistic concurrency compare-and-swap on ai_usage_count
      const { data: updatedRows, error } = await client
        .from(tableName)
        .update({ ai_usage_count: used + 1 })
        .eq("id", userId)
        .eq("ai_usage_count", used)
        .select("id, ai_usage_count");

      if (error) {
        throw new ExternalServiceError("تعذر تحديث عداد استهلاك الذكاء الاصطناعي.", "STORAGE_UNAVAILABLE");
      }

      if (updatedRows && updatedRows.length > 0) {
        return {
          reserved: true,
          unlimited: false,
          ai_usage_count: used + 1,
          ai_quota_limit: limit,
          plan_tier: user.plan_tier || "plus",
          ai_renewal_date: user.ai_renewal_date ?? nextRenewalIso,
        };
      }
    }

    throw new ConflictError("تزامن طلبات التحليل الذكي؛ يرجى الانتظار لحظة وإعادة المحاولة.");
  });
}

/**
 * Releases a previously reserved AI quota unit if the upstream AI service failed before producing a result.
 */
export async function releaseUserAiQuota(userId: string): Promise<void> {
  await withSheetLock(`ai_quota:${userId}`, async () => {
    try {
      const client = getSupabaseClient();
      if (!client) {
        const local = loadLocalUsers();
        const u = local.find((x) => x.id === userId);
        if (u && (u.ai_usage_count || 0) > 0) {
          u.ai_usage_count = Math.max(0, (u.ai_usage_count || 0) - 1);
          saveLocalUsers(local);
        }
        return;
      }

      const user = await findSupabaseUserById(userId);
      if (user && (user.ai_usage_count || 0) > 0) {
        await client
          .from(env.supabaseTableName)
          .update({ ai_usage_count: Math.max(0, (user.ai_usage_count || 0) - 1) })
          .eq("id", userId);
      }
    } catch (err) {
      logger.warn({ err, userId }, "Failed to release reserved AI quota unit");
    }
  });
}

export async function incrementUserAiUsage(
  userId: string,
): Promise<{ ai_usage_count: number; ai_quota_limit: number; plan_tier: string }> {
  const res = await reserveUserAiQuota(userId);
  return {
    ai_usage_count: res.ai_usage_count,
    ai_quota_limit: res.ai_quota_limit,
    plan_tier: res.plan_tier,
  };
}

export async function resetUserAiUsage(userId: string): Promise<AppUser> {
  const { period, nextRenewalIso } = getCurrentRiyadhQuotaCycle();
  return updateSupabaseUser(userId, {
    ai_usage_count: 0,
    ai_quota_period: period,
    ai_renewal_date: nextRenewalIso,
  });
}

/**
 * Toggles a user's subscription status via direct single-row lookup (no full-table scan).
 */
export async function toggleUserStatus(
  id: string,
  explicitStatus?: "active" | "suspended",
): Promise<AppUser> {
  const target = await findSupabaseUserById(id);
  if (!target) {
    throw new NotFoundError("المستخدم غير موجود.");
  }
  const newStatus = explicitStatus || (target.status === "suspended" ? "active" : "suspended");
  return updateSupabaseUser(id, { status: newStatus });
}

/**
 * Increments session_version to revoke all active sessions for a user immediately (e.g. on logout).
 */
export async function revokeUserSessions(userId: string): Promise<void> {
  try {
    await updateSupabaseUser(userId, { bump_session_version: true });
  } catch {
    // Ignore if user was already deleted
  }
}
