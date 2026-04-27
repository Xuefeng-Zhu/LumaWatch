import { chromium } from "playwright";
import { scoreEvent } from "./filter.js";
import { retryAfterHeaderToMs, RetryableError, withRetries } from "./retry.js";
import { sleep } from "./time.js";
import { extractEventId, normalizeLumaEventUrl } from "./url.js";

const MONTH_RE = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec|today|tomorrow|mon|tue|wed|thu|fri|sat|sun)\b/i;
const TIME_RE = /\b([01]?\d|2[0-3])(:\d{2})?\s?(am|pm|AM|PM)?\b/;
const STATUS_RE = /\b(waitlist|sold out|registration closed|near capacity|cancelled|canceled|full)\b/i;

function parseCardFields(candidate, config) {
  const lines = (candidate.cardText || "")
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line, index, arr) => arr.indexOf(line) === index);

  const dateText = lines.find((line) => MONTH_RE.test(line) || TIME_RE.test(line));
  const locationText = lines.find((line) =>
    (config.location?.nearby_terms || []).some((term) => line.toLowerCase().includes(term.toLowerCase()))
  );
  const statusText = lines.find((line) => STATUS_RE.test(line));
  const title = candidate.linkText || lines.find((line) => line !== dateText && line !== locationText && line !== statusText);

  return {
    ...candidate,
    title: candidate.title || title || null,
    dateText: candidate.dateText || dateText || null,
    locationText: candidate.locationText || locationText || null,
    statusText: candidate.statusText || statusText || null
  };
}

async function gotoWithRetries(page, url, timeoutMs, logger) {
  return withRetries(async () => {
    const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs });
    if (response?.status() === 429) {
      throw new RetryableError(`Luma rate limited ${url}`, {
        retryAfterMs: retryAfterHeaderToMs(response.headers()["retry-after"]) ?? 60000
      });
    }
    if (response?.status() >= 500) {
      throw new RetryableError(`Luma transient HTTP ${response.status()} for ${url}`);
    }
    return response;
  }, { logger, label: `navigate ${url}`, attempts: 3, baseDelayMs: 3000 });
}

async function waitForSettledPage(page, timeoutMs) {
  await Promise.race([
    page.waitForLoadState("networkidle", { timeout: Math.min(timeoutMs, 15000) }).catch(() => undefined),
    page.waitForTimeout(5000)
  ]);
}

async function scrollPage(page, steps, pauseMs) {
  for (let index = 0; index < steps; index += 1) {
    await page.evaluate(() => window.scrollBy({ top: Math.floor(window.innerHeight * 0.85), behavior: "smooth" }));
    await page.waitForTimeout(pauseMs);
  }
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
}

async function extractCandidatesFromPage(page, source) {
  return page.evaluate((sourceInput) => {
    function textFor(anchor) {
      let node = anchor;
      let best = anchor.innerText || anchor.textContent || "";
      for (let depth = 0; depth < 5 && node; depth += 1) {
        const candidate = node.closest?.("article, li, section, [role='article'], [data-testid*='event'], [class*='event'], [class*='card']") || node.parentElement;
        if (!candidate) break;
        const text = (candidate.innerText || candidate.textContent || "").replace(/\s+\n/g, "\n").trim();
        if (text.length > best.length && text.length < 4000) best = text;
        node = candidate.parentElement;
      }
      return best.trim();
    }

    function surroundingText(anchor) {
      const section = anchor.closest("section, main, body");
      const text = (section?.innerText || section?.textContent || "").slice(0, 5000);
      return text;
    }

    return Array.from(document.querySelectorAll("a[href]")).map((anchor) => {
      const href = anchor.href;
      const cardText = textFor(anchor);
      const sectionText = surroundingText(anchor);
      return {
        href,
        linkText: (anchor.innerText || anchor.textContent || "").trim(),
        cardText,
        foundInNearbySection: /\b(nearby|near you|in seattle|seattle)\b/i.test(`${cardText}\n${sectionText}`),
        sourceName: sourceInput.name,
        sourceUrl: sourceInput.url,
        sourceType: sourceInput.type
      };
    });
  }, source);
}

async function extractPageLocationSignals(page, config) {
  const bodyText = await page.evaluate(() => document.body?.innerText || "");
  const lower = bodyText.toLowerCase();
  const nearbyTerms = config.location?.nearby_terms || [];
  const hasTargetSignals = nearbyTerms.some((term) => lower.includes(term.toLowerCase()));
  const hasNearbyUi = /\b(near you|nearby|local events|popular in)\b/i.test(bodyText);
  const otherCityMatches = ["san francisco", "new york", "los angeles", "austin", "boston", "chicago", "miami"]
    .filter((city) => lower.includes(city));
  return { hasTargetSignals, hasNearbyUi, otherCityMatches };
}

