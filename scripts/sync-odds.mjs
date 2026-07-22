// Odds sync — spec Section 6 Step 1.4 / Week 3.
// Pulls current moneylines for upcoming MMA fights from The Odds API and
// writes them into odds_snapshots (append-only time series, per spec
// Section 1 — each run adds new rows so line movement over time is
// preserved, never overwrites a prior snapshot).
//
// The Odds API's only MMA sport key (mma_mixed_martial_arts) covers every
// promotion — UFC, Bellator, KSW, ONE, PFL, etc. — with no way to filter by
// league, and gives no card/PPV grouping or weight class either. To keep
// this UFC-only and avoid inventing fighter data, a bout is only accepted
// if BOTH fighters already match a row in our `fighters` table (built from
// UFCStats history) — a promotion outside the UFC essentially never
// matches, so this doubles as the UFC filter. Matching tries an exact name
// first, then falls back to (first token, last suffix-stripped last token)
// to catch name-variant mismatches (e.g. the API's "Ian Garry" against our
// historical "Ian Machado Garry", or "Khalil Rountree" against "Khalil
// Rountree Jr.") — but only when that fallback resolves to exactly one
// existing fighter, to avoid merging two different people. A final fallback
// matches on last name alone (e.g. the API's "Stephen Erceg" / "Ramazonbek
// Temirov" against our historical "Steve Erceg" / "Ramazan Temirov" — a
// legal-name-vs-known-as mismatch, not a suffix), again only when the last
// name is unique across the whole roster — common surnames (e.g. "Silva")
// have multiple fighters and correctly fall through to unmatched instead of
// guessing. Bouts where
// either side can't be confidently matched are skipped and reported, not
// guessed at; a genuine UFC debut with no prior UFCStats record will be
// skipped until it's added to the roster by some other means.
//
// Fights on the same card don't carry a shared card identifier from the
// API, so they're grouped by exact commence_time; the resulting `events`
// row is named generically ("UFC — <date>") since we don't have the real
// card name (e.g. "UFC 305") from this source. weight_class is left null
// on these auto-created fights — not provided by this API either.
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ODDS_API_KEY = process.env.ODDS_API_KEY;

// Free-tier request cap safety net: this script is the ONLY thing that ever
// calls The Odds API (the site itself only ever reads odds_snapshots rows
// out of our own database — see src/lib/upcoming-card.ts — so a page visit
// never spends API quota). This guard stops an accidental double-run (or an
// over-eager cron) from burning credits faster than intended. Pass --force
// to bypass it.
const MIN_SYNC_INTERVAL_HOURS = 3;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}
if (!ODDS_API_KEY) {
  console.error("Missing ODDS_API_KEY.");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const NAME_SUFFIXES = new Set(["jr", "jr.", "sr", "sr.", "ii", "iii", "iv"]);

function nameTokens(fullName) {
  const parts = fullName.trim().toLowerCase().split(/\s+/);
  let last = parts[parts.length - 1];
  if (NAME_SUFFIXES.has(last) && parts.length > 1) {
    parts.pop();
    last = parts[parts.length - 1];
  }
  return { first: parts[0], last };
}

async function fetchAll(table, columns) {
  const rows = [];
  const pageSize = 1000;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase.from(table).select(columns).range(offset, offset + pageSize - 1);
    if (error) throw error;
    rows.push(...data);
    if (data.length < pageSize) break;
  }
  return rows;
}

