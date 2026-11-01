/**
 * Unified Date Validation and Formatting Utilities
 * Handles Hijri and Gregorian validation, comparison, and human-friendly display.
 */

import moment from 'moment-hijri';

export type CalendarType = 'hijri' | 'gregorian';

export interface DateValidationResult {
  isValid: boolean;
  message?: string;
  normalized?: string;
  year?: number;
  month?: number;
  day?: number;
}

const ARABIC_MONTHS_GREGORIAN = [
  'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
  'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'
];

const ARABIC_MONTHS_HIJRI = [
  'محرم', 'صفر', 'ربيع الأول', 'ربيع الآخر',
  'جمادى الأولى', 'جمادى الآخرة', 'رجب', 'شعبان',
  'رمضان', 'شوال', 'ذو القعدة', 'ذو الحجة'
];

export function normalizeArabicDigits(str: string | null | undefined): string {
  if (!str) return '';
  return String(str)
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 1632))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 1776));
}

export const normalizeArabicNumerals = normalizeArabicDigits;

/**
 * Validates a date string for either Hijri or Gregorian format.
 * Accepted separators: '/', '-', '.'
 * Supports both DD/MM/YYYY and YYYY/MM/DD and Arabic numerals.
 */
export function validateDateInput(
  rawDate: string | null | undefined,
  type: CalendarType = 'hijri'
): DateValidationResult {
  if (!rawDate || !String(rawDate).trim()) {
    return { isValid: false, message: 'يرجى إدخال التاريخ' };
  }

  const normalized = normalizeArabicDigits(String(rawDate).trim());
  const clean = normalized.replace(/[^\d\/\.\-]/g, '');
  const parts = clean.split(/[\/\.\-]/);

  if (parts.length !== 3) {
    return {
      isValid: false,
      message: type === 'hijri'
        ? 'تنسيق التاريخ غير صحيح. يرجى استخدام التنسيق: يوم/شهر/سنة (مثال: 15/02/1448)'
        : 'تنسيق التاريخ غير صحيح. يرجى استخدام التنسيق: يوم/شهر/سنة (مثال: 25/10/2026)',
    };
  }

  let day: number, month: number, year: number;
  if (parts[0].length === 4) {
    year = parseInt(parts[0], 10);
    month = parseInt(parts[1], 10);
    day = parseInt(parts[2], 10);
  } else {
    day = parseInt(parts[0], 10);
    month = parseInt(parts[1], 10);
    year = parseInt(parts[2], 10);
  }

  if (isNaN(day) || isNaN(month) || isNaN(year)) {
    return { isValid: false, message: 'التاريخ يحتوي على قيم غير رقمية' };
  }

  if (type === 'hijri') {
    if (year < 1300 || year > 1550) {
      return {
        isValid: false,
        message: 'سنة هجرية غير منطقية (المسموح بين 1300 و 1550 هـ)',
      };
    }
    if (month < 1 || month > 12) {
      return { isValid: false, message: 'رقم الشهر الهجري يجب أن يكون بين 1 و 12' };
    }
    if (day < 1 || day > 30) {
      return { isValid: false, message: 'يوم الشهر الهجري يجب أن يكون بين 1 و 30' };
    }

    try {
      const m = moment(`${year}/${month}/${day}`, 'iYYYY/iM/iD');
      if (!m.isValid()) {
        return { isValid: false, message: 'تاريخ هجري غير صالح في التقويم' };
      }
    } catch {
      return { isValid: false, message: 'تاريخ هجري غير صالح' };
    }

    const norm = `${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}/${year}`;
    return { isValid: true, normalized: norm, year, month, day };
  } else {
    // Gregorian
    if (year < 1900 || year > 2100) {
      return {
        isValid: false,
        message: 'سنة ميلادية غير منطقية (المسموح بين 1900 و 2100 م)',
      };
    }
    if (month < 1 || month > 12) {
      return { isValid: false, message: 'رقم الشهر الميلادي يجب أن يكون بين 1 و 12' };
    }
    const daysInMonth = new Date(year, month, 0).getDate();
    if (day < 1 || day > daysInMonth) {
      return {
        isValid: false,
        message: `يوم غير صالح لهذا الشهر (المسموح حتى ${daysInMonth})`,
      };
    }

    const norm = `${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}/${year}`;
    return { isValid: true, normalized: norm, year, month, day };
  }
}

