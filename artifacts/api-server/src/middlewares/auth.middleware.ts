import crypto from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import { env } from "../config/env";
import {
  findSupabaseUserById,
  revokeUserSessions,
  type AppUser,
  type OfficeRole,
  type PlatformRole,
  type UserPermissions,
} from "../services/supabase.service";
import { ExternalServiceError } from "../lib/errors";

export const SESSION_COOKIE_NAME = "court_session_v2";
const LEGACY_COOKIE_NAME = "court_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

export interface AuthSessionPayload {
  jti: string;
  uid: string;
  fp: string;
  iat: number;
  exp: number;
}

export interface AuthenticatedContext {
  userId: string;
  username: string;
  role: PlatformRole;
  officeId: string;
  officeRole: OfficeRole;
  permissions: UserPermissions;
  displayName?: string | null;
  tokenJti?: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: string;
      userId?: string;
      officeId?: string;
      userRole?: PlatformRole;
      officeRole?: OfficeRole;
      userPermissions?: UserPermissions;
      userRecord?: AppUser;
      authContext?: AuthenticatedContext;
      authStoreError?: Error;
    }
  }
}

// Instant in-process revoked JTI set (supplements DB session_version / session_fingerprint)
const revokedJtis = new Map<string, number>();

function cleanupRevokedJtis(): void {
  if (revokedJtis.size < 1000) return;
  const nowSec = Math.floor(Date.now() / 1000);
  for (const [jti, exp] of revokedJtis.entries()) {
    if (nowSec > exp) revokedJtis.delete(jti);
  }
}

function hmacSign(payloadB64: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(payloadB64).digest("base64url");
}

/**
 * Creates a cryptographically signed session token (HMAC-SHA256).
 * Unsigned or tampered tokens are strictly rejected.
 */
export function signSessionToken(user: AppUser): string {
  const nowSec = Math.floor(Date.now() / 1000);
  const payload: AuthSessionPayload = {
    jti: crypto.randomUUID(),
    uid: user.id,
    fp: user.session_fingerprint || String(user.session_version ?? 1),
    iat: nowSec,
    exp: nowSec + SESSION_TTL_SECONDS,
  };
  const payloadB64 = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const sigB64 = hmacSign(payloadB64, env.sessionSecret);
  return `${payloadB64}.${sigB64}`;
}

/**
 * Verifies the HMAC-SHA256 signature and expiration of a session token using timingSafeEqual.
 */
export function verifySessionToken(rawToken: string | undefined | null): AuthSessionPayload | null {
  if (!rawToken || typeof rawToken !== "string") {
    return null;
  }

  // Strictly reject any unsigned JSON or legacy cookie format
  const trimmed = rawToken.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("s:")) {
    return null;
  }

  const parts = trimmed.split(".");
  if (parts.length !== 2) {
    return null;
  }

  const [payloadB64, providedSig] = parts;
  if (!payloadB64 || !providedSig) {
    return null;
  }

  let expectedSig: string;
  try {
    expectedSig = hmacSign(payloadB64, env.sessionSecret);
  } catch {
    return null;
  }

  const providedBuf = Buffer.from(providedSig, "utf8");
  const expectedBuf = Buffer.from(expectedSig, "utf8");
  if (providedBuf.length !== expectedBuf.length) {
    return null;
  }
  if (!crypto.timingSafeEqual(providedBuf, expectedBuf)) {
    return null;
  }

  try {
    const decoded = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8")) as Partial<AuthSessionPayload>;
    if (
      !decoded ||
      typeof decoded.uid !== "string" ||
      !decoded.uid ||
      typeof decoded.jti !== "string" ||
      typeof decoded.fp !== "string" ||
      typeof decoded.exp !== "number"
    ) {
      return null;
    }

    const nowSec = Math.floor(Date.now() / 1000);
    if (nowSec >= decoded.exp) {
      return null;
    }

    if (revokedJtis.has(decoded.jti)) {
      return null;
    }

    return decoded as AuthSessionPayload;
  } catch {
    return null;
  }
}

function readCookieFromRequest(req: Request, name: string): string | undefined {
  const fromParser = (req.cookies as Record<string, string | undefined> | undefined)?.[name];
  if (typeof fromParser === "string" && fromParser.length > 0) {
    return fromParser;
  }

  const header = req.headers.cookie;
  if (!header) return undefined;

  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    if (k === name) {
      try {
        return decodeURIComponent(part.slice(idx + 1).trim());
      } catch {
        return part.slice(idx + 1).trim();
      }
    }
  }
  return undefined;
}

