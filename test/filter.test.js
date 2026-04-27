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

test("filter rejects broad category events without nearby signals", () => {
  const config = testConfig();
  const result = scoreEvent({
    title: "Global AI Founder Summit",
    dateText: "June 8, 9:00 AM",
    locationText: "Online",
    cardText: "Global AI Founder Summit for LLM startup builders",
    sourceName: "luma-ai",
    sourceUrl: "https://luma.com/ai",
    foundInNearbySection: false
  }, config);
  assert.equal(result.keep, false);
  assert.match(result.why, /no nearby signal/);
});

test("filter keeps nearby category events with hidden exact location", () => {
  const config = testConfig();
  const result = scoreEvent({
    title: "AI Agents Builder Meetup",
    dateText: "June 8, 6:00 PM",
    locationText: "",
    cardText: "AI Agents Builder Meetup",
    sourceName: "luma-ai",
    sourceUrl: "https://luma.com/ai",
    foundInNearbySection: true
  }, config);
  assert.equal(result.keep, true);
  assert.match(result.why, /nearby section/);
});

test("filter rejects nearby-section events that clearly belong to another city", () => {
  const config = testConfig();
  const result = scoreEvent({
    title: "San Francisco AI Startup Night",
    dateText: "June 8, 6:00 PM",
    locationText: "San Francisco, CA",
    cardText: "San Francisco AI Startup Night",
    sourceName: "luma-ai",
    sourceUrl: "https://luma.com/ai",
    foundInNearbySection: true
  }, config);
  assert.equal(result.keep, false);
  assert.match(result.why, /other city signal/);
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
