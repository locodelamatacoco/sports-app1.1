// src/models/ufcSimulator.js
//
// UFC Monte Carlo betting model.
//
// Simulates fights round-by-round (>= 10,000 sims per fight) using Poisson
// projections for strike/takedown/submission events, pace + fatigue scaling,
// damage accumulation, and finish escalation. Compares simulated
// probabilities against sportsbook odds to surface value bets.

// ---------------------------------------------------------------------------
// Tunable model constants
// ---------------------------------------------------------------------------

export const MODEL_CONSTANTS = {
  LEAGUE_AVG_STRIKE_DEF: 0.55, // league-average significant strike defense
  LEAGUE_AVG_TD_DEF: 0.56, // league-average takedown defense
  ROUND_MINUTES: 5,
  DAMAGE_PER_STRIKE: 0.0035, // health lost per sig strike at power 5 vs chin 5
  KNOCKDOWN_HEALTH_COST: 0.09,
  KO_STRIKE_COEFF: 0.002, // per head strike KO hazard at power 5 vs chin 5
  KO_KNOCKDOWN_COEFF: 0.33, // KO hazard contributed by each knockdown
  FINISH_ESCALATION_HEALTH: 0.55, // below this health, finish hazard escalates
  FINISH_ESCALATION_MULT: 1.6,
  SUB_BASE_SUCCESS: 0.16, // baseline sub attempt conversion
  COUNTER_SUB_MULT: 1.5, // conversion multiplier on scramble counter-subs
  JUDGE_NOISE_SD: 7, // gaussian noise on round scorecards
  MIN_STAMINA: 0.42,
  DRAW_ROUND_MARGIN: 0.6, // score margin under which a round can be 10-10
};

// Minimum edge thresholds and confidence gate for recommendations
export const BET_RULES = {
  MIN_FAVORITE_EDGE: 0.05,
  MIN_UNDERDOG_EDGE: 0.07,
  MIN_CONFIDENCE: 6.5,
  COIN_FLIP_BAND: [0.47, 0.53], // model win prob band treated as a coin flip
  HUGE_FAVORITE_IMPLIED: 0.8, // implied prob above which value must be present
  LOW_VOLUME_SLPM: 2.2, // combined striking+grappling output floor
};

// ---------------------------------------------------------------------------
// RNG + sampling helpers
// ---------------------------------------------------------------------------

// Deterministic PRNG so simulation runs are reproducible per seed.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Knuth Poisson sampler; lambdas in this model stay small (< ~40).
export function poissonSample(lambda, rand) {
  if (lambda <= 0) return 0;
  const L = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  do {
    k += 1;
    p *= rand();
  } while (p > L);
  return k - 1;
}

