import { createClient } from "@/utils/supabase/server";
import { getModelPrediction, type FighterForPrediction } from "@/lib/predict";
import { buildMatchupExplanation, type MatchupExplanation } from "@/lib/matchup-explanation";
import { devig, VALUE_BET_THRESHOLD } from "@/lib/odds";
import type { SimulatorFighterInputs } from "@/lib/simulator";
import { classifyFighterStyle, type FighterStyle } from "@/lib/fighter-style";

type FighterRow = FighterForPrediction & {
  full_name: string;
  weight_class: string | null;
  wins: number;
  losses: number;
  draws: number;
  no_contests: number;
  sub_avg: number | null;
  historical_finish_rate: number | null;
  historical_finish_speed: number | null;
  historical_gets_finished_rate: number | null;
};

type BoutFighter = {
  id: string;
  full_name: string;
  elo_rating: number;
  wins: number;
  losses: number;
  draws: number;
  style: FighterStyle | null;
  simInputs: SimulatorFighterInputs;
};

export type OddsHistoryPoint = { sportsbook: string; fetchedAt: string; probA: number };
export type BestPrice = { sportsbook: string; moneyline: number } | null;

export type UpcomingBout = {
  id: string;
  weight_class: string | null;
  is_title_fight: boolean;
  scheduled_rounds: number;
  fighterA: BoutFighter;
  fighterB: BoutFighter;
  modelProbA: number;
  marketProbA: number | null;
  bookmakerCount: number;
  gap: number | null;
  isValueBet: boolean;
  valueSide: "a" | "b" | null;
  explanation: MatchupExplanation;
  oddsHistory: OddsHistoryPoint[];
  bestPriceA: BestPrice;
  bestPriceB: BestPrice;
};

export type UpcomingCard = {
  event: { name: string; date: string; location: string | null };
  bouts: UpcomingBout[];
} | null;

