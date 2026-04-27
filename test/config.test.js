import test from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../src/luma_monitor/config.js";

test("loadConfig ignores invalid numeric environment overrides", () => {
  const config = loadConfig("missing-test-config.yaml", {
    LUMA_TIMEOUT_MS: "not-a-number",
    LUMA_SCROLL_STEPS: "-3"
  });

  assert.equal(config.browser.timeout_ms, 60000);
  assert.equal(config.browser.scroll_steps, 6);
});

test("loadConfig applies valid numeric environment overrides", () => {
  const config = loadConfig("missing-test-config.yaml", {
    LUMA_TIMEOUT_MS: "45000",
    LUMA_SCROLL_STEPS: "9"
  });

  assert.equal(config.browser.timeout_ms, 45000);
  assert.equal(config.browser.scroll_steps, 9);
});
