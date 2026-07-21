import {
  americanToProb,
  probToAmerican,
  removeVig,
  poissonSample,
  mulberry32,
  simulateFight,
  analyzeFight,
  analyzeCard,
  gradeBet,
  betUnits,
  BET_RULES,
} from './ufcSimulator';
import { UFC_CARD } from '../data/ufcFights';
import { UFC_329_CARD } from '../data/ufc329';

const mainEvent = UFC_CARD.fights[0];

describe('odds math', () => {
  test('american odds convert to implied probability', () => {
    expect(americanToProb(100)).toBeCloseTo(0.5);
    expect(americanToProb(-200)).toBeCloseTo(2 / 3);
    expect(americanToProb(150)).toBeCloseTo(0.4);
  });

  test('probability converts back to american odds', () => {
    expect(probToAmerican(0.5)).toBe(-100);
    expect(probToAmerican(2 / 3)).toBe(-200);
    expect(probToAmerican(0.4)).toBe(150);
  });

  test('removeVig normalizes market probabilities to 1', () => {
    const noVig = removeVig([0.55, 0.52]);
    expect(noVig[0] + noVig[1]).toBeCloseTo(1);
    expect(noVig[0]).toBeGreaterThan(noVig[1]);
  });
});

describe('sampling', () => {
  test('poisson sample mean approximates lambda', () => {
    const rand = mulberry32(7);
    const n = 5000;
    let total = 0;
    for (let i = 0; i < n; i++) total += poissonSample(4, rand);
    expect(total / n).toBeGreaterThan(3.7);
    expect(total / n).toBeLessThan(4.3);
  });

  test('rng is deterministic per seed', () => {
    const a = mulberry32(123);
    const b = mulberry32(123);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });
});

describe('simulateFight', () => {
  const { probs, numSims } = simulateFight(mainEvent, { numSims: 10000, seed: 1 });

  test('runs the requested number of simulations', () => {
    expect(numSims).toBe(10000);
  });

  test('outcome probabilities sum to 1', () => {
    const total = probs.aWin + probs.bWin + probs.draw;
    expect(total).toBeCloseTo(1, 6);
    const byMethod =
      probs.aKO + probs.aSub + probs.aDec + probs.bKO + probs.bSub + probs.bDec + probs.draw;
    expect(byMethod).toBeCloseTo(1, 6);
  });

  test('distance probability matches decision + draw outcomes', () => {
    expect(probs.goesDistance).toBeCloseTo(probs.aDec + probs.bDec + probs.draw, 6);
  });

  test('over/under probabilities are complementary', () => {
    expect(probs.overRounds + probs.underRounds).toBeCloseTo(1, 6);
  });

  test('finish-by-round distribution accounts for all finishes', () => {
    const finishTotal = probs.finishByRound.reduce((a, b) => a + b, 0);
    expect(finishTotal).toBeCloseTo(1 - probs.goesDistance, 6);
    expect(probs.finishByRound).toHaveLength(mainEvent.rounds);
  });

  test('same seed reproduces identical results', () => {
    const again = simulateFight(mainEvent, { numSims: 2000, seed: 99 });
    const again2 = simulateFight(mainEvent, { numSims: 2000, seed: 99 });
    expect(again.probs).toEqual(again2.probs);
  });
});

describe('analyzeFight', () => {
  const analysis = analyzeFight(mainEvent, { numSims: 10000, seed: 42 });

  test('produces the full summary block', () => {
    const s = analysis.summary;
    expect(s.predictedWinner).toBeTruthy();
    expect(s.winProbability).toBeGreaterThan(0.5);
    expect(s.confidenceScore).toBeGreaterThanOrEqual(1);
    expect(s.confidenceScore).toBeLessThanOrEqual(10);
    expect(['Low', 'Medium', 'High']).toContain(s.riskLevel);
    expect(s.finishProbability + s.goesDistance).toBeCloseTo(1, 6);
  });

  test('covers all seven market families', () => {
    const labels = analysis.markets.map((m) => m.label).join(' | ');
    expect(labels).toMatch(/ML/);
    expect(labels).toMatch(/distance/);
    expect(labels).toMatch(/Over .* rounds/);
    expect(labels).toMatch(/KO\/TKO/);
    expect(labels).toMatch(/Submission/);
    expect(labels).toMatch(/Decision/);
    expect(analysis.roundProps).toHaveLength(mainEvent.rounds);
  });

  test('every recommended bet clears the edge and confidence gates', () => {
    analysis.valueBets.forEach((bet) => {
      const minEdge =
        bet.bookOdds > 0 ? BET_RULES.MIN_UNDERDOG_EDGE : BET_RULES.MIN_FAVORITE_EDGE;
      expect(bet.edge).toBeGreaterThanOrEqual(minEdge);
    });
    if (analysis.valueBets.length > 0) {
      expect(analysis.confidence.score).toBeGreaterThanOrEqual(BET_RULES.MIN_CONFIDENCE);
    }
  });

  test('blending shrinks edges toward the market', () => {
    analysis.markets.forEach((row) => {
      expect(Math.abs(row.edge)).toBeLessThanOrEqual(Math.abs(row.modelEdge) + 1e-9);
      const lo = Math.min(row.modelProb, row.blendProb);
      const hi = Math.max(row.modelProb, row.blendProb);
      // blended prob sits between the model and the market prior
      expect(row.blendProb).toBeGreaterThanOrEqual(Math.min(lo, row.implied) - 1e-9);
      expect(row.blendProb).toBeLessThanOrEqual(Math.max(hi, row.implied) + 1e-9);
    });
  });
});

