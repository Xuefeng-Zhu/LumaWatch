import { chromium } from "playwright";
import { scoreEvent } from "./filter.js";
import { retryAfterHeaderToMs, RetryableError, withRetries } from "./retry.js";
import { sleep } from "./time.js";
import { extractEventId, normalizeLumaEventUrl } from "./url.js";

const TIME_RE = /\b([01]?\d|2[0-3])(:\d{2})?\s?(am|pm|AM|PM)?\b/;
const STATUS_RE = /^(?:status\s*:?\s*)?(waitlist|sold out|registration closed|near capacity|cancelled|canceled|full)$/i;
const WEEKDAY_RE = /^(mon(?:day)?|tue(?:sday)?|wed(?:nesday)?|thu(?:rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)$/i;
const MONTH_ONLY_RE = /^(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?$/i;
const MONTH_DAY_RE = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2}(?:,\s*\d{4})?\b/i;
const NUMERIC_DATE_RE = /\b\d{1,2}\/\d{1,2}(\s*(—|-|to)\s*\d{1,2}\/\d{1,2})?\b/;
const ISO_DATE_RE = /\b\d{4}-\d{2}-\d{2}\b/;

function isStatusOnlyLine(line) {
  return /^(happening now|live now|starting soon)$/i.test(line.trim());
}

function isStatusLine(line) {
  return isStatusOnlyLine(line) || STATUS_RE.test(line.trim());
}

function isDateLikeLine(line) {
  const trimmed = line.trim();
  if (!trimmed || isStatusOnlyLine(trimmed)) return false;
  if (/^(today|tomorrow)(?:,?\s+\d{1,2}(?::\d{2})?\s*(am|pm))?$/i.test(trimmed)) return true;
  if (WEEKDAY_RE.test(trimmed)) return true;
  if (MONTH_DAY_RE.test(trimmed) && trimmed.length <= 80) return true;
  if (NUMERIC_DATE_RE.test(trimmed) || ISO_DATE_RE.test(trimmed)) return true;
  return false;
}

function isTimeOnlyLine(line) {
  const trimmed = line.trim();
  return /^\d{1,2}(?::\d{2})?\s*(am|pm|AM|PM)?\s*([A-Z]{2,4})?$/.test(trimmed) && !isDateLikeLine(trimmed);
}

function uniqueLines(value) {
  return (value || "")
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line, index, arr) => arr.indexOf(line) === index);
}

function titleLineFrom(lines) {
  return lines.find((line) =>
    !isDateLikeLine(line)
    && !isTimeOnlyLine(line)
    && !isStatusLine(line)
    && !MONTH_ONLY_RE.test(line.trim())
    && !isOrganizerLine(line)
    && !isNonEventUiLine(line)
    && !/^\d+\s*Events?\b/i.test(line)
    && !/^\d+\s*Subscribers?\b/i.test(line)
    && !/^Subscribe$/i.test(line)
  );
}

function isOrganizerLine(line) {
  return /^by\b/i.test(line.trim());
}

function isPriceOrRsvpLine(line) {
  const trimmed = line.trim();
  return /^(\$|free\b|suggested:|going\b|\+\d+\b)/i.test(trimmed);
}

function isNonEventUiLine(line) {
  const trimmed = line.trim();
  return /^(explore events|sign in|discover|pricing|help|submit event|upcoming|past|events|featured in .+)$/i.test(trimmed)
    || isPriceOrRsvpLine(trimmed);
}

function isLocationCandidateLine(line, title) {
  const trimmed = line.trim();
  return Boolean(trimmed)
    && normalizedText(trimmed) !== normalizedText(title)
    && !isDateLikeLine(trimmed)
    && !isTimeOnlyLine(trimmed)
    && !isStatusLine(trimmed)
    && !MONTH_ONLY_RE.test(trimmed)
    && !isOrganizerLine(trimmed)
    && !isNonEventUiLine(trimmed)
    && !/^\d+\s*Events?\b/i.test(trimmed)
    && !/^\d+\s*Subscribers?\b/i.test(trimmed);
}

function normalizedText(value) {
  return String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
}

function titleLineIndex(lines, title) {
  const normalizedTitle = normalizedText(title);
  if (!normalizedTitle) return -1;
  let index = lines.findIndex((line) => normalizedText(line) === normalizedTitle);
  if (index >= 0) return index;
  index = lines.findIndex((line) => normalizedText(line).includes(normalizedTitle));
  if (index >= 0) return index;
  return lines.findIndex((line) => {
    const normalizedLine = normalizedText(line);
    return normalizedLine.length >= 8 && normalizedTitle.includes(normalizedLine);
  });
}

