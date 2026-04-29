# LumaWatch Agent Guide

This file is for coding agents working on LumaWatch. It gives the project shape, important invariants, and the commands that matter most.

## Project Purpose

LumaWatch is a personal Node.js monitor for public Luma discovery pages. It finds public AI, tech, and related events near the machine/session running the script, filters them for configured location and relevance signals, stores seen events in SQLite, sends notifications only for unseen events, and writes a static HTML report.

The current sample/local config targets Seattle-area terms, but the project is not inherently Seattle-only. Luma's `Nearby Events` results can depend on browser/session geolocation, IP location, and where the script is run.

The tool intentionally uses only public pages. Do not add login flows, attendee scraping, private-page access, CAPTCHA bypassing, or rate-limit bypassing.

## Runtime Stack

- Node.js ESM project, `type: module`
- Playwright Chromium for public page extraction
- SQLite through `better-sqlite3`
- YAML config through `yaml`
- Native `node:test` test suite

## Main Commands

```bash
npm install
npx playwright install --with-deps chromium
npm test
node src/cli.js init-db --config config.yaml
node src/cli.js baseline --config config.yaml
node src/cli.js check --config config.yaml
node src/cli.js check --config config.yaml --headed
```

`baseline` records current matching events as seen without notifications. `check` records observations, updates seen events, sends notifications for unseen kept events, and writes the HTML report.

## Source Map

- `src/cli.js`: CLI argument parsing and command dispatch.
- `src/luma_monitor/config.js`: default config, YAML loading, environment overrides.
- `src/luma_monitor/extractor.js`: Playwright navigation, Nearby Events extraction, Luma card parsing, optional detail enrichment.
- `src/luma_monitor/filter.js`: configured-location and AI/tech relevance scoring.
- `src/luma_monitor/monitor.js`: run orchestration, source loop, scoring, dedupe, database writes, notifications, report generation.
- `src/luma_monitor/db.js`: SQLite schema and persistence helpers.
- `src/luma_monitor/report.js`: static HTML report rendering and event-date sorting.
- `src/luma_monitor/notifications.js`: stdout, Slack, Telegram notification adapters.
- `src/luma_monitor/url.js`: URL normalization, event keys, fingerprints.
- `src/luma_monitor/retry.js`: retryable navigation helpers.
- `src/luma_monitor/time.js`: time helpers.
- `test/*.test.js`: regression tests for config, extraction, filtering, monitor behavior, database behavior, and URL logic.

## Data Flow

1. `runMonitor` initializes the database and configured sources.
2. `LumaExtractor.extractSource` opens each enabled Luma source.
3. The extractor scrolls to the `Nearby Events` section and collects visible Luma event anchors.
4. `parseCardFields` derives title, date, location, and status from link/card text.
5. `scoreEvent` decides whether the candidate is relevant enough to keep.
6. Every candidate observation is inserted into `event_observations`.
7. Kept events are deduped by event key for current-run report lists.
8. `seen_events` prevents duplicate notifications across runs.
9. `writeHtmlReport` writes `reports/luma-report.html` when reports are enabled.

## Architecture & Workflow Diagram

```mermaid
flowchart TD
  A[CLI: src/cli.js
init-db, baseline, check] --> B[loadConfig
src/luma_monitor/config.js]
  B --> C[runMonitor
src/luma_monitor/monitor.js]
  C --> D[(SQLite)
src/luma_monitor/db.js]
  C --> E{Enabled sources}
  E --> F[LumaExtractor.extractSource
src/luma_monitor/extractor.js]
  F --> G[Nearby Events anchors
parseCardFields]
  G --> H[scoreEvent
src/luma_monitor/filter.js]
  H --> I[Insert observation
event_observations]
  H --> J{Kept?}
  J -- no --> K[Next candidate]
  J -- yes --> L[normalizeUrl / buildEventKey
src/luma_monitor/url.js]
  L --> M[Dedup within run
canonical event once]
  M --> N[seen_events check]
  N --> O[Notify unseen only
src/luma_monitor/notifications.js]
  M --> P[writeHtmlReport
src/luma_monitor/report.js]
```

This diagram mirrors the invariants above: extraction is limited to public Nearby Events, all candidates are observed in SQLite, dedupe is key-based, and notifications trigger only for unseen kept events.

## Important Invariants

- Extraction should only use the Nearby Events section from public Luma pages.
- Canonical URL/event key dedupe is the primary identity mechanism.
- Fallback fingerprints are based on stable event fields when no canonical URL exists.
- Keep per-source observations in SQLite even when report rows are deduped.
- Current-run report lists should show a canonical event only once, even if multiple sources found it.
- Do not treat day headings like `Friday` as titles.
- Do not treat organizer lines like `By Some Local Tech Forum` as venues.
- Prefer exact date context such as `May 1, 2:00 PM` over a lone weekday.
- Avoid broad UI/non-event links such as `/ios`, `/android`, `/pricing`, `/help`, and `/discover`.

## Configuration Notes

Primary config lives in `config.yaml`; defaults are mirrored in `config.example.yaml`.

Configured sources currently include:

```yaml
sources:
  - name: luma-ai
    url: https://luma.com/ai
    type: category_page
  - name: luma-tech
    url: https://luma.com/tech
    type: category_page
  - name: luma-food
    url: https://luma.com/food
    type: category_page
  - name: luma-seattle
    url: https://luma.com/seattle
    type: city_page
    enabled: false
```

When adding config keys, update `config.example.yaml`, `README.md` when user-facing, and tests if defaults or env overrides change.

## Testing Guidance

Run the full suite after code changes:

```bash
npm test
```

Add focused regression tests for parser changes. Luma markup is dynamic, so examples from real bad report rows are valuable test fixtures.

Useful test locations:

- Extraction/card parsing: `test/extractor.test.js`
- Monitor orchestration, report behavior, notifications, dedupe: `test/monitor.test.js`
- URL identity/fingerprint behavior: `test/url.test.js`
- Relevance scoring: `test/filter.test.js`
- Config/env behavior: `test/config.test.js`

## Common Gotchas

- Luma pages use virtualized lists. The extractor scrolls both page and scrollable containers.
- Nearby results can depend on IP/session geolocation; GitHub Actions or another remote runner may see events local to that runner instead of the operator's physical location.
- Detail enrichment is off by default because it is slower and noisier.
- The report can show stale historical rows from the database; current-run sections come from `runEvents`.
- If a row appears twice in the current-run report, check event key/canonical URL dedupe before changing report rendering.
- If a title becomes `Friday`, `Tuesday`, or similar, fix date/title parsing in `parseCardFields`.
- If `Where` starts with `By ...`, fix organizer/location parsing in `parseCardFields`.

## Change Hygiene

- Keep scraper changes conservative and covered by tests.
- Do not broaden extraction beyond public Nearby Events unless explicitly requested.
- Stage only intended files; this repo may have local untracked files such as `.codex`.
- Do not commit generated reports or local SQLite data unless explicitly requested.
