import {
  backtest,
  calibrationBuckets,
  constantsReport,
  normalCdf,
  syntheticGame,
} from './backtest';
import { MODEL_CONSTANTS, projectGame } from './nbaSimulator';
import { ratingsFromStandings } from '../data/espnRatings';
import priorStandings from '../data/__fixtures__/espnStandings2025.json';
import finals from '../data/__fixtures__/season2026Finals.json';

// 2024-25 ratings predicting 2025-26 games: the same shape as production,
// where tonight is projected from last season.
const prior = ratingsFromStandings(priorStandings);
const fixtures = finals.games.map(([date, away, home, as, hs]) => ({
  date,
  away,
  home,
  as,
  hs,
}));

describe('normalCdf', () => {
  test('matches known values', () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 6);
    expect(normalCdf(1)).toBeCloseTo(0.8413, 3);
    expect(normalCdf(-1)).toBeCloseTo(0.1587, 3);
    expect(normalCdf(1.96)).toBeCloseTo(0.975, 3);
    expect(normalCdf(-3)).toBeCloseTo(0.00135, 4);
  });

  test('is symmetric and monotonic', () => {
    for (const z of [0.2, 0.7, 1.4, 2.5]) {
      expect(normalCdf(z) + normalCdf(-z)).toBeCloseTo(1, 6);
      expect(normalCdf(z)).toBeGreaterThan(normalCdf(z - 0.1));
    }
  });
});

describe('syntheticGame', () => {
  test('builds a game with no market numbers so anchoring stays inert', () => {
    const g = syntheticGame({ date: '2026-01-01', home: 'BOS', away: 'NY' }, prior.teams, prior.league);
    expect(g.odds).toBeNull();
    const p = projectGame(g, { anchorWeight: 0 });
    // With no posted line there is nothing to anchor to or diverge from.
    expect(p.market.margin).toBeNull();
    expect(p.divergence.margin).toBeNull();
    expect(p.expectedMargin).toBeCloseTo(p.raw.margin, 10);
  });

  test('returns null when either team is unrated, rather than guessing', () => {
    expect(syntheticGame({ home: 'BOS', away: 'ZZZ' }, prior.teams, prior.league)).toBeNull();
    expect(syntheticGame({ home: 'ZZZ', away: 'BOS' }, prior.teams, prior.league)).toBeNull();
  });
});

describe('calibrationBuckets', () => {
  test('folds games onto the favoured side', () => {
    // A 30% home probability is a 70% away favourite; if away won, that is a hit.
    const rows = [{ homeWinProb: 0.3, actualMargin: -5 }];
    const [bucket] = calibrationBuckets(rows, [0.8, 1.01]);
    expect(bucket.predicted).toBeCloseTo(0.7, 6);
    expect(bucket.actual).toBe(1);
  });

  test('a perfectly calibrated set shows no gap', () => {
    // Ten games at a stated 70%, seven of which the favourite wins.
    const rows = Array.from({ length: 10 }, (_, i) => ({
      homeWinProb: 0.7,
      actualMargin: i < 7 ? 5 : -5,
    }));
    const [bucket] = calibrationBuckets(rows, [0.65, 1.01]);
    expect(bucket.n).toBe(10);
    expect(bucket.actual).toBeCloseTo(0.7, 6);
    expect(bucket.gap).toBeCloseTo(0, 6);
  });

  test('empty buckets are dropped rather than reported as zero', () => {
    expect(calibrationBuckets([])).toEqual([]);
  });
});

describe('out-of-sample backtest over the 2025-26 season', () => {
  const result = backtest(fixtures, prior.teams, { leagueContext: prior.league });

  test('projects the full regular season with every team rated', () => {
    expect(result.n).toBeGreaterThan(1200);
    expect(result.skipped).toBe(0);
  });

  test('the projection is unbiased on margin and total', () => {
    // A non-zero bias means the model systematically favours one side, which
    // is what HOME_COURT_POINTS was doing before it was measured.
    expect(Math.abs(result.margin.mean)).toBeLessThan(0.35);
    expect(Math.abs(result.total.mean)).toBeLessThan(1.5);
  });

  test('the variance constants match the residuals they are meant to describe', () => {
    // These are the numbers the simulation draws scores around, so if they
    // drift from the measured residual the whole board is mispriced.
    expect(result.margin.sd).toBeCloseTo(MODEL_CONSTANTS.MARGIN_SD, 0);
    expect(result.total.sd).toBeCloseTo(MODEL_CONSTANTS.TOTAL_SD, 0);
  });

  test('home court matches the measured constant', () => {
    const report = constantsReport(result);
    expect(report.measured ?? report.homeCourt.measured).toBeCloseTo(
      MODEL_CONSTANTS.HOME_COURT_POINTS,
      0
    );
    expect(Math.abs(report.homeCourt.suggested - MODEL_CONSTANTS.HOME_COURT_POINTS)).toBeLessThan(
      0.4
    );
  });

  test('win probabilities are calibrated within 5 points per bucket', () => {
    // Before the constants were measured this ran to ~9 points of
    // overconfidence in every bucket above 55%. Regression guard.
    const weighted =
      result.calibration.reduce((a, b) => a + Math.abs(b.gap) * b.n, 0) / result.n;
    expect(weighted).toBeLessThan(0.05);
    result.calibration.forEach((b) => {
      if (b.n >= 50) expect(Math.abs(b.gap)).toBeLessThan(0.08);
    });
  });

  test('errs underconfident rather than overconfident at the top end', () => {
    // Claiming less than you deliver is the safe direction for a bet gate.
    const high = result.calibration.filter((b) => b.lo >= 0.6 && b.n >= 50);
    expect(high.length).toBeGreaterThan(0);
    high.forEach((b) => expect(b.gap).toBeGreaterThan(-0.05));
  });

  test('beats always-picking-the-home-team, but only modestly', () => {
    // The honest size of the edge: a few points of accuracy over a trivial
    // baseline, which is not the same as a betting edge.
    expect(result.winAccuracy).toBeGreaterThan(result.homeWinRate);
    expect(result.winAccuracy - result.homeWinRate).toBeLessThan(0.1);
  });

  test('shrinkage keeps projected margins inside a believable range', () => {
    // Prior-season ratings explain under 10% of margin variance, so the
    // projections must not swing like they explain all of it.
    const margins = result.rows.map((r) => r.predictedMargin);
    const mean = margins.reduce((a, b) => a + b, 0) / margins.length;
    const sd = Math.sqrt(
      margins.reduce((a, b) => a + (b - mean) ** 2, 0) / (margins.length - 1)
    );
    expect(sd).toBeLessThan(7);
    expect(Math.max(...margins.map(Math.abs))).toBeLessThan(20);
  });
});