function dateWithFollowingTime(lines, index) {
  if (index < 0) return null;
  return [
    lines[index],
    isTimeOnlyLine(lines[index + 1] || "") ? lines[index + 1] : null
  ].filter(Boolean).join(", ");
}

function firstDateFrom(lines) {
  const dateIndex = lines.findIndex((line) => isDateLikeLine(line));
  return dateWithFollowingTime(lines, dateIndex);
}

function contextualDateFrom(lines, contextText) {
  if (!isDateLikeLine(contextText || "")) return null;
  const timeLine = lines.find((line) => isTimeOnlyLine(line));
  return [contextText, timeLine].filter(Boolean).join(", ");
}

function hasCalendarDateSignal(value) {
  const text = String(value || "");
  return /\b(today|tomorrow)\b/i.test(text)
    || MONTH_DAY_RE.test(text)
    || NUMERIC_DATE_RE.test(text)
    || ISO_DATE_RE.test(text);
}

function dateNearTitle(lines, title) {
  const index = titleLineIndex(lines, title);
  if (index < 0) return null;
  const nearby = lines.slice(index + 1, index + 8);
  return firstDateFrom(nearby);
}

function locationLineFrom(lines, title, config) {
  const titleIndex = titleLineIndex(lines, title);
  if (titleIndex >= 0) {
    const nearby = lines.slice(titleIndex + 1, titleIndex + 8);
    const organizerIndex = nearby.findIndex((line) => isOrganizerLine(line));
    if (organizerIndex >= 0) {
      const afterOrganizer = nearby
        .slice(organizerIndex + 1, organizerIndex + 5)
        .find((line) => isLocationCandidateLine(line, title));
      if (afterOrganizer) return afterOrganizer;
    }

    const nearbyTermLocation = nearby.find((line) =>
      isLocationCandidateLine(line, title)
      && (config.location?.nearby_terms || []).some((term) => line.toLowerCase().includes(term.toLowerCase()))
    );
    if (nearbyTermLocation) return nearbyTermLocation;
  }

  return lines.find((line) =>
    isLocationCandidateLine(line, title)
    && (config.location?.nearby_terms || []).some((term) => line.toLowerCase().includes(term.toLowerCase()))
  );
}

