#!/usr/bin/env node
import { loadConfig } from "./luma_monitor/config.js";
import { createLogger } from "./luma_monitor/logger.js";
import { initDatabase, runMonitor } from "./luma_monitor/monitor.js";

function parseArgs(argv) {
  const args = { command: argv[2], config: "config.yaml" };
  if (argv.includes("--help") || argv.includes("-h")) {
    args.help = true;
  }
  for (let index = 3; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--config" || arg === "-c") {
      args.config = argv[index + 1];
      index += 1;
    }
  }
  return args;
}

function printHelp() {
  console.log(`Usage:
  luma-monitor init-db --config config.yaml
  luma-monitor baseline --config config.yaml
  luma-monitor check --config config.yaml

Commands:
  init-db   Create or migrate the SQLite schema and source rows.
  baseline  Discover current matching events and mark them seen without notifications.
  check     Discover current matching events and notify only for unseen events.`);
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help || !args.command) {
    printHelp();
    return;
  }

  const logger = createLogger();
  const config = loadConfig(args.config);

  if (args.command === "init-db") {
    const db = await initDatabase(config, logger);
    db.close();
    return;
  }

  if (args.command === "baseline" || args.command === "check") {
    const stats = await runMonitor(config, { mode: args.command, logger });
    if (args.command === "baseline") {
      logger.info("Baseline completed without notifications", stats);
    }
    return;
  }

  console.error(`Unknown command: ${args.command}`);
  printHelp();
  process.exitCode = 2;
}

main().catch((error) => {
  console.error(JSON.stringify({
    time: new Date().toISOString(),
    level: "error",
    message: "Fatal CLI error",
    meta: { error: error.message, stack: error.stack }
  }));
  process.exitCode = 1;
});
