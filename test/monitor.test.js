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
