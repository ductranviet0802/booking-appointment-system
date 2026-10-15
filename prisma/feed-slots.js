#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */
const { loadEnvConfig } = require("@next/env");
const { Client } = require("pg");
const { feedSlots, parseOptions } = require("./seed/slot-feed");

const HELP = `Usage: npm run slots:feed -- [--month YYYY-MM] [--dry-run]

Feeds missing 09:00-17:00 Vietnam slots for every doctor. The default range is
UTC today through today + BOOKING_WINDOW_DAYS (inclusive). --month loads the
whole calendar month. --dry-run reports missing slots without inserting them.`;

async function main() {
  loadEnvConfig(process.cwd());
  const options = parseOptions(process.argv.slice(2));
  if (options.help) {
    console.log(HELP);
    return;
  }
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set.");

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  try {
    await client.connect();
    const result = await feedSlots({ client, options });
    console.log(`${result.dryRun ? "Missing" : "Inserted"} ${result.missing} slots for ${result.doctors} doctors (${result.from} through ${result.to}).`);
  } finally {
    await client.end().catch(() => {});
  }
}

if (require.main === module) {
  main().catch((error) => {
    const message = error instanceof Error && (/^(DATABASE_URL|BOOKING_WINDOW_DAYS|--month|--dry-run|Unknown option|No doctors|A PostgreSQL)/.test(error.message))
      ? error.message
      : "Slot feed failed. Check DATABASE_URL, database connectivity, and migration state.";
    console.error(message);
    process.exitCode = 1;
  });
}

module.exports = { main };
