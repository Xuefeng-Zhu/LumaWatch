import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { defaultConfig } from "../src/luma_monitor/config.js";

export function tempDbPath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "luma-watch-"));
  return path.join(dir, "seen.sqlite");
}

export function tempReportPath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "luma-watch-report-"));
  return path.join(dir, "report.html");
}

export function testConfig(overrides = {}) {
  return {
    ...defaultConfig,
    ...overrides,
    sources: overrides.sources || [
      { name: "fixture", url: "https://luma.com/ai", type: "category_page", enabled: true }
    ],
    notifications: overrides.notifications || {
      stdout: { enabled: false },
      slack: { enabled: false, webhook_url_env: "SLACK_WEBHOOK_URL" },
      telegram: { enabled: false, bot_token_env: "TELEGRAM_BOT_TOKEN", chat_id_env: "TELEGRAM_CHAT_ID" }
    },
    browser: {
      ...defaultConfig.browser,
      enrich_details: false,
      ...(overrides.browser || {})
    },
    database: {
      path: overrides.database?.path || tempDbPath()
    },
    reports: {
      enabled: overrides.reports?.enabled ?? true,
      path: overrides.reports?.path || tempReportPath()
    }
  };
}

export class FixtureExtractor {
  constructor(eventsBySource) {
    this.eventsBySource = eventsBySource;
  }

  async extractSource(source) {
    return this.eventsBySource[source.name] || [];
  }
}

export class CollectingNotifier {
  constructor() {
    this.channel = "test";
    this.events = [];
  }

  async send(event) {
    this.events.push(event);
    return { status: "sent", payload: { title: event.title } };
  }
}

export function aiSeattleEvent(overrides = {}) {
  return {
    eventUrl: "https://luma.com/ai-seattle-build-night",
    canonicalUrl: "https://luma.com/ai-seattle-build-night",
    title: "Seattle AI Builder Night",
    dateText: "May 12, 6:00 PM",
    locationText: "Seattle, WA",
    cardText: "Seattle AI Builder Night\nMay 12, 6:00 PM\nSeattle, WA\nLLM agents and startups",
    sourceName: "fixture",
    sourceUrl: "https://luma.com/ai",
    foundInNearbySection: true,
    ...overrides
  };
}