export async function getUpcomingCard(): Promise<UpcomingCard> {
  const supabase = await createClient();
  const today = new Date().toISOString().slice(0, 10);

  const { data: nextEvent, error: eventError } = await supabase
    .from("events")
    .select("id, name, date, location")
    .gte("date", today)
    .order("date", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (eventError) throw eventError;
  if (!nextEvent) return null;

  const { data: fights, error: fightsError } = await supabase
    .from("fights")
    .select(
      `
      id, weight_class, is_title_fight, scheduled_rounds, status,
      fighter_a:fighter_a_id ( id, full_name, weight_class, elo_rating, wins, losses, draws, no_contests, height_cm, reach_cm, dob, stance, slpm, sapm, td_avg, td_def, sub_avg, historical_finish_rate, historical_finish_speed, historical_gets_finished_rate ),
      fighter_b:fighter_b_id ( id, full_name, weight_class, elo_rating, wins, losses, draws, no_contests, height_cm, reach_cm, dob, stance, slpm, sapm, td_avg, td_def, sub_avg, historical_finish_rate, historical_finish_speed, historical_gets_finished_rate )
    `
    )
    .eq("event_id", nextEvent.id)
    .eq("status", "scheduled");

  if (fightsError) throw fightsError;
  if (!fights || fights.length === 0) return { event: nextEvent, bouts: [] };

  const fightIds = fights.map((f) => f.id);
  const { data: snapshots, error: snapshotsError } = await supabase
    .from("odds_snapshots")
    .select("fight_id, sportsbook, fighter_a_moneyline, fighter_b_moneyline, fetched_at")
    .in("fight_id", fightIds)
    .order("fetched_at", { ascending: false });

  if (snapshotsError) throw snapshotsError;

  const latestByFightAndBook = new Map<string, { sportsbook: string; fighter_a_moneyline: number; fighter_b_moneyline: number }>();
  for (const snap of snapshots ?? []) {
    const key = `${snap.fight_id}|${snap.sportsbook}`;
    if (!latestByFightAndBook.has(key)) {
      latestByFightAndBook.set(key, snap);
    }
  }

  const typedFights = fights as unknown as Array<{
    id: string;
    weight_class: string | null;
    is_title_fight: boolean;
    scheduled_rounds: number;
    fighter_a: FighterRow;
    fighter_b: FighterRow;
  }>;

  function toBoutFighter(f: FighterRow): BoutFighter {
    return {
      id: f.id,
      full_name: f.full_name,
      elo_rating: f.elo_rating,
      wins: f.wins,
      losses: f.losses,
      draws: f.draws,
      style: classifyFighterStyle(f),
      simInputs: {
        finishRate: f.historical_finish_rate,
        finishSpeed: f.historical_finish_speed,
        getsFinishedRate: f.historical_gets_finished_rate,
      },
    };
  }

  const bouts: UpcomingBout[] = await Promise.all(
    typedFights.map(async (fight) => {
      const fightBooks = Array.from(latestByFightAndBook.entries())
        .filter(([key]) => key.startsWith(`${fight.id}|`))
        .map(([, snap]) => snap);

      const bookOdds = fightBooks.map((snap) => devig(snap.fighter_a_moneyline, snap.fighter_b_moneyline).probA);

      // American odds compare correctly as plain numbers regardless of sign
      // (-105 > -150 is a better price; +150 > +105 is a better price; any
      // positive beats any negative) — so "best" is just the max value.
      const bestPriceA: BestPrice = fightBooks.length
        ? (() => {
            const b = fightBooks.reduce((best, cur) => (cur.fighter_a_moneyline > best.fighter_a_moneyline ? cur : best));
            return { sportsbook: b.sportsbook, moneyline: b.fighter_a_moneyline };
          })()
        : null;
      const bestPriceB: BestPrice = fightBooks.length
        ? (() => {
            const b = fightBooks.reduce((best, cur) => (cur.fighter_b_moneyline > best.fighter_b_moneyline ? cur : best));
            return { sportsbook: b.sportsbook, moneyline: b.fighter_b_moneyline };
          })()
        : null;

      const marketProbA = bookOdds.length
        ? bookOdds.reduce((sum, p) => sum + p, 0) / bookOdds.length
        : null;

      const prediction = await getModelPrediction(supabase, fight.fighter_a, fight.fighter_b, nextEvent.date);
      const modelProbA = prediction.probability;
      const gap = marketProbA === null ? null : modelProbA - marketProbA;
      const isValueBet = gap !== null && Math.abs(gap) >= VALUE_BET_THRESHOLD;
      const valueSide = !isValueBet ? null : gap! > 0 ? "a" : "b";

      const explanation = buildMatchupExplanation(
        fight.fighter_a.full_name,
        fight.fighter_b.full_name,
        modelProbA,
        prediction.contributions
      );

      const oddsHistory: OddsHistoryPoint[] = (snapshots ?? [])
        .filter((snap) => snap.fight_id === fight.id)
        .map((snap) => ({
          sportsbook: snap.sportsbook,
          fetchedAt: snap.fetched_at,
          probA: devig(snap.fighter_a_moneyline, snap.fighter_b_moneyline).probA,
        }))
        .sort((a, b) => a.fetchedAt.localeCompare(b.fetchedAt));

      // The odds-sync API doesn't provide weight class, so most auto-created
      // fights have a null fights.weight_class — fall back to the fighters'
      // own weight_class (from historical UFCStats data) when both agree.
      // If they disagree (one side moved divisions, stale data, etc.),
      // there's no confident inference to make, so leave it null rather
      // than guess.
      const inferredWeightClass =
        fight.weight_class ??
        (fight.fighter_a.weight_class && fight.fighter_a.weight_class === fight.fighter_b.weight_class
          ? fight.fighter_a.weight_class
          : null);

      return {
        id: fight.id,
        weight_class: inferredWeightClass,
        is_title_fight: fight.is_title_fight,
        scheduled_rounds: fight.scheduled_rounds,
        fighterA: toBoutFighter(fight.fighter_a),
        fighterB: toBoutFighter(fight.fighter_b),
        modelProbA,
        marketProbA,
        bookmakerCount: bookOdds.length,
        gap,
        isValueBet,
        valueSide,
        explanation,
        oddsHistory,
        bestPriceA,
        bestPriceB,
      };
    })
  );

  return { event: nextEvent, bouts };
}
