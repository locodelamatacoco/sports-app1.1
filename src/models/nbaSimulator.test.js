import {
  americanToProb,
  probToAmerican,
  removeVig,
  marketHold,
  mulberry32,
  projectGame,
  varianceComponents,
  projectProp,
  simulateGame,
  analyzeGame,
  analyzeSlate,
  gamePenalties,
  propPenalties,
  sumPenalties,
  divergenceVeto,
  confidenceFromPenalties,
  priceLine,
  derivedMarkets,
  MODEL_CONSTANTS,
  BET_RULES,
} from './nbaSimulator';
import { gammaSample } from './oddsMath';
import { NBA_SLATE } from '../data/nbaGames';

const [bosDet, phiNyk, okcSas] = NBA_SLATE.games;

// A mid-season game with clean inputs and a badly priced moneyline. Its job is
// to prove the dampener gates bets rather than blocking all of them: if this
// stops qualifying, the model has gone mute.
const CLEAN_GAME = {
  id: 'clean-test',
  label: 'Clean Away @ Clean Home',
  tipoff: '7:00 PM ET',
  venue: 'Test Arena',
  away: {
    code: 'AWY',
    name: 'Away Team',
    ratings: { off: 114, def: 114, pace: 100 },
    rosterAdj: { off: 0, def: 0 },
    turnover: 'low',
    recentForm: { off: 114, def: 114, pace: 100, games: 20 },
  },
  home: {
    code: 'HOM',
    name: 'Home Team',
    ratings: { off: 118, def: 112, pace: 100 },
    rosterAdj: { off: 0, def: 0 },
    turnover: 'low',
    recentForm: { off: 118, def: 112, pace: 100, games: 20 },
  },
  context: {
    home: { restDays: 1, backToBack: false },
    away: { restDays: 1, backToBack: false },
  },
  odds: {
    // +100 on a team the market itself makes an 8.5-point favourite.
    moneyline: { away: -120, home: 100 },
    spread: { homeLine: -8.5, homePrice: -110, awayPrice: -110 },
    total: { line: 229.5, over: -110, under: -110 },
  },
  props: [],
};

describe('odds math', () => {
  test('american odds convert to implied probability', () => {
    expect(americanToProb(100)).toBeCloseTo(0.5);
    expect(americanToProb(-200)).toBeCloseTo(2 / 3);
    expect(americanToProb(150)).toBeCloseTo(0.4);
  });

  test('probability round-trips back to american odds', () => {
    expect(probToAmerican(0.5)).toBe(-100);
    expect(probToAmerican(2 / 3)).toBe(-200);
    expect(probToAmerican(0.4)).toBe(150);
  });

  test('removeVig normalizes a two-way market to 1', () => {
    const noVig = removeVig([americanToProb(-170), americanToProb(145)]);
    expect(noVig[0] + noVig[1]).toBeCloseTo(1);
    expect(noVig[0]).toBeGreaterThan(noVig[1]);
  });

  test('marketHold reports the book overround', () => {
    expect(marketHold(-110, -110)).toBeCloseTo(0.0476, 3);
    expect(marketHold(100, -100)).toBeCloseTo(0, 6);
  });
});

describe('sampling', () => {
  test('gamma sample matches its mean and variance', () => {
    const rand = mulberry32(11);
    const shape = 12;
    const scale = 2;
    const n = 20000;
    let sum = 0;
    let sumSq = 0;
    for (let i = 0; i < n; i++) {
      const x = gammaSample(rand, shape, scale);
      sum += x;
      sumSq += x * x;
    }
    const mean = sum / n;
    const variance = sumSq / n - mean * mean;
    expect(mean).toBeGreaterThan(shape * scale * 0.97);
    expect(mean).toBeLessThan(shape * scale * 1.03);
    expect(variance).toBeGreaterThan(shape * scale * scale * 0.9);
    expect(variance).toBeLessThan(shape * scale * scale * 1.1);
  });

  test('rng is deterministic per seed', () => {
    const a = mulberry32(99);
    const b = mulberry32(99);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });
});

