/**
 * Run the retention/GC sweep once and print the outcome.
 *
 *   npm run retention
 *
 * Safe to schedule from cron (e.g. nightly). Deletes only rows past the configured retention
 * windows; see src/lib/retention.ts for the environment variables and the compliance caveat.
 */
async function main() {
  const { getDb } = await import("../src/db");
  const { runRetentionSweep } = await import("../src/lib/retention");
  const db = await getDb();
  const result = await runRetentionSweep(db);
  console.log(JSON.stringify({ sweptAt: new Date().toISOString(), ...result }, null, 2));
  process.exit(0);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
