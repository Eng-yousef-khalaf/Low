import fs from "node:fs";
import path from "node:path";
import type { Request, Response, NextFunction } from "express";
import { getSupabaseClient, isSupabaseConfigured } from "../services/supabase.service";

interface RateBucket {
  count: number;
  resetAt: number;
}

const DATA_DIR = path.resolve(process.cwd(), ".data");
const RATE_FILE = path.join(DATA_DIR, "rate_limits.json");
const isStatelessProd =
  process.env.NODE_ENV === "production" &&
  (Boolean(process.env.VERCEL) || Boolean(process.env.AWS_LAMBDA_FUNCTION_NAME));

const memoryBuckets = new Map<string, RateBucket>();

function loadSharedLocalBuckets(): Map<string, RateBucket> {
  if (isStatelessProd) return memoryBuckets;
  try {
    if (fs.existsSync(RATE_FILE)) {
      const raw = JSON.parse(fs.readFileSync(RATE_FILE, "utf8")) as Record<string, RateBucket>;
      const now = Date.now();
      for (const [k, v] of Object.entries(raw)) {
        if (v && typeof v.resetAt === "number" && v.resetAt > now) {
          memoryBuckets.set(k, v);
        }
      }
    }
  } catch {
    // fallback to memory map
  }
  return memoryBuckets;
}

function saveSharedLocalBuckets(): void {
  if (isStatelessProd) return;
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    const now = Date.now();
    const obj: Record<string, RateBucket> = {};
    for (const [k, v] of memoryBuckets.entries()) {
      if (v.resetAt > now) {
        obj[k] = v;
      } else {
        memoryBuckets.delete(k);
      }
    }
    fs.writeFileSync(RATE_FILE, JSON.stringify(obj), "utf8");
  } catch {
    // ignore disk errors
  }
}

export function resolveClientIp(req: Request): string {
  // Rely on Express req.ip (configured via app.set("trust proxy", 1))
  const ip = req.ip || req.socket?.remoteAddress || "unknown";
  return ip.replace(/^::ffff:/, "").slice(0, 64);
}

async function incrementSharedBucket(
  bucketKey: string,
  windowMs: number,
): Promise<RateBucket> {
  const now = Date.now();

  if (isSupabaseConfigured()) {
    try {
      const client = getSupabaseClient();
      if (client) {
        const { data } = await client
          .from("rate_limits")
          .select("count, reset_at")
          .eq("key", bucketKey)
          .maybeSingle();

        if (data && Number(data.reset_at) > now) {
          const nextCount = Number(data.count || 0) + 1;
          await client
            .from("rate_limits")
            .update({ count: nextCount })
            .eq("key", bucketKey);
          return { count: nextCount, resetAt: Number(data.reset_at) };
        } else {
          const resetAt = now + windowMs;
          const { error } = await client
            .from("rate_limits")
            .upsert({ key: bucketKey, count: 1, reset_at: resetAt }, { onConflict: "key" });
          if (!error) {
            return { count: 1, resetAt };
          }
        }
      }
    } catch {
      // Optional table; fall back to local/memory bucket
    }
  }

  const store = loadSharedLocalBuckets();
  const existing = store.get(bucketKey);
  if (!existing || now > existing.resetAt) {
    const fresh: RateBucket = { count: 1, resetAt: now + windowMs };
    store.set(bucketKey, fresh);
    saveSharedLocalBuckets();
    return fresh;
  }

  existing.count += 1;
  store.set(bucketKey, existing);
  saveSharedLocalBuckets();
  return existing;
}

export async function clearRateLimitForLogin(req: Request, username?: string): Promise<void> {
  const ip = resolveClientIp(req);
  const userPart = (username || "").trim().toLowerCase();
  const keys = [`login:user:${ip}:${userPart}`, `admin_login:user:${ip}:${userPart}`];

  for (const key of keys) {
    memoryBuckets.delete(key);
    if (isSupabaseConfigured()) {
      try {
        const client = getSupabaseClient();
        await client?.from("rate_limits").delete().eq("key", key);
      } catch {
        // ignore
      }
    }
  }
  saveSharedLocalBuckets();
}

export function createRateLimiter(options: {
  windowMs: number;
  maxRequests: number;
  message?: string;
  keyPrefix?: string;
  includeUsername?: boolean;
}) {
  const {
    windowMs,
    maxRequests,
    message = "تم تجاوز الحد المسموح من الطلبات. يرجى الانتظار قليلاً والمحاولة مجدداً.",
    keyPrefix = "rl",
    includeUsername = false,
  } = options;

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const ip = resolveClientIp(req);
      const rawUsername =
        includeUsername && req.body && typeof req.body.username === "string"
          ? req.body.username.trim().toLowerCase().slice(0, 64)
          : "";

      // Check IP-level ceiling (3x per-account limit to allow shared office NAT while blocking sprays)
      const ipBucket = await incrementSharedBucket(
        `${keyPrefix}:ip:${ip}`,
        windowMs,
      );
      const ipCeiling = includeUsername ? maxRequests * 3 : maxRequests;

      let effectiveBucket = ipBucket;
      let blocked = ipBucket.count > ipCeiling;

      if (!blocked && includeUsername && rawUsername) {
        const userBucket = await incrementSharedBucket(
          `${keyPrefix}:user:${ip}:${rawUsername}`,
          windowMs,
        );
        effectiveBucket = userBucket;
        if (userBucket.count > maxRequests) {
          blocked = true;
        }
      } else if (!includeUsername && ipBucket.count > maxRequests) {
        blocked = true;
      }

      if (blocked) {
        const retryAfterSec = Math.max(
          1,
          Math.ceil((effectiveBucket.resetAt - Date.now()) / 1000),
        );
        res.setHeader("Retry-After", String(retryAfterSec));
        res.status(429).json({
          error: message,
          code: "RATE_LIMITED",
          retryAfterSeconds: retryAfterSec,
        });
        return;
      }

      next();
    } catch (err) {
      next(err);
    }
  };
}

export const loginRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutes
  maxRequests: 8,
  keyPrefix: "login",
  includeUsername: true,
  message: "محاولات تسجيل دخول متكررة. تم تقييد المحاولات مؤقتاً لحماية الحساب؛ يرجى المحاولة بعد 15 دقيقة.",
});

export const adminLoginRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutes
  maxRequests: 6,
  keyPrefix: "admin_login",
  includeUsername: true,
  message: "تم تجاوز الحد الأقصى لمحاولات دخول المشرف. يرجى الانتظار 15 دقيقة قبل المحاولة مجدداً.",
});

export const aiRateLimiter = createRateLimiter({
  windowMs: 60 * 1000, // 1 minute
  maxRequests: 15,
  keyPrefix: "ai",
  message: "طلبات تحليل متتالية بسرعة عالية. يرجى الانتظار بضع ثوانٍ ثم المحاولة.",
});

export function resetAllRateLimitsForTesting(): void {
  memoryBuckets.clear();
  try {
    if (fs.existsSync(RATE_FILE)) fs.unlinkSync(RATE_FILE);
  } catch {
    // ignore
  }
}
