import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { SeenDatabase } from "../src/luma_monitor/db.js";
import { runMonitor } from "../src/luma_monitor/monitor.js";
import { aiSeattleEvent, CollectingNotifier, FixtureExtractor, testConfig } from "./helpers.js";

function makeDb(config) {
  const db = new SeenDatabase(config.database.path);
  db.init();
  return db;
}

test("baseline mode saves events but sends no notifications", async () => {
  const config = testConfig();
  const db = makeDb(config);
  const notifier = new CollectingNotifier();
  const extractor = new FixtureExtractor({ fixture: [aiSeattleEvent()] });

  await runMonitor(config, { mode: "baseline", db, extractor, notifiers: [notifier] });

  assert.equal(db.countSeen(), 1);
  assert.equal(db.countNotifications(), 0);
  assert.equal(notifier.events.length, 0);
  db.close();
});

test("check mode sends notifications only for unseen events", async () => {
  const config = testConfig();
  const db = makeDb(config);
  const notifier = new CollectingNotifier();
  const event = aiSeattleEvent();

  await runMonitor(config, {
    mode: "baseline",
    db,
    extractor: new FixtureExtractor({ fixture: [event] }),
    notifiers: [notifier]
  });
  await runMonitor(config, {
    mode: "check",
    db,
    extractor: new FixtureExtractor({ fixture: [event] }),
    notifiers: [notifier]
  });

  assert.equal(db.countSeen(), 1);
  assert.equal(db.countNotifications(), 0);
  assert.equal(notifier.events.length, 0);
  db.close();
});

test("check mode writes an HTML report", async () => {
  const config = testConfig();
  const db = makeDb(config);
  const notifier = new CollectingNotifier();
  const event = aiSeattleEvent();

  const stats = await runMonitor(config, {
    mode: "check",
    db,
    extractor: new FixtureExtractor({ fixture: [event] }),
    notifiers: [notifier]
  });

  assert.equal(stats.reportPath, config.reports.path);
  assert.equal(fs.existsSync(config.reports.path), true);
  const html = fs.readFileSync(config.reports.path, "utf8");
  assert.match(html, /LumaWatch Report/);
  assert.match(html, /Seattle AI Builder Night/);
  assert.match(html, /New Events This Run/);
  db.close();
});

test("HTML report sorts events by event date", async () => {
  const config = testConfig();
  const db = makeDb(config);
  const later = aiSeattleEvent({
    eventUrl: "https://luma.com/later-ai-seattle",
    canonicalUrl: "https://luma.com/later-ai-seattle",
    title: "Later Seattle AI Meetup",
    dateText: "Jun 20, 2026, 6:00 PM"
  });
  const earlier = aiSeattleEvent({
    eventUrl: "https://luma.com/earlier-ai-seattle",
    canonicalUrl: "https://luma.com/earlier-ai-seattle",
    title: "Earlier Seattle AI Meetup",
    dateText: "May 5, 2026, 6:00 PM"
  });

  await runMonitor(config, {
    mode: "check",
    db,
    extractor: new FixtureExtractor({ fixture: [later, earlier] }),
    notifiers: [new CollectingNotifier()]
  });

  const html = fs.readFileSync(config.reports.path, "utf8");
  assert.ok(
    html.indexOf("Earlier Seattle AI Meetup") < html.indexOf("Later Seattle AI Meetup"),
    "expected earlier event to appear before later event"
  );
  assert.match(html, /May/);
  assert.match(html, /Jun/);
  db.close();
});

test("HTML report does not treat time-only text as an event date", async () => {
  const config = testConfig();
  const db = makeDb(config);
  const timeOnly = aiSeattleEvent({
    eventUrl: "https://luma.com/time-only-ai-seattle",
    canonicalUrl: "https://luma.com/time-only-ai-seattle",
    title: "Time Only Seattle AI Meetup",
    dateText: "8:54 AM PDT"
  });
  const dated = aiSeattleEvent({
    eventUrl: "https://luma.com/dated-ai-seattle",
    canonicalUrl: "https://luma.com/dated-ai-seattle",
    title: "Dated Seattle AI Meetup",
    dateText: "May 5, 2026, 6:00 PM"
  });

  await runMonitor(config, {
    mode: "check",
    db,
    extractor: new FixtureExtractor({ fixture: [timeOnly, dated] }),
    notifiers: [new CollectingNotifier()]
  });

  const html = fs.readFileSync(config.reports.path, "utf8");
  assert.ok(
    html.indexOf("Dated Seattle AI Meetup") < html.indexOf("Time Only Seattle AI Meetup"),
    "expected real dated event to appear before time-only event"
  );
  assert.doesNotMatch(html, /<span><strong>Date<\/strong>8:54 AM PDT<\/span>/);
  assert.match(html, /<strong>TBD<\/strong>/);
  db.close();
});

test("dedupe prevents duplicate notifications across check runs", async () => {
  const config = testConfig();
  const db = makeDb(config);
  const notifier = new CollectingNotifier();
  const unseen = aiSeattleEvent({
    eventUrl: "https://luma.com/new-ai-summit-seattle",
    canonicalUrl: "https://luma.com/new-ai-summit-seattle",
    title: "New AI Summit Seattle"
  });
  const extractor = new FixtureExtractor({ fixture: [unseen] });

  await runMonitor(config, { mode: "check", db, extractor, notifiers: [notifier] });
  await runMonitor(config, { mode: "check", db, extractor, notifiers: [notifier] });

  assert.equal(notifier.events.length, 1);
  assert.equal(db.countSeen(), 1);
  assert.equal(db.countNotifications(), 1);
  db.close();
});
