import test from "node:test";
import assert from "node:assert/strict";
import { defaultConfig } from "../src/luma_monitor/config.js";
import { parseCardFields } from "../src/luma_monitor/extractor.js";

test("parseCardFields ignores Luma page clock and uses the matching tech card date", () => {
  const parsed = parseCardFields({
    href: "https://luma.com/btw?k=c",
    linkText: [
      "Boston Tech Week",
      "0 Events11 Subscribers",
      "Boston, United States",
      "5/26 — 5/31"
    ].join("\n"),
    cardText: [
      "8:54 AM PDT",
      "Explore Events",
      "Sign In",
      "Upcoming Major Events",
      "May",
      "Costa Rica Tech Week 2026",
      "68 Events103 Subscribers",
      "San José, Costa Rica",
      "5/16 — 5/24",
      "Boston Tech Week",
      "0 Events11 Subscribers",
      "Boston, United States",
      "5/26 — 5/31"
    ].join("\n"),
    dateText: "8:54 AM PDT"
  }, defaultConfig);

  assert.equal(parsed.title, "Boston Tech Week");
  assert.equal(parsed.dateText, "5/26 — 5/31");
});

test("parseCardFields derives a clean title from multiline Luma link text", () => {
  const parsed = parseCardFields({
    href: "https://luma.com/crtechweek?k=c",
    linkText: [
      "Costa Rica Tech Week 2026",
      "69 Events104 Subscribers",
      "San José, Costa Rica",
      "5/16 — 5/24"
    ].join("\n")
  }, defaultConfig);

  assert.equal(parsed.title, "Costa Rica Tech Week 2026");
  assert.equal(parsed.dateText, "5/16 — 5/24");
});
