/**
 * Utilities to parse Hijri hearing dates/times (as they appear in Saudi
 * court SMS notices, e.g. "27/01/1448" + "12:30 مساء") and convert them to
 * a real JavaScript Date so the reminder scheduler can compute "24 hours
 * before" / "6 hours before" windows.
 *
 * All date/time calculations use Mecca time (Asia/Makkah = UTC+3).
 * Saudi Arabia has no daylight-saving time, so the offset is always +3.
 *
 * The conversion uses `moment-hijri` which accurately implements the
 * Umm al-Qura calendar used in Saudi Arabia.
 */

import moment from "moment-hijri";
import { env } from "../config/env";

function normalizeDigits(input: string): string {
  return input
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
}

export interface HijriDate {
  year: number;
  month: number; // 1-12
  day: number;
}

/** Parses a "DD/MM/YYYY" (or "D/M/YYYY") Hijri date string. Returns null if unparseable. */
export function parseHijriDateString(input: string | null | undefined): HijriDate | null {
  if (!input || typeof input !== "string") {
    return null;
  }
  const normalized = normalizeDigits(input.trim());
  if (!normalized) {
    return null;
  }

  // Pass single format strings instead of an array because `moment-hijri`'s array-format overload returns `undefined` when none match
  const formats = [
    "iDD/iMM/iYYYY",
    "iD/iM/iYYYY",
    "iDD-iMM-iYYYY",
    "iD-iM-iYYYY",
    "iYYYY/iMM/iDD",
    "iYYYY-iMM-iDD",
  ];

  // Try strict parsing first
  for (const fmt of formats) {
    try {
      const m = moment(normalized, fmt, true);
      if (m && typeof m.isValid === "function" && m.isValid()) {
        const year = m.iYear();
        const month = m.iMonth() + 1;
        const day = m.iDate();
        if (!isNaN(year) && !isNaN(month) && !isNaN(day) && year > 1300 && year < 1600 && month >= 1 && month <= 12 && day >= 1 && day <= 30) {
          return { year, month, day };
        }
      }
    } catch {
      // ignore parsing error for single format
    }
  }

  // Try non-strict parsing as fallback
  for (const fmt of formats) {
    try {
      const m = moment(normalized, fmt);
      if (m && typeof m.isValid === "function" && m.isValid()) {
        const year = m.iYear();
        const month = m.iMonth() + 1;
        const day = m.iDate();
        if (!isNaN(year) && !isNaN(month) && !isNaN(day) && year > 1300 && year < 1600 && month >= 1 && month <= 12 && day >= 1 && day <= 30) {
          return { year, month, day };
        }
      }
    } catch {
      // ignore
    }
  }

  return null;
}

export interface ParsedTime {
  hours: number; // 0-23
  minutes: number; // 0-59
}

/** Parses a time string with Arabic AM/PM markers (صباحا / مساء / م / ص) or plain AM/PM or 24-hour format. Returns null if unparseable. */
export function parseArabicTime(input: string | null | undefined): ParsedTime | null {
  if (!input || typeof input !== "string") {
    return null;
  }
  const normalized = normalizeDigits(input.trim());
  if (!normalized) {
    return null;
  }

  // Detect AM/PM indicators
  const isArabicPm = /م(?!ص)/.test(normalized) || /مساء/.test(normalized);
  const isArabicAm = /ص/.test(normalized) || /صباح/.test(normalized);
  const isPm = /pm/i.test(normalized) || isArabicPm;
  const isAm = /am/i.test(normalized) || isArabicAm;

  let hours: number | null = null;
  let minutes = 0;

  // Try parsing HH:MM or HH.MM (e.g. "06:00", "6:30", "6.30", "18:00")
  const matchColonOrDot = normalized.match(/(\d{1,2})[:\.](\d{2})/);
  if (matchColonOrDot) {
    hours = Number(matchColonOrDot[1]);
    minutes = Number(matchColonOrDot[2]);
  } else {
    // Try parsing single or double digit hour (e.g. "6 م", "06 م", "6م", "6 مساء", "18")
    const matchHourOnly = normalized.match(/(\d{1,2})/);
    if (matchHourOnly) {
      hours = Number(matchHourOnly[1]);
      minutes = 0;
    }
  }

  if (hours === null || isNaN(hours) || isNaN(minutes) || hours > 23 || minutes > 59) {
    return null;
  }

  // Adjust hours for 12-hour vs 24-hour notation
  if (isPm && !isAm) {
    if (hours < 12) {
      hours += 12;
    }
  } else if (isAm) {
    if (hours === 12) {
      hours = 0;
    }
  } else {
    // If no AM/PM marker is specified:
    // In Saudi court context, working hours are daytime/afternoon.
    // Hours 1..6 without AM/PM almost certainly refer to PM (13:00..18:00 e.g. 6:00 PM).
    if (hours >= 1 && hours <= 6) {
      hours += 12;
    }
  }

  return { hours, minutes };
}


