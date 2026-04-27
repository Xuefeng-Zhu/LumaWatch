import test from "node:test";
import assert from "node:assert/strict";
import { isLumaEventUrl, normalizeLumaEventUrl } from "../src/luma_monitor/url.js";

test("URL normalization strips query strings and hashes", () => {
  assert.equal(
    normalizeLumaEventUrl("https://luma.com/ai-seattle-build-night?utm_source=x#tickets"),
    "https://luma.com/ai-seattle-build-night"
  );
});

test("non-event links are excluded", () => {
  assert.equal(isLumaEventUrl("https://luma.com/ai"), false);
  assert.equal(isLumaEventUrl("https://luma.com/tech"), false);
  assert.equal(isLumaEventUrl("https://luma.com/seattle"), false);
  assert.equal(isLumaEventUrl("https://luma.com/ios"), false);
  assert.equal(isLumaEventUrl("https://luma.com/android"), false);
  assert.equal(isLumaEventUrl("https://example.com/ai-seattle-build-night"), false);
  assert.equal(isLumaEventUrl("https://luma.com/signin"), false);
  assert.equal(isLumaEventUrl("https://luma.com/ai-seattle-build-night"), true);
});
