import { SeenDatabase } from "./db.js";
import { scoreEvent } from "./filter.js";
import { buildNotifiers, notifyAll } from "./notifications.js";
import { writeHtmlReport } from "./report.js";
import { nowIso } from "./time.js";
import { eventFingerprint, eventKeyFor } from "./url.js";

function prepareEvent(event, config) {
  const scored = scoreEvent(event, config);
  const prepared = {
    ...event,
    eventKey: eventKeyFor(event),
    fingerprint: eventFingerprint(event),
    matchScore: scored.score,
    matchWhy: scored.why
  };
  return { event: prepared, scored };
}

function reportEventDetailLength(event) {
  return [event.title, event.dateText, event.locationText, event.matchWhy]
    .filter(Boolean)
    .join("\n")
    .length;
}

function isBetterReportEvent(candidate, existing) {
  if (!existing) return true;
  const candidateScore = candidate.matchScore ?? Number.NEGATIVE_INFINITY;
  const existingScore = existing.matchScore ?? Number.NEGATIVE_INFINITY;
  if (candidateScore !== existingScore) return candidateScore > existingScore;
  return reportEventDetailLength(candidate) > reportEventDetailLength(existing);
}

export async function initDatabase(config, logger) {
  const db = new SeenDatabase(config.database.path);
  db.init();
  for (const source of config.sources || []) {
    db.upsertSource(source);
  }
  logger?.info("SQLite database initialized", { path: config.database.path });
  return db;
}

export async function runMonitor(config, options = {}) {
  const mode = options.mode || "check";
  const logger = options.logger;
  const db = options.db || await initDatabase(config, logger);
  const extractor = options.extractor || await createDefaultExtractor(config, logger);
  const notifiers = options.notifiers || buildNotifiers(config, process.env, logger);
  const closeDb = !options.db;
  const stats = {
    mode,
    sourcesChecked: 0,
    candidates: 0,
    kept: 0,
    skipped: 0,
    newEvents: 0,
    notificationsAttempted: 0
  };
  const runEvents = {
    newEvents: [],
    keptEvents: [],
    skippedEvents: []
  };
  const currentRunKept = new Map();
  const currentRunNew = new Map();
  const deletedPastEvents = db.deletePastEvents();
  if (deletedPastEvents > 0) {
    logger?.info("Deleted past events from database", { deletedPastEvents });
  }

  function rememberReportEvent(map, list, event) {
    const key = event.eventKey || eventKeyFor(event);
    const existing = map.get(key);
    if (!isBetterReportEvent(event, existing)) return false;
    map.set(key, event);
    const index = list.findIndex((item) => (item.eventKey || eventKeyFor(item)) === key);
    if (index >= 0) {
      list[index] = event;
    } else {
      list.push(event);
    }
    return !existing;
  }

  try {
    for (const source of config.sources || []) {
      db.upsertSource(source);
      if (source.enabled === false) {
        logger?.info("Skipping disabled source", { source: source.name });
        continue;
      }

      const checkedAt = nowIso();
      try {
        const candidates = await extractor.extractSource(source);
        stats.sourcesChecked += 1;
        stats.candidates += candidates.length;

        for (const candidate of candidates) {
          const { event, scored } = prepareEvent(candidate, config);
          db.insertObservation(event, { now: checkedAt });

          if (!scored.keep) {
            stats.skipped += 1;
            runEvents.skippedEvents.push({
              event,
              score: scored.score,
              reasons: scored.reasons
            });
            logger?.info("Skipped event candidate", {
              source: source.name,
              url: event.canonicalUrl || event.eventUrl,
              score: scored.score,
              reasons: scored.reasons
            });
            continue;
          }

          if (rememberReportEvent(currentRunKept, runEvents.keptEvents, event)) {
            stats.kept += 1;
          }
          const existing = db.getSeen(event.eventKey);
          if (mode === "baseline") {
            db.upsertSeen(event, { now: checkedAt, notified: false });
            continue;
          }

          if (existing) {
            if (currentRunNew.has(event.eventKey)) {
              rememberReportEvent(currentRunNew, runEvents.newEvents, event);
            }
            db.upsertSeen(event, { now: checkedAt, notified: Boolean(existing.first_notified_at) });
            continue;
          }

          stats.newEvents += 1;
          rememberReportEvent(currentRunNew, runEvents.newEvents, event);
          db.upsertSeen(event, { now: checkedAt, notified: false });
          const notificationSummary = await notifyAll(event, notifiers, db, logger);
          stats.notificationsAttempted += notificationSummary.attempted;
          if (notificationSummary.sent > 0) {
            db.upsertSeen(event, { now: checkedAt, notified: true });
          }
        }

        db.markSourceChecked(source.name, {
          last_checked_at: checkedAt,
          last_success_at: nowIso(),
          last_error: null
        });
      } catch (error) {
        db.markSourceChecked(source.name, {
          last_checked_at: checkedAt,
          last_error: error.message
        });
        logger?.error("Source check failed", {
          source: source.name,
          url: source.url,
          error: error.message
        });
      }
    }
    if (mode === "check") {
      stats.reportPath = writeHtmlReport({ config, db, stats, runEvents, logger });
    }
    logger?.info("Monitor run complete", stats);
    return stats;
  } finally {
    if (closeDb) db.close();
  }
}

async function createDefaultExtractor(config, logger) {
  const { LumaExtractor } = await import("./extractor.js");
  return new LumaExtractor(config, logger);
}
