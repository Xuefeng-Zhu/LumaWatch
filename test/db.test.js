import test from "node:test";
import assert from "node:assert/strict";
import { SeenDatabase } from "../src/luma_monitor/db.js";
import { tempDbPath } from "./helpers.js";

test("SQLite schema initializes cleanly", () => {
  const db = new SeenDatabase(tempDbPath());
  db.init();
  const tables = db.db.prepare("select name from sqlite_master where type = 'table'").all().map((row) => row.name);
  assert.ok(tables.includes("sources"));
  assert.ok(tables.includes("seen_events"));
  assert.ok(tables.includes("event_observations"));
  assert.ok(tables.includes("notifications"));
  db.close();
});

test("deletePastEvents removes stale relative-date events", () => {
  const db = new SeenDatabase(tempDbPath());
  db.init();
  const nowMs = Date.UTC(2026, 3, 28, 15, 0, 0, 0);

  db.upsertSeen({
    eventKey: "event:today",
    eventUrl: "https://luma.com/event-today",
    canonicalUrl: "https://luma.com/event-today",
    title: "Today Event",
    dateText: "Today, 8:00 AM",
    sourceName: "test"
  }, { now: new Date(nowMs).toISOString(), notified: false });

  const deleted = db.deletePastEvents({ nowMs });
  assert.equal(deleted, 1);
  assert.equal(db.countSeen(), 0);
  db.close();
});

test("deletePastEvents keeps future relative-date events", () => {
  const db = new SeenDatabase(tempDbPath());
  db.init();
  const nowMs = Date.UTC(2026, 3, 28, 15, 0, 0, 0);

  db.upsertSeen({
    eventKey: "event:tomorrow",
    eventUrl: "https://luma.com/event-tomorrow",
    canonicalUrl: "https://luma.com/event-tomorrow",
    title: "Tomorrow Event",
    dateText: "Tomorrow, 8:00 PM",
    sourceName: "test"
  }, { now: new Date(nowMs).toISOString(), notified: false });

  const deleted = db.deletePastEvents({ nowMs });
  assert.equal(deleted, 0);
  assert.equal(db.countSeen(), 1);
  db.close();
});
