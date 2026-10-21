// src/models/backtest.js
//
// Out-of-sample backtest for the NBA model.
//
// The production setup on any given night is: project tonight's game from the
// PRIOR season's ratings. So the honest test is the same shape — rate teams on
// 2024-25, predict 2025-26 — and never the other way round. Rating a season
// from its own results and then "predicting" it is the lookahead trap this
// module exists to avoid.
//
// What it measures, and why each matters:
//
//   marginBias   mean(predicted - actual) margin. Non-zero means the model is
//                systematically favouring one side; HOME_COURT_POINTS is the
//                usual culprit.
//   marginSd     SD of that error. This IS what MODEL_CONSTANTS.MARGIN_SD
//                should be, since the simulation draws final margins around
//                the projection with exactly that spread.
//   totalBias    same for the total.
//   totalSd      same, and sets TOTAL_SD.
//   calibration  bucketed win probability vs realised win rate. A model that
//                says 60% should win 60%.
//
// There are no historical closing lines here: ESPN strips odds from completed
// games, so this validates the score projection, not profitability. Those are
// different claims and this module only supports the first.

import { projectGame, MODEL_CONSTANTS } from './nbaSimulator';
import { clamp } from './oddsMath';

// Normal CDF, for turning a projected margin into a win probability without
// paying for a Monte Carlo run on every one of a thousand-plus games.
export function normalCdf(z) {
  // Abramowitz & Stegun 7.1.26 on the error function.
  const sign = z < 0 ? -1 : 1;
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t +
      0.254829592) *
      t *
      Math.exp(-x * x);
  return 0.5 * (1 + sign * y);
}

// Build the minimal game shape projectGame needs. No market numbers are
// supplied, so anchoring is inert and the raw model is what gets tested.
export function syntheticGame(fixture, ratings, leagueContext) {
  const home = ratings[fixture.home];
  const away = ratings[fixture.away];
  if (!home || !away) return null;
  return {
    id: `${fixture.date}-${fixture.away}-${fixture.home}`,
    home: { ...home, recentForm: null },
    away: { ...away, recentForm: null },
    leagueContext,
    context: {
      // A backtest over a whole season has no rest data, so both sides get a
      // normal day. Rest is worth well under a point either way.
      home: { restDays: 1, backToBack: false },
      away: { restDays: 1, backToBack: false },
    },
    odds: null,
  };
}

function summarise(values) {
  const n = values.length;
  if (n === 0) return { n: 0, mean: null, sd: null, mae: null };
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1);
  const mae = values.reduce((a, b) => a + Math.abs(b), 0) / n;
  return { n, mean, sd: Math.sqrt(variance), mae };
}

// Win-probability calibration in fixed buckets.
export function calibrationBuckets(rows, edges = [0.5, 0.55, 0.6, 0.65, 0.7, 0.8, 1.01]) {
  const buckets = [];
  let lo = 0;
  for (const hi of edges) {
    // Fold each game onto the side the model favoured, so every bucket is a
    // probability at or above 50%.
    const inBucket = rows.filter((r) => {
      const p = Math.max(r.homeWinProb, 1 - r.homeWinProb);
      return p >= lo && p < hi;
    });
    if (inBucket.length > 0) {
      const predicted =
        inBucket.reduce((a, r) => a + Math.max(r.homeWinProb, 1 - r.homeWinProb), 0) /
        inBucket.length;
      const actual =
        inBucket.filter((r) => {
          const favouriteIsHome = r.homeWinProb >= 0.5;
          const homeWon = r.actualMargin > 0;
          return favouriteIsHome === homeWon;
        }).length / inBucket.length;
      buckets.push({ lo, hi, n: inBucket.length, predicted, actual, gap: actual - predicted });
    }
    lo = hi;
  }
  return buckets;
}

// `fixtures` are { date, home, away, hs, as }; `ratings` is keyed by team
// abbreviation, as `espnRatings.ratingsFromStandings` returns.
export function backtest(fixtures, ratings, { leagueContext = null, marginSd } = {}) {
  const sd = marginSd ?? MODEL_CONSTANTS.MARGIN_SD;
  const rows = [];
  let skipped = 0;

  for (const f of fixtures) {
    const game = syntheticGame(f, ratings, leagueContext);
    if (!game) {
      skipped += 1;
      continue;
    }
    const p = projectGame(game, { anchorWeight: 0 });
    const actualMargin = f.hs - f.as;
    const actualTotal = f.hs + f.as;
    rows.push({
      date: f.date,
      home: f.home,
      away: f.away,
      predictedMargin: p.expectedMargin,
      predictedTotal: p.expectedTotal,
      actualMargin,
      actualTotal,
      marginError: p.expectedMargin - actualMargin,
      totalError: p.expectedTotal - actualTotal,
      homeWinProb: clamp(normalCdf(p.expectedMargin / sd), 0.001, 0.999),
    });
  }

  const margin = summarise(rows.map((r) => r.marginError));
  const total = summarise(rows.map((r) => r.totalError));

  // Straight-up accuracy against a coin flip, and against always-pick-home.
  const correct = rows.filter((r) => (r.homeWinProb >= 0.5) === r.actualMargin > 0).length;
  const homeWins = rows.filter((r) => r.actualMargin > 0).length;

  return {
    n: rows.length,
    skipped,
    margin,
    total,
    // The mean actual home margin is the measured home-court advantage, since
    // over a full season every team plays a near-equal split of home and away.
    observedHomeCourt: rows.reduce((a, r) => a + r.actualMargin, 0) / Math.max(rows.length, 1),
    observedTotal: rows.reduce((a, r) => a + r.actualTotal, 0) / Math.max(rows.length, 1),
    winAccuracy: rows.length ? correct / rows.length : null,
    homeWinRate: rows.length ? homeWins / rows.length : null,
    calibration: calibrationBuckets(rows),
    rows,
  };
}

// What the measured residuals say the simulation's variance constants should
// be, next to what they currently are.
export function constantsReport(result) {
  return {
    homeCourt: {
      current: MODEL_CONSTANTS.HOME_COURT_POINTS,
      measured: result.observedHomeCourt,
      // A positive margin bias means the projection favours the home side too
      // much, so home court should come down by that much.
      suggested: MODEL_CONSTANTS.HOME_COURT_POINTS - result.margin.mean,
    },
    marginSd: { current: MODEL_CONSTANTS.MARGIN_SD, measured: result.margin.sd },
    totalSd: { current: MODEL_CONSTANTS.TOTAL_SD, measured: result.total.sd },
  };
}