describe('expected score model', () => {
  test('two league-average teams at league pace score the league average', () => {
    const avg = MODEL_CONSTANTS.LEAGUE_AVG_RATING;
    const pace = MODEL_CONSTANTS.LEAGUE_AVG_PACE;
    const team = {
      code: 'AVG',
      name: 'Average',
      ratings: { off: avg, def: avg, pace },
      turnover: 'low',
      recentForm: null,
    };
    const neutral = { id: 'n', away: { ...team }, home: { ...team }, context: {} };
    const p = projectGame(neutral);
    expect(p.home.efficiency).toBeCloseTo(avg, 6);
    expect(p.away.efficiency).toBeCloseTo(avg, 6);
    // Home court is the only thing separating identical teams.
    expect(p.expectedMargin).toBeCloseTo(MODEL_CONSTANTS.HOME_COURT_POINTS, 6);
    // Regulation lands exactly on the possession identity; the all-in total
    // sits above it by the expected overtime contribution.
    expect(p.regulation.total).toBeCloseTo(2 * (avg / 100) * pace, 6);
    expect(p.expectedTotal).toBeCloseTo(
      2 * (avg / 100) * pace + p.expectedOvertimePoints,
      6
    );
    expect(p.expectedOvertimePoints).toBeGreaterThan(0);
  });

  test('a better defence suppresses the opponent efficiency', () => {
    const p = projectGame(okcSas);
    // Oklahoma City owned the league's best defensive rating, so San Antonio's
    // adjusted efficiency has to land below its own season rating.
    const sasRating = okcSas.home.ratings.off + okcSas.home.rosterAdj.off;
    expect(p.home.efficiency).toBeLessThan(sasRating);
  });

  test('recent form earns weight only as the sample grows', () => {
    const base = JSON.parse(JSON.stringify(CLEAN_GAME));
    base.home.recentForm = { off: 130, def: 100, pace: 100, games: 2 };
    const small = projectGame(base);
    base.home.recentForm.games = 25;
    const large = projectGame(base);
    expect(large.home.efficiency).toBeGreaterThan(small.home.efficiency);
    expect(small.home.rawRatings.formWeight).toBeCloseTo(2 / 25, 6);
    expect(large.home.rawRatings.formWeight).toBeCloseTo(0.6, 6);
  });

  test('market anchoring pulls the projection toward the posted line', () => {
    const raw = projectGame(bosDet, { anchorWeight: 0 });
    const full = projectGame(bosDet, { anchorWeight: 1 });
    const half = projectGame(bosDet, { anchorWeight: 0.5 });
    const marketMargin = -bosDet.odds.spread.homeLine;

    expect(raw.expectedMargin).toBeCloseTo(raw.raw.margin, 6);
    expect(full.expectedMargin).toBeCloseTo(marketMargin, 6);
    expect(full.expectedTotal).toBeCloseTo(bosDet.odds.total.line, 6);
    expect(half.expectedMargin).toBeCloseTo((raw.raw.margin + marketMargin) / 2, 6);
  });

  test('market-implied possessions are reported next to the model estimate', () => {
    const p = projectGame(okcSas);
    expect(p.market.impliedPossessions).toBeGreaterThan(90);
    expect(p.market.impliedPossessions).toBeLessThan(115);
    expect(p.divergence.total).toBeCloseTo(p.raw.total - okcSas.odds.total.line, 6);
  });
});

describe('variance calibration', () => {
  test('derived components reproduce the margin and total SD targets', () => {
    const p = projectGame(bosDet);
    const v = varianceComponents(p);
    const effHome = p.home.efficiency / 100;
    const effAway = p.away.efficiency / 100;
    const possVar = v.possessionSd ** 2;

    const homeVar = effHome ** 2 * possVar + v.sharedSd ** 2 + v.homeIdioSd ** 2;
    const awayVar = effAway ** 2 * possVar + v.sharedSd ** 2 + v.awayIdioSd ** 2;
    const cov = effHome * effAway * possVar + v.sharedSd ** 2;

    expect(Math.sqrt(homeVar + awayVar - 2 * cov)).toBeCloseTo(MODEL_CONSTANTS.MARGIN_SD, 4);
    expect(Math.sqrt(homeVar + awayVar + 2 * cov)).toBeCloseTo(MODEL_CONSTANTS.TOTAL_SD, 4);
    expect(v.correlation).toBeGreaterThan(0);
    expect(v.correlation).toBeLessThan(0.5);
  });

  test('simulated margin and total spread match the calibration', () => {
    const sim = simulateGame(CLEAN_GAME, { numSims: 30000, seed: 7 });
    // The projected total includes the expected overtime contribution, so the
    // simulated mean has to land on it rather than ~0.7 points above.
    expect(sim.means.total - sim.projection.expectedTotal).toBeLessThan(0.4);
    expect(sim.means.total - sim.projection.expectedTotal).toBeGreaterThan(-0.4);
    expect(sim.means.margin).toBeCloseTo(sim.projection.expectedMargin, 0);
    expect(sim.projection.expectedOvertimePoints).toBeGreaterThan(0.2);
    expect(sim.projection.expectedOvertimePoints).toBeLessThan(1.5);
  });
});

