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
  priceVeto,
  confidenceFromPenalties,
  priceLine,
  derivedMarkets,
  propLadder,
  percentile,
  probBetween,
  projectPlayerGame,
  DOUBLE_DOUBLE_STATS,
  POINTS_THRESHOLDS,
  distributionSummary,
  propDistribution,
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
    ratings: { off: 116, def: 113, pace: 100 },
    rosterAdj: { off: 0, def: 0 },
    turnover: 'low',
    recentForm: { off: 116, def: 113, pace: 100, games: 20 },
  },
  context: {
    home: { restDays: 1, backToBack: false },
    away: { restDays: 1, backToBack: false },
  },
  odds: {
    // Even money on a side the market itself makes a 3.5-point favourite.
    moneyline: { away: -120, home: 100 },
    spread: { homeLine: -3.5, homePrice: -110, awayPrice: -110 },
    total: { line: 230.5, over: -110, under: -110 },
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
    // The possession identity describes the projection BEFORE shrinkage: the
    // all-in unshrunk total is the identity plus the overtime contribution.
    expect(p.unshrunk.total).toBeCloseTo(
      2 * (avg / 100) * pace + p.expectedOvertimePoints,
      6
    );
    expect(p.expectedOvertimePoints).toBeGreaterThan(0);

    // The reported total is then regressed toward the league mean, so it sits
    // between the identity and that mean rather than on either.
    const identity = 2 * (avg / 100) * pace + p.expectedOvertimePoints;
    const mean = MODEL_CONSTANTS.LEAGUE_MEAN_TOTAL;
    expect(p.expectedTotal).toBeCloseTo(
      mean + MODEL_CONSTANTS.RATING_SHRINK_TOTAL * (identity - mean),
      6
    );
    expect(Math.abs(p.expectedTotal - mean)).toBeLessThan(Math.abs(identity - mean));
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
  // The guard against a mute model. It used to rest on a mispriced moneyline;
  // with moneylines off the board, the one route left to a qualifying bet is a
  // player prop, so that is what has to keep working.
  test('a clean game with a mispriced prop does produce a bet', () => {
    const game = {
      ...CLEAN_GAME,
      props: [
        {
          player: 'Clean Scorer',
          stat: 'points',
          line: 17.5,
          over: -110,
          under: -110,
          baseline: { perGame: 20, minutes: 34, pace: 100 },
          projectedMinutes: 34,
          minutesVolatility: 0.05,
          flags: {},
        },
      ],
    };
    const analysis = analyzeGame(game, { numSims: 20000, seed: 21 });
    expect(analysis.penalties).toHaveLength(0);
    expect(analysis.confidence).toBe(9.5);
    expect(analysis.veto).toBeNull();

    const pick = analysis.bestBet;
    expect(pick).not.toBeNull();
    expect(pick.label).toMatch(/Clean Scorer Over 17.5/);
    expect(pick.adjustedEdge).toBeGreaterThanOrEqual(BET_RULES.MIN_ADJUSTED_EDGE);
    expect(pick.adjustedEdge).toBeCloseTo(pick.rawEdge, 10); // nothing to dampen
  });

  test('the same clean game will not recommend its mispriced moneyline', () => {
    const analysis = analyzeGame(CLEAN_GAME, { numSims: 20000, seed: 21 });
    const home = analysis.markets.find((m) => /Home Team ML/.test(m.label));
    // The edge is still computed and reported; it is simply not a bet.
    expect(home.rawEdge).toBeGreaterThan(BET_RULES.MIN_ADJUSTED_EDGE);
    expect(home.veto).toMatch(/moneylines are off the board/);
    expect(home.qualifies).toBe(false);
  });

  // Recorded rather than discovered again. With moneylines off, game markets
  // can barely reach the bar even with ZERO penalties: the 35% market anchor
  // and the per-point divergence charge cap a spread near 3.7%, and a total
  // only clears 5% at the knife-edge of a six-point disagreement in an
  // otherwise perfect game (5.1-5.4% at 60k sims). Real games carry a 13-22%
  // penalty floor, which is why the bar was never cleared in six slates — it
  // was only ever reachable through moneylines, which carry no edge.
  //
  // An earlier version of this test claimed no total could qualify. At 8,000
  // sims one did, at 5.17%: the claim had been read off a single 20,000-sim
  // run that happened to land on 5.00%. The bounds below allow for that.
  const cleanSweep = (kind) => {
    const fair = projectGame({ ...CLEAN_GAME, odds: null }, { anchorWeight: 0 });
    const half = (x) => Math.round(x * 2) / 2;
    const rows = [];
    for (const offset of [2, 4, 6, 8]) {
      const odds = {
        moneyline: { away: -120, home: 100 },
        spread: {
          homeLine: -half(fair.expectedMargin - (kind === 'spread' ? offset : 0)),
          homePrice: -110,
          awayPrice: -110,
        },
        total: {
          line: half(fair.expectedTotal - (kind === 'total' ? offset : 0)),
          over: -110,
          under: -110,
        },
      };
      const a = analyzeGame({ ...CLEAN_GAME, odds }, { numSims: 8000, seed: 21 });
      rows.push(...[...a.markets, ...a.derived].filter((m) => m.market === kind && m.priced !== false));
    }
    return rows;
  };

  test('no spread qualifies even in a perfectly clean game', () => {
    const rows = cleanSweep('spread');
    expect(rows.length).toBeGreaterThan(0);
    for (const m of rows) expect(m.qualifies).toBe(false);
    // Well clear of the bar, so this is not a sim-noise artefact.
    expect(Math.max(...rows.map((m) => m.adjustedEdge))).toBeLessThan(
      BET_RULES.MIN_ADJUSTED_EDGE - 0.005
    );
  });

  test('a total reaches the bar only at the edge, with nothing in reserve', () => {
    const rows = cleanSweep('total');
    const best = Math.max(...rows.map((m) => m.adjustedEdge));
    // Close to the bar either side, never comfortably over it: the smallest
    // real-world penalty removes it.
    expect(best).toBeGreaterThan(BET_RULES.MIN_ADJUSTED_EDGE - 0.02);
    expect(best).toBeLessThan(BET_RULES.MIN_ADJUSTED_EDGE + 0.015);
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

describe('prop ladders for an adjustable line', () => {
  const game = JSON.parse(JSON.stringify(bosDet));
  game.props = [
    {
      id: 'ladder-test',
      player: 'Test Scorer',
      team: 'DET',
      stat: 'points',
      line: 15.5,
      over: -110,
      under: -110,
      baseline: { perGame: 20, minutes: 32, pace: 99.4 },
      projectedMinutes: 32,
      minutesVolatility: 0.06,
    },
  ];
  const sim = simulateGame(game, { numSims: 30000, seed: 44 });
  const result = sim.propResults.find((r) => r.prop.id === 'ladder-test');

  test('a prop records its full outcome distribution', () => {
    expect(result.dist).toBeInstanceOf(Map);
    expect(result.dist.size).toBeGreaterThan(10);
    const counted = [...result.dist.values()].reduce((a, b) => a + b, 0);
    expect(counted).toBe(result.samples);
  });

  test('the ladder agrees with the prop row at the posted line', () => {
    const [rung] = propLadder(result, [15.5]);
    expect(rung.overProb).toBeCloseTo(result.overProb, 2);
  });

  test('a lower line is always easier to clear', () => {
    const rungs = propLadder(result, [10.5, 14.5, 18.5, 22.5, 26.5]);
    for (let i = 1; i < rungs.length; i++) {
      expect(rungs[i].overProb).toBeLessThan(rungs[i - 1].overProb);
    }
    expect(rungs[0].overProb).toBeGreaterThan(0.9);
    expect(rungs[rungs.length - 1].overProb).toBeLessThan(0.15);
  });

  test('over and under are complementary at every rung', () => {
    propLadder(result, [12.5, 16.5, 20.5]).forEach((r) => {
      expect(r.overProb + r.underProb).toBeCloseTo(1, 10);
    });
  });

  test('the required price accounts for the penalty load', () => {
    // With nothing to dampen, the required price is just the gate above fair.
    const clean = propLadder(result, [15.5], { penaltyTotal: 0 })[0];
    const dampened = propLadder(result, [15.5], { penaltyTotal: 0.22 })[0];
    // A heavier penalty demands a longer price for the same outcome.
    expect(dampened.requiredOverPrice).toBeGreaterThan(clean.requiredOverPrice);
    expect(clean.fairOver).toBe(dampened.fairOver); // fair odds do not move
  });

  test('a rung no price can rescue reports null rather than a silly number', () => {
    // Model probability below the penalty load plus the gate is unbettable at
    // any price, and saying so is more useful than quoting +50000.
    const rungs = propLadder(result, [34.5], { penaltyTotal: 0.22 });
    expect(rungs[0].overProb).toBeLessThan(0.22);
    expect(rungs[0].requiredOverPrice).toBeNull();
  });

  test('an unsimulated or insufficient prop yields an empty ladder', () => {
    expect(propLadder(null, [10.5])).toEqual([]);
    expect(propLadder({ insufficientData: true }, [10.5])).toEqual([]);
    expect(propLadder({ dist: null, samples: 0 }, [10.5])).toEqual([]);
  });
});

describe('reading the simulated distribution', () => {
  const sim = simulateGame(okcSas, { numSims: 30000, seed: 77 });

  test('percentiles are ordered and bracket the mean', () => {
    const d = distributionSummary(sim);
    expect(d.margin.p5).toBeLessThan(d.margin.p25);
    expect(d.margin.p25).toBeLessThan(d.margin.median);
    expect(d.margin.median).toBeLessThan(d.margin.p75);
    expect(d.margin.p75).toBeLessThan(d.margin.p95);
    expect(d.margin.median).toBeCloseTo(sim.means.margin, 0);
  });

  test('the 90% margin interval is as wide as the calibration implies', () => {
    const d = distributionSummary(sim);
    const width = d.marginRange90[1] - d.marginRange90[0];
    // Two-sided 90% of a normal is about 3.29 SD, so with MARGIN_SD near 15.8
    // the band should be roughly 50 points. A much narrower band would mean the
    // model is quietly overconfident again.
    expect(width).toBeGreaterThan(40);
    expect(width).toBeLessThan(65);
  });

  test('a percentile matches the probability it is derived from', () => {
    const d = distributionSummary(sim);
    const below = probBetween(sim.dist.total, sim.numSims, -1e9, d.total.median);
    expect(below).toBeGreaterThan(0.45);
    expect(below).toBeLessThan(0.58);
  });

  test('probBetween partitions the distribution', () => {
    const lo = probBetween(sim.dist.margin, sim.numSims, -1e9, -1);
    const mid = probBetween(sim.dist.margin, sim.numSims, 0, 0);
    const hi = probBetween(sim.dist.margin, sim.numSims, 1, 1e9);
    expect(lo + mid + hi).toBeCloseTo(1, 10);
  });

  test('a prop carries its own percentile band', () => {
    const rebounds = sim.propResults.find((r) => r.prop.id === 'wemby-reb');
    const band = propDistribution(rebounds);
    expect(band.p10).toBeLessThan(band.median);
    expect(band.median).toBeLessThan(band.p90);
    expect(band.mean).toBeCloseTo(rebounds.simulatedMean, 10);
    // A rebounding line should not swing from 0 to 30.
    expect(band.p90 - band.p10).toBeLessThan(15);
  });

  test('an unsimulated prop has no band rather than a fake one', () => {
    expect(propDistribution(null)).toBeNull();
    expect(propDistribution({ insufficientData: true })).toBeNull();
  });

  test('analyzeGame exposes the distribution alongside the projection', () => {
    const a = analyzeGame(okcSas, { numSims: 8000, seed: 78 });
    expect(a.distribution.numSims).toBe(8000);
    expect(a.distribution.marginRange90).toHaveLength(2);
    expect(a.distribution.coinFlipBand).toBeGreaterThan(0);
    expect(a.distribution.coinFlipBand).toBeLessThan(0.35);
  });
});

describe('shrinkage scales with how much of the rating is this season', () => {
  // Same matchup, three levels of current-season evidence.
  const withWeight = (w) => ({
    ...CLEAN_GAME,
    away: { ...CLEAN_GAME.away, blendWeight: w, currentSeasonGames: w ? 20 : 0 },
    home: { ...CLEAN_GAME.home, blendWeight: w, currentSeasonGames: w ? 20 : 0 },
  });

  test('prior-season-only ratings get the prior-season constants', () => {
    const p = projectGame(withWeight(0), { anchorWeight: 0 });
    expect(p.blendWeight).toBe(0);
    expect(p.shrinkMargin).toBeCloseTo(MODEL_CONSTANTS.RATING_SHRINK_MARGIN, 10);
    expect(p.marginSd).toBeCloseTo(MODEL_CONSTANTS.MARGIN_SD, 10);
  });

  test('fully blended ratings get the blended constants', () => {
    const p = projectGame(withWeight(1), { anchorWeight: 0 });
    expect(p.shrinkMargin).toBeCloseTo(MODEL_CONSTANTS.RATING_SHRINK_MARGIN_BLENDED, 10);
    expect(p.marginSd).toBeCloseTo(MODEL_CONSTANTS.MARGIN_SD_BLENDED, 10);
  });

  test('a half-weighted blend lands halfway between the two fits', () => {
    const p = projectGame(withWeight(0.5), { anchorWeight: 0 });
    const C = MODEL_CONSTANTS;
    expect(p.shrinkMargin).toBeCloseTo(
      (C.RATING_SHRINK_MARGIN + C.RATING_SHRINK_MARGIN_BLENDED) / 2,
      10
    );
    expect(p.marginSd).toBeCloseTo((C.MARGIN_SD + C.MARGIN_SD_BLENDED) / 2, 10);
  });

  test('less shrinkage means a bigger projected gap, not a smaller one', () => {
    // Shrinkage pulls the rating-driven margin toward home court alone, so
    // trusting the ratings more has to widen the projection.
    const weak = projectGame(withWeight(0), { anchorWeight: 0 });
    const strong = projectGame(withWeight(1), { anchorWeight: 0 });
    const homeCourt = MODEL_CONSTANTS.HOME_COURT_POINTS;
    expect(Math.abs(strong.expectedMargin - homeCourt)).toBeGreaterThan(
      Math.abs(weak.expectedMargin - homeCourt)
    );
    // The unshrunk margin is a property of the ratings and must not move.
    expect(strong.unshrunk.margin).toBeCloseTo(weak.unshrunk.margin, 8);
  });

  test('the simulation draws from the projection it was handed', () => {
    // A tighter margin SD has to reach the simulated spread, or prices come
    // out wider than the point estimate they were built from.
    const weak = varianceComponents(projectGame(withWeight(0), { anchorWeight: 0 }));
    const strong = varianceComponents(projectGame(withWeight(1), { anchorWeight: 0 }));
    expect(strong.teamSd).toBeLessThan(weak.teamSd);
    expect(strong.correlation).toBeGreaterThan(weak.correlation);
  });

  test('a projection built by hand still gets the prior-season spread', () => {
    // Nothing outside the data layer sets blendWeight, so the absence of it
    // must mean "prior season only" rather than NaN.
    const p = projectGame(CLEAN_GAME, { anchorWeight: 0 });
    expect(p.blendWeight).toBe(0);
    expect(varianceComponents({ ...p, marginSd: undefined }).teamSd).toBeCloseTo(
      varianceComponents(p).teamSd,
      10
    );
  });
});

describe('whole-player games: double-doubles and scoring marks', () => {
  // A big averaging a double-double, and a guard who scores without rebounding.
  const rateFor = (perMinute, minutesPerGame, games = 3) => ({
    player: 'Test Player',
    team: 'HOM',
    games,
    totalMinutes: minutesPerGame * games,
    minutesPerGame,
    perMinute,
    usableSample: true,
    sampleNote: `${games} games this season`,
  });

  const bigRate = rateFor({ points: 18 / 36, rebounds: 12 / 36, assists: 5 / 36 }, 36);
  const guardRate = rateFor({ points: 26 / 35, rebounds: 2.5 / 35, assists: 6 / 35 }, 35);

  const gameWith = (players) => ({ ...CLEAN_GAME, players });

  test('an unusable sample projects nothing rather than guessing', () => {
    const thin = { ...bigRate, usableSample: false };
    const p = projectPlayerGame({ player: 'Thin', rate: thin }, CLEAN_GAME, {
      expectedPossessions: 100,
    });
    expect(p.insufficientData).toBe(true);
    expect(p.means).toBeNull();
  });

  test('a missing rate table projects nothing', () => {
    expect(projectPlayerGame({ player: 'Nobody' }, CLEAN_GAME, { expectedPossessions: 100 }).insufficientData).toBe(true);
  });

  test('means scale off minutes and the game pace', () => {
    const projection = { expectedPossessions: 100 };
    const base = projectPlayerGame({ player: 'B', rate: bigRate, pace: 100 }, CLEAN_GAME, projection);
    expect(base.means.points).toBeCloseTo(18, 6);
    expect(base.means.rebounds).toBeCloseTo(12, 6);

    // Same player in a faster game must project more of everything.
    const faster = projectPlayerGame({ player: 'B', rate: bigRate, pace: 90 }, CLEAN_GAME, projection);
    expect(faster.means.points).toBeGreaterThan(base.means.points);
    expect(faster.means.rebounds).toBeGreaterThan(base.means.rebounds);

    // Fewer minutes, less of everything.
    const short = projectPlayerGame(
      { player: 'B', rate: bigRate, pace: 100, projectedMinutes: 18 },
      CLEAN_GAME,
      projection
    );
    expect(short.means.points).toBeCloseTo(9, 6);
  });

  test('a double-double average lands near a coin flip or better, a scorer does not', () => {
    const sim = simulateGame(
      gameWith([
        { player: 'Big', rate: bigRate, pace: 100 },
        { player: 'Guard', rate: guardRate, pace: 100 },
      ]),
      { numSims: 8000, seed: 7 }
    );
    const [big, guard] = sim.playerResults;
    expect(big.player).toBe('Big');
    expect(big.doubleDouble).toBeGreaterThan(0.4);
    // 2.5 rebounds and 6 assists a night is not a double-double threat.
    expect(guard.doubleDouble).toBeLessThan(0.15);
    // But he is the scorer, and the points marks have to say so.
    expect(guard.pointsAtLeast[20]).toBeGreaterThan(big.pointsAtLeast[20]);
  });

  test('a triple-double is rarer than a double-double, always', () => {
    const sim = simulateGame(
      gameWith([{ player: 'Big', rate: bigRate, pace: 100 }]),
      { numSims: 8000, seed: 11 }
    );
    const [big] = sim.playerResults;
    expect(big.tripleDouble).toBeLessThanOrEqual(big.doubleDouble);
  });

  test('points thresholds are monotone — a higher mark cannot be likelier', () => {
    const sim = simulateGame(
      gameWith([{ player: 'Guard', rate: guardRate, pace: 100 }]),
      { numSims: 8000, seed: 13 }
    );
    const [guard] = sim.playerResults;
    for (let i = 1; i < POINTS_THRESHOLDS.length; i += 1) {
      expect(guard.pointsAtLeast[POINTS_THRESHOLDS[i]]).toBeLessThanOrEqual(
        guard.pointsAtLeast[POINTS_THRESHOLDS[i - 1]]
      );
    }
  });

  test('the double-double test counts only stats that can plausibly reach ten', () => {
    // Steals and blocks are tracked, but a 10-block game is close enough to
    // never that including them would add noise, not accuracy.
    expect(DOUBLE_DOUBLE_STATS).toEqual(['points', 'rebounds', 'assists']);
    const withDefence = rateFor(
      { points: 18 / 36, rebounds: 12 / 36, assists: 5 / 36, blocks: 2 / 36, steals: 1 / 36 },
      36
    );
    const sim = simulateGame(gameWith([{ player: 'Big', rate: withDefence, pace: 100 }]), {
      numSims: 4000,
      seed: 17,
    });
    const [big] = sim.playerResults;
    expect(Object.keys(big.atLeastTen).sort()).toEqual(['assists', 'points', 'rebounds']);
    // The extra stats are still simulated and reported.
    expect(big.simulatedMeans.blocks).toBeGreaterThan(0);
  });

  test('a game with no player entries is unaffected', () => {
    const sim = simulateGame(CLEAN_GAME, { numSims: 500, seed: 3 });
    expect(sim.playerResults).toEqual([]);
  });

  test('blowouts cost minutes, and that reaches the double-double odds', () => {
    // Same player, two games: one competitive, one a near-certain rout. The
    // rout has to lower his double-double chance through lost minutes.
    const lopsided = {
      ...CLEAN_GAME,
      home: { ...CLEAN_GAME.home, ratings: { off: 128, def: 104, pace: 100 } },
      away: { ...CLEAN_GAME.away, ratings: { off: 104, def: 128, pace: 100 } },
      odds: null,
    };
    const even = simulateGame(gameWith([{ player: 'Big', rate: bigRate, pace: 100 }]), {
      numSims: 8000,
      seed: 5,
    });
    const rout = simulateGame(
      { ...lopsided, players: [{ player: 'Big', rate: bigRate, pace: 100 }] },
      { numSims: 8000, seed: 5 }
    );
    expect(rout.probs.blowout).toBeGreaterThan(even.probs.blowout);
    expect(rout.playerResults[0].doubleDouble).toBeLessThan(
      even.playerResults[0].doubleDouble
    );
  });
});


describe('the long-moneyline-dog ceiling', () => {
  // The ceiling still governs moneylines if they are ever re-enabled, so it is
  // tested with them on. The blanket ban is tested separately below.
  let allowed;
  beforeEach(() => {
    allowed = BET_RULES.ALLOW_MONEYLINE;
    BET_RULES.ALLOW_MONEYLINE = true;
  });
  afterEach(() => {
    BET_RULES.ALLOW_MONEYLINE = allowed;
  });

  test('a dog at or past the ceiling is vetoed, a shorter one is not', () => {
    expect(priceVeto('moneyline', 300)).toMatch(/past the \+300 ceiling/);
    expect(priceVeto('moneyline', 525)).toMatch(/moneyline priced \+525/);
    expect(priceVeto('moneyline', 299)).toBeNull();
    expect(priceVeto('moneyline', 150)).toBeNull();
  });

  test('favourites are never caught by it', () => {
    // A negative price is a favourite; the rule is about small probabilities.
    expect(priceVeto('moneyline', -575)).toBeNull();
    expect(priceVeto('moneyline', -110)).toBeNull();
  });

  test('it applies only to moneylines', () => {
    // A spread or prop at +400 is a different animal: its probability is not
    // small, the price is. Only the moneyline ceiling is evidenced.
    expect(priceVeto('spread', 400)).toBeNull();
    expect(priceVeto('total', 400)).toBeNull();
    expect(priceVeto('prop', 400)).toBeNull();
    expect(priceVeto('moneyline', null)).toBeNull();
  });

  test('a long dog is vetoed by the ceiling, not merely by divergence', () => {
    // A lopsided game would trip the margin-divergence veto first and mask the
    // rule under test, so the line is derived from the model's OWN projection:
    // the model and the market agree on the game, and the only thing wrong
    // with the row is that a small probability cannot be priced.
    const mismatch = {
      ...CLEAN_GAME,
      away: { ...CLEAN_GAME.away, ratings: { off: 106, def: 124, pace: 100 } },
      home: { ...CLEAN_GAME.home, ratings: { off: 124, def: 106, pace: 100 } },
      odds: null,
    };
    const fair = projectGame(mismatch, { anchorWeight: 0 });
    const line = Math.round(fair.expectedMargin * 2) / 2; // nearest half point

    const result = analyzeGame(
      {
        ...mismatch,
        odds: {
          moneyline: { away: 900, home: -1500 },
          spread: { homeLine: -line, homePrice: -110, awayPrice: -110 },
          total: { line: Math.round(fair.expectedTotal * 2) / 2, over: -110, under: -110 },
        },
      },
      { numSims: 4000, seed: 23 }
    );

    const dog = result.markets.find((m) => m.market === 'moneyline' && m.price > 0);
    expect(dog).toBeDefined();
    expect(dog.price).toBe(900);
    expect(dog.veto).toMatch(/ceiling/);
    expect(dog.qualifies).toBe(false);

    // The favourite side of the same market is untouched by the rule.
    const fav = result.markets.find((m) => m.market === 'moneyline' && m.price < 0);
    expect(priceVeto('moneyline', fav.price)).toBeNull();
  });

  test('the clean game still produces a playable row', () => {
    // The guard that matters: these rules must gate bets, not silence the model.
    const result = analyzeGame(CLEAN_GAME, { numSims: 4000, seed: 29 });
    const playable = [...result.markets, ...result.derived].filter((m) => !m.veto);
    expect(playable.length).toBeGreaterThan(0);
  });
});


describe('moneylines off the board', () => {
  test('the ban is in force', () => {
    expect(BET_RULES.ALLOW_MONEYLINE).toBe(false);
  });

  test('every moneyline is vetoed, favourite or dog, short or long', () => {
    for (const price of [-575, -150, -110, 100, 160, 299, 300, 900]) {
      expect(priceVeto('moneyline', price)).toMatch(/moneylines are off the board/);
    }
  });

  test('other markets are untouched by it', () => {
    expect(priceVeto('spread', -110)).toBeNull();
    expect(priceVeto('total', -110)).toBeNull();
    expect(priceVeto('prop', 150)).toBeNull();
  });

  test('a moneyline row keeps its edge for reporting while refusing to qualify', () => {
    const result = analyzeGame(CLEAN_GAME, { numSims: 4000, seed: 31 });
    const mls = result.markets.filter((m) => m.market === 'moneyline');
    expect(mls.length).toBe(2);
    for (const m of mls) {
      expect(Number.isFinite(m.rawEdge)).toBe(true);
      expect(m.qualifies).toBe(false);
    }
  });
});
