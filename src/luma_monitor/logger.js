export function createLogger(level = process.env.LOG_LEVEL || "info") {
  const levels = new Map([
    ["debug", 10],
    ["info", 20],
    ["warn", 30],
    ["error", 40]
  ]);
  const active = levels.get(level) ?? levels.get("info");

  function write(name, message, meta) {
    if ((levels.get(name) ?? 99) < active) return;
    const payload = {
      time: new Date().toISOString(),
      level: name,
      message,
      ...(meta && Object.keys(meta).length > 0 ? { meta } : {})
    };
    const line = JSON.stringify(payload);
    if (name === "error" || name === "warn") {
      console.error(line);
    } else {
      console.log(line);
    }
  }

  return {
    debug: (message, meta) => write("debug", message, meta),
    info: (message, meta) => write("info", message, meta),
    warn: (message, meta) => write("warn", message, meta),
    error: (message, meta) => write("error", message, meta)
  };
}
