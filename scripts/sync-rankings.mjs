// Rankings sync CLI — thin wrapper for manual/local runs around the shared
// logic in src/lib/sync-rankings-core.ts, which is also used by the Vercel
// Cron route handler (src/app/api/cron/sync-rankings/route.ts) that runs
// this weekly in production.
import { runRankingsSync } from "../src/lib/sync-rankings-core.ts";

runRankingsSync()
  .then((report) => {
    console.log("=== Rankings sync report ===");
    console.log(`Groups parsed (divisions + P4P lists): ${report.groupsParsed}`);
    console.log(`Entries parsed: ${report.entriesParsed}`);
    console.log(`Matched: ${report.matched}`);
    console.log(`Cleared (no longer ranked): ${report.cleared}`);
    console.log(`Unmatched (${report.unmatched.length}):`);
    if (report.unmatched.length) console.log("  ->", report.unmatched.join(" | "));
    if (report.variantMatches.length) {
      console.log(`Name-variant matches used (${report.variantMatches.length}):`);
      console.log("  ->", report.variantMatches.join(" | "));
    }
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