/**
 * Checks if dateA is before dateB (chronologically).
 * Returns true if dateA < dateB, false otherwise.
 * Both dates must be parseable.
 */
export function isDateBefore(dateAStr: string, dateBStr: string): boolean {
  try {
    const parseA = parseToTimestamp(dateAStr);
    const parseB = parseToTimestamp(dateBStr);
    if (parseA !== null && parseB !== null) {
      return parseA < parseB;
    }
  } catch {}
  return false;
}

function parseToTimestamp(str: string): number | null {
  if (!str || !str.trim()) return null;
  const parts = str.trim().split(/[\/\.\-]/);
  if (parts.length !== 3) return null;

  let day: number, month: number, year: number;
  if (parts[0].length === 4) {
    year = parseInt(parts[0], 10);
    month = parseInt(parts[1], 10);
    day = parseInt(parts[2], 10);
  } else {
    day = parseInt(parts[0], 10);
    month = parseInt(parts[1], 10);
    year = parseInt(parts[2], 10);
  }

  if (isNaN(day) || isNaN(month) || isNaN(year)) return null;

  // If year > 1700, interpret as Gregorian
  if (year > 1700) {
    return new Date(year, month - 1, day).getTime();
  }

  // Hijri conversion to Gregorian timestamp via moment-hijri
  try {
    const m = moment(`${year}/${month}/${day}`, 'iYYYY/iM/iD');
    if (m.isValid()) {
      return m.toDate().getTime();
    }
  } catch {}

  return null;
}

/**
 * Formats a subscription date or any ISO date string into beautiful Arabic:
 * e.g. "ينتهي الاشتراك في 13 أكتوبر 2027 — متبقي 352 يوماً"
 */
export function formatFriendlySubscriptionDate(dateStr: string | null | undefined): {
  formattedDate: string;
  daysRemaining: number | null;
  text: string;
  isExpiringSoon: boolean;
  isExpired: boolean;
} {
  if (!dateStr || !dateStr.trim()) {
    return {
      formattedDate: 'غير محدد',
      daysRemaining: null,
      text: 'اشتراك دائم مفتوح',
      isExpiringSoon: false,
      isExpired: false,
    };
  }

  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) {
      return {
        formattedDate: dateStr,
        daysRemaining: null,
        text: dateStr,
        isExpiringSoon: false,
        isExpired: false,
      };
    }

    const day = d.getDate();
    const month = ARABIC_MONTHS_GREGORIAN[d.getMonth()] || '';
    const year = d.getFullYear();
    const formattedDate = `${day} ${month} ${year}`;

    const diffMs = d.getTime() - Date.now();
    const daysRemaining = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
    const isExpired = daysRemaining < 0;
    const isExpiringSoon = !isExpired && daysRemaining <= 30;

    let text = '';
    if (isExpired) {
      text = `انتهى الاشتراك في ${formattedDate} (منذ ${Math.abs(daysRemaining)} يوم)`;
    } else if (daysRemaining === 0) {
      text = `ينتهي الاشتراك اليوم في ${formattedDate}`;
    } else {
      text = `ينتهي الاشتراك في ${formattedDate} — متبقي ${daysRemaining} يوماً`;
    }

    return {
      formattedDate,
      daysRemaining,
      text,
      isExpiringSoon,
      isExpired,
    };
  } catch {
    return {
      formattedDate: dateStr,
      daysRemaining: null,
      text: dateStr,
      isExpiringSoon: false,
      isExpired: false,
    };
  }
}
