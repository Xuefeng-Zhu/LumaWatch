import { retryAfterHeaderToMs, RetryableError, withRetries } from "./retry.js";
import { nowIso } from "./time.js";

export function formatNotification(event) {
  return [
    "New Luma AI/Tech event near Seattle",
    "",
    `Title: ${event.title || "Unknown"}`,
    `When: ${event.dateText || "Unknown"}`,
    `Where: ${event.locationText || "Unknown"}`,
    `Status: ${event.statusText || "Unknown"}`,
    `Source: ${event.sourceName || event.sourceUrl || "Unknown"}`,
    `URL: ${event.canonicalUrl || event.eventUrl || "Unknown"}`,
    "",
    `Why matched: ${event.matchWhy || "matched configured filters"}`
  ].join("\n");
}

class StdoutNotifier {
  constructor() {
    this.channel = "stdout";
  }

  async send(event) {
    const text = formatNotification(event);
    console.log(text);
    return { status: "sent", payload: { text } };
  }
}

class SlackNotifier {
  constructor(webhookUrl, logger) {
    this.channel = "slack";
    this.webhookUrl = webhookUrl;
    this.logger = logger;
  }

  async send(event) {
    const text = formatNotification(event);
    await withRetries(async () => {
      const response = await fetch(this.webhookUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text })
      });
      if (response.status === 429) {
        throw new RetryableError("Slack rate limit", {
          retryAfterMs: retryAfterHeaderToMs(response.headers.get("retry-after")) ?? 30000
        });
      }
      if (response.status >= 500) {
        throw new RetryableError(`Slack transient HTTP ${response.status}`);
      }
      if (!response.ok) {
        throw new Error(`Slack HTTP ${response.status}: ${await response.text()}`);
      }
    }, { logger: this.logger, label: "slack notification" });
    return { status: "sent", payload: { text } };
  }
}

class TelegramNotifier {
  constructor(botToken, chatId, logger) {
    this.channel = "telegram";
    this.botToken = botToken;
    this.chatId = chatId;
    this.logger = logger;
  }

  async send(event) {
    const text = formatNotification(event);
    const url = `https://api.telegram.org/bot${this.botToken}/sendMessage`;
    await withRetries(async () => {
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          chat_id: this.chatId,
          text,
          disable_web_page_preview: false
        })
      });
      if (response.status === 429) {
        throw new RetryableError("Telegram rate limit", {
          retryAfterMs: retryAfterHeaderToMs(response.headers.get("retry-after")) ?? 30000
        });
      }
      if (response.status >= 500) {
        throw new RetryableError(`Telegram transient HTTP ${response.status}`);
      }
      if (!response.ok) {
        throw new Error(`Telegram HTTP ${response.status}: ${await response.text()}`);
      }
    }, { logger: this.logger, label: "telegram notification" });
    return { status: "sent", payload: { text } };
  }
}

export function buildNotifiers(config, env = process.env, logger) {
  const notifiers = [];
  if (config.notifications?.stdout?.enabled) {
    notifiers.push(new StdoutNotifier());
  }

  const slackConfig = config.notifications?.slack;
  if (slackConfig?.enabled) {
    const webhook = env[slackConfig.webhook_url_env || "SLACK_WEBHOOK_URL"];
    if (!webhook) {
      logger?.warn("Slack notification enabled but webhook env var is missing", {
        env: slackConfig.webhook_url_env || "SLACK_WEBHOOK_URL"
      });
    } else {
      notifiers.push(new SlackNotifier(webhook, logger));
    }
  }

  const telegramConfig = config.notifications?.telegram;
  if (telegramConfig?.enabled) {
    const token = env[telegramConfig.bot_token_env || "TELEGRAM_BOT_TOKEN"];
    const chatId = env[telegramConfig.chat_id_env || "TELEGRAM_CHAT_ID"];
    if (!token || !chatId) {
      logger?.warn("Telegram notification enabled but token/chat env vars are missing");
    } else {
      notifiers.push(new TelegramNotifier(token, chatId, logger));
    }
  }

  return notifiers;
}

export async function notifyAll(event, notifiers, db, logger) {
  for (const notifier of notifiers) {
    try {
      const result = await notifier.send(event);
      db.insertNotification({
        eventKey: event.eventKey,
        channel: notifier.channel,
        sentAt: nowIso(),
        status: result.status,
        payload: result.payload
      });
      logger?.info("Notification sent", { event_key: event.eventKey, channel: notifier.channel });
    } catch (error) {
      db.insertNotification({
        eventKey: event.eventKey,
        channel: notifier.channel,
        sentAt: nowIso(),
        status: "error",
        error: error.message,
        payload: { event }
      });
      logger?.error("Notification failed", {
        event_key: event.eventKey,
        channel: notifier.channel,
        error: error.message
      });
    }
  }
}
