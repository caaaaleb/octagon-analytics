// Coarse fighting-style tag, derived entirely from a fighter's own career
// stats already in the database (SLpM, takedown avg, submission avg) — no
// invented or hand-curated claims. This can only produce broad categories
// ("Striker", "Wrestler", "Grappler", "All-Around"), not specific disciplines
// like "Kickboxing" or "Brazilian Jiu-Jitsu" — the numbers alone can't tell
// two grapplers with different backgrounds apart, and ground-and-pound
// volume from top position inflates SLpM the same as standup striking does,
// so an elite wrestler with heavy GnP can read as "Striker" or "All-Around"
// here. Thresholds were picked against the ~85th percentile of fighters with
// 5+ UFC fights (Charles Oliveira/Max Holloway/Ilia Topuria/Israel Adesanya/
// Alex Pereira all land where you'd expect against these cutoffs).
//
// Same 5-fight floor as the feature model's blend-toward-Elo cutoff (see
// methodology page) — below that, per-15-minutes rates are too noisy to
// characterize confidently, so no tag is shown rather than guess.
const MIN_FIGHTS = 5;
const STRIKE_ELITE = 4.0;
const STRIKE_COMPETENT = 2.6;
const TD_ELITE = 2.5;
const TD_COMPETENT = 0.75;
const SUB_ELITE = 1.0;
const SUB_COMPETENT = 0.4;

export type FighterStyle = "Striker" | "Wrestler" | "Grappler" | "All-Around";

export function classifyFighterStyle(fighter: {
  slpm: number | null;
  td_avg: number | null;
  sub_avg: number | null;
  wins: number;
  losses: number;
  draws: number;
  no_contests: number;
}): FighterStyle | null {
  const totalFights = fighter.wins + fighter.losses + fighter.draws + fighter.no_contests;
  if (totalFights < MIN_FIGHTS) return null;
  if (fighter.slpm === null || fighter.td_avg === null || fighter.sub_avg === null) return null;

  const { slpm, td_avg, sub_avg } = fighter;
  const eliteStriking = slpm >= STRIKE_ELITE;
  const competentStriking = slpm >= STRIKE_COMPETENT;
  const eliteGrappling = td_avg >= TD_ELITE || sub_avg >= SUB_ELITE;
  const competentGrappling = td_avg >= TD_COMPETENT || sub_avg >= SUB_COMPETENT;

  if (sub_avg >= SUB_ELITE && !eliteStriking) return "Grappler";
  if (eliteStriking && eliteGrappling) return "All-Around";
  if (eliteStriking && competentGrappling) return "All-Around";
  if (td_avg >= TD_ELITE && competentStriking) return "All-Around";
  if (td_avg >= TD_ELITE) return "Wrestler";
  if (eliteStriking) return "Striker";
  return null;
}
