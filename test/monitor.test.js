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

test("HTML report recovers date ranges from Luma tech card text", async () => {
  const config = testConfig();
  const db = makeDb(config);
  const event = aiSeattleEvent({
    eventUrl: "https://luma.com/crtechweek",
    canonicalUrl: "https://luma.com/crtechweek",
    title: "Costa Rica Tech Week 2026",
    dateText: "10:12 AM PDT",
    cardText: [
      "Upcoming Major Events",
      "May",
      "Costa Rica Tech Week 2026",
      "68 Events104 Subscribers",
      "San Jose, Costa Rica",
      "5/16 — 5/24",
      "Boston Tech Week",
      "0 Events11 Subscribers",
      "Boston, United States",
      "5/26 — 5/31"
    ].join("\n")
  });

  await runMonitor(config, {
    mode: "check",
    db,
    extractor: new FixtureExtractor({ fixture: [event] }),
    notifiers: [new CollectingNotifier()]
  });

  const html = fs.readFileSync(config.reports.path, "utf8");
  assert.match(html, /Costa Rica Tech Week 2026/);
  assert.match(html, /5\/16 — 5\/24/);
  assert.match(html, /<strong>5\/16 — 5\/24<\/strong>/);
  assert.doesNotMatch(html, /<strong>TBD<\/strong>/);
  db.close();
});

test("HTML report labels stored events as historical when current run has no candidates", async () => {
  const config = testConfig();
  const db = makeDb(config);
  const stored = aiSeattleEvent({
    eventUrl: "https://luma.com/stored-ai-seattle",
    canonicalUrl: "https://luma.com/stored-ai-seattle",
    title: "Stored Seattle AI Meetup"
  });

  await runMonitor(config, {
    mode: "baseline",
    db,
    extractor: new FixtureExtractor({ fixture: [stored] }),
    notifiers: [new CollectingNotifier()]
  });
  await runMonitor(config, {
    mode: "check",
    db,
    extractor: new FixtureExtractor({ fixture: [] }),
    notifiers: [new CollectingNotifier()]
  });

  const html = fs.readFileSync(config.reports.path, "utf8");
  assert.match(html, /No Nearby Events found this run/);
  assert.match(html, /Historical Database Events/);
  assert.match(html, /not current run results/);
  db.close();
});

test("HTML report sorts relative Today and Tomorrow dates correctly", async () => {
  const config = testConfig();
  const db = makeDb(config);
  const tomorrowEvent = aiSeattleEvent({
    eventUrl: "https://luma.com/tomorrow-ai-seattle",
    canonicalUrl: "https://luma.com/tomorrow-ai-seattle",
    title: "Tomorrow Seattle AI Meetup",
    dateText: "Tomorrow, 6:00 PM"
  });
  const todayEvent = aiSeattleEvent({
    eventUrl: "https://luma.com/today-ai-seattle",
    canonicalUrl: "https://luma.com/today-ai-seattle",
    title: "Today Seattle AI Meetup",
    dateText: "Today, 7:00 PM"
  });

  await runMonitor(config, {
    mode: "check",
    db,
    extractor: new FixtureExtractor({ fixture: [tomorrowEvent, todayEvent] }),
    notifiers: [new CollectingNotifier()]
  });

  const html = fs.readFileSync(config.reports.path, "utf8");
  assert.ok(
    html.indexOf("Today Seattle AI Meetup") < html.indexOf("Tomorrow Seattle AI Meetup"),
    "expected Today event to appear before Tomorrow event"
  );
  assert.doesNotMatch(html, /Today Seattle AI Meetup[\s\S]*?<strong>TBD<\/strong>/);
  assert.doesNotMatch(html, /Tomorrow Seattle AI Meetup[\s\S]*?<strong>TBD<\/strong>/);
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