async function fetchOddsEvents() {
  const url = new URL("https://api.the-odds-api.com/v4/sports/mma_mixed_martial_arts/odds/");
  url.searchParams.set("apiKey", ODDS_API_KEY);
  url.searchParams.set("regions", "us");
  url.searchParams.set("markets", "h2h");
  url.searchParams.set("oddsFormat", "american");

  const res = await fetch(url);
  const remaining = res.headers.get("x-requests-remaining");
  const used = res.headers.get("x-requests-used");
  console.log(`Odds API quota — used: ${used}, remaining: ${remaining}`);

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Odds API request failed: ${res.status} ${body}`);
  }
  return res.json();
}

async function checkRateLimit() {
  const force = process.argv.includes("--force");
  if (force) return;

  const { data, error } = await supabase
    .from("odds_snapshots")
    .select("fetched_at")
    .order("fetched_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data) return;

  const hoursSinceLastSync = (Date.now() - new Date(data.fetched_at).getTime()) / (1000 * 60 * 60);
  if (hoursSinceLastSync < MIN_SYNC_INTERVAL_HOURS) {
    console.log(
      `Last sync was ${hoursSinceLastSync.toFixed(1)}h ago (minimum interval is ${MIN_SYNC_INTERVAL_HOURS}h). ` +
      `Skipping to conserve API quota. Pass --force to override.`
    );
    process.exit(0);
  }
}

async function main() {
  await checkRateLimit();

  console.log("Fetching upcoming MMA odds...");
  const events = await fetchOddsEvents();
  console.log(`${events.length} upcoming fights returned (all promotions, unfiltered).`);

  if (events.length === 0) {
    console.log("Nothing to sync.");
    return;
  }

  const fighters = await fetchAll("fighters", "id, full_name, wins, losses, draws, no_contests");
  const fighterNameById = new Map(fighters.map((f) => [f.id, f.full_name]));

  // Real name collisions happen (two different UFC lightweights both named
  // "Mike Davis") — the API gives us nothing but a plain name string to
  // disambiguate with, so resolution has to be a deterministic rule, not
  // "whichever happened to be last in an unordered fetch" (which is how two
  // separate sync runs once created two different fight rows for what was
  // actually one real bout). Preferring whoever has fought more isn't
  // infallible, but it's consistent and a reasonable prior — a newly
  // scheduled UFC bout is far more likely to involve the established roster
  // member than a same-named newcomer.
  function totalFights(f) {
    return f.wins + f.losses + f.draws + f.no_contests;
  }
  const exactByName = new Map();
  for (const f of fighters) {
    const key = f.full_name.trim().toLowerCase();
    const current = exactByName.get(key);
    if (!current || totalFights(f) > totalFights(current)) exactByName.set(key, f);
  }
  const byTokens = new Map();
  const byLastName = new Map();
  for (const f of fighters) {
    const { first, last } = nameTokens(f.full_name);
    const key = `${first}|${last}`;
    if (!byTokens.has(key)) byTokens.set(key, []);
    byTokens.get(key).push(f);
    if (!byLastName.has(last)) byLastName.set(last, []);
    byLastName.get(last).push(f);
  }

  function resolveFighterId(name) {
    const exact = exactByName.get(name.trim().toLowerCase());
    if (exact) return { id: exact.id, matchedVia: "exact" };

    const { first, last } = nameTokens(name);
    const candidates = byTokens.get(`${first}|${last}`) ?? [];
    if (candidates.length === 1) {
      return { id: candidates[0].id, matchedVia: `variant of "${candidates[0].full_name}"` };
    }

    const lastNameCandidates = byLastName.get(last) ?? [];
    if (lastNameCandidates.length === 1) {
      return { id: lastNameCandidates[0].id, matchedVia: `last-name match for "${lastNameCandidates[0].full_name}"` };
    }
    return null;
  }

  const existingEvents = await fetchAll("events", "id, name, date");
  const existingFights = await fetchAll("fights", "id, event_id, fighter_a_id, fighter_b_id, status");

  let eventsCreated = 0;
  let fightsCreated = 0;
  let fightsCancelled = 0;
  let snapshotsInserted = 0;
  const variantMatches = [];
  const skippedUnmatched = [];
  const cancelledLog = [];

  // Group the API's individual bout-events by exact commence_time, since
  // that's the only signal available for "these fights are on the same card".
  const byCommenceTime = new Map();
  for (const ev of events) {
    if (!byCommenceTime.has(ev.commence_time)) byCommenceTime.set(ev.commence_time, []);
    byCommenceTime.get(ev.commence_time).push(ev);
  }

  for (const [commenceTime, bouts] of byCommenceTime) {
    const date = commenceTime.slice(0, 10);

    for (const bout of bouts) {
      const matchA = resolveFighterId(bout.home_team);
      const matchB = resolveFighterId(bout.away_team);

      if (!matchA || !matchB) {
        skippedUnmatched.push(`${bout.home_team} vs ${bout.away_team}`);
        continue;
      }
      if (matchA.matchedVia !== "exact") variantMatches.push(`"${bout.home_team}" -> ${matchA.matchedVia}`);
      if (matchB.matchedVia !== "exact") variantMatches.push(`"${bout.away_team}" -> ${matchB.matchedVia}`);

      let eventRow = existingEvents.find((e) => e.date === date);
      if (!eventRow) {
        const { data, error } = await supabase
          .from("events")
          .insert({ name: `UFC — ${date}`, date, is_ppv: false })
          .select("id, name, date")
          .single();
        if (error) throw error;
        eventRow = data;
        existingEvents.push(eventRow);
        eventsCreated++;
      }

      const fighterAId = matchA.id;
      const fighterBId = matchB.id;

      let fightRow = existingFights.find(
        (f) =>
          f.event_id === eventRow.id &&
          ((f.fighter_a_id === fighterAId && f.fighter_b_id === fighterBId) ||
            (f.fighter_a_id === fighterBId && f.fighter_b_id === fighterAId))
      );

      // A fighter can only have one bout on a given card — if either side of
      // this bout already has a DIFFERENT scheduled fight on this same event,
      // that's an opponent replacement (injury pullout, etc.), not two real
      // bouts. Mark the old one cancelled instead of leaving it to linger
      // alongside the new pairing forever.
      if (!fightRow) {
        const replaced = existingFights.find(
          (f) =>
            f.event_id === eventRow.id &&
            f.status === "scheduled" &&
            (f.fighter_a_id === fighterAId || f.fighter_b_id === fighterAId || f.fighter_a_id === fighterBId || f.fighter_b_id === fighterBId)
        );
        if (replaced) {
          const { error } = await supabase.from("fights").update({ status: "cancelled" }).eq("id", replaced.id);
          if (error) throw error;
          replaced.status = "cancelled";
          fightsCancelled++;
          cancelledLog.push(
            `${fighterNameById.get(replaced.fighter_a_id)} vs ${fighterNameById.get(replaced.fighter_b_id)} ` +
              `(replaced by ${bout.home_team} vs ${bout.away_team})`
          );
        }
      }

      if (!fightRow) {
        const { data, error } = await supabase
          .from("fights")
          .insert({
            event_id: eventRow.id,
            fighter_a_id: fighterAId,
            fighter_b_id: fighterBId,
            scheduled_rounds: 3,
            status: "scheduled",
          })
          .select("id, event_id, fighter_a_id, fighter_b_id")
          .single();
        if (error) throw error;
        fightRow = data;
        existingFights.push(fightRow);
        fightsCreated++;
      }

      // fightRow's a/b order may be swapped relative to this bout's
      // home/away — normalize snapshots to match fightRow's own ordering.
      const aIsHome = fightRow.fighter_a_id === fighterAId;

      for (const bookmaker of bout.bookmakers ?? []) {
        const h2h = bookmaker.markets?.find((m) => m.key === "h2h");
        if (!h2h) continue;
        const homeOutcome = h2h.outcomes.find((o) => o.name === bout.home_team);
        const awayOutcome = h2h.outcomes.find((o) => o.name === bout.away_team);
        if (!homeOutcome || !awayOutcome) continue;

        const { error } = await supabase.from("odds_snapshots").insert({
          fight_id: fightRow.id,
          sportsbook: bookmaker.title,
          fighter_a_moneyline: aIsHome ? homeOutcome.price : awayOutcome.price,
          fighter_b_moneyline: aIsHome ? awayOutcome.price : homeOutcome.price,
        });
        if (error) throw error;
        snapshotsInserted++;
      }
    }
  }

  console.log("\n=== Sync report ===");
  console.log(`Events created: ${eventsCreated}`);
  console.log(`Fights created: ${fightsCreated}`);
  console.log(`Fights cancelled (opponent replaced): ${fightsCancelled}`);
  if (cancelledLog.length) console.log("  ->", cancelledLog.join(" | "));
  console.log(`Odds snapshots inserted: ${snapshotsInserted}`);
  console.log(`Skipped (couldn't confidently match both fighters — likely non-UFC or unlisted debut): ${skippedUnmatched.length}`);
  if (skippedUnmatched.length) console.log("  ->", skippedUnmatched.join(" | "));
  if (variantMatches.length) {
    console.log(`Name-variant matches used (${variantMatches.length}):`);
    console.log("  ->", variantMatches.join(" | "));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
