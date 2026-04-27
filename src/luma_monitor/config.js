import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";

export const defaultConfig = {
  sources: [
    { name: "luma-ai", url: "https://luma.com/ai", type: "category_page", enabled: true },
    { name: "luma-tech", url: "https://luma.com/tech", type: "category_page", enabled: true },
    { name: "luma-seattle", url: "https://luma.com/seattle", type: "city_page", enabled: false }
  ],
  location: {
    target_city: "Seattle",
    nearby_terms: [
      "Seattle",
      "Bellevue",
      "Redmond",
      "Kirkland",
      "Bothell",
      "Renton",
      "South Lake Union",
      "Capitol Hill",
      "Pioneer Square",
      "University District",
      "WA",
      "Washington"
    ],
    timezone: "America/Los_Angeles"
  },
  relevance: {
    include_terms: [
      "ai",
      "artificial intelligence",
      "machine learning",
      "ml",
      "llm",
      "genai",
      "generative ai",
      "agent",
      "agents",
      "data",
      "startup",
      "founder",
      "software",
      "developer",
      "engineering",
      "tech",
      "robotics"
    ],
    exclude_terms: ["nightclub", "yoga", "dating", "real estate open house"]
  },
  browser: {
    headless: true,
    timeout_ms: 60000,
    scroll_steps: 6,
    scroll_pause_ms: 1200,
    user_agent: null,
    enrich_details: true,
    detail_delay_ms: 1500
  },
  polling: {
    min_seconds_between_source_checks: 1800,
    jitter_seconds: 60
  },
  notifications: {
    stdout: { enabled: true },
    slack: { enabled: false, webhook_url_env: "SLACK_WEBHOOK_URL" },
    telegram: {
      enabled: false,
      bot_token_env: "TELEGRAM_BOT_TOKEN",
      chat_id_env: "TELEGRAM_CHAT_ID"
    }
  },
  reports: {
    enabled: true,
    path: "./reports/luma-report.html"
  },
  database: {
    path: "./luma_seen.sqlite"
  }
};

function mergeDeep(base, override) {
  if (Array.isArray(base) || Array.isArray(override)) return override ?? base;
  if (!base || typeof base !== "object") return override ?? base;
  const out = { ...base };
  for (const [key, value] of Object.entries(override || {})) {
    out[key] = mergeDeep(base[key], value);
  }
  return out;
}

function envBool(value) {
  if (value == null) return undefined;
  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
}

export function loadConfig(configPath = "config.yaml", env = process.env) {
  let fileConfig = {};
  if (fs.existsSync(configPath)) {
    fileConfig = YAML.parse(fs.readFileSync(configPath, "utf8")) || {};
  }
  const config = mergeDeep(defaultConfig, fileConfig);

  if (env.LUMA_DATABASE_PATH) config.database.path = env.LUMA_DATABASE_PATH;
  if (env.LUMA_TARGET_CITY) config.location.target_city = env.LUMA_TARGET_CITY;
  if (env.LUMA_TIMEOUT_MS) config.browser.timeout_ms = Number(env.LUMA_TIMEOUT_MS);
  if (env.LUMA_SCROLL_STEPS) config.browser.scroll_steps = Number(env.LUMA_SCROLL_STEPS);
  if (env.LUMA_USER_AGENT) config.browser.user_agent = env.LUMA_USER_AGENT;
  if (env.LUMA_REPORT_PATH) config.reports.path = env.LUMA_REPORT_PATH;
  const reportsEnabled = envBool(env.LUMA_REPORTS_ENABLED);
  if (reportsEnabled !== undefined) config.reports.enabled = reportsEnabled;
  const headless = envBool(env.LUMA_HEADLESS);
  if (headless !== undefined) config.browser.headless = headless;

  config.sources = (config.sources || []).map((source) => ({
    enabled: true,
    ...source
  }));

  if (!path.isAbsolute(config.database.path)) {
    config.database.path = path.resolve(process.cwd(), config.database.path);
  }
  if (config.reports?.path && !path.isAbsolute(config.reports.path)) {
    config.reports.path = path.resolve(process.cwd(), config.reports.path);
  }
  return config;
}
