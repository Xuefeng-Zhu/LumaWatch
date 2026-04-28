import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { eventFingerprint, eventKeyFor } from "./url.js";
import { nowIso } from "./time.js";

function relativeEventTimestamp(text, now = new Date()) {
  const normalized = String(text || "").toLowerCase();
  const match = normalized.match(/\b(today|tomorrow|mon(day)?|tue(sday)?|wed(nesday)?|thu(rsday)?|fri(day)?|sat(urday)?|sun(day)?)\b/);
  if (!match) return null;

  const target = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    12,
    0,
    0,
    0
  );
  const key = match[1].slice(0, 3).toLowerCase();
  if (key === "tom") {
    target.setDate(target.getDate() + 1);
  } else if (key !== "tod") {
    const todayIndex = now.getDay();
    const order = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
    const targetIndex = order.indexOf(key);
    if (todayIndex >= 0 && targetIndex >= 0) {
      const delta = (targetIndex - todayIndex + 7) % 7;
      target.setDate(target.getDate() + delta);
    }
  }

  const time = normalized.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i);
  if (time) {
    let hour = Number(time[1]);
    const minute = Number(time[2] || 0);
    const meridiem = time[3].toLowerCase();
    if (meridiem === "pm" && hour < 12) hour += 12;
    if (meridiem === "am" && hour === 12) hour = 0;
    target.setHours(hour, minute, 0, 0);
  }

  return target.getTime();
}

function parseEventTimestamp(value, now = new Date()) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return Number.POSITIVE_INFINITY;
  const currentYear = now.getFullYear();

  const namedNoYear = text.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})\b(?!,\s*\d{4})/i);
  if (namedNoYear) {
    const normalized = `${namedNoYear[0]}, ${currentYear}`;
    const parsedNamed = Date.parse(normalized);
    if (Number.isFinite(parsedNamed)) return parsedNamed;
  }

  const numericNoYear = text.match(/\b(\d{1,2})\/(\d{1,2})\b(?!\/\d{2,4})/);
  if (numericNoYear) {
    const normalized = `${numericNoYear[1]}/${numericNoYear[2]}/${currentYear}`;
    const parsedNumeric = Date.parse(normalized);
    if (Number.isFinite(parsedNumeric)) return parsedNumeric;
  }

  const relative = relativeEventTimestamp(text, now);
  if (relative != null) return relative;

  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
}