export function createSession(res: Response, user: AppUser): string {
  const token = signSessionToken(user);
  const isSecure = env.isProduction || Boolean(process.env.VERCEL);

  // Clear any legacy unsigned cookie
  res.clearCookie(LEGACY_COOKIE_NAME, { path: "/" });

  res.cookie(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: isSecure,
    sameSite: "lax",
    maxAge: SESSION_TTL_SECONDS * 1000,
    path: "/",
  });
  return token;
}

export async function clearSession(res: Response, req?: Request): Promise<void> {
  if (req) {
    const raw = readCookieFromRequest(req, SESSION_COOKIE_NAME);
    const verified = verifySessionToken(raw);
    if (verified) {
      cleanupRevokedJtis();
      revokedJtis.set(verified.jti, verified.exp);
      await revokeUserSessions(verified.uid);
    } else if (req.userId) {
      await revokeUserSessions(req.userId);
    }
  }

  const isSecure = env.isProduction || Boolean(process.env.VERCEL);
  res.clearCookie(LEGACY_COOKIE_NAME, { path: "/" });
  res.clearCookie(SESSION_COOKIE_NAME, {
    httpOnly: true,
    secure: isSecure,
    sameSite: "lax",
    path: "/",
  });
}

/**
 * Attaches the live, server-verified user identity & role on every request.
 * Never trusts role/status from the cookie; verifies against the authoritative user store.
 */
export async function attachAuthUser(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const rawToken = readCookieFromRequest(req, SESSION_COOKIE_NAME);
  if (!rawToken) {
    next();
    return;
  }

  const tokenPayload = verifySessionToken(rawToken);
  if (!tokenPayload) {
    // Invalid or forged cookie — clear immediately
    res.clearCookie(SESSION_COOKIE_NAME, { path: "/" });
    next();
    return;
  }

  try {
    const liveUser = await findSupabaseUserById(tokenPayload.uid);
    if (!liveUser) {
      // Account deleted — revoke cookie immediately
      res.clearCookie(SESSION_COOKIE_NAME, { path: "/" });
      next();
      return;
    }

    // Verify fingerprint (invalidates session immediately on password, role, or status change)
    if (liveUser.session_fingerprint && tokenPayload.fp !== liveUser.session_fingerprint) {
      res.clearCookie(SESSION_COOKIE_NAME, { path: "/" });
      next();
      return;
    }

    req.userRecord = liveUser;
    req.user = liveUser.username;
    req.userId = liveUser.id;
    req.officeId = liveUser.office_id;
    req.userRole = liveUser.role;
    req.officeRole = liveUser.office_role || "office_manager";
    req.userPermissions = liveUser.permissions || {
      canAccessFinances: true,
      canEditCases: true,
      canManageSettings: liveUser.role === "admin",
    };
    req.authContext = {
      userId: liveUser.id,
      username: liveUser.username,
      role: liveUser.role,
      officeId: liveUser.office_id,
      officeRole: req.officeRole,
      permissions: req.userPermissions,
      displayName: liveUser.display_name,
      tokenJti: tokenPayload.jti,
    };
    next();
  } catch (err) {
    req.authStoreError = err instanceof Error ? err : new ExternalServiceError();
    next();
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (req.authStoreError) {
    res.status(503).json({
      error: "تعذر التحقق من جلسة الدخول حالياً بسبب انقطاع مؤقت في خدمة الحسابات.",
      code: "STORAGE_UNAVAILABLE",
    });
    return;
  }

  if (!req.user || !req.userId || !req.userRecord) {
    res.status(401).json({
      error: "يلزم تسجيل الدخول للوصول إلى هذه الخدمة.",
      code: "UNAUTHORIZED",
    });
    return;
  }

  if (req.userRecord.status === "suspended") {
    res.clearCookie(SESSION_COOKIE_NAME, { path: "/" });
    res.status(403).json({
      error: "تم إيقاف حسابك مؤقتاً من قِبل الإدارة. يرجى التواصل مع المشرف لإعادة التفعيل.",
      code: "SUBSCRIPTION_INACTIVE",
      accountSuspended: true,
    });
    return;
  }

  next();
}

/**
 * Requires verified platform super-admin role from the live user store.
 */
export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (req.authStoreError) {
    res.status(503).json({
      error: "تعذر التحقق من صلاحيات المشرف حالياً.",
      code: "STORAGE_UNAVAILABLE",
    });
    return;
  }

  if (!req.user || !req.userId || !req.userRecord) {
    res.status(401).json({
      error: "يلزم تسجيل الدخول بحساب المشرف العام.",
      code: "UNAUTHORIZED",
    });
    return;
  }

  if (req.userRecord.role !== "admin" || req.userRecord.status === "suspended") {
    res.status(403).json({
      error: "الوصول مرفوض. هذه الصلاحية محصورة بالمشرف العام للمنصة فقط.",
      code: "FORBIDDEN",
    });
    return;
  }

  next();
}

