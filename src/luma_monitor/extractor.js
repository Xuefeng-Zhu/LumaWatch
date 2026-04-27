import { chromium } from "playwright";
import { scoreEvent } from "./filter.js";
import { retryAfterHeaderToMs, RetryableError, withRetries } from "./retry.js";
import { sleep } from "./time.js";
import { extractEventId, normalizeLumaEventUrl } from "./url.js";

const MONTH_RE = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec|today|tomorrow|mon|tue|wed|thu|fri|sat|sun)\b/i;
const TIME_RE = /\b([01]?\d|2[0-3])(:\d{2})?\s?(am|pm|AM|PM)?\b/;
const STATUS_RE = /\b(waitlist|sold out|registration closed|near capacity|cancelled|canceled|full)\b/i;
const DATE_RE = /\b(today|tomorrow|mon|tue|wed|thu|fri|sat|sun)\b|(\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2}\b)|(\b\d{1,2}\/\d{1,2}(\s*(—|-|to)\s*\d{1,2}\/\d{1,2})?\b)/i;

function isStatusOnlyLine(line) {
  return /^(happening now|live now|starting soon)$/i.test(line.trim());
}

function isDateLikeLine(line) {
  const trimmed = line.trim();
  if (!trimmed || isStatusOnlyLine(trimmed)) return false;
  if (DATE_RE.test(trimmed)) return true;
  return false;
}

function isTimeOnlyLine(line) {
  const trimmed = line.trim();
  return TIME_RE.test(trimmed) && !isDateLikeLine(trimmed);
}

function parseCardFields(candidate, config) {
  const lines = (candidate.cardText || "")
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line, index, arr) => arr.indexOf(line) === index);

  const dateIndex = lines.findIndex((line) => isDateLikeLine(line));
  const dateText = dateIndex >= 0
    ? [
        lines[dateIndex],
        isTimeOnlyLine(lines[dateIndex + 1] || "") ? lines[dateIndex + 1] : null
      ].filter(Boolean).join(", ")
    : null;
  const locationText = lines.find((line) =>
    (config.location?.nearby_terms || []).some((term) => line.toLowerCase().includes(term.toLowerCase()))
  );
  const statusText = lines.find((line) => STATUS_RE.test(line) || isStatusOnlyLine(line));
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
  const minSteps = Math.max(1, steps);
  const maxSteps = Math.max(minSteps, minSteps + 10);
  let stableHeightCount = 0;
  let previousHeight = 0;

  for (let index = 0; index < maxSteps; index += 1) {
    const { scrollHeight, viewportHeight } = await page.evaluate(() => ({
      scrollHeight: document.documentElement.scrollHeight,
      viewportHeight: window.innerHeight
    }));
    await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "smooth" }));
    await page.waitForTimeout(pauseMs);

    const currentHeight = await page.evaluate(() => document.documentElement.scrollHeight);
    if (currentHeight <= previousHeight || currentHeight === scrollHeight) {
      stableHeightCount += 1;
    } else {
      stableHeightCount = 0;
    }
    previousHeight = currentHeight;

    const atBottom = await page.evaluate(() =>
      Math.ceil(window.scrollY + window.innerHeight) >= document.documentElement.scrollHeight
    );
    if (index + 1 >= minSteps && atBottom && stableHeightCount >= 2) {
      break;
    }

    if (viewportHeight <= 0) break;
  }
  await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" }));
}

async function extractCandidatesFromPage(page, source, config) {
  return page.evaluate((sourceInput) => {
    function normalizeText(value) {
      return (value || "").replace(/\s+/g, " ").trim().toLowerCase();
    }

    function addLinksFrom(root, anchors) {
      for (const anchor of root.querySelectorAll?.("a[href]") || []) {
        anchors.add(anchor);
      }
    }

    function nearbyEventAnchors() {
      const headings = Array.from(document.querySelectorAll("h2.section-title"))
        .filter((heading) => normalizeText(heading.innerText || heading.textContent) === "nearby events");
      const anchors = new Set();

      for (const heading of headings) {
        let scoped = false;
        let node = heading.parentElement;
        for (let depth = 0; depth < 5 && node && node !== document.body; depth += 1) {
          const hasLinks = node.querySelectorAll("a[href]").length > 0;
          const sectionTitleCount = node.querySelectorAll("h2.section-title").length;
          if (hasLinks && sectionTitleCount === 1) {
            addLinksFrom(node, anchors);
            scoped = true;
            break;
          }
          node = node.parentElement;
        }

        if (scoped) continue;

        let sibling = heading.nextElementSibling;
        while (sibling && !sibling.matches?.("h2.section-title")) {
          addLinksFrom(sibling, anchors);
          sibling = sibling.nextElementSibling;
        }
      }

      return Array.from(anchors);
    }

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

    function nearbyContextText(anchor) {
      const parts = [];
      let node = anchor.parentElement;
      for (let depth = 0; depth < 6 && node; depth += 1) {
        const tag = node.tagName?.toLowerCase();
        if (tag === "section" || tag === "article" || tag === "li" || node.getAttribute?.("role") === "region") {
          const text = (node.innerText || node.textContent || "").trim();
          if (text && text.length < 5000) parts.push(text);
          const heading = node.querySelector?.("h1,h2,h3,[role='heading']");
          const headingText = (heading?.innerText || heading?.textContent || "").trim();
          if (headingText) parts.push(headingText);
        }

        let sibling = node.previousElementSibling;
        for (let count = 0; count < 3 && sibling; count += 1) {
          if (/^H[1-6]$/.test(sibling.tagName || "") || sibling.getAttribute?.("role") === "heading") {
            parts.push((sibling.innerText || sibling.textContent || "").trim());
            break;
          }
          sibling = sibling.previousElementSibling;
        }
        node = node.parentElement;
      }
      return parts.join("\n").slice(0, 5000);
    }

    function escapeRegExp(value) {
      return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }

    return nearbyEventAnchors().map((anchor) => {
      const href = anchor.href;
      const cardText = textFor(anchor);
      const sectionText = nearbyContextText(anchor);
      const targetCity = escapeRegExp(sourceInput.targetCity || "Seattle");
      const nearbyPattern = new RegExp(`\\b(nearby|near you|near ${targetCity}|in ${targetCity}|${targetCity})\\b`, "i");
      return {
        href,
        linkText: (anchor.innerText || anchor.textContent || "").trim(),
        cardText,
        foundInNearbySection: true,
        nearbySectionMatched: nearbyPattern.test(`${cardText}\n${sectionText}`),
        sourceName: sourceInput.name,
        sourceUrl: sourceInput.url,
        sourceType: sourceInput.type
      };
    });
  }, { ...source, targetCity: config.location?.target_city || "Seattle" });
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

      const rawCandidates = await extractCandidatesFromPage(page, source, this.config);
      if (rawCandidates.length === 0) {
        this.logger?.warn("No Nearby Events section candidates found", {
          source: source.name,
          heading_selector: "h2.section-title",
          heading_text: "Nearby Events"
        });
      }
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
