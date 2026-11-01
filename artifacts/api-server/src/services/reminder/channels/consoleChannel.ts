import { logger } from "../../../lib/logger";
import type { ChannelSendResult, ReminderChannel, ReminderPayload } from "../reminder.types";

/**
 * Audit-safe diagnostic console channel:
 * Logs ONLY opaque identifiers (`sessionId`, `officeId`, `kind`) — NEVER party names,
 * phone numbers, or case subjects!
 * Returns `isExternalChannel: false` so console logging alone NEVER marks a reminder as delivered.
 */
export class ConsoleReminderChannel implements ReminderChannel {
  readonly name = "console";

  async send(payload: ReminderPayload): Promise<ChannelSendResult> {
    logger.info(
      {
        sessionId: payload.sessionId,
        officeId: payload.officeId || "unspecified",
        kind: payload.kind,
      },
      "Session reminder event evaluated",
    );
    return {
      delivered: true,
      isExternalChannel: false,
    };
  }
}