export function parseCardFields(candidate, config) {
  const linkLines = uniqueLines(candidate.linkText || "");
  const cardLines = uniqueLines(candidate.cardText || "");
  const allLines = [...linkLines, ...cardLines];
  const title = candidate.title || titleLineFrom(linkLines) || titleLineFrom(cardLines) || null;
  const contextualDate = contextualDateFrom(allLines, candidate.dateContextText);
  const dateText = isDateLikeLine(candidate.dateText || "")
    ? candidate.dateText
    : (hasCalendarDateSignal(contextualDate) ? contextualDate : null)
      || dateNearTitle(linkLines, title)
      || firstDateFrom(linkLines)
      || dateNearTitle(cardLines, title)
      || firstDateFrom(cardLines)
      || contextualDate;

  const locationText = locationLineFrom(allLines, title, config);
  const statusText = allLines.find((line) => isStatusLine(line));

  return {
    ...candidate,
    title: candidate.title || title || null,
    dateText: dateText || null,
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

async function extractCandidatesFromPage(page, source, config) {
  return page.evaluate((sourceInput) => {
    function normalizeText(value) {
      return (value || "").replace(/\s+/g, " ").trim().toLowerCase();
    }

    function canonicalHref(value) {
      try {
        const url = new URL(value, window.location.href);
        url.hash = "";
        url.search = "";
        url.protocol = "https:";
        url.hostname = url.hostname.toLowerCase().replace(/^www\./, "");
        url.pathname = url.pathname.replace(/\/+$/, "");
        return url.toString();
      } catch {
        return "";
      }
    }

    function lumaLikeEventHref(value) {
      const normalized = canonicalHref(value);
      if (!normalized) return "";
      const url = new URL(normalized);
      const parts = url.pathname.split("/").filter(Boolean);
      const nonEventPaths = new Set(["android", "discover", "help", "ios", "pricing"]);
      if (!["luma.com", "lu.ma"].includes(url.hostname)) return "";
      if (parts.length === 0 || parts.length > 2) return "";
      if (parts.length === 1 && nonEventPaths.has(parts[0].toLowerCase())) return "";
      return normalized;
    }

    function addLinksFrom(root, anchors) {
      for (const anchor of root.querySelectorAll?.("a[href]") || []) {
        anchors.add(anchor);
      }
    }

    function isSectionBoundary(element) {
      return element.matches?.(".section-title-wrapper")
        || element.matches?.("h2.section-title")
        || Boolean(element.querySelector?.(":scope > .section-title-wrapper, :scope > h2.section-title"));
    }

    function nearbyRoots() {
      const headings = Array.from(document.querySelectorAll("h2.section-title"))
        .filter((heading) => normalizeText(heading.innerText || heading.textContent) === "nearby events");
      const roots = [];

      for (const heading of headings) {
        const titleWrapper = heading.closest(".section-title-wrapper") || heading.parentElement;
        let sibling = titleWrapper?.nextElementSibling;
        while (sibling && !isSectionBoundary(sibling)) {
          roots.push(sibling);
          sibling = sibling.nextElementSibling;
        }
      }

      return roots;
    }

    function nearbyEventAnchors() {
      const anchors = new Set();

      for (const root of nearbyRoots()) {
        addLinksFrom(root, anchors);
      }

      return Array.from(anchors);
    }

    function dayHeadingFromText(value) {
      const lines = String(value || "")
        .split(/\n+/)
        .map((line) => line.replace(/\s+/g, " ").trim())
        .filter(Boolean);
      for (const line of lines) {
        const monthDay = line.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2}(?:,\s*\d{4})?\b/i);
        if (monthDay && line.length <= 80) return monthDay[0];
        const relative = line.match(/^(today|tomorrow)$/i);
        if (relative) return relative[1];
        const weekday = line.match(/^(mon(?:day)?|tue(?:sday)?|wed(?:nesday)?|thu(?:rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)$/i);
        if (weekday) return weekday[1];
      }
      return "";
    }

    function nearestDayHeading(anchor) {
      const anchorRect = anchor.getBoundingClientRect();
      let bestText = "";
      let bestBottom = Number.NEGATIVE_INFINITY;

      for (const root of nearbyRoots()) {
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        let node = walker.nextNode();
        while (node) {
          const text = dayHeadingFromText(node.nodeValue);
          const element = node.parentElement;
          if (text && element && !element.contains(anchor)) {
            const rect = element.getBoundingClientRect();
            const bottom = rect.bottom || rect.top;
            if (bottom <= anchorRect.top + 2 && bottom > bestBottom) {
              bestBottom = bottom;
              bestText = text;
            }
          }
          node = walker.nextNode();
        }
      }

      return bestText;
    }

    function textFor(anchor) {
      let node = anchor;
      let best = anchor.innerText || anchor.textContent || "";
      const anchorEventHref = lumaLikeEventHref(anchor.href);
      for (let depth = 0; depth < 5 && node?.parentElement; depth += 1) {
        const candidate = node.parentElement;
        if (!candidate) break;
        if (["BODY", "HTML", "NAV", "FOOTER"].includes(candidate.tagName || "")) break;
        const eventHrefs = new Set(
          Array.from(candidate.querySelectorAll?.("a[href]") || [])
            .map((link) => lumaLikeEventHref(link.href))
            .filter(Boolean)
        );
        if (eventHrefs.size > 1 || (eventHrefs.size === 1 && anchorEventHref && !eventHrefs.has(anchorEventHref))) {
          node = candidate;
          continue;
        }
        const text = (candidate.innerText || candidate.textContent || "").replace(/\s+\n/g, "\n").trim();
        if (text.length > best.length && text.length < 4000) best = text;
        node = candidate;
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
        dateContextText: nearestDayHeading(anchor),
        foundInNearbySection: true,
        nearbySectionMatched: nearbyPattern.test(`${cardText}\n${sectionText}`),
        sourceName: sourceInput.name,
        sourceUrl: sourceInput.url,
        sourceType: sourceInput.type
      };
    });
  }, { ...source, targetCity: config.location?.target_city || "Seattle" });
}

async function scrollToNearbySection(page, pauseMs) {
  const found = await page.evaluate(() => {
    function normalizeText(value) {
      return (value || "").replace(/\s+/g, " ").trim().toLowerCase();
    }

    const heading = Array.from(document.querySelectorAll("h2.section-title"))
      .find((element) => normalizeText(element.innerText || element.textContent) === "nearby events");
    if (!heading) return false;
    heading.scrollIntoView({ block: "start", behavior: "instant" });
    return true;
  });

  if (found) await page.waitForTimeout(pauseMs);
  return found;
}

