export interface ReminderPayload {
  sessionId: number;
  officeId?: string;
  userId?: string;
  recipientPhone?: string | null;
  caseNumber: string | null;
  sessionDateHijri: string | null;
  sessionTime: string | null;
  /** Which threshold triggered this reminder. */
  kind: "24h" | "6h" | "instant";
  remainingText?: string | null;
  court?: string | null;
  courtCircuit?: string | null;
  plaintiff?: string | null;
  defendant?: string | null;
  caseSubject?: string | null;
}

export interface ChannelSendResult {
  delivered: boolean;
  isExternalChannel: boolean;
  reason?: string;
}

export interface ReminderChannel {
  readonly name: string;
  send(payload: ReminderPayload): Promise<ChannelSendResult>;
}
