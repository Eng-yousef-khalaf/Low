import cron from "node-cron";
import { env } from "../config/env";
import { getSettings } from "../config/settings-store";
import { logger } from "../lib/logger";
import { listSessions, markReminderSent } from "../services/session.service";
import { notify } from "../services/reminder/reminder.service";
import {
  listSupabaseUsers,
  sweepMonthlyAiQuotaRenewals,
} from "../services/supabase.service";
import { computeHearingDateTime } from "../utils/hijri";

const MS_PER_HOUR = 60 * 60 * 1000;
let sweepInProgress = false;

function formatRemainingTime(diffMs: number): string {
  const totalMinutes = Math.floor(diffMs / 60_000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;

  const parts: string[] = [];

  if (days > 0) {
    parts.push(days === 1 ? "يوم" : days === 2 ? "يومين" : `${days} أيام`);
  }
  if (hours > 0) {
    parts.push(
      hours === 1
        ? "ساعة"
        : hours === 2
          ? "ساعتين"
          : hours <= 10
            ? `${hours} ساعات`
            : `${hours} ساعة`,
    );
  }
  if (minutes > 0 || parts.length === 0) {
    parts.push(
      minutes === 1
        ? "دقيقة"
        : minutes === 2
          ? "دقيقتين"
          : minutes <= 10
            ? `${minutes} دقائق`
            : `${minutes} دقيقة`,
    );
  }

  return `متبقي ${parts.join(" و ")}`;
}

export interface ReminderSweepSummary {
  officesChecked: number;
  sessionsEvaluated: number;
  sent24h: number;
  sent6h: number;
  failedDeliveries: number;
  quotasRenewed: number;
}

/**
 * Multi-tenant reminder & monthly AI quota renewal sweep:
 * - Prevents overlapping runs via `sweepInProgress`.
 * - Renews monthly AI quotas (`sweepMonthlyAiQuotaRenewals`) automatically.
 * - Iterates per active office owner (`office_manager` / standalone `staff` / `admin`),
 *   queries ONLY that office's sessions, sends to THAT office's `whatsapp_number`,
 *   and calls `markReminderSent` ONLY when `delivery.success === true`!
 */
export async function runReminderSweep(): Promise<ReminderSweepSummary> {
  const summary: ReminderSweepSummary = {
    officesChecked: 0,
    sessionsEvaluated: 0,
    sent24h: 0,
    sent6h: 0,
    failedDeliveries: 0,
    quotasRenewed: 0,
  };

  if (sweepInProgress) {
    logger.info("Skipping reminder sweep because a previous sweep is still running");
    return summary;
  }

  sweepInProgress = true;
  try {
    try {
      summary.quotasRenewed = await sweepMonthlyAiQuotaRenewals();
    } catch (err) {
      logger.warn({ reason: (err as any)?.message }, "Monthly AI quota renewal sweep warning");
    }

    const users = await listSupabaseUsers();
    const settings = getSettings();
    const now = new Date();
    const visitedOffices = new Set<string>();

    for (const user of users) {
      if (user.status !== "active") continue;
      if (user.subscription_end_date) {
        const exp = new Date(user.subscription_end_date);
        if (!isNaN(exp.getTime()) && exp.getTime() < now.getTime()) {
          continue;
        }
      }

      const officeId = user.office_id || (user.role === "admin" ? "platform-admin" : user.id);
      if (visitedOffices.has(officeId)) continue;
      // Prefer office_manager or admin record for the office's recipient phone
      if (user.office_role && user.office_role !== "office_manager" && user.role !== "admin") {
        continue;
      }
      visitedOffices.add(officeId);

      const recipientPhone =
        user.whatsapp_number?.trim() ||
        (user.role === "admin" ? settings.whatsappNumber?.trim() : "") ||
        "";

      // If this office has no recipient phone configured, skip external dispatch cleanly
      if (!recipientPhone) {
        continue;
      }

      let sessions;
      try {
        sessions = await listSessions(undefined, user.id);
      } catch {
        // Office may not have linked Google Sheets yet; skip without crashing other offices
        continue;
      }

      summary.officesChecked++;

      for (const session of sessions) {
        if (session.status === "Cancelled" || session.status === "Finished") {
          continue;
        }
        const hearingAt = computeHearingDateTime(
          session.sessionDateHijri,
          session.sessionTime,
        );
        if (!hearingAt) continue;

        summary.sessionsEvaluated++;
        const diffMs = hearingAt.getTime() - now.getTime();
        const hoursLeft = diffMs / MS_PER_HOUR;
        if (hoursLeft <= 0) continue;

        const remainingText = formatRemainingTime(diffMs);

        if (!session.reminder24 && hoursLeft <= 24 && hoursLeft > 6) {
          const delivery = await notify({
            sessionId: session.id,
            officeId,
            userId: user.id,
            recipientPhone,
            caseNumber: session.caseNumber,
            sessionDateHijri: session.sessionDateHijri,
            sessionTime: session.sessionTime,
            kind: "24h",
            remainingText,
            court: session.court,
            courtCircuit: session.courtCircuit,
            plaintiff: session.plaintiff,
            defendant: session.defendant,
            caseSubject: session.caseSubject,
          });

          if (delivery.success) {
            await markReminderSent(session.id, "24h", user.id);
            summary.sent24h++;
          } else {
            summary.failedDeliveries++;
          }
        }

        if (!session.reminder6 && hoursLeft <= 6 && hoursLeft > 0) {
          const delivery = await notify({
            sessionId: session.id,
            officeId,
            userId: user.id,
            recipientPhone,
            caseNumber: session.caseNumber,
            sessionDateHijri: session.sessionDateHijri,
            sessionTime: session.sessionTime,
            kind: "6h",
            remainingText,
            court: session.court,
            courtCircuit: session.courtCircuit,
            plaintiff: session.plaintiff,
            defendant: session.defendant,
            caseSubject: session.caseSubject,
          });

          if (delivery.success) {
            await markReminderSent(session.id, "6h", user.id);
            summary.sent6h++;
          } else {
            summary.failedDeliveries++;
          }
        }
      }
    }

    return summary;
  } finally {
    sweepInProgress = false;
  }
}

let started = false;

export function startReminderScheduler(): void {
  if (started || env.isTest) {
    return;
  }
  started = true;

  cron.schedule(env.reminderCronExpression, () => {
    runReminderSweep().catch((err) => {
      logger.error({ reason: err?.message }, "Scheduled reminder sweep failed");
    });
  });

  logger.info(
    { cron: env.reminderCronExpression },
    "Multi-office reminder & quota renewal scheduler started",
  );
}