export class LumaExtractor {
  constructor(config, logger) {
    this.config = config;
    this.logger = logger;
  }

  async extractSource(source) {
    const browser = await chromium.launch({ headless: this.config.browser?.headless !== false });
    try {
      const context = await browser.newContext({
        userAgent: this.config.browser?.user_agent || undefined,
        timezoneId: this.config.location?.timezone || "America/Los_Angeles"
      });
      const page = await context.newPage();
      page.setDefaultTimeout(this.config.browser?.timeout_ms || 60000);

      await gotoWithRetries(page, source.url, this.config.browser?.timeout_ms || 60000, this.logger);
      await waitForSettledPage(page, this.config.browser?.timeout_ms || 60000);
      await scrollPage(
        page,
        this.config.browser?.scroll_steps ?? 6,
        this.config.browser?.scroll_pause_ms ?? 1200
      );

      const locationSignals = await extractPageLocationSignals(page, this.config);
      if (locationSignals.hasNearbyUi && !locationSignals.hasTargetSignals) {
        this.logger?.warn("Luma nearby results may not be Seattle-geolocated", {
          source: source.name,
          other_city_signals: locationSignals.otherCityMatches
        });
      }

      const rawCandidates = await extractCandidatesFromPage(page, source);
      const byUrl = new Map();
      for (const candidate of rawCandidates) {
        const canonicalUrl = normalizeLumaEventUrl(candidate.href);
        if (!canonicalUrl) continue;
        const parsed = parseCardFields({
          ...candidate,
          eventUrl: canonicalUrl,
          canonicalUrl,
          eventId: extractEventId(canonicalUrl)
        }, this.config);
        if (!byUrl.has(canonicalUrl)) byUrl.set(canonicalUrl, parsed);
      }

      const candidates = Array.from(byUrl.values());
      this.logger?.info("Extracted Luma event candidates", {
        source: source.name,
        count: candidates.length
      });

      if (this.config.browser?.enrich_details === false) return candidates;
      return await this.enrichCandidates(candidates);
    } finally {
      await browser.close();
    }
  }

  async enrichCandidates(candidates) {
    const browser = await chromium.launch({ headless: this.config.browser?.headless !== false });
    try {
      const context = await browser.newContext({
        userAgent: this.config.browser?.user_agent || undefined,
        timezoneId: this.config.location?.timezone || "America/Los_Angeles"
      });
      const page = await context.newPage();
      page.setDefaultTimeout(this.config.browser?.timeout_ms || 60000);

      const enriched = [];
      for (const candidate of candidates) {
        const initialScore = scoreEvent(candidate, this.config);
        if (!initialScore.keep && !candidate.foundInNearbySection) {
          enriched.push(candidate);
          continue;
        }
        try {
          await sleep(this.config.browser?.detail_delay_ms ?? 1500);
          await gotoWithRetries(page, candidate.canonicalUrl, this.config.browser?.timeout_ms || 60000, this.logger);
          await waitForSettledPage(page, this.config.browser?.timeout_ms || 60000);
          const detail = await page.evaluate(() => {
            const bodyText = document.body?.innerText || "";
            const title = document.querySelector("h1")?.innerText?.trim()
              || document.querySelector("meta[property='og:title']")?.getAttribute("content")
              || document.title;
            const description = document.querySelector("meta[property='og:description']")?.getAttribute("content")
              || bodyText.split(/\n+/).slice(0, 12).join("\n");
            const dateText = document.querySelector("time")?.innerText?.trim()
              || document.querySelector("time")?.getAttribute("datetime");
            const statusText = (bodyText.match(/\b(Waitlist|Sold Out|Registration Closed|Near Capacity|Cancelled|Canceled|Full)\b/i) || [])[0] || null;
            return { title, descriptionText: description, dateText, detailText: bodyText.slice(0, 6000), statusText };
          });
          enriched.push(parseCardFields({ ...candidate, ...detail }, this.config));
        } catch (error) {
          this.logger?.warn("Failed to enrich Luma event detail", {
            url: candidate.canonicalUrl,
            error: error.message
          });
          enriched.push(candidate);
        }
      }
      return enriched;
    } finally {
      await browser.close();
    }
  }
}
