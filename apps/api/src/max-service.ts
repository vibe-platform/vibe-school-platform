import { timingSafeEqual } from "node:crypto";
import type { BotButton } from "./bot.js";

export type MaxBotInfo = { user_id?: number | string; name?: string; username?: string; is_bot?: boolean };

const defaultApiBase = "https://platform-api2.max.ru";
export const isMaxEnabled = () => process.env.MAX_BOT_ENABLED === "true";
export const isMaxConfigured = () => Boolean(process.env.MAX_BOT_TOKEN?.trim());

export function maxConfigStatus() {
  const tokenConfigured = isMaxConfigured();
  const username = process.env.MAX_BOT_USERNAME?.trim().replace(/^@/u, "") || null;
  const miniAppUrl = process.env.MAX_MINI_APP_URL?.trim() || null;
  const botUrl = process.env.MAX_BOT_URL?.trim() || (username ? `https://max.ru/${username}` : null);
  let miniAppUrlValid = false;
  if (miniAppUrl) {
    try { const parsed = new URL(miniAppUrl); miniAppUrlValid = parsed.protocol === "https:"; } catch { /* invalid local configuration */ }
  }
  return {
    enabled: isMaxEnabled(),
    configured: tokenConfigured,
    tokenConfigured,
    usernameConfigured: Boolean(username),
    username,
    botUrl,
    miniAppUrl,
    miniAppUrlValid,
    webhookConfigured: Boolean(process.env.MAX_WEBHOOK_URL?.trim() && process.env.MAX_WEBHOOK_SECRET?.trim()),
    transport: process.env.MAX_TRANSPORT === "max" && isMaxEnabled() && tokenConfigured ? "max" : "mock",
  } as const;
}

function apiBase() {
  const base = new URL(process.env.MAX_API_BASE_URL?.trim() || defaultApiBase);
  if (base.protocol !== "https:" || base.hostname !== "platform-api2.max.ru" || base.username || base.password || base.search || base.hash) {
    throw new Error("MAX API должен использовать официальный адрес https://platform-api2.max.ru");
  }
  return base.toString().replace(/\/$/u, "");
}

export const maxApiBaseUrl = () => apiBase();

export class MaxApiClient {
  private readonly base: string;

  constructor(private readonly token: string) {
    if (!token.trim()) throw new Error("Секрет MAX не настроен");
    this.base = apiBase();
  }

  async getMe() {
    const response = await fetch(`${this.base}/me`, {
      headers: { Authorization: this.token },
      signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) throw new Error(`MAX API ответил с кодом ${response.status}`);
    return await response.json() as MaxBotInfo;
  }

  async answerCallback(callbackId: string) {
    const response = await fetch(`${this.base}/answers?callback_id=${encodeURIComponent(callbackId)}`, {
      method: "POST",
      headers: { Authorization: this.token, "Content-Type": "application/json" },
      body: JSON.stringify({ notification: "" }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`MAX API ответил с кодом ${response.status}`);
  }

  async sendMessage(recipient: string, message: { text: string; link?: string; buttons?: BotButton[] }) {
    const buttons = message.buttons?.map((button) => button.type === "link"
      ? { type: button.type, text: button.text, url: button.url }
      : button.type === "open_app" ? { type: "open_app", text: button.text, web_app: process.env.MAX_BOT_URL?.trim() || process.env.MAX_BOT_USERNAME?.trim()?.replace(/^@/u, "") } : { type: button.type, text: button.text });
    const link = message.link ? [{ type: "link", text: "Открыть Вайб", url: message.link }] : [];
    const rows: Array<Array<{ type: string; text: string; url?: string; web_app?: string; payload?: string }>> = [];
    if (buttons?.length) for (const button of buttons) rows.push([button]);
    else if (link.length) rows.push(link);
    const response = await fetch(`${this.base}/messages?user_id=${encodeURIComponent(recipient)}`, {
      method: "POST",
      headers: { Authorization: this.token, "Content-Type": "application/json" },
      body: JSON.stringify({
        text: message.text.slice(0, 4000),
        disable_link_preview: true,
        ...(rows.length ? { attachments: [{ type: "inline_keyboard", payload: { buttons: rows } }] } : {}),
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw new Error(`MAX API ответил с кодом ${response.status}`);
  }
}

export function verifyMaxWebhookSecret(received: string | undefined) {
  const expected = process.env.MAX_WEBHOOK_SECRET?.trim();
  if (!expected || !received) return false;
  const left = Buffer.from(expected);
  const right = Buffer.from(received);
  return left.length === right.length && timingSafeEqual(left, right);
}
