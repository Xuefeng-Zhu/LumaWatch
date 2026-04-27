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