async function scrollNearbyVirtualList(page) {
  return page.evaluate(() => {
    function normalizeText(value) {
      return (value || "").replace(/\s+/g, " ").trim().toLowerCase();
    }

    function isSectionBoundary(element) {
      return element.matches?.(".section-title-wrapper")
        || element.matches?.("h2.section-title")
        || Boolean(element.querySelector?.(":scope > .section-title-wrapper, :scope > h2.section-title"));
    }

    function nearbyRoots() {
      const headings = Array.from(document.querySelectorAll("h2.section-title"))
        .filter((heading) => normalizeText(heading.innerText || heading.textContent) === "nearby events");
      const roots = new Set();

      for (const heading of headings) {
        const titleWrapper = heading.closest(".section-title-wrapper") || heading.parentElement;
        let sibling = titleWrapper?.nextElementSibling;
        while (sibling && !isSectionBoundary(sibling)) {
          roots.add(sibling);
          sibling = sibling.nextElementSibling;
        }
      }

      return Array.from(roots);
    }

    let changed = false;
    const scrollables = new Set();
    for (const root of nearbyRoots()) {
      if (root.scrollHeight > root.clientHeight + 8) scrollables.add(root);
      for (const element of root.querySelectorAll?.("*") || []) {
        if (element.scrollHeight > element.clientHeight + 8) scrollables.add(element);
      }
    }

    for (const element of scrollables) {
      const before = element.scrollTop;
      const step = Math.max(120, Math.floor(element.clientHeight * 0.85));
      element.scrollTop = Math.min(element.scrollTop + step, element.scrollHeight);
      if (element.scrollTop !== before) changed = true;
    }

    const beforeY = window.scrollY;
    const pageStep = Math.max(240, Math.floor(window.innerHeight * 0.85));
    window.scrollBy({ top: pageStep, behavior: "instant" });
    if (window.scrollY !== beforeY) changed = true;

    const atPageBottom = Math.ceil(window.scrollY + window.innerHeight) >= document.documentElement.scrollHeight;
    const scrollablesAtBottom = Array.from(scrollables).every((element) =>
      Math.ceil(element.scrollTop + element.clientHeight) >= element.scrollHeight
    );

    return { changed, atEnd: atPageBottom && scrollablesAtBottom };
  });
}

async function collectNearbyCandidatesFromPage(page, source, config) {
  const pauseMs = config.browser?.scroll_pause_ms ?? 1200;
  const configuredSteps = config.browser?.scroll_steps ?? 6;
  const maxSteps = Math.max(12, configuredSteps * 8);
  const byHref = new Map();

  async function addVisibleCandidates() {
    const candidates = await extractCandidatesFromPage(page, source, config);
    let added = 0;
    for (const candidate of candidates) {
      const previous = byHref.get(candidate.href);
      if (!previous || (candidate.cardText || "").length > (previous.cardText || "").length) {
        byHref.set(candidate.href, candidate);
        added += previous ? 0 : 1;
      }
    }
    return added;
  }

  const foundNearbySection = await scrollToNearbySection(page, pauseMs);
  if (!foundNearbySection) return [];

  await addVisibleCandidates();
  let stableSteps = 0;
  for (let index = 0; index < maxSteps; index += 1) {
    const scrollState = await scrollNearbyVirtualList(page);
    await page.waitForTimeout(pauseMs);
    const added = await addVisibleCandidates();

    if (added === 0 && !scrollState.changed) {
      stableSteps += 1;
    } else {
      stableSteps = 0;
    }

    if (scrollState.atEnd && stableSteps >= 2) break;
    if (stableSteps >= 4) break;
  }

  return Array.from(byHref.values());
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

      const locationSignals = await extractPageLocationSignals(page, this.config);
      if (locationSignals.hasNearbyUi && !locationSignals.hasTargetSignals) {
        this.logger?.warn("Luma nearby results may not be Seattle-geolocated", {
          source: source.name,
          other_city_signals: locationSignals.otherCityMatches
        });
      }

      const rawCandidates = await collectNearbyCandidatesFromPage(page, source, this.config);
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
      if (candidates.length === 0) {
        this.logger?.warn("No Luma event links found in Nearby Events section", {
          source: source.name,
          heading_selector: "h2.section-title",
          heading_text: "Nearby Events",
          nearby_links_seen: rawCandidates.length
        });
      }
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
            const statusText = bodyText
              .split(/\n+/)
              .map((line) => line.trim())
              .find((line) => /^(?:status\s*:?\s*)?(Waitlist|Sold Out|Registration Closed|Near Capacity|Cancelled|Canceled|Full)$/i.test(line)) || null;
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
