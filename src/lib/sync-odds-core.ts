// Shared odds-sync logic — used by both the CLI script (scripts/sync-odds.mjs,
// for manual/local runs) and the Vercel Cron route handler
// (src/app/api/cron/sync-odds/route.ts, for the scheduled production sync).
// Keeping this in one place means the matching/replacement/dedup logic can't
// drift between "what I run by hand" and "what actually runs in production".
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
// Rountree Jr."), then falls back further to last-name-alone when it's
// unique across the whole roster (catches legal-name-vs-known-as mismatches
// like "Stephen Erceg" vs. our "Steve Erceg") — common surnames correctly
// fall through to unmatched instead of guessing. Real name collisions (two
// different UFC lightweights both named "Mike Davis") are resolved
// deterministically by preferring whoever has fought more, so repeated runs
// can't create two fight rows for what's really one bout.
import { createClient } from "@supabase/supabase-js";

const MIN_SYNC_INTERVAL_HOURS = 3;
const NAME_SUFFIXES = new Set(["jr", "jr.", "sr", "sr.", "ii", "iii", "iv"]);

type OddsApiOutcome = { name: string; price: number };
type OddsApiMarket = { key: string; outcomes: OddsApiOutcome[] };
type OddsApiBookmaker = { title: string; markets: OddsApiMarket[] };
type OddsApiEvent = { commence_time: string; home_team: string; away_team: string; bookmakers?: OddsApiBookmaker[] };

type FighterRow = { id: string; full_name: string; wins: number; losses: number; draws: number; no_contests: number };
type EventRow = { id: string; name: string; date: string };
type FightRow = { id: string; event_id: string; fighter_a_id: string; fighter_b_id: string; status?: string };

export type OddsSyncReport = {
  skipped: boolean;
  skipReason?: string;
  quotaUsed?: string | null;
  quotaRemaining?: string | null;
  eventsCreated: number;
  fightsCreated: number;
  fightsCancelled: number;
  snapshotsInserted: number;
  skippedUnmatched: string[];
  variantMatches: string[];
  cancelledLog: string[];
};

function nameTokens(fullName: string): { first: string; last: string } {
  const parts = fullName.trim().toLowerCase().split(/\s+/);
  let last = parts[parts.length - 1];
  if (NAME_SUFFIXES.has(last) && parts.length > 1) {
    parts.pop();
    last = parts[parts.length - 1];
  }
  return { first: parts[0], last };
}

