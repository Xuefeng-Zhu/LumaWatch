import test from "node:test";
import assert from "node:assert/strict";
import { scoreEvent } from "../src/luma_monitor/filter.js";
import { aiSeattleEvent, testConfig } from "./helpers.js";

test("filter keeps Seattle AI and tech examples", () => {
  const config = testConfig();
  const result = scoreEvent(aiSeattleEvent(), config);
  assert.equal(result.keep, true);
  assert.ok(result.score >= 2);
  assert.match(result.why, /Seattle|AI|Tech|nearby/i);
});

test("filter rejects obvious unrelated examples", () => {
  const config = testConfig();
  const result = scoreEvent({
    title: "Friday Nightclub Yoga Mixer",
    dateText: "Friday 10 PM",
    locationText: "Miami, FL",
    cardText: "Friday Nightclub Yoga Mixer dating event",
    sourceName: "fixture",
    sourceUrl: "https://luma.com/seattle"
  }, config);
  assert.equal(result.keep, false);
  assert.ok(result.score < 2);
});
