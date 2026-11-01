import { logger } from "../../lib/logger";
import { ConsoleReminderChannel } from "./channels/consoleChannel";
import { WhatsappReminderChannel } from "./channels/whatsappChannel";
import type { ReminderChannel, ReminderPayload } from "./reminder.types";

const channels: ReminderChannel[] = [
  new ConsoleReminderChannel(),
  new WhatsappReminderChannel(),
];

export interface DeliveryResult {
  channel: string;
  success: boolean;
  isExternalChannel: boolean;
  error?: string;
}

/**
 * Dispatches a reminder across registered channels.
 * CRITICAL GUARANTEE (Audit Finding #26 & #30):
 * - `success` is TRUE ONLY when at least one real external delivery channel (`isExternalChannel === true`)
 *   confirmed delivery (`delivered === true`). Console logging alone NEVER marks `success = true`.
 * - Zero PII (`plaintiff`, `defendant`, `caseSubject`, `phone`, `message`) is ever written to logs.
 */
export async function notify(
  payload: ReminderPayload,
): Promise<{ success: boolean; results: DeliveryResult[] }> {
  const results: DeliveryResult[] = [];

  for (const channel of channels) {
    try {
      const outcome = await channel.send(payload);
      results.push({
        channel: channel.name,
        success: outcome.delivered,
        isExternalChannel: outcome.isExternalChannel,
        error: outcome.reason,
      });
    } catch (err: any) {
      logger.warn(
        {
          channel: channel.name,
          sessionId: payload.sessionId,
          officeId: payload.officeId || "unspecified",
          kind: payload.kind,
          reason: err?.message || "channel_error",
        },
        "Reminder channel delivery did not complete",
      );
      results.push({
        channel: channel.name,
        success: false,
        isExternalChannel: channel.name !== "console",
        error: err?.message || String(err),
      });
    }
  }

  const confirmedExternal = results.some((r) => r.isExternalChannel && r.success);
  return { success: confirmedExternal, results };
}