describe('simulateGame', () => {
  const sim = simulateGame(bosDet, { numSims: 10000, seed: 5 });

  test('runs the requested number of simulations', () => {
    expect(sim.numSims).toBe(10000);
  });

  test('moneyline probabilities are exhaustive — no simulated ties survive', () => {
    expect(sim.probs.homeWin + sim.probs.awayWin).toBeCloseTo(1, 6);
  });

  test('spread outcomes partition into cover, push and loss', () => {
    expect(sim.probs.homeCover + sim.probs.homePush + sim.probs.awayCover).toBeCloseTo(1, 6);
  });

  test('total outcomes partition into over, push and under', () => {
    expect(sim.probs.over + sim.probs.totalPush + sim.probs.under).toBeCloseTo(1, 6);
  });

  test('a half-point line cannot push but a whole number can', () => {
    expect(bosDet.odds.spread.homeLine % 1).not.toBe(0);
    expect(sim.probs.homePush).toBe(0);

    // Thunder/Spurs is priced on a whole number, so pushes must appear.
    expect(Number.isInteger(okcSas.odds.spread.homeLine)).toBe(true);
    const whole = simulateGame(okcSas, { numSims: 10000, seed: 5 });
    expect(whole.probs.homePush).toBeGreaterThan(0);
  });

  test('overtime resolves every tie and lifts scoring', () => {
    expect(sim.probs.overtime).toBeGreaterThan(0);
    expect(sim.probs.overtime).toBeLessThan(0.1);
  });

  test('same seed reproduces identical results', () => {
    const a = simulateGame(phiNyk, { numSims: 2000, seed: 123 });
    const b = simulateGame(phiNyk, { numSims: 2000, seed: 123 });
    expect(a.probs).toEqual(b.probs);
    expect(a.means).toEqual(b.means);
  });
});

describe('player props', () => {
  test('the expected stat reduces to the per-game rate when nothing shifts', () => {
    const prop = {
      player: 'Test',
      stat: 'points',
      line: 20.5,
      over: -110,
      under: -110,
      baseline: { perGame: 24, minutes: 32, pace: MODEL_CONSTANTS.LEAGUE_AVG_PACE },
      projectedMinutes: 32,
    };
    const projection = projectGame(CLEAN_GAME);
    const p = projectProp(prop, CLEAN_GAME, projection);
    expect(p.paceFactor).toBeCloseTo(
      projection.expectedPossessions / MODEL_CONSTANTS.LEAGUE_AVG_PACE,
      6
    );
    expect(p.expected).toBeCloseTo(24 * p.paceFactor, 6);
  });

  test('a missing baseline is reported rather than guessed', () => {
    const projection = projectGame(bosDet);
    const noBaseline = projectProp({ stat: 'threes', baseline: null }, bosDet, projection);
    expect(noBaseline.insufficientData).toBe(true);
    expect(noBaseline.expected).toBeNull();

    const analysis = analyzeGame(bosDet, { numSims: 2000, seed: 3 });
    const declined = analysis.props.filter((row) => row.insufficientData);
    expect(declined.length).toBeGreaterThan(0);
    declined.forEach((row) => {
      expect(row.recommendation).toMatch(/insufficient baseline/i);
      expect(row.adjustedEdge).toBeUndefined();
    });
  });

  test('counting stats simulate as integers so thresholds price correctly', () => {
    const sim = simulateGame(okcSas, { numSims: 4000, seed: 8 });
    const rebounds = sim.propResults.find((r) => r.prop.id === 'wemby-reb');
    expect(rebounds.overProb + rebounds.pushProb + rebounds.underProb).toBeCloseTo(1, 6);
    expect(rebounds.simulatedMean).toBeGreaterThan(7);
    expect(rebounds.simulatedMean).toBeLessThan(14);
  });

  test('threshold props price P(stat >= threshold) on a single side', () => {
    const analysis = analyzeGame(phiNyk, { numSims: 6000, seed: 4 });
    const threshold = analysis.props.find((row) => row.prop?.id === 'jbrown-pts-20');
    expect(threshold.label).toMatch(/20\+ points/);
    expect(threshold.pushProb).toBe(0);
    expect(threshold.settleProb).toBeGreaterThan(0);
    expect(threshold.settleProb).toBeLessThan(1);
    // Only the posted side exists, so there is no paired under row.
    expect(analysis.props.filter((r) => r.prop?.id === 'jbrown-pts-20')).toHaveLength(1);
  });

  test('a usage haircut lowers the projection', () => {
    const projection = projectGame(phiNyk);
    const base = {
      player: 'Test',
      stat: 'points',
      baseline: { perGame: 28.7, minutes: 34, pace: 95.6 },
      projectedMinutes: 34,
    };
    const full = projectProp(base, phiNyk, projection);
    const cut = projectProp({ ...base, usageFactor: 0.74 }, phiNyk, projection);
    expect(cut.expected).toBeCloseTo(full.expected * 0.74, 6);
  });
});

