import { sleep } from "./time.js";

export class RetryableError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = "RetryableError";
    this.retryAfterMs = options.retryAfterMs;
    this.cause = options.cause;
  }
}

export function retryAfterHeaderToMs(value) {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const dateMs = Date.parse(value);
  if (Number.isFinite(dateMs)) return Math.max(0, dateMs - Date.now());
  return null;
}

export async function withRetries(fn, options = {}) {
  const {
    attempts = 3,
    baseDelayMs = 1000,
    maxDelayMs = 30000,
    logger,
    label = "operation"
  } = options;

  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fn(attempt);
    } catch (error) {
      lastError = error;
      if (attempt >= attempts) break;
      const retryAfterMs = error instanceof RetryableError ? error.retryAfterMs : null;
      const delayMs = retryAfterMs ?? Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1));
      logger?.warn("Retrying transient failure", {
        label,
        attempt,
        delay_ms: delayMs,
        error: error.message
      });
      await sleep(delayMs);
    }
  }
  throw lastError;
}
