import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
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

test("deletePastEvents interprets relative dates using local day boundaries", () => {
  const script = `
    import os from "node:os";
    import path from "node:path";
    import { SeenDatabase } from "./src/luma_monitor/db.js";

    const dbPath = path.join(os.tmpdir(), "luma-db-test-" + Date.now() + "-" + Math.random() + ".sqlite");
    const db = new SeenDatabase(dbPath);
    db.init();

    const nowMs = Date.parse("2026-04-29T02:00:00.000Z"); // Apr 28, 7:00 PM in America/Los_Angeles
    db.upsertSeen({
      eventKey: "event:today-local",
      eventUrl: "https://luma.com/event-today-local",
      canonicalUrl: "https://luma.com/event-today-local",
      title: "Today Local Event",
      dateText: "Today, 8:00 AM",
      sourceName: "test"
    }, { now: new Date(nowMs).toISOString(), notified: false });

    const deleted = db.deletePastEvents({ nowMs });
    console.log(JSON.stringify({ deleted, count: db.countSeen() }));
    db.close();
  `;

  const output = execFileSync(process.execPath, ["--input-type=module", "-e", script], {
    cwd: process.cwd(),
    env: { ...process.env, TZ: "America/Los_Angeles" }
  }).toString().trim();
  const result = JSON.parse(output);
  assert.equal(result.deleted, 1);
  assert.equal(result.count, 0);
});
