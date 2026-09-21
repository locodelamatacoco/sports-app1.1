// src/models/calibration.js
//
// Model evaluation. Unit counting over a handful of cards is far too noisy to
// tell whether the simulation has an edge, so this measures the things that
// converge faster:
//
//  - Brier score and log loss on win probabilities, for BOTH the model and
//    the vig-free closing line. If the market scores better, the model has no
//    edge on that market and no amount of gate-tuning will create one.
//  - Calibration bins: when the model says 70%, do those fighters win ~70%?
//    A model can pick winners well and still be badly calibrated, which is
//    what actually decides whether an "edge" is real.
//  - Method-call accuracy, tracked separately from winner accuracy, because
//    the betting value in MMA lives in method/round markets.
//  - A favorite-only baseline, so "picks winners" claims are measured against
//    the trivial strategy of always taking the market favorite.

import { analyzeCard, americanToProb, removeVig } from './ufcSimulator';

const clamp01 = (p) => Math.min(0.999, Math.max(0.001, p));

// Brier score for a binary outcome: mean squared error of the probability.
// Lower is better; 0.25 is what you get by always guessing 50%.
export function brier(pairs) {
  if (!pairs.length) return null;
  return pairs.reduce((s, [p, hit]) => s + (p - (hit ? 1 : 0)) ** 2, 0) / pairs.length;
}

// Log loss: punishes confident mistakes far harder than Brier does.
export function logLoss(pairs) {
  if (!pairs.length) return null;
  return (
    -pairs.reduce((s, [p, hit]) => {
      const q = clamp01(p);
      return s + (hit ? Math.log(q) : Math.log(1 - q));
    }, 0) / pairs.length
  );
}

// Group predictions into probability bands and compare predicted vs actual.
export function calibrationBins(pairs, edges = [0.5, 0.6, 0.7, 0.8, 0.9, 1.01]) {
  const bins = [];
  let lo = 0;
  for (const hi of edges) {
    const inBin = pairs.filter(([p]) => p >= lo && p < hi);
    if (inBin.length) {
      bins.push({
        range: `${(lo * 100).toFixed(0)}-${(Math.min(hi, 1) * 100).toFixed(0)}%`,
        n: inBin.length,
        predicted: inBin.reduce((s, [p]) => s + p, 0) / inBin.length,
        actual: inBin.filter(([, hit]) => hit).length / inBin.length,
      });
    }
    lo = hi;
  }
  return bins;
}

// Evaluate the model over every graded fight on the supplied cards.
export function evaluateCards(cards, options = {}) {
  const modelPairs = [];
  const marketPairs = [];
  const favPairs = [];
  let methodHits = 0;
  let methodGraded = 0;
  let winnerHits = 0;
  let favHits = 0;
  let graded = 0;
  const rows = [];

  cards.forEach((card, ci) => {
    const results = analyzeCard(card.fights, {
      numSims: options.numSims ?? 10000,
      seed: (options.seed ?? 42) + ci * 7919,
    });
    results.forEach((r) => {
      if (!r.grading) return;
      const { fight, sim, summary, grading } = r;
      const aWon = grading.actual.winner === 'A';
      const bWon = grading.actual.winner === 'B';
      if (!aWon && !bWon) return; // skip draws/NCs
      graded += 1;

      // Score fighter A's win probability against whether A actually won.
      const [mktA] = removeVig([
        americanToProb(fight.odds.moneylineA),
        americanToProb(fight.odds.moneylineB),
      ]);
      const modelA = sim.probs.aWin / (sim.probs.aWin + sim.probs.bWin);
      modelPairs.push([modelA, aWon]);
      marketPairs.push([mktA, aWon]);

      // Trivial baseline: always back the market favorite.
      const favIsA = mktA >= 0.5;
      favPairs.push([favIsA ? mktA : 1 - mktA, favIsA === aWon]);
      if (favIsA === aWon) favHits += 1;

      if (grading.predictedWinnerCorrect) winnerHits += 1;

      // Method call: did the single most likely outcome match reality?
      methodGraded += 1;
      const [predName, predMethod] = summary.mostLikelyMethod.split(' by ');
      if (predName === grading.actualWinnerName && predMethod === grading.actual.method)
        methodHits += 1;

      rows.push({
        event: card.event,
        fight: `${fight.fighterA.name} vs ${fight.fighterB.name}`,
        modelA,
        marketA: mktA,
        actualA: aWon,
        winnerCorrect: grading.predictedWinnerCorrect,
        predictedMethod: summary.mostLikelyMethod,
        actualMethod: `${grading.actualWinnerName} by ${grading.actual.method}`,
      });
    });
  });

  return {
    graded,
    winnerAccuracy: graded ? winnerHits / graded : null,
    favoriteAccuracy: graded ? favHits / graded : null,
    methodAccuracy: methodGraded ? methodHits / methodGraded : null,
    model: {
      brier: brier(modelPairs),
      logLoss: logLoss(modelPairs),
      bins: calibrationBins(modelPairs.map(([p, h]) => (p >= 0.5 ? [p, h] : [1 - p, !h]))),
    },
    market: {
      brier: brier(marketPairs),
      logLoss: logLoss(marketPairs),
    },
    favoriteBaseline: { brier: brier(favPairs) },
    // Positive means the model's probabilities were sharper than the closing
    // line's. Negative means the market was sharper — i.e. no edge here.
    brierEdgeVsMarket: brier(marketPairs) - brier(modelPairs),
    rows,
  };
}
