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

test("parseCardFields does not treat numeric event titles as time-only text", () => {
  const parsed = parseCardFields({
    href: "https://luma.com/nearby-ai-10",
    linkText: [
      "Nearby AI Event 10",
      "May 20, 6:00 PM",
      "Seattle, WA"
    ].join("\n")
  }, defaultConfig);

  assert.equal(parsed.title, "Nearby AI Event 10");
  assert.equal(parsed.dateText, "May 20, 6:00 PM");
});

test("parseCardFields does not treat Full Stack titles as status text", () => {
  const parsed = parseCardFields({
    href: "https://luma.com/full-stack-ai-night",
    linkText: [
      "Full Stack AI Night",
      "May 21, 6:00 PM",
      "Seattle, WA",
      "Waitlist"
    ].join("\n")
  }, defaultConfig);

  assert.equal(parsed.title, "Full Stack AI Night");
  assert.equal(parsed.dateText, "May 21, 6:00 PM");
  assert.equal(parsed.statusText, "Waitlist");
});

test("parseCardFields combines Today context with card time", () => {
  const parsed = parseCardFields({
    href: "https://luma.com/today-lawyers-meetup",
    dateContextText: "Today",
    linkText: [
      "2:00 PM",
      "Taiwanese American Lawyers Meetup Ahead of the Madrona GC Summit",
      "By Cooley LLP",
      "Alder & Ash"
    ].join("\n")
  }, defaultConfig);

  assert.equal(parsed.title, "Taiwanese American Lawyers Meetup Ahead of the Madrona GC Summit");
  assert.equal(parsed.dateText, "Today, 2:00 PM");
});

test("parseCardFields combines Tomorrow context with card time", () => {
  const parsed = parseCardFields({
    href: "https://luma.com/tomorrow-open-source-tuesday",
    dateContextText: "Tomorrow",
    linkText: [
      "8:00 AM",
      "Open Source Tuesday — Free Coworking at Labour Temple",
      "By Labour Temple",
      "2800 1st Ave"
    ].join("\n")
  }, defaultConfig);

  assert.equal(parsed.title, "Open Source Tuesday — Free Coworking at Labour Temple");
  assert.equal(parsed.dateText, "Tomorrow, 8:00 AM");
});

test("parseCardFields ignores full weekday headings when choosing event titles", () => {
  const parsed = parseCardFields({
    href: "https://luma.com/ai-northwest-coffee",
    dateContextText: "May 1",
    linkText: [
      "Friday",
      "2:00 PM",
      "AI Northwest - Coffee Social + Show & Tell",
      "By Aaron Poppie",
      "The Collective Seattle",
      "Suggested: $10"
    ].join("\n")
  }, defaultConfig);

  assert.equal(parsed.title, "AI Northwest - Coffee Social + Show & Tell");
  assert.equal(parsed.dateText, "May 1, 2:00 PM");
  assert.equal(parsed.locationText, "The Collective Seattle");
});

test("parseCardFields derives venue after organizer even without city terms", () => {
  const parsed = parseCardFields({
    href: "https://luma.com/climatetech-scalathon",
    dateContextText: "May 1",
    linkText: [
      "5:00 PM",
      "ClimateTech Scalathon",
      "By Venture Mechanics Startup Launchpad, Laura ...",
      "9Zero Climate Innovation Hub",
      "$25"
    ].join("\n")
  }, defaultConfig);

  assert.equal(parsed.title, "ClimateTech Scalathon");
  assert.equal(parsed.dateText, "May 1, 5:00 PM");
  assert.equal(parsed.locationText, "9Zero Climate Innovation Hub");
});

test("parseCardFields does not use organizer lines as venue", () => {
  const parsed = parseCardFields({
    href: "https://luma.com/ai-pm-skills",
    linkText: [
      "AI PM Skills Workshop: From Discovery to Prototyping",
      "By Seattle Tech Forum, Amy Peltonen, Amandeep, Shaili Guru & 2 others"
    ].join("\n")
  }, defaultConfig);

  assert.equal(parsed.title, "AI PM Skills Workshop: From Discovery to Prototyping");
  assert.equal(parsed.locationText, null);
});
