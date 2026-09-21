// src/models/winProbModel.js
//
// Fitted win-probability model.
//
// The Monte Carlo simulation's hazard coefficients were all hand-chosen and
// never fitted to anything. Backtested over 960 out-of-sample fights with
// no-lookahead profiles built from UFCStats, it scored a Brier of 0.2584
// (0.2976 before calibration) — WORSE than simply guessing 50/50 (0.2500),
// at 54.6% winner accuracy.
//
// This logistic regression uses the same inputs but fits them to outcomes.
// Trained on 2081 fights before 2023-01-01, tested on 1273 fights
// after it, with the training set mirrored (A-B and B-A) so the model is
// symmetric and cannot learn a corner bias:
//
//   logistic   brier 0.2313  logloss 0.6549  accuracy 62.0%
//   simulation brier 0.2584  logloss 0.7142  accuracy 54.6%
//   coin flip  brier 0.2500  logloss 0.6931
//
// Train and test Brier agree to within 0.001, so it is not overfitting, and
// its calibration bins track the diagonal within a few points.
//
// IMPORTANT LIMIT: no historical closing lines were available, so this has
// NOT been shown to beat the market — only to beat the simulation and a coin
// flip. Published UFC closing lines typically score around 0.21-0.22 Brier,
// which would still be ahead of this model. Treat it as a better estimator,
// not as proven edge.
//
// Regenerate with scripts/fit_logistic.py when more fights are graded.

// Each term: standardised coefficient plus the training mean/sd used to
// standardise that feature.
export const WIN_PROB_TERMS = {
  slpm: { w: 0.080325, mean: 0.000000, sd: 1.855106 },
  absorbed: { w: 0.197563, mean: 0.000000, sd: 1.664517 },
  str_acc: { w: 0.153246, mean: 0.000000, sd: 0.108982 },
  str_def: { w: 0.176547, mean: 0.000000, sd: 0.102601 },
  kd15: { w: -0.136771, mean: 0.000000, sd: 1.468702 },
  power: { w: 0.061879, mean: 0.000000, sd: 4.341705 },
  pace: { w: 0.195531, mean: 0.000000, sd: 3.427682 },
  td15: { w: 0.259345, mean: 0.000000, sd: 1.947177 },
  td_acc: { w: -0.135225, mean: 0.000000, sd: 0.250466 },
  td_def: { w: 0.040695, mean: 0.000000, sd: 0.258515 },
  sub15: { w: 0.004821, mean: 0.000000, sd: 1.280146 },
  control: { w: 0.032915, mean: 0.000000, sd: 3.780404 },
  scramble: { w: -0.045802, mean: 0.000000, sd: 2.667104 },
  age: { w: 0.068509, mean: 0.000000, sd: 1.544471 },
  reach: { w: 0.119456, mean: 0.000000, sd: 3.175546 },
  height: { w: 0.042131, mean: 0.000000, sd: 2.414317 },
  cardio: { w: -0.080013, mean: 0.000000, sd: 3.139266 },
  durability: { w: 0.117277, mean: 0.000000, sd: 4.220199 },
  recentForm: { w: 0.065902, mean: 0.000000, sd: 3.378056 },
  damage3: { w: -0.000593, mean: 0.000000, sd: 4.222060 },
  activity: { w: 0.210165, mean: 0.000000, sd: 0.824415 },
  oppStrength: { w: 0.079000, mean: 0.000000, sd: 1.728369 },
  ufcFights: { w: -0.144422, mean: 0.000000, sd: 7.711521 },
  finishRate: { w: 0.132528, mean: 0.000000, sd: 0.403983 },
  variance: { w: 0.114716, mean: 0.000000, sd: 3.454187 },
  koLoss: { w: 0.031083, mean: 0.000000, sd: 0.458776 },
};

export const WIN_PROB_BIAS = -0.000000;

export const WIN_PROB_METRICS = {
  brier: 0.2313,
  logLoss: 0.6549,
  accuracy: 0.6198,
  nTrain: 2081,
  nTest: 1273,
  testFrom: '2023-01-01',
};

// Raw (unstandardised) feature differences, A minus B. Sign convention is
// always "higher is better for A".
export function winProbFeatures(a, b) {
  const sa = a.striking, sb = b.striking;
  const ga = a.grappling, gb = b.grappling;
  const fa = a.factors, fb = b.factors;
  return {
    slpm: sa.sigStrikesPerMin - sb.sigStrikesPerMin,
    absorbed: sb.strikesAbsorbedPerMin - sa.strikesAbsorbedPerMin,
    str_acc: sa.strikeAccuracy - sb.strikeAccuracy,
    str_def: sa.strikeDefense - sb.strikeDefense,
    kd15: sa.knockdownRate - sb.knockdownRate,
    power: sa.powerRating - sb.powerRating,
    pace: sa.pace - sb.pace,
    td15: ga.takedownsPer15 - gb.takedownsPer15,
    td_acc: ga.takedownAccuracy - gb.takedownAccuracy,
    td_def: ga.takedownDefense - gb.takedownDefense,
    sub15: ga.subAttemptsPer15 - gb.subAttemptsPer15,
    control: ga.controlRating - gb.controlRating,
    scramble: ga.scrambleAbility - gb.scrambleAbility,
    age: fb.age - fa.age,
    reach: fa.reach - fb.reach,
    height: fa.height - fb.height,
    cardio: fa.cardio - fb.cardio,
    durability: fa.durability - fb.durability,
    recentForm: fa.recentForm - fb.recentForm,
    damage3: fb.damageLastThree - fa.damageLastThree,
    activity: fa.activityLevel - fb.activityLevel,
    oppStrength: fa.oppStrength - fb.oppStrength,
    ufcFights: fa.ufcFights - fb.ufcFights,
    finishRate: fa.finishRate - fb.finishRate,
    variance: fb.varianceRating - fa.varianceRating,
    koLoss: (fb.recentKOLoss ? 1 : 0) - (fa.recentKOLoss ? 1 : 0),
  };
}

// Probability that fighter A beats fighter B.
export function winProbability(a, b) {
  const f = winProbFeatures(a, b);
  let z = WIN_PROB_BIAS;
  for (const [key, term] of Object.entries(WIN_PROB_TERMS)) {
    const raw = f[key];
    if (raw === undefined || Number.isNaN(raw)) continue;
    z += term.w * ((raw - term.mean) / (term.sd || 1));
  }
  return 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, z))));
}
