// Odds sync CLI — spec Section 6 Step 1.4 / Week 3.
// Thin wrapper for manual/local runs around the shared sync logic in
// src/lib/sync-odds-core.ts, which is also used by the Vercel Cron route
// handler (src/app/api/cron/sync-odds/route.ts) that runs this in
// production. Keeping the logic in one place means "what I run by hand"
// and "what actually runs on schedule" can't drift apart.
import { runOddsSync } from "../src/lib/sync-odds-core.ts";

const force = process.argv.includes("--force");

runOddsSync({ skipRateLimit: force })
  .then((report) => {
    if (report.skipped) {
      console.log(`${report.skipReason} Skipping to conserve API quota. Pass --force to override.`);
      return;
    }
    console.log(`Odds API quota — used: ${report.quotaUsed}, remaining: ${report.quotaRemaining}`);
    console.log("\n=== Sync report ===");
    console.log(`Events created: ${report.eventsCreated}`);
    console.log(`Fights created: ${report.fightsCreated}`);
    console.log(`Fights cancelled (opponent replaced): ${report.fightsCancelled}`);
    if (report.cancelledLog.length) console.log("  ->", report.cancelledLog.join(" | "));
    console.log(`Odds snapshots inserted: ${report.snapshotsInserted}`);
    console.log(`Skipped (couldn't confidently match both fighters — likely non-UFC or unlisted debut): ${report.skippedUnmatched.length}`);
    if (report.skippedUnmatched.length) console.log("  ->", report.skippedUnmatched.join(" | "));
    if (report.variantMatches.length) {
      console.log(`Name-variant matches used (${report.variantMatches.length}):`);
      console.log("  ->", report.variantMatches.join(" | "));
    }
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
