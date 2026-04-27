# LumaWatch

Personal Node.js monitor for public Luma AI and tech events near Seattle.

It checks configured public Luma discovery pages, extracts public event links/cards, filters for Seattle-area AI/tech relevance, stores a persistent seen-event SQLite database, and notifies only for events that have not been seen before.

The monitor intentionally keeps only nearby events: an event must either include a configured Seattle-area term, come from the target city page, or appear in a nearby section without clear non-Seattle city signals. Broad `/ai` or `/tech` category events without nearby signals are skipped.

## Guardrails

This tool uses public pages only. It does not log in, collect guest lists, collect attendee data, access private/member-only pages, or attempt to bypass bot protection, CAPTCHAs, rate limits, or access controls. Keep schedules conservative.

## Install

```bash
npm install
npx playwright install --with-deps chromium
```

Create a config:

```bash
cp config.example.yaml config.yaml
```

Then edit `config.yaml` if needed. The default sources are:

```yaml
sources:
  - name: luma-ai
    url: https://luma.com/ai
    type: category_page
  - name: luma-tech
    url: https://luma.com/tech
    type: category_page
  - name: luma-seattle
    url: https://luma.com/seattle
    type: city_page
    enabled: false
```

Environment overrides:

```bash
LUMA_DATABASE_PATH=./luma_seen.sqlite
LUMA_HEADLESS=true
LUMA_TIMEOUT_MS=60000
LUMA_SCROLL_STEPS=6
LUMA_USER_AGENT="optional custom user agent"
```

## Commands

Initialize the database:

```bash
node src/cli.js init-db --config config.yaml
```

Create the first baseline. This saves currently visible matching events as seen and sends no notifications:

```bash
node src/cli.js baseline --config config.yaml
```

Run a normal check. This notifies only for unseen matching events:

```bash
node src/cli.js check --config config.yaml
```

Run with a visible Playwright browser window for debugging:

```bash
node src/cli.js check --config config.yaml --headed
```

`--headful` is also accepted as an alias. Use `--headless` to force headless mode for a single run, overriding `config.yaml` or `LUMA_HEADLESS`.

Each `check` run also writes a static HTML report by default:

```yaml
reports:
  enabled: true
  path: ./reports/luma-report.html
```

The report includes run metrics, new events from the current run, matching events seen in the current run, recently seen events, skipped candidates, source health, and recent notification status. Override with `LUMA_REPORT_PATH` or disable with `LUMA_REPORTS_ENABLED=false`.

If installed globally or run through `npx`, the equivalent command is:

```bash
luma-monitor check --config config.yaml
```

## Notifications

Stdout is enabled by default.

Slack:

```yaml
notifications:
  stdout:
    enabled: true
  slack:
    enabled: true
    webhook_url_env: SLACK_WEBHOOK_URL
```

```bash
export SLACK_WEBHOOK_URL="https://hooks.slack.com/services/..."
```

Telegram:

```yaml
notifications:
  telegram:
    enabled: true
    bot_token_env: TELEGRAM_BOT_TOKEN
    chat_id_env: TELEGRAM_CHAT_ID
```

```bash
export TELEGRAM_BOT_TOKEN="123:abc"
export TELEGRAM_CHAT_ID="123456"
```

## Scheduling

Cron every 30 minutes:

```cron
*/30 * * * * cd /path/to/LumaWatch && /usr/bin/node src/cli.js check --config config.yaml >> luma-watch.log 2>&1
```

A GitHub Actions example is included at `.github/workflows/luma-watch.yml`. For GitHub Actions, remember that nearby results may depend on GitHub runner IP geolocation, which is unlikely to be Seattle.

## Docker

```bash
docker build -t luma-watch .
docker run --rm \
  -v "$PWD/config.yaml:/app/config.yaml:ro" \
  -v "$PWD/data:/app/data" \
  -e SLACK_WEBHOOK_URL \
  luma-watch check --config config.yaml
```

Set `database.path: ./data/luma_seen.sqlite` when using the mounted `data` directory.

## Known Limitations

Luma nearby/category results may depend on IP geolocation. Run this from Seattle or a Seattle-geolocated environment for best results. The monitor logs a warning if a discovery page appears to show nearby results without Seattle-area signals.

Extraction is defensive because public Luma pages can change markup. The monitor keeps URL-based dedupe as the primary identity and falls back to a stable title/date/location hash only when no canonical event URL is available.

## Testing

```bash
npm test
```

Tests cover URL normalization, non-event link exclusion, SQLite schema initialization, baseline behavior, check behavior, dedupe, and relevance filtering.