/**
 * Requires either platform admin OR office_manager / settings permission within the user's office.
 */
export function requireOfficeManagerOrAdmin(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (req.authStoreError) {
    res.status(503).json({
      error: "تعذر التحقق من صلاحيات الإدارة حالياً.",
      code: "STORAGE_UNAVAILABLE",
    });
    return;
  }
  if (!req.userRecord) {
    res.status(401).json({ error: "يلزم تسجيل الدخول.", code: "UNAUTHORIZED" });
    return;
  }
  const canManage =
    req.userRecord.role === "admin" ||
    req.officeRole === "office_manager" ||
    Boolean(req.userPermissions?.canManageSettings);

  if (!canManage) {
    res.status(403).json({
      error: "هذه الصلاحية متاحة لمدير المكتب أو المشرف العام فقط.",
      code: "FORBIDDEN",
    });
    return;
  }
  next();
}

export function requirePermission(permission: keyof UserPermissions) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.userRecord) {
      res.status(401).json({ error: "يلزم تسجيل الدخول.", code: "UNAUTHORIZED" });
      return;
    }
    if (req.userRecord.role === "admin" || req.officeRole === "office_manager") {
      next();
      return;
    }
    if (!req.userPermissions?.[permission]) {
      res.status(403).json({
        error: "حسابك في فريق المكتب لا يملك صلاحية تنفيذ هذا الإجراء.",
        code: "FORBIDDEN",
      });
      return;
    }
    next();
  };
}

/**
 * Fail-closed subscription enforcement middleware.
 * Never calls next() when user lookup fails or account is missing/suspended/expired.
 */
export function requireActiveSubscription(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (req.authStoreError) {
    res.status(503).json({
      error: "تعذر التحقق من حالة الاشتراك حالياً. يرجى المحاولة بعد قليل.",
      code: "STORAGE_UNAVAILABLE",
    });
    return;
  }

  const user = req.userRecord;
  if (!user || !req.userId) {
    res.status(401).json({
      error: "يلزم تسجيل الدخول بحساب معتمد.",
      code: "UNAUTHORIZED",
    });
    return;
  }

  if (user.role === "admin") {
    next();
    return;
  }

  if (user.status === "suspended") {
    res.clearCookie(SESSION_COOKIE_NAME, { path: "/" });
    res.status(403).json({
      error: "تم إيقاف اشتراكك مؤقتاً. يرجى التواصل مع الإدارة لتجديد وتفعيل الحساب.",
      code: "SUBSCRIPTION_INACTIVE",
      accountSuspended: true,
    });
    return;
  }

  if (user.subscription_end_date) {
    const parsedEnd = new Date(user.subscription_end_date);
    if (Number.isNaN(parsedEnd.getTime())) {
      res.status(403).json({
        error: "تاريخ صلاحية الاشتراك غير صالح. يرجى مراجعة المشرف العام.",
        code: "SUBSCRIPTION_INACTIVE",
      });
      return;
    }
    // If date-only YYYY-MM-DD, allow through the end of that day in Riyadh time (UTC+3)
    const isDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(user.subscription_end_date.trim());
    const effectiveEndMs = isDateOnly
      ? parsedEnd.getTime() + 24 * 3600 * 1000 - 1
      : parsedEnd.getTime();

    if (Date.now() > effectiveEndMs) {
      res.status(403).json({
        error:
          "انتهت فترة اشتراكك في المنظومة. تم إيقاف تعديل السجلات وتصدير التقارير والذكاء الاصطناعي لحين تجديد الاشتراك.",
        code: "SUBSCRIPTION_INACTIVE",
        subscriptionExpired: true,
        expiredAt: user.subscription_end_date,
      });
      return;
    }
  }

  next();
}