describe('confidence dampener', () => {
  test('penalties are named, additive and capped', () => {
    const sim = simulateGame(bosDet, { numSims: 3000, seed: 2 });
    const ledger = gamePenalties(bosDet, sim);
    expect(ledger.length).toBeGreaterThan(3);
    ledger.forEach((entry) => {
      expect(entry.amount).toBeGreaterThan(0);
      expect(typeof entry.reason).toBe('string');
      expect(entry.reason.length).toBeGreaterThan(0);
    });
    expect(sumPenalties(ledger)).toBeLessThanOrEqual(BET_RULES.MAX_TOTAL_PENALTY);
  });

  test('opening night charges every game for having no current-season data', () => {
    NBA_SLATE.games.forEach((game) => {
      const sim = simulateGame(game, { numSims: 1500, seed: 1 });
      const reasons = gamePenalties(game, sim).map((e) => e.reason).join(' | ');
      expect(reasons).toMatch(/No current-season data/);
    });
  });

  test('prop flags add their own penalties on top of the game ledger', () => {
    const tatum = bosDet.props.find((p) => p.id === 'tatum-reb');
    const reasons = propPenalties(tatum, {}).map((e) => e.reason).join(' | ');
    expect(reasons).toMatch(/16 games/);
    expect(reasons).toMatch(/injury-shortened/);
  });

  test('confidence falls as the ledger grows', () => {
    expect(confidenceFromPenalties([])).toBe(9.5); // the model never claims certainty
    const light = confidenceFromPenalties([{ amount: 0.02, reason: 'a' }]);
    const heavy = confidenceFromPenalties([
      { amount: 0.05, reason: 'a' },
      { amount: 0.05, reason: 'b' },
      { amount: 0.05, reason: 'c' },
    ]);
    expect(light).toBeGreaterThan(heavy);
    expect(heavy).toBeGreaterThanOrEqual(1);
  });

  test('the adjusted edge is the raw edge less the penalty total', () => {
    const analysis = analyzeGame(bosDet, { numSims: 3000, seed: 6 });
    analysis.markets.forEach((row) => {
      expect(row.adjustedEdge).toBeCloseTo(row.rawEdge - row.penaltyTotal, 10);
      expect(row.adjustedEdge).toBeLessThanOrEqual(row.rawEdge);
    });
  });
});

describe('divergence guard', () => {
  test('a wide disagreement with the market vetoes the game', () => {
    const skewed = JSON.parse(JSON.stringify(CLEAN_GAME));
    skewed.odds.spread.homeLine = 20; // market makes the home side a 20-point dog
    const projection = projectGame(skewed);
    expect(divergenceVeto(projection)).toMatch(/margin/);

    const analysis = analyzeGame(skewed, { numSims: 3000, seed: 9 });
    expect(analysis.veto).toBeTruthy();
    expect(analysis.qualified).toHaveLength(0);
    analysis.markets.forEach((row) => {
      expect(row.qualifies).toBe(false);
      if (row.rawEdge > 0) expect(row.recommendation).toMatch(/NO BET/);
    });
  });

  test('a close agreement with the market is not vetoed', () => {
    expect(divergenceVeto(projectGame(CLEAN_GAME))).toBeNull();
  });
});