export function hijriToGregorian(hijri: HijriDate): {
  year: number;
  month: number;
  day: number;
} | null {
  try {
    const dateString = `${hijri.year}/${String(hijri.month).padStart(2, "0")}/${String(hijri.day).padStart(2, "0")}`;
    const m = moment(dateString, "iYYYY/iMM/iDD");
    if (!m || typeof m.isValid !== "function" || !m.isValid()) {
      return null;
    }
    const year = m.year();
    const month = m.month() + 1;
    const day = m.date();
    if (isNaN(year) || isNaN(month) || isNaN(day)) {
      return null;
    }
    return { year, month, day };
  } catch {
    return null;
  }
}

/**
 * Converts a Gregorian Date object to the corresponding Hijri
 * calendar date using Umm al-Qura. Uses UTC date components.
 */
export function gregorianToHijri(date: Date): HijriDate {
  // Convert UTC components into a moment representation ignoring timezone shifts
  const m = moment([date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()]);
  return {
    year: m.iYear(),
    month: m.iMonth() + 1,
    day: m.iDate(),
  };
}

/**
 * Returns the current date as a Hijri date string "DD/MM/YYYY" using
 * Mecca time (Asia/Makkah = UTC+3).
 */
export function currentHijriDateString(): string {
  const offsetHours = env.courtTimezoneOffsetHours; // UTC+3 = Mecca time
  // Shift the time to Mecca local timezone
  const localNow = new Date(Date.now() + offsetHours * 3600 * 1000);
  const h = gregorianToHijri(localNow);
  const dd = String(h.day).padStart(2, "0");
  const mm = String(h.month).padStart(2, "0");
  return `${dd}/${mm}/${h.year}`;
}

/**
 * Combines a Hijri date string and an Arabic/English time string into a
 * concrete UTC `Date` representing the hearing instant, assuming
 * Mecca time (Asia/Makkah = UTC+3, no DST).
 *
 * If `sessionTime` is not provided, defaults to noon (12:00) in Mecca time
 * so that hearingAt is never null for date-only sessions.
 *
 * Returns null if the Hijri date cannot be parsed.
 */
export interface CalendarDate {
  year: number;
  month: number;
  day: number;
}

export function parseGregorianDateString(input: string | null | undefined): CalendarDate | null {
  if (!input || typeof input !== "string") {
    return null;
  }
  const normalized = normalizeDigits(input.trim());
  if (!normalized) {
    return null;
  }

  // Format 1: YYYY-MM-DD or YYYY/MM/DD
  const ymdMatch = normalized.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (ymdMatch) {
    const year = Number(ymdMatch[1]);
    const month = Number(ymdMatch[2]);
    const day = Number(ymdMatch[3]);
    if (year >= 1900 && year <= 2100 && month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return { year, month, day };
    }
  }

  // Format 2: DD/MM/YYYY or DD-MM-YYYY
  const dmyMatch = normalized.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (dmyMatch) {
    const day = Number(dmyMatch[1]);
    const month = Number(dmyMatch[2]);
    const year = Number(dmyMatch[3]);
    if (year >= 1900 && year <= 2100 && month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return { year, month, day };
    }
  }

  return null;
}

export function computeHearingDateTime(
  sessionDateHijri: string | null | undefined,
  sessionTime: string | null | undefined,
): Date | null {
  if (!sessionDateHijri) {
    return null;
  }
  try {
    const offsetHours = env.courtTimezoneOffsetHours;

    let timeHours = 23;
    let timeMinutes = 59;
    if (sessionTime) {
      const time = parseArabicTime(sessionTime);
      if (time) {
        timeHours = time.hours;
        timeMinutes = time.minutes;
      }
    }

    // 1. Support Gregorian date (used in Palestinian, Jordanian, Egyptian and many Arab courts)
    const greg = parseGregorianDateString(sessionDateHijri);
    if (greg) {
      const hearingDate = new Date(
        Date.UTC(
          greg.year,
          greg.month - 1,
          greg.day,
          timeHours - offsetHours,
          timeMinutes,
        ),
      );
      return isNaN(hearingDate.getTime()) ? null : hearingDate;
    }

    // 2. Support Hijri date (e.g. Saudi courts, Umm al-Qura calendar)
    const hijriDate = parseHijriDateString(sessionDateHijri);
    if (!hijriDate) {
      return null;
    }
    const gregorian = hijriToGregorian(hijriDate);
    if (!gregorian) {
      return null;
    }

    const hearingDate = new Date(
      Date.UTC(
        gregorian.year,
        gregorian.month - 1,
        gregorian.day,
        timeHours - offsetHours,
        timeMinutes,
      ),
    );
    return isNaN(hearingDate.getTime()) ? null : hearingDate;
  } catch {
    return null;
  }
}
