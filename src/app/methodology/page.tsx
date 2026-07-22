import type { Metadata } from "next";
import { FEATURE_NAMES } from "@/lib/feature-model";
import modelArtifact from "@/lib/model-weights/feature-v1.json";
import { SiteHeader } from "@/components/SiteHeader";

export const metadata: Metadata = {
  title: "Methodology & Backtest — Octagon Analytics",
  description: "How the prediction model works, and how it performs against a simple Elo baseline on fights it never trained on.",
};

const FEATURE_LABELS: Record<string, string> = {
  eloDiff: "Elo rating",
  heightDiff: "Height",
  reachDiff: "Reach",
  ageDiff: "Age (younger favored)",
  slpmDiff: "Significant strikes landed per minute",
  sapmDiff: "Significant strikes absorbed per minute (fewer favored)",
  tdAvgDiff: "Takedowns per 15 minutes",
  tdDefDiff: "Takedown defense",
  streakDiff: "Current win/loss streak",
  daysSinceLastFightDiff: "Days since last fight (ring rust)",
  recentOpponentQualityDiff: "Recent opponent quality",
  stanceMatchup: "Southpaw vs. orthodox stance matchup",
};

function pct(n: number) {
  return `${(n * 100).toFixed(1)}%`;
}

export default function MethodologyPage() {
  const { backtest, trainCount, testCount, weights } = modelArtifact;

  const rankedFeatures = FEATURE_NAMES.map((name, i) => ({ name, weight: weights[i] }))
    .sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight));

  const accuracyGain = ((backtest.blended.accuracy - backtest.eloOnly.accuracy) * 100).toFixed(1);

  return (
    <>
      <SiteHeader current="methodology" />
      <div className="mx-auto w-full max-w-4xl px-6 py-10">
      <h1 className="mb-2 text-xl font-semibold">How the Model Works</h1>
      <p className="mb-8 text-sm text-muted">
        A plain accounting of what the prediction model is, how it was tested, and where it's weaker than we'd like —
        so the accuracy number below can actually be trusted.
      </p>

      <section className="mb-8 rounded-xl border border-border bg-surface px-5 py-5">
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
          <div>
            <div className="text-xs uppercase tracking-wide text-muted">Blended model accuracy</div>
            <div className="text-3xl font-semibold text-accent [text-shadow:0_0_18px_rgba(220,38,38,0.5)]">{pct(backtest.blended.accuracy)}</div>
            <div className="mt-1 text-xs text-muted">
              vs. {pct(backtest.eloOnly.accuracy)} for Elo alone — a {accuracyGain}-point improvement
            </div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-muted">Brier score (lower is better)</div>
            <div className="text-3xl font-semibold text-foreground">{backtest.blended.brier.toFixed(4)}</div>
            <div className="mt-1 text-xs text-muted">vs. {backtest.eloOnly.brier.toFixed(4)} for Elo alone</div>
          </div>
        </div>
        <p className="mt-4 border-t border-border pt-4 text-sm text-muted">
          Measured on {testCount.toLocaleString()} fights the model never trained on — the most recent slice of
          history, held out and only used for evaluation after training on the older {trainCount.toLocaleString()}.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide">What these numbers mean</h2>
        <div className="space-y-3 text-sm text-muted">
          <p>
            <span className="font-semibold text-foreground">Accuracy</span> is simply how often the model's favorite
            actually won. {pct(backtest.blended.accuracy)} beats a coin flip by a real margin, but it's not close to
            certainty — MMA has real upset variance, and the model isn't pretending otherwise.
          </p>
          <p>
            <span className="font-semibold text-foreground">Brier score</span> measures calibration, not just
            win/loss: it penalizes being confidently wrong more than being cautiously wrong. A model that says "51%"
            for a coin-flip fight and a model that says "90%" for the same fight can have the same accuracy but very
            different Brier scores — this is the number that tells you whether the percentages themselves are honest.
          </p>
          <p>
            <span className="font-semibold text-foreground">Why a held-out test set, not just fitting the past:</span>{" "}
            training and testing on the same fights would let the model memorize outcomes it already knows,
            producing an accuracy number that looks great but tells you nothing about a real upcoming fight. Testing
            only on fights chronologically after the training cutoff is the only honest way to estimate that.
          </p>
        </div>
      </section>

      <section className="mb-8">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide">Two layers, blended</h2>
        <p className="mb-3 text-sm text-muted">
          An Elo rating gives every fighter a baseline from win/loss history alone — simple, always available, even
          for a fighter with almost no UFC history. A logistic regression model layered on top uses the differential
          in real fighter stats between the two fighters. For fighters with fewer than five fights in our data, the
          blend leans toward Elo, since the stat-based model has little reliable signal to work with yet.
        </p>
        <p className="text-sm text-muted">Ranked by how much each factor actually moved the model's predictions, most to least:</p>
        <ol className="mt-3 space-y-1.5 text-sm">
          {rankedFeatures.map((f, i) => (
            <li key={f.name} className="flex items-baseline gap-3">
              <span className="w-5 shrink-0 text-right font-mono text-xs text-muted">{i + 1}.</span>
              <span>{FEATURE_LABELS[f.name] ?? f.name}</span>
            </li>
          ))}
        </ol>
      </section>

      <section className="rounded-xl border border-border bg-surface px-5 py-5">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">Known limitations</h2>
        <ul className="list-disc space-y-2 pl-5 text-sm text-muted">
          <li>
            <span className="text-foreground">The historical dataset is frozen at 2026-07-11.</span> There's no live
            scraper feeding it (UFCStats actively blocks automated access), so recent fights beyond that date only
            enter the system through manual entry or the odds sync's roster-matching.
          </li>
          <li>
            <span className="text-foreground">Odds coverage depends on name-matching.</span> The odds feed covers
            every MMA promotion, not just the UFC — a fight only gets tracked once both fighters are confidently
            matched to our UFC roster, so a genuine UFC debut may not show odds right away.
          </li>
        </ul>
        <p className="mt-4 text-sm text-muted">
          Every number on this site traces back to a real stat or this documented model output — nothing is an
          invented rating.
        </p>
      </section>
      </div>
    </>
  );
}
