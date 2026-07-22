// Win Simulator per-fighter stats — spec Section 3 / Week 5.
// Aggregates each fighter's CAREER finish behavior from completed fights
// (order doesn't matter here, unlike Elo — these are simple career totals,
// not point-in-time snapshots):
//   - historical_finish_rate: fraction of their WINS that were finishes
//   - historical_finish_speed: how early they finish, 0-1 (1 = fast), the
//     mean fraction of scheduled time NOT used across their finishes,
//     inverted so higher = faster (matches the round-weight formula in
//     src/lib/simulator.ts)
//   - historical_gets_finished_rate: fraction of their LOSSES that were
//     finishes (inverse of durability — how often they personally get
//     finished when they lose)
// Reuses resolveFightOutcome's finish/decision classification (from
// scripts/lib/replay-helpers.mjs) so this agrees with the Elo/feature
// pipeline's notion of "finish" — same heuristic-on-a-heuristic caveat
// applies (time-based, since the source data has no method column).
import { createClient } from "@supabase/supabase-js";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { buildStatsLookup, fetchAll as fetchAllShared, resolveFightOutcome } from "./lib/replay-helpers.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SEED_DIR = path.join(__dirname, "..", "data", "seed");

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const fetchAll = (table, columns) => fetchAllShared(supabase, table, columns);

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function newStats() {
  return { winsTotal: 0, winsFinished: 0, lossesTotal: 0, lossesFinished: 0, finishTimeFractions: [] };
}

async function main() {
  console.log("Building stats lookup from seed CSV...");
  const statsLookup = buildStatsLookup(SEED_DIR);

  console.log("Fetching fighters and fights...");
  const fighters = await fetchAll("fighters", "id");
  const fights = await fetchAll(
    "fights",
    `id, fighter_a_id, fighter_b_id, result_winner_id, result_method, result_round, result_time, scheduled_rounds, status,
     is_title_fight, weight_class,
     fighter_a:fighter_a_id(ufcstats_id), fighter_b:fighter_b_id(ufcstats_id), event:event_id(date, name)`
  );

  const completed = fights.filter((f) => f.status === "completed");
  const stats = new Map(fighters.map((f) => [f.id, newStats()]));
  const titlesWonByFighter = new Map(); // required by resolveFightOutcome's signature, unused here

  let processed = 0;
  for (const fight of completed) {
    const { fighter_a_id, fighter_b_id, result_winner_id, scheduled_rounds } = fight;
    if (!stats.has(fighter_a_id) || !stats.has(fighter_b_id) || !result_winner_id) continue;

    const { methodLabel, totalFightSeconds } = resolveFightOutcome(fight, statsLookup, titlesWonByFighter);
    if (!methodLabel.startsWith("finish") && !methodLabel.startsWith("decision")) continue; // draw/nc

    const isFinish = methodLabel.startsWith("finish");
    const loserId = result_winner_id === fighter_a_id ? fighter_b_id : fighter_a_id;
    const winnerStats = stats.get(result_winner_id);
    const loserStats = stats.get(loserId);

    winnerStats.winsTotal++;
    loserStats.lossesTotal++;

    if (isFinish) {
      winnerStats.winsFinished++;
      loserStats.lossesFinished++;

      const scheduledSeconds = (scheduled_rounds ?? 3) * 300;
      if (totalFightSeconds && scheduledSeconds > 0) {
        winnerStats.finishTimeFractions.push(totalFightSeconds / scheduledSeconds);
      }
    }
    processed++;
  }

  console.log(`Processed ${processed} completed decisive fights.`);

  const updates = [];
  for (const [id, s] of stats) {
    const finishRate = s.winsTotal > 0 ? s.winsFinished / s.winsTotal : null;
    const getsFinishedRate = s.lossesTotal > 0 ? s.lossesFinished / s.lossesTotal : null;
    const finishSpeed = s.finishTimeFractions.length
      ? 1 - s.finishTimeFractions.reduce((a, b) => a + b, 0) / s.finishTimeFractions.length
      : null;
    if (finishRate === null && getsFinishedRate === null && finishSpeed === null) continue;
    updates.push({
      id,
      historical_finish_rate: finishRate === null ? null : Math.round(finishRate * 1000) / 1000,
      historical_finish_speed: finishSpeed === null ? null : Math.round(finishSpeed * 1000) / 1000,
      historical_gets_finished_rate: getsFinishedRate === null ? null : Math.round(getsFinishedRate * 1000) / 1000,
    });
  }

  console.log(`Writing stats for ${updates.length} fighters...`);
  const CONCURRENCY = 25;
  let written = 0;
  for (const batch of chunk(updates, CONCURRENCY)) {
    await Promise.all(
      batch.map(async (u) => {
        const { id, ...fields } = u;
        const { error } = await supabase.from("fighters").update(fields).eq("id", id);
        if (error) console.warn(`Failed to update ${id}:`, error.message);
        else written++;
      })
    );
  }

  console.log(`Wrote ${written} / ${updates.length}.`);

  const { data: sample, error: sampleErr } = await supabase
    .from("fighters")
    .select("full_name, historical_finish_rate, historical_finish_speed, historical_gets_finished_rate, wins, losses")
    .order("historical_finish_rate", { ascending: false })
    .limit(5);
  if (sampleErr) throw sampleErr;
  console.log("\nTop 5 by finish rate:");
  sample.forEach((f) =>
    console.log(`${f.full_name}: finish_rate=${f.historical_finish_rate}, finish_speed=${f.historical_finish_speed}, gets_finished_rate=${f.historical_gets_finished_rate} (${f.wins}-${f.losses})`)
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
