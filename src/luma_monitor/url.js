import crypto from "node:crypto";

const EVENT_HOSTS = new Set(["luma.com", "www.luma.com", "lu.ma", "www.lu.ma"]);
const NON_EVENT_SEGMENTS = new Set([
  "",
  "about",
  "ai",
  "api",
  "calendar",
  "careers",
  "category",
  "city",
  "create",
  "discover",
  "explore",
  "help",
  "home",
  "android",
  "ios",
  "login",
  "pricing",
  "privacy",
  "search",
  "seattle",
  "signin",
  "sign-in",
  "signup",
  "sign-up",
  "tech",
  "terms"
]);

export function normalizeUrl(input) {
  if (!input) return null;
  try {
    const url = new URL(input, "https://luma.com");
    url.hash = "";
    url.search = "";
    url.protocol = "https:";
    url.hostname = url.hostname.toLowerCase().replace(/^www\./, "");
    url.pathname = url.pathname.replace(/\/+$/, "");
    return url.toString();
  } catch {
    return null;
  }
}

export function isLumaEventUrl(input) {
  const normalized = normalizeUrl(input);
  if (!normalized) return false;
  const url = new URL(normalized);
  if (!EVENT_HOSTS.has(url.hostname)) return false;
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length === 0) return false;
  if (parts.length > 2) return false;
  if (NON_EVENT_SEGMENTS.has(parts[0].toLowerCase())) return false;
  if (parts[0].startsWith("@")) return false;
  return true;
}

export function normalizeLumaEventUrl(input) {
  const normalized = normalizeUrl(input);
  if (!normalized || !isLumaEventUrl(normalized)) return null;
  return normalized;
}

export function extractEventId(input) {
  const normalized = normalizeLumaEventUrl(input);
  if (!normalized) return null;
  const url = new URL(normalized);
  const parts = url.pathname.split("/").filter(Boolean);
  return parts.at(-1) || null;
}

export function stableHash(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function eventKeyFor(event) {
  const canonical = normalizeLumaEventUrl(event.canonicalUrl || event.eventUrl);
  if (canonical) return canonical;
  if (event.eventId) return `luma:${event.eventId}`;
  const fallback = [
    event.title || "",
    event.dateText || "",
    event.locationText || ""
  ].join("|").toLowerCase().trim();
  return `fallback:${stableHash(fallback)}`;
}

export function eventFingerprint(event) {
  return stableHash(JSON.stringify({
    title: event.title || "",
    dateText: event.dateText || "",
    locationText: event.locationText || "",
    statusText: event.statusText || "",
    canonicalUrl: event.canonicalUrl || event.eventUrl || ""
  }));
}
