import fs from "node:fs";
import path from "node:path";

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function display(value, fallback = "Unknown") {
  return escapeHtml(value || fallback);
}

function formatTime(value) {
  if (!value) return "Unknown";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "America/Los_Angeles"
  }).format(date);
}

function parseRawJson(row) {
  try {
    return row?.raw_json ? JSON.parse(row.raw_json) : {};
  } catch {
    return {};
  }
}

function eventUrl(event) {
  return event.canonicalUrl || event.canonical_url || event.eventUrl || event.event_url || "#";
}

function eventTitle(event) {
  return event.title || "Untitled event";
}

function eventMeta(event) {
  const items = [
    { label: "When", value: event.dateText || event.date_text },
    { label: "Where", value: event.locationText || event.location_text },
    { label: "Status", value: event.statusText || event.status_text }
  ].filter((item) => item.value);

  if (!items.length) return `<div class="event-meta"><span>Details unavailable</span></div>`;
  return `<div class="event-meta">${items.map((item) => `
    <span><strong>${item.label}</strong>${display(item.value)}</span>
  `).join("")}</div>`;
}

function card(event, options = {}) {
  const url = eventUrl(event);
  const source = event.sourceName || event.source_name || "source";
  const score = event.matchScore ?? event.match_score;
  return `
    <article class="event-row ${options.highlight ? "event-row--highlight" : ""}">
      <div class="event-main">
        <div class="event-kicker">
          <span>${display(source)}</span>
          ${score != null ? `<span>score ${display(score)}</span>` : ""}
        </div>
        <a class="event-title" href="${escapeHtml(url)}" target="_blank" rel="noreferrer">${display(eventTitle(event), "Untitled event")}</a>
        ${eventMeta(event)}
        ${event.matchWhy ? `<p class="match">${display(event.matchWhy)}</p>` : ""}
      </div>
      <a class="open-link" href="${escapeHtml(url)}" target="_blank" rel="noreferrer">Open</a>
    </article>
  `;
}

function sourceRows(sources) {
  if (!sources.length) {
    return `<tr><td colspan="5">No sources configured.</td></tr>`;
  }
  return sources.map((source) => `
    <tr>
      <td><strong>${display(source.name)}</strong></td>
      <td><a href="${escapeHtml(source.url)}" target="_blank" rel="noreferrer">${display(source.url)}</a></td>
      <td><span class="badge ${source.enabled ? "badge--good" : "badge--muted"}">${display(source.enabled ? "enabled" : "disabled")}</span></td>
      <td>${display(formatTime(source.last_success_at), "never")}</td>
      <td>${source.last_error ? `<span class="badge badge--bad">error</span> ${display(source.last_error)}` : `<span class="badge badge--good">ok</span>`}</td>
    </tr>
  `).join("");
}

function notificationRows(notifications) {
  if (!notifications.length) {
    return `<tr><td colspan="4">No notifications recorded yet.</td></tr>`;
  }
  return notifications.map((notification) => `
    <tr>
      <td>${display(formatTime(notification.sent_at))}</td>
      <td>${display(notification.channel)}</td>
      <td><span class="badge ${notification.status === "sent" ? "badge--good" : "badge--bad"}">${display(notification.status)}</span></td>
      <td>${display(notification.error, "")}</td>
    </tr>
  `).join("");
}

function metric(label, value, tone = "") {
  return `
    <div class="metric ${tone ? `metric--${tone}` : ""}">
      <span>${display(label)}</span>
      <strong>${display(value, 0)}</strong>
    </div>
  `;
}

function sectionHeader(title, count, note) {
  return `
    <div class="section-header">
      <div>
        <h2>${display(title)}</h2>
        ${note ? `<p>${display(note)}</p>` : ""}
      </div>
      ${count != null ? `<span class="count">${display(count)}</span>` : ""}
    </div>
  `;
}