describe('bet selection', () => {
  test('a clean game with a mispriced moneyline does produce a bet', () => {
    const analysis = analyzeGame(CLEAN_GAME, { numSims: 20000, seed: 21 });
    expect(analysis.penalties).toHaveLength(0);
    expect(analysis.confidence).toBe(9.5);
    expect(analysis.veto).toBeNull();

    const pick = analysis.bestBet;
    expect(pick).not.toBeNull();
    expect(pick.label).toMatch(/Home Team ML/);
    expect(pick.adjustedEdge).toBeGreaterThanOrEqual(BET_RULES.MIN_ADJUSTED_EDGE);
    expect(pick.adjustedEdge).toBeCloseTo(pick.rawEdge, 10); // nothing to dampen
  });

  test('every qualifying bet clears both the edge and confidence gates', () => {
    const { results } = analyzeSlate([...NBA_SLATE.games, CLEAN_GAME], {
      numSims: 4000,
      seed: 42,
    });
    results.forEach((r) => {
      r.qualified.forEach((bet) => {
        expect(bet.adjustedEdge).toBeGreaterThanOrEqual(BET_RULES.MIN_ADJUSTED_EDGE);
        expect(bet.confidence).toBeGreaterThanOrEqual(BET_RULES.MIN_CONFIDENCE);
        expect(bet.veto).toBeNull();
      });
    });
  });

  test('tonight\'s slate qualifies nothing — thin inputs mean no card', () => {
    const { topBets, topByEdge } = analyzeSlate(NBA_SLATE.games, { numSims: 8000, seed: 2026 });
    expect(topBets).toHaveLength(0);
    // The leaderboard is still published so the board stays auditable.
    expect(topByEdge).toHaveLength(5);
    topByEdge.forEach((row) => expect(row.qualifies).toBe(false));
  });

  test('the slate leaderboard is sorted by adjusted edge, not raw', () => {
    const { topByEdge } = analyzeSlate([...NBA_SLATE.games, CLEAN_GAME], {
      numSims: 4000,
      seed: 31,
    });
    const edges = topByEdge.map((r) => r.adjustedEdge);
    expect([...edges].sort((a, b) => b - a)).toEqual(edges);
    // The clean game's mispriced side has to outrank the dampened slate.
    expect(topByEdge[0].gameId).toBe('clean-test');
  });

  test('a pushable line is priced on the no-push settlement probability', () => {
    const analysis = analyzeGame(okcSas, { numSims: 10000, seed: 12 });
    const spreadRow = analysis.markets.find((r) => r.market === 'spread');
    expect(spreadRow.pushProb).toBeGreaterThan(0);
    expect(spreadRow.settleProb).toBeCloseTo(
      spreadRow.modelProb / (1 - spreadRow.pushProb),
      10
    );
  });

  test('each row carries a no-vig comparison as well as the posted price', () => {
    const analysis = analyzeGame(phiNyk, { numSims: 3000, seed: 15 });
    const ml = analysis.markets.find((r) => r.market === 'moneyline');
    expect(ml.noVigProb).toBeGreaterThan(0);
    expect(ml.noVigProb).toBeLessThan(ml.implied); // de-vigging removes the hold
    expect(ml.edgeVsNoVig).toBeCloseTo(ml.settleProb - ml.noVigProb, 10);
  });
});

describe('slate summary', () => {
  const { results } = analyzeSlate(NBA_SLATE.games, { numSims: 4000, seed: 2026 });

  test('every game reports a full summary block', () => {
    expect(results).toHaveLength(3);
    results.forEach((r) => {
      const s = r.summary;
      expect(s.predictedScore.home).toBeGreaterThan(80);
      expect(s.predictedScore.away).toBeGreaterThan(80);
      expect(s.predictedTotal).toBeCloseTo(s.predictedScore.home + s.predictedScore.away, 6);
      expect(s.predictedMargin).toBeCloseTo(s.predictedScore.home - s.predictedScore.away, 6);
      expect(s.homeWinProb + s.awayWinProb).toBeCloseTo(1, 6);
      expect(['Low', 'Medium', 'High']).toContain(r.riskLevel);
      expect(r.confidence).toBeGreaterThanOrEqual(1);
      expect(r.confidence).toBeLessThanOrEqual(10);
    });
  });

  test('each game is simulated with its own seed', () => {
    const seeds = results.map((r) => r.sim.seed);
    expect(new Set(seeds).size).toBe(seeds.length);
  });

  test('projected scores land in a believable NBA range', () => {
    results.forEach((r) => {
      expect(r.summary.predictedTotal).toBeGreaterThan(190);
      expect(r.summary.predictedTotal).toBeLessThan(260);
      expect(r.summary.possessions).toBeGreaterThan(88);
      expect(r.summary.possessions).toBeLessThan(110);
    });
  });
});