function gaussianSample(rand, mean = 0, sd = 1) {
  const u1 = Math.max(rand(), 1e-12);
  const u2 = rand();
  return mean + sd * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

// ---------------------------------------------------------------------------
// Odds math
// ---------------------------------------------------------------------------

export function americanToProb(odds) {
  return odds > 0 ? 100 / (odds + 100) : -odds / (-odds + 100);
}

export function probToAmerican(prob) {
  const p = clamp(prob, 0.001, 0.999);
  return p >= 0.5
    ? Math.round((-100 * p) / (1 - p))
    : Math.round((100 * (1 - p)) / p);
}

export function formatAmerican(odds) {
  return odds > 0 ? `+${odds}` : `${odds}`;
}

// Remove the vig from a set of mutually exclusive market prices.
export function removeVig(probs) {
  const total = probs.reduce((a, b) => a + b, 0);
  return probs.map((p) => p / total);
}

// ---------------------------------------------------------------------------
// Pre-simulation Poisson-style projections
// ---------------------------------------------------------------------------

// Analytic projections (expected strike totals, finish/KO/sub/decision
// probabilities) used to sanity-check the Monte Carlo output and shown in the UI.
export function poissonProjections(fight) {
  const { fighterA, fighterB, rounds } = fight;
  const C = MODEL_CONSTANTS;

  const project = (me, opp) => {
    const defAdj = (1 - opp.striking.strikeDefense) / (1 - C.LEAGUE_AVG_STRIKE_DEF);
    const paceMult = 0.85 + 0.03 * me.striking.pace;
    const expStrikesPerRound =
      me.striking.sigStrikesPerMin * C.ROUND_MINUTES * defAdj * paceMult * 0.92;
    const expStrikes = expStrikesPerRound * rounds;

    const chin = (opp.factors.durability / 5) * (1 - 0.03 * opp.factors.damageLastThree);
    const koLambda =
      expStrikes *
      me.striking.headStrikePct *
      C.KO_STRIKE_COEFF *
      (me.striking.powerRating / 5) /
      Math.max(chin, 0.35);
    const koProb = 1 - Math.exp(-koLambda);

    const tdPerRound = (me.grappling.takedownsPer15 / 3) *
      ((1 - opp.grappling.takedownDefense) / (1 - C.LEAGUE_AVG_TD_DEF));
    const subLambda =
      (me.grappling.subAttemptsPer15 / 3) *
      rounds *
      Math.min(tdPerRound * 1.5, 1) *
      C.SUB_BASE_SUCCESS *
      (10 - opp.grappling.scrambleAbility) / 6;
    const subProb = 1 - Math.exp(-subLambda);

    return {
      expectedStrikes: Math.round(expStrikes),
      expectedTakedowns: +(tdPerRound * rounds).toFixed(1),
      koProb,
      subProb,
    };
  };

  const a = project(fighterA, fighterB);
  const b = project(fighterB, fighterA);
  const finishProb = clamp(a.koProb + a.subProb + b.koProb + b.subProb, 0, 0.97);
  return {
    fighterA: a,
    fighterB: b,
    finishProb,
    decisionProb: 1 - finishProb,
  };
}

// ---------------------------------------------------------------------------
// Round-by-round fight simulation
// ---------------------------------------------------------------------------

function buildSimProfile(fighter, opponent, rounds, rand) {
  const { striking: s, grappling: g, factors: f } = fighter;
  const C = MODEL_CONSTANTS;

  const of = opponent.factors;

  // Per-sim performance noise: wild / high-variance fighters swing more,
  // as do inactive fighters (ring rust) and short-notice replacements.
  const noiseSd =
    0.05 +
    0.012 * f.varianceRating +
    (f.shortNotice ? 0.03 : 0) +
    (f.activityLevel < 1.5 ? 0.02 : 0);
  // Stats built against weak opposition regress hard, and octagon experience
  // travels: a big UFC-fights gap favors the veteran in chaotic fights.
  // (Recalibrated after UFC 329, where an unbeaten prospect's stats vs weak
  // opposition were trusted far too much against a former title challenger.)
  const meanForm =
    1 +
    0.012 * (f.recentForm - 5) +
    0.02 * (f.oppStrength - of.oppStrength) +
    0.004 * (Math.min(f.ufcFights, 20) - Math.min(of.ufcFights, 20));
  const form = clamp(gaussianSample(rand, meanForm, noiseSd), 0.55, 1.45);

  // Physical edges: reach/height help at range, southpaw-vs-orthodox is a
  // small edge for the lefty; age past 35 taxes chin and cardio.
  const reachEdge = clamp((f.reach - of.reach) * 0.006, -0.04, 0.04);
  const heightEdge = clamp((f.height - of.height) * 0.002, -0.01, 0.01);
  const stanceEdge =
    f.stance === 'Southpaw' && opponent.factors.stance === 'Orthodox' ? 0.02 : 0;
  const physicalMult = 1 + reachEdge + heightEdge + stanceEdge;
  const ageTax = Math.max(0, f.age - 35) * 0.02;

  // Chin erosion from accumulated career damage, age, and recent KO losses.
  let chin = (f.durability / 5) * (1 - 0.035 * f.damageLastThree) * (1 - ageTax);
  if (f.recentKOLoss) chin *= 0.82;
  if (f.weightCutConcerns) chin *= 0.93;

  // Cardio decay per round; five-round experience softens championship rounds.
  const paceCost = 0.028 + 0.012 * s.pace;
  const cardioSave = 0.0135 * f.cardio;
  let drainPerRound = Math.max(0.015, paceCost - cardioSave + ageTax * 0.3);
  if (f.shortNotice) drainPerRound += 0.02;
  if (f.weightCutConcerns) drainPerRound += 0.015;
  const championshipPenalty =
    rounds === 5 && f.fiveRoundExp === 0 ? 0.02 : 0;

  const defAdj =
    (1 - opponent.striking.strikeDefense) / (1 - C.LEAGUE_AVG_STRIKE_DEF);

  return {
    fighter,
    form,
    chin,
    drainPerRound,
    championshipPenalty,
    strikesPerMin:
      s.sigStrikesPerMin *
      defAdj *
      (0.85 + 0.03 * s.pace) *
      // hittable opponents (high absorbed-per-min) inflate landed volume
      (0.85 + 0.15 * (opponent.striking.strikesAbsorbedPerMin / 3.5)) *
      form *
      physicalMult,
    // accurate strikers convert volume into knockdowns at a higher clip
    kdRatePerRound:
      (s.knockdownRate / 3) *
      (s.powerRating / 5) *
      (0.7 + 0.3 * (s.strikeAccuracy / 0.45)) *
      form,
    tdAttemptsPerRound: (g.takedownsPer15 / 3) * form,
    tdSuccessProb: clamp(
      g.takedownAccuracy *
        ((1 - opponent.grappling.takedownDefense) / (1 - C.LEAGUE_AVG_TD_DEF)) *
        (1 - 0.03 * (opponent.grappling.scrambleAbility - 5)),
      0.04,
      0.85
    ),
    subAttemptsPerRound: g.subAttemptsPer15 / 3,
    subFinishProb: clamp(
      C.SUB_BASE_SUCCESS *
        (0.6 + g.subAttemptsPer15 * 0.25) *
        ((10 - opponent.grappling.scrambleAbility) / 5),
      0.02,
      0.45
    ),
    health: 1,
    stamina: 1,
    roundsWon: 0,
  };
}

function simulateOneFight(fight, rand) {
  const { rounds } = fight;
  const C = MODEL_CONSTANTS;
  const A = buildSimProfile(fight.fighterA, fight.fighterB, rounds, rand);
  const B = buildSimProfile(fight.fighterB, fight.fighterA, rounds, rand);

  for (let round = 1; round <= rounds; round++) {
    // Championship-round fatigue for fighters without 5-round experience
    const champDrainA = round > 3 ? A.championshipPenalty : 0;
    const champDrainB = round > 3 ? B.championshipPenalty : 0;

    const result = simulateRound(A, B, round, rand);
    if (result) return { ...result, round };

    A.stamina = Math.max(C.MIN_STAMINA, A.stamina - A.drainPerRound - champDrainA - A.extraDrain);
    B.stamina = Math.max(C.MIN_STAMINA, B.stamina - B.drainPerRound - champDrainB - B.extraDrain);
  }

  // Decision: tally round wins, allow rare draws on even cards
  if (A.roundsWon === B.roundsWon) return { winner: 'draw', method: 'Draw', round: rounds };
  return {
    winner: A.roundsWon > B.roundsWon ? 'A' : 'B',
    method: 'Decision',
    round: rounds,
  };
}

// Simulate a single round; returns a finish result or null if it goes on.
function simulateRound(A, B, round, rand) {
  const C = MODEL_CONSTANTS;
  A.extraDrain = 0;
  B.extraDrain = 0;

  // --- Grappling phase: takedowns + control shrink standing time ---
  const grapple = (me, opp) => {
    const attempts = poissonSample(me.tdAttemptsPerRound * me.stamina, rand);
    let landed = 0;
    for (let i = 0; i < attempts; i++) if (rand() < me.tdSuccessProb) landed += 1;
    // Control minutes per takedown, cut down by opponent scrambling
    const controlPerTd =
      (0.9 + rand() * 1.4) * (me.fighter.grappling.controlRating / 5) *
      (1 - 0.05 * (opp.fighter.grappling.scrambleAbility - 5));
    const controlMin = Math.min(landed * Math.max(controlPerTd, 0.2), 4);
    if (controlMin > 0.5) opp.extraDrain += 0.02 * controlMin; // being controlled drains cardio
    return { attempts, landed, controlMin };
  };
  const gA = grapple(A, B);
  const gB = grapple(B, A);

  const standingFrac = clamp(1 - (gA.controlMin + gB.controlMin) / C.ROUND_MINUTES, 0.15, 1);

  // --- Striking phase: Poisson strike volume, damage, knockdowns ---
  const strike = (me, opp, myControlMin) => {
    // Ground strikes during control partially replace standing volume
    const minutes = C.ROUND_MINUTES * standingFrac + myControlMin * 0.6;
    const outputMult = me.stamina * (0.55 + 0.45 * me.health);
    const landed = poissonSample(me.strikesPerMin * minutes * outputMult, rand);
    const expected = me.strikesPerMin * C.ROUND_MINUTES;
    const kdLambda =
      me.kdRatePerRound * (landed / Math.max(expected, 1)) / Math.max(opp.chin * opp.health, 0.3);
    const knockdowns = poissonSample(kdLambda, rand);
    return { landed, knockdowns };
  };
  const sA = strike(A, B, gA.controlMin);
  const sB = strike(B, A, gB.controlMin);

  // --- Damage accumulation ---
  const applyDamage = (target, hits, kds, power) => {
    target.health = clamp(
      target.health -
        hits * C.DAMAGE_PER_STRIKE * (power / 5) / Math.max(target.chin, 0.35) -
        kds * C.KNOCKDOWN_HEALTH_COST,
      0.05,
      1
    );
  };
  applyDamage(B, sA.landed, sA.knockdowns, A.fighter.striking.powerRating);
  applyDamage(A, sB.landed, sB.knockdowns, B.fighter.striking.powerRating);

  // --- KO check with finish escalation after heavy damage ---
  const koHazard = (me, opp, s) => {
    let lambda =
      s.landed * me.fighter.striking.headStrikePct * C.KO_STRIKE_COEFF *
        (me.fighter.striking.powerRating / 5) / Math.max(opp.chin * opp.health, 0.3) +
      s.knockdowns * C.KO_KNOCKDOWN_COEFF;
    if (opp.health < C.FINISH_ESCALATION_HEALTH) lambda *= C.FINISH_ESCALATION_MULT;
    return 1 - Math.exp(-lambda);
  };
  const koA = rand() < koHazard(A, B, sA);
  const koB = rand() < koHazard(B, A, sB);
  if (koA && koB) {
    // Both scored fight-ending damage this round; earlier event decided by volume
    return rand() < sA.landed / Math.max(sA.landed + sB.landed, 1)
      ? { winner: 'A', method: 'KO/TKO' }
      : { winner: 'B', method: 'KO/TKO' };
  }
  if (koA) return { winner: 'A', method: 'KO/TKO' };
  if (koB) return { winner: 'B', method: 'KO/TKO' };

  // --- Submission checks ---
  // Top-position subs need grappling success; a badly hurt opponent also
  // opens front-headlock/back-take finishes without a takedown, and failed
  // shots concede scramble counter-subs (guillotines, D'arces) to defenders
  // with real sub skill. Fatigue and damage raise conversion everywhere.
  const vulnerability = (opp) =>
    (1.35 - opp.stamina * 0.5) * (1.3 - opp.health * 0.45);

  const subCheck = (me, opp, g) => {
    const hurtOpp = opp.health < C.FINISH_ESCALATION_HEALTH;
    if (g.landed === 0 && g.controlMin < 0.5 && !hurtOpp) return false;
    const lambda =
      me.subAttemptsPerRound * (0.5 + g.controlMin / 2) +
      (hurtOpp ? me.subAttemptsPerRound * 0.6 : 0);
    const attempts = poissonSample(lambda, rand);
    const vuln = vulnerability(opp) * (hurtOpp ? 1.25 : 1);
    for (let i = 0; i < attempts; i++) {
      if (rand() < me.subFinishProb * vuln) return true;
    }
    return false;
  };

  const counterSubCheck = (defender, shooter, shooterGrapple) => {
    const failedShots = shooterGrapple.attempts - shooterGrapple.landed;
    if (failedShots === 0) return false;
    const dg = defender.fighter.grappling;
    // chance each stuffed shot turns into a real counter-sub attempt
    const attemptProb = clamp(
      0.08 + 0.025 * (dg.scrambleAbility - 5) + 0.06 * dg.subAttemptsPer15,
      0.02,
      0.45
    );
    for (let i = 0; i < failedShots; i++) {
      if (
        rand() < attemptProb &&
        rand() < defender.subFinishProb * C.COUNTER_SUB_MULT * vulnerability(shooter)
      )
        return true;
    }
    return false;
  };

  if (subCheck(A, B, gA)) return { winner: 'A', method: 'Submission' };
  if (subCheck(B, A, gB)) return { winner: 'B', method: 'Submission' };
  if (counterSubCheck(A, B, gB)) return { winner: 'A', method: 'Submission' };
  if (counterSubCheck(B, A, gA)) return { winner: 'B', method: 'Submission' };

  // --- Score the round (strikes, knockdowns, takedowns, control) ---
  const scoreA =
    sA.landed + sA.knockdowns * 14 + gA.landed * 4 + gA.controlMin * 3 +
    gaussianSample(rand, 0, C.JUDGE_NOISE_SD);
  const scoreB =
    sB.landed + sB.knockdowns * 14 + gB.landed * 4 + gB.controlMin * 3 +
    gaussianSample(rand, 0, C.JUDGE_NOISE_SD);
  if (Math.abs(scoreA - scoreB) > C.DRAW_ROUND_MARGIN) {
    if (scoreA > scoreB) A.roundsWon += 1;
    else B.roundsWon += 1;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Monte Carlo driver
// ---------------------------------------------------------------------------

export function simulateFight(fight, { numSims = 10000, seed = 42 } = {}) {
  const rand = mulberry32(seed);
  const tally = {
    A: { 'KO/TKO': 0, Submission: 0, Decision: 0 },
    B: { 'KO/TKO': 0, Submission: 0, Decision: 0 },
    draw: 0,
    finishRounds: Array(fight.rounds).fill(0), // finishes by round (1-indexed offset)
    distance: 0,
    totalRoundsCompleted: 0,
  };

  for (let i = 0; i < numSims; i++) {
    const r = simulateOneFight(fight, rand);
    if (r.winner === 'draw') tally.draw += 1;
    else tally[r.winner][r.method] += 1;
    if (r.method === 'Decision' || r.method === 'Draw') {
      tally.distance += 1;
      tally.totalRoundsCompleted += fight.rounds;
    } else {
      tally.finishRounds[r.round - 1] += 1;
      // approximate finishes at the midpoint of the round for O/U lines
      tally.totalRoundsCompleted += r.round - 0.5;
    }
  }

  const p = (n) => n / numSims;
  const probs = {
    aWin: p(tally.A['KO/TKO'] + tally.A.Submission + tally.A.Decision),
    bWin: p(tally.B['KO/TKO'] + tally.B.Submission + tally.B.Decision),
    draw: p(tally.draw),
    aKO: p(tally.A['KO/TKO']),
    aSub: p(tally.A.Submission),
    aDec: p(tally.A.Decision),
    bKO: p(tally.B['KO/TKO']),
    bSub: p(tally.B.Submission),
    bDec: p(tally.B.Decision),
    goesDistance: p(tally.distance),
    finishByRound: tally.finishRounds.map(p),
    expectedRounds: tally.totalRoundsCompleted / numSims,
  };

  // Over/under vs. the fight's posted round line (e.g. 2.5 or 4.5)
  const line = fight.odds.totalRounds.line;
  let underProb = 0;
  probs.finishByRound.forEach((prob, idx) => {
    // finish in round idx+1 counts under if the line sits above that midpoint
    if (idx + 0.5 < line) underProb += prob;
  });
  probs.underRounds = underProb;
  probs.overRounds = 1 - underProb;

  return { numSims, probs };
}

// ---------------------------------------------------------------------------
// Confidence scoring + dampeners
// ---------------------------------------------------------------------------

export function confidenceScore(fight, probs) {
  const penalties = [];
  let score = 8.5;
  const dampen = (amount, reason) => {
    score -= amount;
    penalties.push(reason);
  };

  [fight.fighterA, fight.fighterB].forEach((f) => {
    const { factors: fa, striking: s, grappling: g } = f;
    if (fa.varianceRating >= 7) dampen(0.8, `${f.name}: high-variance style`);
    if (fa.cardio <= 4) dampen(0.7, `${f.name}: poor cardio`);
    if (fa.finishRate >= 0.85 && fa.cardio <= 6)
      dampen(0.6, `${f.name}: finish-or-fade profile`);
    if (fa.ufcFights < 4) dampen(0.9, `${f.name}: low UFC sample (${fa.ufcFights} fights)`);
    if (fa.recentKOLoss) dampen(0.7, `${f.name}: recent KO loss`);
    if (fa.age >= 38) dampen(0.6, `${f.name}: age-cliff risk (${fa.age})`);
    if (fa.activityLevel < 1) dampen(0.6, `${f.name}: long layoff / ring rust`);
    if (fa.inconsistentPace) dampen(0.5, `${f.name}: inconsistent pacing`);
    if (fa.shortNotice) dampen(1.0, `${f.name}: short-notice replacement`);
    if (fa.weightCutConcerns) dampen(0.4, `${f.name}: weight cut concerns`);
    if (s.sigStrikesPerMin + g.takedownsPer15 / 2 < BET_RULES.LOW_VOLUME_SLPM)
      dampen(0.6, `${f.name}: low output volume`);
  });

  // Coin flips are inherently low-conviction regardless of style profiles
  const [lo, hi] = BET_RULES.COIN_FLIP_BAND;
  const aShare = probs.aWin / Math.max(probs.aWin + probs.bWin, 1e-9);
  if (aShare > lo && aShare < hi) dampen(1.2, 'model sees a coin flip');

  return { score: clamp(+score.toFixed(1), 1, 10), penalties };
}

// ---------------------------------------------------------------------------
// Results grading
// ---------------------------------------------------------------------------

// Grade a market row against a fight's actual result. Returns 'win' | 'loss'
// | 'push', or null when the fight has no result or the label is unknown.
// Fights with a `result` carry: { winner: 'A'|'B'|'draw', method, round,
// timeMin? } — timeMin is minutes elapsed in the finish round; without it,
// round-total grading assumes the midpoint of the round.
export function gradeBet(bet, fight) {
  const res = fight.result;
  if (!res) return null;
  const winnerName =
    res.winner === 'A' ? fight.fighterA.name : res.winner === 'B' ? fight.fighterB.name : null;
  const wentDistance = res.method === 'Decision' || res.method === 'Draw';
  const elapsedRounds = wentDistance
    ? fight.rounds
    : res.round - 1 + (res.timeMin != null ? res.timeMin / 5 : 0.5);

  if (bet.label.endsWith(' ML')) {
    if (res.winner === 'draw') return 'push';
    return bet.label.slice(0, -3) === winnerName ? 'win' : 'loss';
  }
  if (bet.label.startsWith('Fight goes distance')) {
    return bet.label.includes('Yes') === wentDistance ? 'win' : 'loss';
  }
  const ou = bet.label.match(/^(Over|Under) ([\d.]+) rounds$/);
  if (ou) {
    if (elapsedRounds === parseFloat(ou[2])) return 'push';
    return (ou[1] === 'Over') === (elapsedRounds > parseFloat(ou[2])) ? 'win' : 'loss';
  }
  const method = bet.label.match(/^(.+) by (KO\/TKO|Submission|Decision)$/);
  if (method) {
    return method[1] === winnerName && method[2] === res.method ? 'win' : 'loss';
  }
  return null;
}

// Profit in flat 1-unit stakes for a graded bet.
export function betUnits(bet, outcome) {
  if (outcome === 'win') return bet.bookOdds > 0 ? bet.bookOdds / 100 : 100 / -bet.bookOdds;
  if (outcome === 'loss') return -1;
  return 0;
}

// ---------------------------------------------------------------------------
// Edge detection + bet selection
// ---------------------------------------------------------------------------

function edgeRow(label, modelProb, bookOdds) {
  const implied = americanToProb(bookOdds);
  return {
    label,
    modelProb,
    bookOdds,
    implied,
    edge: modelProb - implied,
    fairOdds: probToAmerican(modelProb),
  };
}

export function analyzeFight(fight, { numSims = 10000, seed = 42 } = {}) {
  const sim = simulateFight(fight, { numSims, seed });
  const { probs } = sim;
  const projections = poissonProjections(fight);
  const confidence = confidenceScore(fight, probs);
  const { odds } = fight;

  // Vig-free moneyline market probabilities for trap/coin-flip detection
  const [mktA, mktB] = removeVig([
    americanToProb(odds.moneylineA),
    americanToProb(odds.moneylineB),
  ]);

  const markets = [
    edgeRow(`${fight.fighterA.name} ML`, probs.aWin, odds.moneylineA),
    edgeRow(`${fight.fighterB.name} ML`, probs.bWin, odds.moneylineB),
    edgeRow('Fight goes distance — Yes', probs.goesDistance, odds.goesDistance.yes),
    edgeRow('Fight goes distance — No', 1 - probs.goesDistance, odds.goesDistance.no),
    edgeRow(`Over ${odds.totalRounds.line} rounds`, probs.overRounds, odds.totalRounds.over),
    edgeRow(`Under ${odds.totalRounds.line} rounds`, probs.underRounds, odds.totalRounds.under),
    edgeRow(`${fight.fighterA.name} by KO/TKO`, probs.aKO, odds.props.koA),
    edgeRow(`${fight.fighterB.name} by KO/TKO`, probs.bKO, odds.props.koB),
    edgeRow(`${fight.fighterA.name} by Submission`, probs.aSub, odds.props.subA),
    edgeRow(`${fight.fighterB.name} by Submission`, probs.bSub, odds.props.subB),
    edgeRow(`${fight.fighterA.name} by Decision`, probs.aDec, odds.props.decA),
    edgeRow(`${fight.fighterB.name} by Decision`, probs.bDec, odds.props.decB),
  ];

  // --- Filters: avoid coin flips, public traps, huge no-value favorites ---
  const avoidReasons = [];
  const aShare = probs.aWin / Math.max(probs.aWin + probs.bWin, 1e-9);
  const [lo, hi] = BET_RULES.COIN_FLIP_BAND;
  if (aShare > lo && aShare < hi) avoidReasons.push('Coin-flip fight — pass on the moneyline');
  if (fight.publicTrap) avoidReasons.push('Heavy public money on the favorite — trap risk');
  const bigFavSide = mktA >= BET_RULES.HUGE_FAVORITE_IMPLIED ? 'A' : mktB >= BET_RULES.HUGE_FAVORITE_IMPLIED ? 'B' : null;
  if (bigFavSide) {
    const favEdge = bigFavSide === 'A' ? markets[0].edge : markets[1].edge;
    if (favEdge < BET_RULES.MIN_FAVORITE_EDGE)
      avoidReasons.push('Huge favorite with no value at the posted price');
  }

  // --- Qualify bets: favorites need >=5% edge, dogs >=7%, confidence >=6.5 ---
  const qualifies = (row) => {
    if (confidence.score < BET_RULES.MIN_CONFIDENCE) return false;
    const isUnderdogPrice = row.bookOdds > 0;
    const minEdge = isUnderdogPrice ? BET_RULES.MIN_UNDERDOG_EDGE : BET_RULES.MIN_FAVORITE_EDGE;
    return row.edge >= minEdge;
  };
  const valueBets = avoidReasons.some((r) => r.startsWith('Coin-flip'))
    ? markets.filter((row) => qualifies(row) && !row.label.includes(' ML')).sort((x, y) => y.edge - x.edge)
    : markets.filter(qualifies).sort((x, y) => y.edge - x.edge);

  // --- Headline summary fields ---
  const winner = probs.aWin >= probs.bWin ? fight.fighterA : fight.fighterB;
  const winnerProb = Math.max(probs.aWin, probs.bWin);
  const winnerRow = probs.aWin >= probs.bWin ? markets[0] : markets[1];
  const methodProbs = [
    { label: `${fight.fighterA.name} by KO/TKO`, p: probs.aKO },
    { label: `${fight.fighterA.name} by Submission`, p: probs.aSub },
    { label: `${fight.fighterA.name} by Decision`, p: probs.aDec },
    { label: `${fight.fighterB.name} by KO/TKO`, p: probs.bKO },
    { label: `${fight.fighterB.name} by Submission`, p: probs.bSub },
    { label: `${fight.fighterB.name} by Decision`, p: probs.bDec },
  ].sort((x, y) => y.p - x.p);

  const riskLevel =
    confidence.score >= 7.5 ? 'Low' : confidence.score >= 6.5 ? 'Medium' : 'High';

  // Best side of each prop family (by edge) for the BEST PROPS block
  const bestOf = (...rows) => rows.slice().sort((x, y) => y.edge - x.edge)[0];
  const bestProps = {
    ko: bestOf(markets[6], markets[7]),
    sub: bestOf(markets[8], markets[9]),
    dec: bestOf(markets[10], markets[11]),
    rounds: bestOf(markets[4], markets[5]),
  };

  // Round-betting props: most likely finish rounds with book comparison
  const roundProps = probs.finishByRound
    .map((p, i) => ({
      label: `Finish in Round ${i + 1}`,
      modelProb: p,
      fairOdds: probToAmerican(p),
    }))
    .sort((x, y) => y.modelProb - x.modelProb);

  // Grade recommendations against the actual result when one is recorded
  let grading = null;
  if (fight.result) {
    const gradedBets = valueBets.map((bet) => {
      const outcome = gradeBet(bet, fight);
      return { ...bet, outcome, units: betUnits(bet, outcome) };
    });
    const actualWinnerName =
      fight.result.winner === 'A'
        ? fight.fighterA.name
        : fight.result.winner === 'B'
        ? fight.fighterB.name
        : 'Draw';
    grading = {
      actual: fight.result,
      actualWinnerName,
      predictedWinnerCorrect: winner.name === actualWinnerName,
      bets: gradedBets,
      netUnits: gradedBets.reduce((sum, b) => sum + b.units, 0),
    };
  }

  return {
    fight,
    sim,
    projections,
    confidence,
    grading,
    markets,
    marketNoVig: { a: mktA, b: mktB },
    avoidReasons,
    valueBets,
    bestBet: valueBets[0] || null,
    bestProps,
    roundProps,
    summary: {
      predictedWinner: winner.name,
      winProbability: winnerProb,
      impliedOdds: probToAmerican(winnerProb),
      bettingEdge: winnerRow.edge,
      confidenceScore: confidence.score,
      riskLevel,
      mostLikelyMethod: methodProbs[0].label,
      finishProbability: 1 - probs.goesDistance,
      goesDistance: probs.goesDistance,
    },
  };
}

export function analyzeCard(fights, options = {}) {
  return fights.map((fight, i) =>
    analyzeFight(fight, { ...options, seed: (options.seed ?? 42) + i * 7919 })
  );
}
