// Matchup Explanation Generator — spec Section 4.
// Template-driven, NOT an LLM call: every sentence is filled from an actual
// number in the feature vector the model used, so it can't hallucinate a
// stat and every claim traces back to real data. Ranks factors by the
// trained model's own weight x standardized-differential (its "importance
// weight x differential" per spec), not just raw magnitude, so the ranking
// reflects what actually drove the prediction.
import type { FeatureContribution } from "@/lib/predict";

type Template = (magnitude: number, subject: string, opponent: string) => string;

const TEMPLATES: Record<string, Template> = {
  eloDiff: (m, s) => `${s} carries a ${Math.round(m)}-point Elo edge`,
  heightDiff: (m, s) => `${s} is ${m.toFixed(1)} cm taller`,
  reachDiff: (m, s) => `${s} has a ${m.toFixed(1)} cm longer reach`,
  ageDiff: (m, s) => `${s} is ${m.toFixed(1)} years younger`,
  slpmDiff: (m, s, o) => `${s} lands ${m.toFixed(1)} more significant strikes per minute than ${o}`,
  sapmDiff: (m, s, o) => `${s} absorbs ${m.toFixed(1)} fewer significant strikes per minute than ${o}`,
  tdAvgDiff: (m, s) => `${s} averages ${m.toFixed(1)} more takedowns per 15 minutes`,
  tdDefDiff: (m, s) => `${s} defends takedowns at a ${Math.round(m * 100)}-point higher rate`,
  streakDiff: (m, s) => `${s} enters in clearly better recent form`,
  daysSinceLastFightDiff: (m, s) => `${s} is fresher, coming off a shorter layoff`,
  recentOpponentQualityDiff: (m, s) => `${s} has recently faced tougher competition`,
  stanceMatchup: (m, s, o) => `${s}'s stance creates a classic stylistic edge against ${o}`,
};

// Combined per spec's own example ("lands X more ... while absorbing Y
// fewer ...") when both strike-volume features favor the same fighter.
function combinedStrikingSentence(slpm: FeatureContribution, sapm: FeatureContribution, subject: string, opponent: string) {
  return `${subject} lands ${Math.abs(slpm.diff).toFixed(1)} more significant strikes per minute while absorbing ${Math.abs(sapm.diff).toFixed(1)} fewer than ${opponent}`;
}

export type MatchupExplanation = {
  summary: string;
  riskFactors: string | null;
};

const MAX_MAIN_FACTORS = 4;
const MAX_RISK_FACTORS = 2;

export function buildMatchupExplanation(
  fighterAName: string,
  fighterBName: string,
  displayedProbA: number,
  contributions: FeatureContribution[]
): MatchupExplanation {
  // Must match whichever probability is actually shown on the page (the
  // blended one) — using the feature-only sub-probability here would let
  // the narrative name a different favorite than the displayed percentage
  // whenever Elo and the feature model disagree, which reads as a flat
  // contradiction to anyone comparing the two.
  const favoredIsA = displayedProbA >= 0.5;
  const favoriteName = favoredIsA ? fighterAName : fighterBName;

  // "Relative to the favorite" — positive means this feature supports the
  // model's actual favorite; negative means it's a point in the underdog's
  // favor despite the overall prediction.
  const ranked = contributions
    .map((c) => ({ ...c, relative: favoredIsA ? c.contribution : -c.contribution }))
    .filter((c) => c.relative !== 0);

  const favoringFavorite = ranked.filter((c) => c.relative > 0).sort((a, b) => b.relative - a.relative);
  const favoringUnderdog = ranked.filter((c) => c.relative < 0).sort((a, b) => a.relative - b.relative);

  function sentenceFor(c: FeatureContribution): string | null {
    const template = TEMPLATES[c.name];
    if (!template) return null;
    const subjectIsA = c.contribution > 0;
    const subject = subjectIsA ? fighterAName : fighterBName;
    const opponent = subjectIsA ? fighterBName : fighterAName;
    return template(Math.abs(c.diff), subject, opponent);
  }

  function buildParagraph(factors: typeof ranked, limit: number): string {
    const used = new Set<string>();
    const sentences: string[] = [];

    const slpm = factors.find((c) => c.name === "slpmDiff");
    const sapm = factors.find((c) => c.name === "sapmDiff");
    if (slpm && sapm && Math.sign(slpm.contribution) === Math.sign(sapm.contribution)) {
      const subjectIsA = slpm.contribution > 0;
      sentences.push(
        combinedStrikingSentence(slpm, sapm, subjectIsA ? fighterAName : fighterBName, subjectIsA ? fighterBName : fighterAName)
      );
      used.add("slpmDiff");
      used.add("sapmDiff");
    }

    for (const c of factors) {
      if (sentences.length >= limit) break;
      if (used.has(c.name)) continue;
      const sentence = sentenceFor(c);
      if (sentence) {
        sentences.push(sentence);
        used.add(c.name);
      }
    }

    return sentences.join(", ");
  }

  const mainSentence = buildParagraph(favoringFavorite, MAX_MAIN_FACTORS);
  const summary = mainSentence
    ? `${mainSentence[0].toUpperCase()}${mainSentence.slice(1)} — the model favors ${favoriteName} here.`
    : `The model narrowly favors ${favoriteName}, without one standout factor.`;

  const riskSentence = buildParagraph(favoringUnderdog, MAX_RISK_FACTORS);
  const underdogName = favoredIsA ? fighterBName : fighterAName;
  const riskFactors = riskSentence
    ? `${riskSentence[0].toUpperCase()}${riskSentence.slice(1)} — ${underdogName}'s clearest path to an upset.`
    : null;

  return { summary, riskFactors };
}