describe('pricing arbitrary lines off the simulated distribution', () => {
  test('priceLine partitions a known distribution exactly', () => {
    const dist = new Map([
      [100, 10],
      [110, 30],
      [120, 60],
    ]);
    const half = priceLine(dist, 100, 110.5);
    expect(half.overProb).toBeCloseTo(0.6, 10);
    expect(half.pushProb).toBe(0);
    expect(half.underProb).toBeCloseTo(0.4, 10);

    // A whole number that lands on a value in the distribution pushes.
    const whole = priceLine(dist, 100, 110);
    expect(whole.overProb).toBeCloseTo(0.6, 10);
    expect(whole.pushProb).toBeCloseTo(0.3, 10);
    expect(whole.underProb).toBeCloseTo(0.1, 10);
    expect(whole.overProb + whole.pushProb + whole.underProb).toBeCloseTo(1, 10);
  });

  test('the recorded distributions agree with the headline probabilities', () => {
    const sim = simulateGame(okcSas, { numSims: 8000, seed: 17 });
    const total = priceLine(sim.dist.total, sim.numSims, okcSas.odds.total.line);
    expect(total.overProb).toBeCloseTo(sim.probs.over, 10);
    expect(total.underProb).toBeCloseTo(sim.probs.under, 10);

    // A home line of -1 covers when the margin exceeds 1.
    const margin = priceLine(sim.dist.margin, sim.numSims, -okcSas.odds.spread.homeLine);
    expect(margin.overProb).toBeCloseTo(sim.probs.homeCover, 10);
    expect(margin.pushProb).toBeCloseTo(sim.probs.homePush, 10);
  });

  test('derived markets cover team totals and alternate lines', () => {
    const sim = simulateGame(okcSas, { numSims: 6000, seed: 18 });
    const rows = derivedMarkets(okcSas, sim);
    const kinds = new Set(rows.map((r) => r.market));
    expect(kinds).toEqual(new Set(['teamTotal', 'altSpread', 'altTotal']));
    expect(rows.length).toBeGreaterThan(20);

    // Team totals must centre on each side's projected score.
    const homeTotals = rows.filter((r) => r.market === 'teamTotal' && r.side === 'home-over');
    const lines = homeTotals.map((r) => r.line);
    expect(Math.min(...lines)).toBeLessThan(sim.means.homeScore);
    expect(Math.max(...lines)).toBeGreaterThan(sim.means.homeScore);
  });

  test('an unpriced derived market is a shop row, never a bet', () => {
    const sim = simulateGame(okcSas, { numSims: 4000, seed: 19 });
    const rows = derivedMarkets(okcSas, sim);
    rows.forEach((r) => {
      expect(r.priced).toBe(false);
      expect(r.price).toBeNull();
      expect(r.qualifies).toBe(false);
      expect(r.recommendation).toMatch(/SHOP/);
      expect(typeof r.fairOdds).toBe('number');
    });

    const analysis = analyzeGame(okcSas, { numSims: 4000, seed: 19 });
    expect(analysis.derived.length).toBeGreaterThan(20);
    // Shop rows stay out of the qualified list and the leaderboard.
    analysis.qualified.forEach((q) => expect(q.priced).not.toBe(false));
  });

  test('supplying a price turns a derived market into a scored one', () => {
    const game = JSON.parse(JSON.stringify(okcSas));
    const sim = simulateGame(game, { numSims: 6000, seed: 20 });
    const centre = Math.round(sim.means.homeScore * 2) / 2;
    game.odds.teamTotals = { home: { [String(centre)]: { over: -110, under: -110 } } };

    const rows = derivedMarkets(game, simulateGame(game, { numSims: 6000, seed: 20 }));
    const scored = rows.filter((r) => r.priced);
    expect(scored.length).toBe(2);
    scored.forEach((r) => {
      expect(r.price).toBe(-110);
      expect(typeof r.rawEdge).toBe('number');
      expect(r.adjustedEdge).toBeCloseTo(r.rawEdge - r.penaltyTotal, 10);
    });
  });

  test('an alternate spread further from the number is harder to cover', () => {
    const sim = simulateGame(okcSas, { numSims: 20000, seed: 22 });
    const rows = derivedMarkets(okcSas, sim).filter(
      (r) => r.market === 'altSpread' && r.side === 'home'
    );
    // Rows are built from a ladder; laying more points must lower the win rate.
    const sorted = rows.slice().sort((a, b) => a.line - b.line); // line is -homeLine
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i].modelProb).toBeLessThanOrEqual(sorted[i - 1].modelProb);
    }
  });
});
