export function nowIso() {
  return new Date().toISOString();
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function randomJitterMs(seconds = 0) {
  if (!seconds || seconds <= 0) return 0;
  return Math.floor(Math.random() * seconds * 1000);
}