export async function runOddsSync({ skipRateLimit = false }: { skipRateLimit?: boolean } = {}): Promise<OddsSyncReport> {
  const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const ODDS_API_KEY = process.env.ODDS_API_KEY;

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
  if (!ODDS_API_KEY) throw new Error("Missing ODDS_API_KEY.");

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  const report: OddsSyncReport = {
    skipped: false,
    eventsCreated: 0,
    fightsCreated: 0,
    fightsCancelled: 0,
    snapshotsInserted: 0,
    skippedUnmatched: [],
    variantMatches: [],
    cancelledLog: [],
  };

  // Free-tier request cap safety net: this is the ONLY code path that ever
  // calls The Odds API (the site itself only ever reads odds_snapshots rows
  // out of our own database — see src/lib/upcoming-card.ts — so a page visit
  // never spends API quota). Stops an accidental double-run (or an
  // over-eager cron) from burning credits faster than intended.
  if (!skipRateLimit) {
    const { data, error } = await supabase
      .from("odds_snapshots")
      .select("fetched_at")
      .order("fetched_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    if (data) {
      const hoursSinceLastSync = (Date.now() - new Date(data.fetched_at).getTime()) / (1000 * 60 * 60);
      if (hoursSinceLastSync < MIN_SYNC_INTERVAL_HOURS) {
        report.skipped = true;
        report.skipReason = `Last sync was ${hoursSinceLastSync.toFixed(1)}h ago (minimum interval is ${MIN_SYNC_INTERVAL_HOURS}h).`;
        return report;
      }
    }
  }

  async function fetchAll<T>(table: string, columns: string): Promise<T[]> {
    const rows: T[] = [];
    const pageSize = 1000;
    for (let offset = 0; ; offset += pageSize) {
      const { data, error } = await supabase.from(table).select(columns).range(offset, offset + pageSize - 1);
      if (error) throw error;
      rows.push(...((data ?? []) as T[]));
      if (!data || data.length < pageSize) break;
    }
    return rows;
  }

  const url = new URL("https://api.the-odds-api.com/v4/sports/mma_mixed_martial_arts/odds/");
  url.searchParams.set("apiKey", ODDS_API_KEY);
  url.searchParams.set("regions", "us");
  url.searchParams.set("markets", "h2h");
  url.searchParams.set("oddsFormat", "american");

  const res = await fetch(url);
  report.quotaUsed = res.headers.get("x-requests-used");
  report.quotaRemaining = res.headers.get("x-requests-remaining");
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Odds API request failed: ${res.status} ${body}`);
  }
  const events: OddsApiEvent[] = await res.json();

  if (events.length === 0) return report;

  const fighters = await fetchAll<FighterRow>("fighters", "id, full_name, wins, losses, draws, no_contests");
  const fighterNameById = new Map(fighters.map((f) => [f.id, f.full_name]));

  function totalFights(f: FighterRow): number {
    return f.wins + f.losses + f.draws + f.no_contests;
  }
  const exactByName = new Map<string, FighterRow>();
  for (const f of fighters) {
    const key = f.full_name.trim().toLowerCase();
    const current = exactByName.get(key);
    if (!current || totalFights(f) > totalFights(current)) exactByName.set(key, f);
  }
  const byTokens = new Map<string, FighterRow[]>();
  const byLastName = new Map<string, FighterRow[]>();
  for (const f of fighters) {
    const { first, last } = nameTokens(f.full_name);
    const key = `${first}|${last}`;
    if (!byTokens.has(key)) byTokens.set(key, []);
    byTokens.get(key)!.push(f);
    if (!byLastName.has(last)) byLastName.set(last, []);
    byLastName.get(last)!.push(f);
  }

  function resolveFighterId(name: string): { id: string; matchedVia: string } | null {
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

  const existingEvents = await fetchAll<EventRow>("events", "id, name, date");
  const existingFights = await fetchAll<FightRow>("fights", "id, event_id, fighter_a_id, fighter_b_id, status");

  // Fights on the same card don't carry a shared card identifier from the
  // API, so they're grouped by exact commence_time; the resulting `events`
  // row is named generically ("UFC — <date>") since we don't have the real
  // card name (e.g. "UFC 305") from this source. weight_class is left null
  // on these auto-created fights — not provided by this API either.
  const byCommenceTime = new Map<string, OddsApiEvent[]>();
  for (const ev of events) {
    if (!byCommenceTime.has(ev.commence_time)) byCommenceTime.set(ev.commence_time, []);
    byCommenceTime.get(ev.commence_time)!.push(ev);
  }

  for (const [commenceTime, bouts] of byCommenceTime) {
    const date = commenceTime.slice(0, 10);

    for (const bout of bouts) {
      const matchA = resolveFighterId(bout.home_team);
      const matchB = resolveFighterId(bout.away_team);

      if (!matchA || !matchB) {
        report.skippedUnmatched.push(`${bout.home_team} vs ${bout.away_team}`);
        continue;
      }
      if (matchA.matchedVia !== "exact") report.variantMatches.push(`"${bout.home_team}" -> ${matchA.matchedVia}`);
      if (matchB.matchedVia !== "exact") report.variantMatches.push(`"${bout.away_team}" -> ${matchB.matchedVia}`);

      let eventRow = existingEvents.find((e) => e.date === date);
      if (!eventRow) {
        const { data, error } = await supabase
          .from("events")
          .insert({ name: `UFC — ${date}`, date, is_ppv: false })
          .select("id, name, date")
          .single();
        if (error) throw error;
        eventRow = data as EventRow;
        existingEvents.push(eventRow);
        report.eventsCreated++;
      }

      const fighterAId = matchA.id;
      const fighterBId = matchB.id;

      let fightRow = existingFights.find(
        (f) =>
          f.event_id === eventRow!.id &&
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
            f.event_id === eventRow!.id &&
            f.status === "scheduled" &&
            (f.fighter_a_id === fighterAId || f.fighter_b_id === fighterAId || f.fighter_a_id === fighterBId || f.fighter_b_id === fighterBId)
        );
        if (replaced) {
          const { error } = await supabase.from("fights").update({ status: "cancelled" }).eq("id", replaced.id);
          if (error) throw error;
          replaced.status = "cancelled";
          report.fightsCancelled++;
          report.cancelledLog.push(
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
        fightRow = data as FightRow;
        existingFights.push(fightRow);
        report.fightsCreated++;
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
        report.snapshotsInserted++;
      }
    }
  }

  return report;
}