function eventDateTimestampFromRawJson(rawJson, now = new Date()) {
  if (!rawJson) return Number.POSITIVE_INFINITY;
  try {
    const event = JSON.parse(rawJson);
    return parseEventTimestamp(event.dateText || event.date_text || "", now);
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

export class SeenDatabase {
  constructor(dbPath) {
    this.dbPath = dbPath;
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
  }

  close() {
    this.db.close();
  }

  init() {
    this.db.exec(`
      create table if not exists sources (
        id integer primary key,
        name text unique,
        url text,
        type text,
        enabled integer,
        last_checked_at text,
        last_success_at text,
        last_error text
      );

      create table if not exists seen_events (
        event_key text primary key,
        event_url text,
        canonical_url text,
        title text,
        source_name text,
        first_seen_at text,
        last_seen_at text,
        first_notified_at text nullable,
        fingerprint text,
        raw_json text
      );

      create table if not exists event_observations (
        id integer primary key autoincrement,
        event_key text,
        observed_at text,
        source_name text,
        title text,
        event_url text,
        location_text text,
        date_text text,
        status_text text,
        fingerprint text,
        raw_json text
      );

      create table if not exists notifications (
        id integer primary key autoincrement,
        event_key text,
        channel text,
        sent_at text,
        status text,
        error text nullable,
        payload_json text
      );
    `);
  }

  upsertSource(source) {
    this.db.prepare(`
      insert into sources (name, url, type, enabled)
      values (@name, @url, @type, @enabled)
      on conflict(name) do update set
        url = excluded.url,
        type = excluded.type,
        enabled = excluded.enabled
    `).run({
      name: source.name,
      url: source.url,
      type: source.type || null,
      enabled: source.enabled === false ? 0 : 1
    });
  }

  markSourceChecked(sourceName, fields = {}) {
    this.db.prepare(`
      update sources set
        last_checked_at = @last_checked_at,
        last_success_at = coalesce(@last_success_at, last_success_at),
        last_error = @last_error
      where name = @name
    `).run({
      name: sourceName,
      last_checked_at: fields.last_checked_at || nowIso(),
      last_success_at: fields.last_success_at || null,
      last_error: fields.last_error || null
    });
  }

  getSource(name) {
    return this.db.prepare("select * from sources where name = ?").get(name);
  }

  getSeen(eventKey) {
    return this.db.prepare("select * from seen_events where event_key = ?").get(eventKey);
  }

  countSeen() {
    return this.db.prepare("select count(*) as count from seen_events").get().count;
  }

  countNotifications() {
    return this.db.prepare("select count(*) as count from notifications").get().count;
  }

  listSources() {
    return this.db.prepare(`
      select name, url, type, enabled, last_checked_at, last_success_at, last_error
      from sources
      order by name
    `).all();
  }

  listRecentSeen(limit = 20) {
    return this.db.prepare(`
      select event_key, event_url, canonical_url, title, source_name,
        first_seen_at, last_seen_at, first_notified_at, fingerprint, raw_json
      from seen_events
      order by last_seen_at desc
      limit ?
    `).all(limit);
  }

  listRecentNotifications(limit = 20) {
    return this.db.prepare(`
      select event_key, channel, sent_at, status, error, payload_json
      from notifications
      order by sent_at desc
      limit ?
    `).all(limit);
  }

  upsertSeen(event, options = {}) {
    const ts = options.now || nowIso();
    const eventKey = event.eventKey || eventKeyFor(event);
    const fingerprint = event.fingerprint || eventFingerprint(event);
    this.db.prepare(`
      insert into seen_events (
        event_key, event_url, canonical_url, title, source_name,
        first_seen_at, last_seen_at, first_notified_at, fingerprint, raw_json
      )
      values (
        @event_key, @event_url, @canonical_url, @title, @source_name,
        @first_seen_at, @last_seen_at, @first_notified_at, @fingerprint, @raw_json
      )
      on conflict(event_key) do update set
        event_url = excluded.event_url,
        canonical_url = excluded.canonical_url,
        title = excluded.title,
        source_name = excluded.source_name,
        last_seen_at = excluded.last_seen_at,
        first_notified_at = coalesce(seen_events.first_notified_at, excluded.first_notified_at),
        fingerprint = excluded.fingerprint,
        raw_json = excluded.raw_json
    `).run({
      event_key: eventKey,
      event_url: event.eventUrl || event.canonicalUrl || null,
      canonical_url: event.canonicalUrl || event.eventUrl || null,
      title: event.title || null,
      source_name: event.sourceName || null,
      first_seen_at: ts,
      last_seen_at: ts,
      first_notified_at: options.notified ? ts : null,
      fingerprint,
      raw_json: JSON.stringify(event)
    });
    return eventKey;
  }

  insertObservation(event, options = {}) {
    const ts = options.now || nowIso();
    const eventKey = event.eventKey || eventKeyFor(event);
    const fingerprint = event.fingerprint || eventFingerprint(event);
    this.db.prepare(`
      insert into event_observations (
        event_key, observed_at, source_name, title, event_url,
        location_text, date_text, status_text, fingerprint, raw_json
      )
      values (
        @event_key, @observed_at, @source_name, @title, @event_url,
        @location_text, @date_text, @status_text, @fingerprint, @raw_json
      )
    `).run({
      event_key: eventKey,
      observed_at: ts,
      source_name: event.sourceName || null,
      title: event.title || null,
      event_url: event.eventUrl || event.canonicalUrl || null,
      location_text: event.locationText || null,
      date_text: event.dateText || null,
      status_text: event.statusText || null,
      fingerprint,
      raw_json: JSON.stringify(event)
    });
    return eventKey;
  }

  insertNotification(record) {
    this.db.prepare(`
      insert into notifications (event_key, channel, sent_at, status, error, payload_json)
      values (@event_key, @channel, @sent_at, @status, @error, @payload_json)
    `).run({
      event_key: record.eventKey,
      channel: record.channel,
      sent_at: record.sentAt || nowIso(),
      status: record.status,
      error: record.error || null,
      payload_json: JSON.stringify(record.payload || {})
    });
  }

  deletePastEvents(options = {}) {
    const nowMs = Number.isFinite(options.nowMs) ? options.nowMs : Date.now();
    const nowDate = new Date(nowMs);
    const rows = this.db.prepare(`
      select event_key, raw_json
      from seen_events
    `).all();
    const staleKeys = rows
      .filter((row) => eventDateTimestampFromRawJson(row.raw_json, nowDate) < nowMs)
      .map((row) => row.event_key);
    if (!staleKeys.length) return 0;

    const deleteSeen = this.db.prepare("delete from seen_events where event_key = ?");
    const deleteObservations = this.db.prepare("delete from event_observations where event_key = ?");
    const deleteNotifications = this.db.prepare("delete from notifications where event_key = ?");
    const tx = this.db.transaction((keys) => {
      for (const key of keys) {
        deleteSeen.run(key);
        deleteObservations.run(key);
        deleteNotifications.run(key);
      }
    });
    tx(staleKeys);
    return staleKeys.length;
  }
}