export function renderHtmlReport({ config, db, stats, runEvents }) {
  const generatedAt = new Date().toISOString();
  const sources = db.listSources();
  const recentSeen = db.listRecentSeen(12).map((row) => ({ ...parseRawJson(row), ...row }));
  const notifications = db.listRecentNotifications(12);
  const newEvents = runEvents.newEvents || [];
  const keptEvents = runEvents.keptEvents || [];
  const skippedEvents = runEvents.skippedEvents || [];
  const skippedPreview = skippedEvents.slice(0, 12);
  const hasSourceErrors = sources.some((source) => source.last_error);
  const statusTone = stats.newEvents > 0 ? "new" : hasSourceErrors ? "warning" : "quiet";
  const statusTitle = stats.newEvents > 0
    ? `${stats.newEvents} new event${stats.newEvents === 1 ? "" : "s"} found`
    : hasSourceErrors
      ? "One or more sources need attention"
      : "No new events this run";
  const statusCopy = stats.newEvents > 0
    ? "Review the new-event list first; each event has already been marked seen to avoid duplicate alerts."
    : hasSourceErrors
      ? "Check Source Health for the last error from each failing source."
      : "The monitor ran successfully and all matching events were already known.";

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>LumaWatch Report</title>
  <style>
    :root {
      color-scheme: light;
      --ink: #182230;
      --muted: #667085;
      --faint: #98a2b3;
      --line: #d0d5dd;
      --soft-line: #eaecf0;
      --panel: #ffffff;
      --page: #f6f8fb;
      --nav: #111827;
      --accent: #0f766e;
      --accent-soft: #ccfbf1;
      --gold: #b45309;
      --gold-soft: #fef3c7;
      --good: #067647;
      --bad: #b42318;
      --bad-soft: #fee4e2;
    }
    * { box-sizing: border-box; }
    html { scroll-behavior: smooth; }
    body {
      margin: 0;
      background: var(--page);
      color: var(--ink);
      font: 14px/1.5 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    header {
      background: var(--nav);
      color: #fff;
      padding: 22px 32px;
      border-bottom: 4px solid var(--accent);
      position: sticky;
      top: 0;
      z-index: 5;
    }
    .header-inner {
      width: min(1180px, calc(100vw - 32px));
      margin: 0 auto;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 18px;
    }
    main {
      width: min(1180px, calc(100vw - 32px));
      margin: 24px auto 48px;
    }
    h1, h2, h3, p { margin: 0; letter-spacing: 0; }
    h1 { font-size: 22px; line-height: 1.15; }
    h2 { font-size: 18px; }
    a { color: var(--accent); text-decoration: none; }
    a:hover { text-decoration: underline; }
    .subhead { color: #d7e3ea; margin-top: 5px; font-size: 13px; }
    .nav-links {
      display: flex;
      gap: 6px;
      flex-wrap: wrap;
      justify-content: flex-end;
    }
    .nav-links a {
      color: #e5e7eb;
      border: 1px solid rgba(255,255,255,0.18);
      border-radius: 999px;
      padding: 5px 10px;
      font-size: 12px;
    }
    .status {
      border: 1px solid var(--line);
      border-left: 6px solid var(--accent);
      background: var(--panel);
      border-radius: 8px;
      padding: 18px 20px;
      margin-bottom: 16px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
    }
    .status--new { border-left-color: var(--accent); background: linear-gradient(90deg, var(--accent-soft), #fff 38%); }
    .status--warning { border-left-color: var(--gold); background: linear-gradient(90deg, var(--gold-soft), #fff 38%); }
    .status h2 { font-size: 20px; margin-bottom: 4px; }
    .status p { color: var(--muted); }
    .status-chip {
      border: 1px solid var(--line);
      border-radius: 999px;
      padding: 7px 11px;
      color: var(--muted);
      background: #fff;
      white-space: nowrap;
    }
    .metrics {
      display: grid;
      grid-template-columns: repeat(6, minmax(0, 1fr));
      gap: 12px;
      margin-bottom: 28px;
    }
    .metric {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
      box-shadow: 0 1px 2px rgba(16, 24, 40, 0.04);
      padding: 14px;
      min-height: 92px;
    }
    .metric span { display: block; color: var(--muted); font-size: 12px; text-transform: uppercase; }
    .metric strong { display: block; margin-top: 8px; font-size: 27px; line-height: 1; }
    .metric--good strong { color: var(--good); }
    .metric--warn strong { color: var(--gold); }
    .metric--bad strong { color: var(--bad); }
    section {
      border-top: 1px solid var(--line);
      padding-top: 22px;
      margin-bottom: 30px;
      scroll-margin-top: 110px;
    }
    .section-header {
      display: flex;
      align-items: end;
      justify-content: space-between;
      gap: 16px;
      margin-bottom: 14px;
    }
    .section-header p { color: var(--muted); margin-top: 3px; }
    .count {
      min-width: 34px;
      text-align: center;
      border: 1px solid var(--line);
      border-radius: 999px;
      color: var(--muted);
      padding: 3px 9px;
      background: #fff;
    }
    .event-list { display: grid; gap: 10px; }
    .event-row {
      display: flex;
      justify-content: space-between;
      gap: 16px;
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 15px 16px;
      background: #fff;
      align-items: center;
    }
    .event-row--highlight { border-color: #5eead4; box-shadow: inset 4px 0 0 var(--accent); }
    .event-main { min-width: 0; }
    .event-kicker {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      color: var(--faint);
      font-size: 12px;
      text-transform: uppercase;
      margin-bottom: 4px;
    }
    .event-title { color: var(--ink); font-weight: 750; font-size: 16px; line-height: 1.3; }
    .event-meta {
      display: flex;
      flex-wrap: wrap;
      gap: 7px 12px;
      color: var(--muted);
      margin-top: 8px;
    }
    .event-meta strong {
      color: var(--ink);
      margin-right: 4px;
      font-weight: 650;
    }
    .match { margin-top: 8px; color: var(--accent); }
    .open-link {
      flex: 0 0 auto;
      border: 1px solid var(--line);
      border-radius: 6px;
      padding: 7px 10px;
      color: var(--ink);
      background: #fff;
      font-weight: 650;
    }
    .open-link:hover { border-color: var(--accent); text-decoration: none; }
    .table-wrap {
      border: 1px solid var(--line);
      border-radius: 8px;
      overflow: hidden;
      background: #fff;
    }
    table { width: 100%; border-collapse: collapse; }
    th, td { text-align: left; border-bottom: 1px solid var(--soft-line); padding: 10px 12px; vertical-align: top; }
    tr:last-child td { border-bottom: 0; }
    th { color: var(--muted); font-size: 12px; text-transform: uppercase; background: #f9fafb; }
    .empty {
      color: var(--muted);
      border: 1px dashed var(--line);
      border-radius: 8px;
      padding: 20px;
      background: #fff;
    }
    details {
      border-top: 1px solid var(--line);
      padding-top: 18px;
      margin-bottom: 28px;
    }
    summary {
      cursor: pointer;
      font-weight: 750;
      font-size: 18px;
      margin-bottom: 14px;
    }
    .badge {
      display: inline-flex;
      align-items: center;
      border-radius: 999px;
      padding: 2px 8px;
      font-size: 12px;
      font-weight: 700;
      background: #f2f4f7;
      color: var(--muted);
    }
    .badge--good { background: #dcfae6; color: var(--good); }
    .badge--bad { background: var(--bad-soft); color: var(--bad); }
    .badge--muted { background: #f2f4f7; color: var(--muted); }
    @media (max-width: 860px) {
      header { position: static; padding: 18px 0; }
      .header-inner, main { width: min(100vw - 24px, 1180px); }
      .header-inner { align-items: flex-start; flex-direction: column; }
      .nav-links { justify-content: flex-start; }
      .metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .status, .event-row, .section-header { display: block; }
      .status-chip, .open-link { display: inline-block; margin-top: 12px; }
      .table-wrap { overflow-x: auto; }
      table { min-width: 760px; }
    }
  </style>
</head>
<body>
  <header>
    <div class="header-inner">
      <div>
        <h1>LumaWatch Report</h1>
        <div class="subhead">Generated ${display(formatTime(generatedAt))} · ${display(config.location?.target_city, "target city")} · ${display(stats.mode)}</div>
      </div>
      <nav class="nav-links" aria-label="Report sections">
        <a href="#new">New</a>
        <a href="#seen">Seen</a>
        <a href="#sources">Sources</a>
        <a href="#notifications">Notifications</a>
      </nav>
    </div>
  </header>
  <main>
    <div class="status status--${statusTone}">
      <div>
        <h2>${display(statusTitle)}</h2>
        <p>${display(statusCopy)}</p>
      </div>
      <span class="status-chip">${display(stats.sourcesChecked, 0)} sources checked</span>
    </div>

    <div class="metrics" aria-label="Run metrics">
      ${metric("Sources", stats.sourcesChecked)}
      ${metric("Candidates", stats.candidates)}
      ${metric("Kept", stats.kept, "good")}
      ${metric("Skipped", stats.skipped, stats.skipped > 0 ? "warn" : "")}
      ${metric("New", stats.newEvents, stats.newEvents > 0 ? "good" : "")}
      ${metric("Notifications", stats.notificationsAttempted)}
    </div>

    <section id="new">
      ${sectionHeader("New Events This Run", newEvents.length, "Only events not previously seen are listed here.")}
      ${newEvents.length ? `<div class="event-list">${newEvents.map((event) => card(event, { highlight: true })).join("")}</div>` : `<div class="empty">No unseen matching events were found in this run.</div>`}
    </section>

    <section id="seen">
      ${sectionHeader("Matching Events Seen This Run", keptEvents.length, "These matched the Seattle AI/tech filter and were recorded as seen.")}
      ${keptEvents.length ? `<div class="event-list">${keptEvents.slice(0, 20).map((event) => card(event)).join("")}</div>` : `<div class="empty">No matching events were kept in this run.</div>`}
    </section>

    <details>
      <summary>Recently Seen Events (${display(recentSeen.length, 0)})</summary>
      ${recentSeen.length ? `<div class="event-list">${recentSeen.map((event) => card(event)).join("")}</div>` : `<div class="empty">No seen events in the database yet.</div>`}
    </details>

    <details>
      <summary>Skipped Candidates (${display(skippedPreview.length, 0)})</summary>
      ${skippedPreview.length ? `<div class="event-list">${skippedPreview.map((item) => `
        <article class="event-row">
          <div class="event-main">
            <div class="event-kicker"><span>${display(item.event?.sourceName, "source")}</span><span>score ${display(item.score, 0)}</span></div>
            <a class="event-title" href="${escapeHtml(eventUrl(item.event))}" target="_blank" rel="noreferrer">${display(eventTitle(item.event), "Untitled event")}</a>
            <div class="event-meta"><span>${display(item.reasons?.join("; "), "No reason")}</span></div>
          </div>
          <a class="open-link" href="${escapeHtml(eventUrl(item.event))}" target="_blank" rel="noreferrer">Open</a>
        </article>
      `).join("")}</div>` : `<div class="empty">No candidates were skipped in this run.</div>`}
    </details>

    <section id="sources">
      ${sectionHeader("Source Health", sources.length, "Last successful checks and errors for every configured source.")}
      <div class="table-wrap">
        <table>
          <thead><tr><th>Name</th><th>URL</th><th>Status</th><th>Last success</th><th>Last error</th></tr></thead>
          <tbody>${sourceRows(sources)}</tbody>
        </table>
      </div>
    </section>

    <section id="notifications">
      ${sectionHeader("Recent Notifications", notifications.length, "Delivery results from stdout, Slack, and Telegram adapters.")}
      <div class="table-wrap">
        <table>
          <thead><tr><th>Sent at</th><th>Channel</th><th>Status</th><th>Error</th></tr></thead>
          <tbody>${notificationRows(notifications)}</tbody>
        </table>
      </div>
    </section>
  </main>
</body>
</html>`;
}

export function writeHtmlReport({ config, db, stats, runEvents, logger }) {
  if (!config.reports?.enabled) return null;
  const reportPath = config.reports.path;
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  const html = renderHtmlReport({ config, db, stats, runEvents });
  fs.writeFileSync(reportPath, html, "utf8");
  logger?.info("HTML report generated", { path: reportPath });
  return reportPath;
}
