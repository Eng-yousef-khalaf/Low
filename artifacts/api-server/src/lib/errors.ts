import crypto from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import { ZodError } from "@workspace/api-zod";
import { logger } from "./logger";

export type ErrorCode =
  | "VALIDATION_ERROR"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "SUBSCRIPTION_INACTIVE"
  | "QUOTA_EXCEEDED"
  | "AI_QUOTA_EXCEEDED"
  | "NOT_FOUND"
  | "CONFLICT"
  | "OFFICE_LINK_INCOMPLETE"
  | "RATE_LIMITED"
  | "UPSTREAM_UNAVAILABLE"
  | "STORAGE_UNAVAILABLE"
  | "INTERNAL_ERROR";

export function generateReferenceCode(prefix = "ERR"): string {
  const ts = Date.now().toString(36).toUpperCase().slice(-5);
  const rand = crypto.randomBytes(3).toString("hex").toUpperCase();
  return `${prefix}-${ts}-${rand}`;
}

export class AppError extends Error {
  readonly statusCode: number;
  readonly code: ErrorCode;
  readonly referenceCode: string;
  readonly details?: Record<string, unknown>;

  constructor(
    statusCode: number,
    code: ErrorCode,
    message: string,
    details?: Record<string, unknown>,
    referenceCode?: string,
  ) {
    super(message);
    Object.setPrototypeOf(this, new.target.prototype);
    this.name = "AppError";
    this.statusCode = statusCode;
    this.code = code;
    this.referenceCode = referenceCode ?? generateReferenceCode();
    this.details = details;
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(400, "VALIDATION_ERROR", message, details, generateReferenceCode("VAL"));
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "انتهت صلاحية الجلسة أو لم يتم تسجيل الدخول. يرجى تسجيل الدخول مجدداً.") {
    super(401, "UNAUTHORIZED", message, undefined, generateReferenceCode("AUTH"));
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "ليس لديك صلاحية لتنفيذ هذا الإجراء.", code: ErrorCode = "FORBIDDEN", details?: Record<string, unknown>) {
    super(403, code, message, details, generateReferenceCode("PERM"));
  }
}

export class NotFoundError extends AppError {
  constructor(message = "السجل المطلوب غير موجود أو لا يتبع لمكتبك.") {
    super(404, "NOT_FOUND", message, undefined, generateReferenceCode("NFD"));
  }
}

export class ConflictError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(409, "CONFLICT", message, details, generateReferenceCode("CNF"));
  }
}

export class OfficeLinkIncompleteError extends AppError {
  constructor(
    message = "ربط المكتب غير مكتمل. يرجى التواصل مع المشرف لإتمام ربط جدول البيانات الخاص بالمكتب.",
    details?: Record<string, unknown>,
  ) {
    super(422, "OFFICE_LINK_INCOMPLETE", message, details, generateReferenceCode("LNK"));
  }
}

export class RateLimitError extends AppError {
  constructor(message: string, retryAfterSeconds?: number) {
    super(
      429,
      "RATE_LIMITED",
      message,
      retryAfterSeconds ? { retryAfterSeconds } : undefined,
      generateReferenceCode("RLM"),
    );
  }
}

export class ExternalServiceError extends AppError {
  constructor(
    message = "تعذر الاتصال بمصدر البيانات حالياً. يرجى المحاولة بعد لحظات.",
    code: ErrorCode = "UPSTREAM_UNAVAILABLE",
  ) {
    super(503, code, message, undefined, generateReferenceCode("SVC"));
  }
}

/**
 * Formats Zod validation issues into clean, safe Arabic messages without exposing internal field names.
 */
export function formatZodErrorArabic(err: ZodError): string {
  const first = err.issues[0];
  if (!first) return "البيانات المدخلة غير صالحة. يرجى مراجعة الحقول المطلوبة.";
  if (first.message && /[\u0600-\u06FF]/.test(first.message)) {
    return first.message;
  }
  return "بعض الحقول المدخلة غير مكتملة أو بتنسيق غير صحيح. يرجى التحقق والمحاولة مجدداً.";
}

/**
 * Unified Express error-handling middleware.
 * Never leaks stack traces, SQL schemas, or internal field identifiers.
 */
export function errorHandlerMiddleware(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (res.headersSent) {
    return;
  }

  if (err instanceof AppError) {
    if (err.statusCode >= 500) {
      logger.error(
        {
          referenceCode: err.referenceCode,
          code: err.code,
          statusCode: err.statusCode,
          method: req.method,
          path: req.originalUrl,
        },
        "Handled server error",
      );
    }
    res.status(err.statusCode).json({
      error: err.message,
      code: err.code,
      referenceCode: err.referenceCode,
      ...(err.details ? err.details : {}),
    });
    return;
  }

  if (err instanceof ZodError) {
    const referenceCode = generateReferenceCode("VAL");
    res.status(400).json({
      error: formatZodErrorArabic(err),
      code: "VALIDATION_ERROR",
      referenceCode,
    });
    return;
  }

  const referenceCode = generateReferenceCode("SYS");
  const rawMessage = err instanceof Error ? err.message : "Unknown error";

  logger.error(
    {
      referenceCode,
      method: req.method,
      path: req.originalUrl,
      errName: err instanceof Error ? err.name : typeof err,
      errMsg: rawMessage.slice(0, 200),
    },
    "Unhandled API error",
  );

  res.status(500).json({
    error: `حدث خطأ غير متوقع أثناء معالجة الطلب. الرقم المرجعي: ${referenceCode}`,
    code: "INTERNAL_ERROR",
    referenceCode,
  });
}