describe('market-blend bet discipline', () => {
  const cards = [
    ...analyzeCard(UFC_CARD.fights, { numSims: 4000, seed: 42 }),
    ...analyzeCard(UFC_329_CARD.fights, { numSims: 4000, seed: 42 }),
  ];

  test('estimated prices are never bet', () => {
    cards.forEach((r) => r.valueBets.forEach((bet) => expect(bet.estimated).toBe(false)));
  });

  test('estimated markets are flagged on the board', () => {
    const main329 = cards.find((r) => r.fight.id === 'ufc329-main');
    const flagged = main329.markets.filter((m) => m.estimated).map((m) => m.label);
    expect(flagged.join(' | ')).toMatch(/distance/);
    expect(flagged.join(' | ')).toMatch(/rounds/);
    // sourced main-event method props stay biddable
    const holKO = main329.markets.find((m) => m.label === 'Max Holloway by KO/TKO');
    expect(holKO.estimated).toBe(false);
  });

  test('no fight carries more than the per-fight bet cap', () => {
    cards.forEach((r) =>
      expect(r.valueBets.length).toBeLessThanOrEqual(BET_RULES.MAX_BETS_PER_FIGHT)
    );
  });
});

describe('results grading', () => {
  // Co-main: Pimblett (fighter B) submitted Saint Denis in round 1
  const comain = UFC_329_CARD.fights.find((f) => f.id === 'ufc329-comain');

  test('grades moneyline, distance, totals, and method bets', () => {
    expect(gradeBet({ label: 'Paddy Pimblett ML', bookOdds: 124 }, comain)).toBe('win');
    expect(gradeBet({ label: 'Benoît Saint Denis ML', bookOdds: -148 }, comain)).toBe('loss');
    expect(gradeBet({ label: 'Fight goes distance — Yes', bookOdds: 170 }, comain)).toBe('loss');
    expect(gradeBet({ label: 'Fight goes distance — No', bookOdds: -210 }, comain)).toBe('win');
    expect(gradeBet({ label: 'Under 2.5 rounds', bookOdds: -160 }, comain)).toBe('win');
    expect(gradeBet({ label: 'Over 2.5 rounds', bookOdds: 130 }, comain)).toBe('loss');
    expect(gradeBet({ label: 'Paddy Pimblett by Submission', bookOdds: 450 }, comain)).toBe('win');
    expect(gradeBet({ label: 'Paddy Pimblett by KO/TKO', bookOdds: 700 }, comain)).toBe('loss');
  });

  test('returns null for fights without a result', () => {
    expect(gradeBet({ label: 'Anyone ML', bookOdds: 100 }, UFC_CARD.fights[0])).toBeNull();
  });

  test('betUnits pays positive odds at odds/100 and negative at 100/odds', () => {
    expect(betUnits({ bookOdds: 130 }, 'win')).toBeCloseTo(1.3);
    expect(betUnits({ bookOdds: -220 }, 'win')).toBeCloseTo(0.4545, 3);
    expect(betUnits({ bookOdds: 130 }, 'loss')).toBe(-1);
    expect(betUnits({ bookOdds: 130 }, 'push')).toBe(0);
  });

  test('analyzeFight attaches grading with net units when result exists', () => {
    const analysis = analyzeFight(comain, { numSims: 3000, seed: 5 });
    expect(analysis.grading).not.toBeNull();
    expect(analysis.grading.actualWinnerName).toBe('Paddy Pimblett');
    expect(typeof analysis.grading.netUnits).toBe('number');
    analysis.grading.bets.forEach((b) => {
      expect(['win', 'loss', 'push']).toContain(b.outcome);
    });
  });

  test('fights without results have null grading', () => {
    const analysis = analyzeFight(UFC_CARD.fights[0], { numSims: 1000, seed: 5 });
    expect(analysis.grading).toBeNull();
  });
});

describe('card-level filters', () => {
  const results = analyzeCard(UFC_CARD.fights, { numSims: 5000, seed: 42 });

  test('public trap fight is flagged and produces no bets', () => {
    const trap = results.find((r) => r.fight.publicTrap);
    expect(trap.avoidReasons.join()).toMatch(/public/i);
    expect(trap.valueBets).toHaveLength(0);
    expect(trap.confidence.score).toBeLessThan(BET_RULES.MIN_CONFIDENCE);
  });

  test('coin-flip fight is flagged and moneyline is excluded', () => {
    const flip = results.find((r) =>
      r.avoidReasons.some((reason) => reason.match(/coin-flip/i))
    );
    expect(flip).toBeTruthy();
    flip.valueBets.forEach((bet) => expect(bet.label).not.toMatch(/ ML$/));
  });

  test('confidence dampeners fire for the wild low-sample fighter', () => {
    const trap = results.find((r) => r.fight.publicTrap);
    const reasons = trap.confidence.penalties.join(' | ');
    expect(reasons).toMatch(/high-variance/);
    expect(reasons).toMatch(/poor cardio/);
    expect(reasons).toMatch(/low UFC sample/);
  });
});
