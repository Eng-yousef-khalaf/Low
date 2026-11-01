import moment from "moment-hijri";
import { ValidationError } from "../lib/errors";

/**
 * Normalizes Eastern Arabic (٠-٩) and Persian (۰-۹) digits to ASCII (0-9).
 */
export function normalizeNumericDigits(input: string | null | undefined): string {
  if (!input) return "";
  return String(input)
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
}

export interface ValidatedCourtDate {
  valid: boolean;
  normalized: string;
  calendar: "hijri" | "gregorian";
  isoTimestamp?: number;
  error?: string;
}

export interface CourtDateValidationOptions {
  fieldName?: string;
  required?: boolean;
  preferredCalendar?: "hijri" | "gregorian" | "auto";
}

/**
 * Non-throwing date inspection helper returning `{ valid, normalized, calendar, isoTimestamp, error }`.
 */
export function inspectCourtDate(
  rawInput: string | null | undefined,
  options: CourtDateValidationOptions = {},
): ValidatedCourtDate {
  const { fieldName, required = false, preferredCalendar = "auto" } = options;
  const label = fieldName ? `(${fieldName})` : "";
  const trimmed = normalizeNumericDigits(rawInput).trim();

  if (!trimmed) {
    if (required) {
      return {
        valid: false,
        normalized: "",
        calendar: preferredCalendar === "gregorian" ? "gregorian" : "hijri",
        error: `يرجى إدخال التاريخ المطلوب ${label}.`.replace(/\s+\./, "."),
      };
    }
    return {
      valid: true,
      normalized: "",
      calendar: preferredCalendar === "gregorian" ? "gregorian" : "hijri",
    };
  }

  // Strip trailing هـ or م markers
  const cleaned = trimmed.replace(/[هـم]/g, "").trim();
  const matchParts = cleaned.match(/^(\d{1,4})[\/\-.](\d{1,2})[\/\-.](\d{1,4})$/);
  if (!matchParts) {
    return {
      valid: false,
      normalized: trimmed,
      calendar: "hijri",
      error: `صيغة التاريخ ${label} غير صحيحة. استخدم يوم/شهر/سنة (مثال: 15/02/1448 أو 25/10/2026).`.replace(/\s+/g, " "),
    };
  }

  let day: number;
  let month: number;
  let year: number;

  if (matchParts[1].length === 4) {
    year = Number(matchParts[1]);
    month = Number(matchParts[2]);
    day = Number(matchParts[3]);
  } else if (matchParts[3].length === 4) {
    day = Number(matchParts[1]);
    month = Number(matchParts[2]);
    year = Number(matchParts[3]);
  } else {
    return {
      valid: false,
      normalized: trimmed,
      calendar: "hijri",
      error: "يجب كتابة السنة من 4 أرقام (مثال: 1448 أو 2026).",
    };
  }

  if (!Number.isInteger(day) || !Number.isInteger(month) || !Number.isInteger(year)) {
    return {
      valid: false,
      normalized: trimmed,
      calendar: "hijri",
      error: "التاريخ يحتوي على قيم غير رقمية.",
    };
  }

  const isHijriCandidate =
    preferredCalendar === "hijri" || (preferredCalendar === "auto" && year < 1700);

  if (isHijriCandidate) {
    if (year < 1300 || year > 1550) {
      return {
        valid: false,
        normalized: trimmed,
        calendar: "hijri",
        error: "السنة الهجرية خارج النطاق المسموح (1300 - 1550 هـ).",
      };
    }
    if (month < 1 || month > 12) {
      return {
        valid: false,
        normalized: trimmed,
        calendar: "hijri",
        error: "الشهر الهجري يجب أن يكون بين 1 و 12.",
      };
    }
    if (day < 1 || day > 30) {
      return {
        valid: false,
        normalized: trimmed,
        calendar: "hijri",
        error: "اليوم الهجري يجب أن يكون بين 1 و 30.",
      };
    }
    try {
      const m = moment(`${year}/${month}/${day}`, "iYYYY/iM/iD");
      if (!m || !m.isValid()) {
        return {
          valid: false,
          normalized: trimmed,
          calendar: "hijri",
          error: "التاريخ الهجري المدخل غير صالح في تقويم أم القرى.",
        };
      }
      const norm = `${String(day).padStart(2, "0")}/${String(month).padStart(2, "0")}/${year}`;
      return {
        valid: true,
        normalized: norm,
        calendar: "hijri",
        isoTimestamp: m.toDate().getTime(),
      };
    } catch {
      return {
        valid: false,
        normalized: trimmed,
        calendar: "hijri",
        error: "تعذر التحقق من التاريخ الهجري.",
      };
    }
  }

  // Gregorian validation
  if (year < 1900 || year > 2100) {
    return {
      valid: false,
      normalized: trimmed,
      calendar: "gregorian",
      error: "السنة الميلادية خارج النطاق المسموح (1900 - 2100 م).",
    };
  }
  if (month < 1 || month > 12) {
    return {
      valid: false,
      normalized: trimmed,
      calendar: "gregorian",
      error: "الشهر الميلادي يجب أن يكون بين 1 و 12.",
    };
  }
  const maxDays = new Date(year, month, 0).getDate();
  if (day < 1 || day > maxDays) {
    return {
      valid: false,
      normalized: trimmed,
      calendar: "gregorian",
      error: `اليوم الميلادي غير صالح لهذا الشهر (المسموح من 1 إلى ${maxDays}).`,
    };
  }

  const utcTime = Date.UTC(year, month - 1, day);
  const norm = `${String(day).padStart(2, "0")}/${String(month).padStart(2, "0")}/${year}`;
  return {
    valid: true,
    normalized: norm,
    calendar: "gregorian",
    isoTimestamp: utcTime,
  };
}

/**
 * Validates and normalizes either a Hijri (1300..1550) or Gregorian (1900..2100) date string.
 * Accepts Eastern Arabic / Persian digits and '/', '-', '.' separators in DD/MM/YYYY or YYYY-MM-DD order.
 * Throws `ValidationError` (400) if invalid, and returns the canonical `DD/MM/YYYY` string (or `""` if empty & optional).
 */
export function validateAndNormalizeCourtDate(
  rawInput: string | null | undefined,
  options: CourtDateValidationOptions = {},
): string {
  const res = inspectCourtDate(rawInput, options);
  if (!res.valid) {
    throw new ValidationError(res.error || "صيغة التاريخ المدخل غير صالحة.");
  }
  return res.normalized;
}

/**
 * Validates Strong Password Policy (unified across admin, lawyer, and team accounts).
 */
export function validatePasswordStrength(password: string | null | undefined): {
  valid: boolean;
  error?: string;
} {
  if (!password || typeof password !== "string") {
    return { valid: false, error: "كلمة المرور مطلوبة." };
  }
  const trimmed = password.trim();
  if (trimmed.length < 8) {
    return {
      valid: false,
      error: "كلمة المرور يجب أن تتكون من 8 خانات على الأقل.",
    };
  }
  if (trimmed.length > 128) {
    return {
      valid: false,
      error: "كلمة المرور طويلة جداً (الحد الأقصى 128 خانة).",
    };
  }
  const hasLetter = /[A-Za-z\u0600-\u06FF]/.test(trimmed);
  const hasDigit = /\d/.test(normalizeNumericDigits(trimmed));
  if (!hasLetter || !hasDigit) {
    return {
      valid: false,
      error: "كلمة المرور يجب أن تحتوي على أحرف وأرقام معاً لزيادة الأمان.",
    };
  }
  return { valid: true };
}
