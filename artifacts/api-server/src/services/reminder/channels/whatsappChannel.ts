import { getSettings } from "../../../config/settings-store";
import { logger } from "../../../lib/logger";
import type { ChannelSendResult, ReminderChannel, ReminderPayload } from "../reminder.types";

export function formatWhatsappMessage(payload: ReminderPayload): string {
  const timeDesc = payload.remainingText
    ? payload.remainingText
    : payload.kind === "24h"
      ? "متبقي 24 ساعة"
      : payload.kind === "6h"
        ? "متبقي 6 ساعات"
        : "تذكير فوري";

  const lines: string[] = [
    `🔔 *تذكير بموعد جلسة قضائية* (${timeDesc})`,
    "",
    `📋 *رقم القضية:* ${payload.caseNumber || "غير محدد"}`,
  ];

  if (payload.court) lines.push(`⚖️ *المحكمة:* ${payload.court}`);
  if (payload.courtCircuit) lines.push(`🏛️ *الدائرة:* ${payload.courtCircuit}`);
  if (payload.sessionDateHijri) lines.push(`📅 *التاريخ الهجري:* ${payload.sessionDateHijri}`);
  if (payload.sessionTime) lines.push(`⏰ *وقت الجلسة:* ${payload.sessionTime}`);
  if (payload.plaintiff) lines.push(`👤 *المدعي:* ${payload.plaintiff}`);
  if (payload.defendant) lines.push(`👥 *المدعى عليه:* ${payload.defendant}`);
  if (payload.caseSubject) lines.push(`📝 *موضوع القضية:* ${payload.caseSubject}`);

  lines.push("", "الرجاء التحضير والاستعداد للجلسة في الموعد المحدد.");
  return lines.join("\n");
}

function buildWhatsappPayloadAndHeaders(
  url: string,
  phone: string,
  token: string | undefined,
  message: string,
  instanceId?: string,
): { targetUrl: string; method: string; headers: Record<string, string>; body?: string; isGreenApi?: boolean } {
  const cleanPhone = phone.replace(/[^0-9]/g, "");
  const formattedChatId = `${cleanPhone}@c.us`;

  if (url.includes("callmebot.com")) {
    const params = new URLSearchParams({
      phone,
      text: message,
      apikey: token || "",
    });
    return {
      targetUrl: `${url.split("?")[0]}?${params.toString()}`,
      method: "GET",
      headers: {},
    };
  }

  if (url.includes("green-api.com") || url.includes("greenapi")) {
    if (url.includes("/waInstance") && url.includes("/sendMessage")) {
      return {
        targetUrl: url,
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chatId: formattedChatId, message }),
        isGreenApi: true,
      };
    }

    if (instanceId && token) {
      const base = url.replace(/\/+$/, "");
      const endpoint = `${base}/waInstance${instanceId}/sendMessage/${token}`;
      return {
        targetUrl: endpoint,
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chatId: formattedChatId, message }),
        isGreenApi: true,
      };
    }

    throw new Error(
      "إعداد Green API غير مكتمل: يرجى إدخال Instance ID في إعدادات بوابة الواتساب.",
    );
  }

  if (url.includes("ultramsg.com")) {
    return {
      targetUrl: url,
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        token: token || "",
        to: phone,
        body: message,
      }).toString(),
    };
  }

  if (url.includes("graph.facebook.com")) {
    return {
      targetUrl: url,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: cleanPhone,
        type: "text",
        text: { body: message },
      }),
    };
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
    headers["x-api-key"] = token;
  }

  return {
    targetUrl: url,
    method: "POST",
    headers,
    body: JSON.stringify({
      phone,
      to: phone,
      number: cleanPhone,
      chatId: formattedChatId,
      message,
      body: message,
      text: message,
      token,
      apikey: token,
    }),
  };
}

export class WhatsappReminderChannel implements ReminderChannel {
  readonly name = "whatsapp";

  /**
   * Dispatches a WhatsApp message to an explicit office recipient phone (or admin default only when explicitly requested).
   * - NEVER logs `phone` or `message` (PII redaction).
   * - Throws if gateway URL or recipient phone is missing so unconfigured gateways NEVER mark a reminder as sent!
   */
  async sendRaw(message: string, recipientPhone?: string | null): Promise<void> {
    const settings = getSettings();
    const phone = recipientPhone?.trim() || "";

    if (!phone) {
      throw new Error("لم يتم تحديد رقم واتساب خاص بالمكتب لاستلام التنبيهات.");
    }

    const apiUrl = settings.whatsappApiUrl?.trim();
    if (!apiUrl) {
      throw new Error("بوابة إرسال الواتساب (API URL) غير مهيأة؛ لم يتم إرسال التنبيه خارجياً.");
    }

    const requestConfig = buildWhatsappPayloadAndHeaders(
      apiUrl,
      phone,
      settings.whatsappToken?.trim(),
      message,
      settings.whatsappInstanceId?.trim(),
    );

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);

    try {
      const res = await fetch(requestConfig.targetUrl, {
        method: requestConfig.method,
        headers: requestConfig.headers,
        body: requestConfig.body,
        signal: controller.signal,
      });

      if (!res.ok) {
        logger.error(
          { status: res.status },
          "WhatsApp Gateway API returned non-OK HTTP status",
        );
        throw new Error(`بوابة الواتساب أرجعت حالة خطأ (${res.status}).`);
      }

      if (requestConfig.isGreenApi) {
        const bodyText = await res.text().catch(() => "{}");
        let parsed: Record<string, unknown> = {};
        try {
          parsed = JSON.parse(bodyText) as Record<string, unknown>;
        } catch {
          // ignore
        }

        if (parsed["instanceError"] || parsed["typeError"]) {
          const errCode = String(
            parsed["instanceError"] ?? parsed["typeError"] ?? "gateway_error",
          );
          logger.error({ errCode }, "Green API reported error in HTTP 200 payload");
          throw new Error(`بوابة Green API أرجعت خطأ (${errCode}).`);
        }

        if (!parsed["idMessage"]) {
          logger.warn("Green API response missing idMessage confirmation");
          throw new Error("لم تؤكد بوابة الواتساب تسليم الرسالة (idMessage مفقود).");
        }
      }

      logger.info("WhatsApp reminder delivered via external gateway");
    } catch (err: any) {
      // PII-safe log: log ONLY error code/reason, NEVER phone or message!
      logger.error(
        { reason: err?.name || "gateway_failure" },
        "WhatsApp Gateway delivery failed",
      );
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  async send(payload: ReminderPayload): Promise<ChannelSendResult> {
    const settings = getSettings();
    const phone =
      payload.recipientPhone?.trim() ||
      (payload.officeId === "platform-admin" ? settings.whatsappNumber?.trim() : "") ||
      "";
    const message = formatWhatsappMessage(payload);
    await this.sendRaw(message, phone);
    return {
      delivered: true,
      isExternalChannel: true,
    };
  }
}
