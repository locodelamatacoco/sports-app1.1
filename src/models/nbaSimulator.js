// src/models/nbaSimulator.js
//
// NBA Monte Carlo betting model.
//
// Builds an expected score for each team from the possession identity
// (points = efficiency x possessions) rather than from raw PPG, then runs
// >= 10,000 correlated simulations of the final score to price the moneyline,
// spread, and total. Player props ride inside the same simulation loop so a
// prop inherits that game's pace shock and blowout state.
//
// Every market is scored twice: a raw edge against the posted price and an
// adjusted edge after a ledger of uncertainty penalties (the "confidence
// dampener"). Only the adjusted edge can qualify a bet, which is what keeps
// the model from betting its own noise on days when the inputs are thin.

import {
  clamp,
  mulberry32,
  gaussianSample,
  gammaSample,
  poissonSample,
  americanToProb,
  probToAmerican,
  formatAmerican,
  removeVig,
  marketHold,
} from './oddsMath';

export {
  americanToProb,
  probToAmerican,
  formatAmerican,
  removeVig,
  marketHold,
  mulberry32,
};

// ---------------------------------------------------------------------------
// Tunable model constants
// ---------------------------------------------------------------------------

export const MODEL_CONSTANTS = {
  // League baselines. Ratings are points per 100 possessions; pace is
  // possessions per 48 minutes.
  LEAGUE_AVG_RATING: 114.4,
  LEAGUE_AVG_PACE: 99.5,
  LEAGUE_PACE_SD: 2.2,

  // Home court, expressed as total points of margin, split evenly between
  // a bump for the home side and a haircut for the road side.
  //
  // MEASURED, not assumed: the mean home margin across 1,229 games of 2025-26
  // was 1.745, and a structural fit (margin = homeCourt + shrink * rating
  // margin) put the intercept at 1.74. The 2.6 this used to carry was folk
  // wisdom and made every projection too kind to the home side.
  HOME_COURT_POINTS: 1.74,

  // Prior-season ratings regress hard. Fitting actual margin on the
  // rating-driven margin over 1,229 out-of-sample games gives a slope of
  // 0.555 — barely more than half of a projected rating gap shows up on the
  // night. Totals are worse: slope 0.325, and prior-season ratings explain
  // only 2% of total variance (R^2 0.0204) against 7.7% for margin.
  //
  // Without these the model is systematically too extreme, which showed up as
  // ~9 points of overconfidence in every probability bucket. Home court is NOT
  // shrunk — it is a real, stable effect; only the rating difference regresses.
  RATING_SHRINK_MARGIN: 0.555,
  RATING_SHRINK_TOTAL: 0.325,

  // Shrinkage is a statement about how much the INPUT ratings can be trusted,
  // so it cannot be one number once the ratings improve. Blended ratings fit a
  // slope of 0.899 to 0.938 depending on the window, against 0.514 to 0.555
  // for prior-season ratings alone; the model interpolates between the two on
  // the blend weight the ratings actually carry. 0.899 is the conservative end
  // of that range on purpose — under-trusting the rating gap costs a little
  // edge, over-trusting it prices games the model cannot actually read.
  //
  // Keeping 0.555 while the ratings got better was measurably wrong: on a
  // held-out season it left 5.81 points of calibration error where scaling the
  // slope leaves 2.89. Re-measure with `npm run fit-blend`.
  RATING_SHRINK_MARGIN_BLENDED: 0.899,

  // The margin residual tightens as the ratings improve, so the simulation's
  // spread has to follow or every price comes out too wide. Measured on the
  // same held-out season: 15.8 on prior-season ratings, 14.2 fully blended.
  MARGIN_SD_BLENDED: 14.2,
  LEAGUE_MEAN_TOTAL: 231.2, // observed mean, 2025-26

  // Variance calibration. These two are the empirical anchors: NBA final
  // margins have a standard deviation near 13 and totals near 17.5. The
  // per-team score SD and the home/away score correlation are *derived* from
  // them rather than guessed, so the simulated spread and total markets stay
  // mutually consistent.
  // MEASURED from the same backtest, as the SD of the residual after
  // shrinkage. The old 13.0 / 17.5 pair was sourced from general NBA knowledge
  // about final-score spread, which is not the same quantity as the spread of
  // outcomes around THIS model's projection — the number the simulation
  // actually needs. Understating it by 20% made every price overconfident.
  MARGIN_SD: 15.8,
  TOTAL_SD: 19.7,

  // Possession count is a shock shared by both teams (one game, one pace),
  // which is also what drives per-simulation prop pace factors.
  POSSESSION_SD: 3.2,

  // Overtime
  OT_MINUTES: 5,
  OT_SCORE_SD: 4.2, // per-team scoring SD across a single overtime period
  REGULATION_MINUTES: 48,
  MAX_OT_PERIODS: 4,

  // Rest / schedule
  REST_POINTS_PER_DAY: 0.35,
  MAX_REST_POINTS: 1.0,
  BACK_TO_BACK_POINTS: -1.1,

  // A game this far apart is "decided"; starters lose minutes to garbage time.
  BLOWOUT_MARGIN: 18,
  BLOWOUT_MINUTES_FACTOR: 0.86,

  // Market anchoring. The closing line is the best single predictor of an NBA
  // game, so the projection is regressed partway toward it instead of being
  // trusted outright. Set to 0 to see the unanchored model.
  MARKET_ANCHOR_WEIGHT: 0.35,

  // Divergence guard. Past these gaps between the model and the market, the
  // likelier explanation is a bad input on our side than a mispriced game, so
  // the edge gets charged for it and a wide enough gap vetoes the game.
  MAX_TRUSTED_MARGIN_DIVERGENCE: 4.0,
  MAX_TRUSTED_TOTAL_DIVERGENCE: 6.0,

  // The same logic has to apply to props, and did not. A posted prop line sits
  // close to the market's projection, so when OUR projection is far from the
  // line the likely explanation is a bad line — stale, from another game, or a
  // preview writer's suggestion rather than a book's number — not a mispriced
  // market. Expressed as a fraction of the line because a 5-point gap means
  // something different on a 25-point line than on a 5-assist one.
  MAX_TRUSTED_PROP_DIVERGENCE_PCT: 0.15,
  DIVERGENCE_PENALTY_PER_POINT: 0.015,
  DIVERGENCE_VETO_MULTIPLE: 2.0,
};

// Per-stat distribution shape. `cv` is the coefficient of variation for
// continuous (points-like) stats; `phi` is the quasi-Poisson variance
// inflation for counting stats (variance = phi * mean).
export const STAT_SHAPES = {
  points: { kind: 'continuous', cv: 0.29 },
  rebounds: { kind: 'count', phi: 1.18 },
  assists: { kind: 'count', phi: 1.22 },
  threes: { kind: 'count', phi: 1.05 },
  blocks: { kind: 'count', phi: 1.15 },
  steals: { kind: 'count', phi: 1.1 },
  pra: { kind: 'continuous', cv: 0.24 },
};

// Edge thresholds and the uncertainty penalty schedule, in probability points.
export const BET_RULES = {
  MIN_ADJUSTED_EDGE: 0.05, // the user-facing gate: adjusted edge >= 5%
  MIN_CONFIDENCE: 6.0, // 0-10 scale; below this nothing qualifies
  MAX_TOTAL_PENALTY: 0.22, // keep the ledger from running away
  COIN_FLIP_BAND: [0.47, 0.53],

  // Long moneyline dogs are never recommended.
  //
  // Across six logged slates they went 0-7 for -7.00u, and the structural
  // reason matches: at +400 the break-even is 20%, so a 3-point error in a
  // small probability is a 15% relative error that flips the sign of the edge.
  // The model's absolute probability error is nowhere near small enough to
  // price them, and it is most confident about upsets exactly where it is
  // least reliable. Favourites and short dogs went 11-11 and +4.29u.
  //
  // This one rule accounts for the whole moneyline leak and most of the
  // published-row damage: of the 15 rows published as best bets, the five it
  // removes were all losses.
  MAX_MONEYLINE_PRICE: 300,

  // There is deliberately NO ceiling on raw edge, though the first cut of this
  // work added one. Rows above a 10% raw edge do grade badly (4-6, -13.3% ROI)
  // and the top of an edge ranking really is adversely selected — but once the
  // long dogs above are removed, the remaining big-edge rows went 4-3 and
  // +1.67u. The effect was the longshots, which carry large edges by
  // construction, not edge size itself. A ceiling would have cut a profitable
  // subset, so the counterfactual that was built to justify the rule is what
  // rejected it.
};

export const PENALTIES = {
  NO_CURRENT_SEASON_DATA: 0.04, // priors only, no current-season form
  // Games have been played that the model does not ingest but the market does.
  BEHIND_MARKET: 0.02,
  SMALL_SAMPLE_TEAM: 0.03,
  SMALL_SAMPLE_PLAYER: 0.05,
  HEAVY_ROSTER_TURNOVER: 0.04,
  MODERATE_ROSTER_TURNOVER: 0.02,
  UNASSESSED_ROSTER: 0.03, // we have not looked, which is its own uncertainty
  ESTIMATED_INPUT: 0.02, // a model input we inferred rather than sourced
  MARKET_DISAGREEMENT: 0.02, // books disagree on the number
  LINE_MOVED_AGAINST: 0.02, // sharp move away from our side
  STREAKY_PLAYER: 0.03,
  BLOWOUT_RISK: 0.03,
  INJURY_NEWS_UNCERTAINTY: 0.05,
  LINEUP_UNCONFIRMED: 0.03,
  MINUTES_VOLATILITY: 0.05,
  ROLE_CHANGE: 0.05, // new team / new usage share
  BACK_TO_BACK: 0.02,
  COIN_FLIP: 0.03,
  // Injury uncertainty is sized by who is missing, not charged as a flat rate.
  INJURY_STARTER_OUT: 0.05,
  INJURY_STARTER_QUESTIONABLE: 0.04,
  INJURY_RESERVE_OUT: 0.01, // per player, capped below
  INJURY_RESERVE_QUESTIONABLE: 0.005,
  INJURY_RESERVE_CAP: 0.02,
  MARGIN_DIVERGENCE: 0.0, // sized per point of gap, see MODEL_CONSTANTS
  TOTAL_DIVERGENCE: 0.0,
};

// ---------------------------------------------------------------------------
// Expected score model
// ---------------------------------------------------------------------------

// Blend a team's prior-season rating with its current-season form. On opening
// night `recentForm` is null and the prior carries the whole projection.
function blendedRatings(team) {
  const base = {
    off: team.ratings.off + (team.rosterAdj?.off ?? 0),
    def: team.ratings.def + (team.rosterAdj?.def ?? 0),
    pace: team.ratings.pace + (team.rosterAdj?.pace ?? 0),
  };
  const form = team.recentForm;
  if (!form || !form.games) return { ...base, formWeight: 0 };

  // Recent form earns weight as the sample grows, capped at 60% by ~15 games.
  const formWeight = clamp(form.games / 25, 0, 0.6);
  const mix = (a, b) => a * (1 - formWeight) + b * formWeight;
  return {
    off: mix(base.off, form.off),
    def: mix(base.def, form.def),
    pace: mix(base.pace, form.pace ?? base.pace),
    formWeight,
  };
}

// Points per 100 possessions a team should manage against this specific
// opponent: its own offense scaled by how the defense it faces compares to
// league average.
function adjustedEfficiency(offRating, oppDefRating, leagueAvgRating) {
  return offRating * (oppDefRating / leagueAvgRating);
}

// Schedule points: extra rest helps a little, a back-to-back hurts.
function scheduleAdjustment(side) {
  const C = MODEL_CONSTANTS;
  let pts = 0;
  if (side?.backToBack) pts += C.BACK_TO_BACK_POINTS;
  const restEdge = (side?.restDays ?? 1) - 1;
  if (restEdge > 0) pts += Math.min(restEdge * C.REST_POINTS_PER_DAY, C.MAX_REST_POINTS);
  return pts;
}

// The pre-simulation projection: expected possessions, each side's adjusted
// efficiency, and the resulting expected score.
//
// The raw model projection is then regressed partway toward the posted line.
// The market is a strong prior, and a model that ignores it mostly discovers
// its own input errors and calls them edges. Both versions are returned so
// the disagreement stays visible rather than being quietly absorbed.
export function projectGame(game, { anchorWeight } = {}) {
  const C = MODEL_CONSTANTS;
  const home = blendedRatings(game.home);
  const away = blendedRatings(game.away);

  // One game, one pace: average the two teams' possession rates.
  const expectedPossessions = (home.pace + away.pace) / 2;
  const paceFactor = expectedPossessions / C.LEAGUE_AVG_PACE;

  // When ratings are derived from a feed, that feed's own league average comes
  // with them, so the adjustment stays self-consistent instead of mixing
  // scales.
  const leagueAvgRating = game.leagueContext?.rating ?? C.LEAGUE_AVG_RATING;
  const homeEff = adjustedEfficiency(home.off, away.def, leagueAvgRating);
  const awayEff = adjustedEfficiency(away.off, home.def, leagueAvgRating);

  // How much of the two teams' ratings comes from this season. Both sides are
  // averaged because one well-sampled team does not make the matchup known.
  const blendWeight =
    ((game.home.blendWeight ?? 0) + (game.away.blendWeight ?? 0)) / 2;
  const shrinkMargin =
    C.RATING_SHRINK_MARGIN +
    (C.RATING_SHRINK_MARGIN_BLENDED - C.RATING_SHRINK_MARGIN) * blendWeight;
  const marginSd =
    C.MARGIN_SD + (C.MARGIN_SD_BLENDED - C.MARGIN_SD) * blendWeight;

  const homeSchedule = scheduleAdjustment(game.context?.home) + C.HOME_COURT_POINTS / 2;
  const awaySchedule = scheduleAdjustment(game.context?.away) - C.HOME_COURT_POINTS / 2;

  const regHome = (homeEff / 100) * expectedPossessions + homeSchedule;
  const regAway = (awayEff / 100) * expectedPossessions + awaySchedule;
  // Regress the rating-driven part of the margin toward zero, leaving home
  // court untouched. See RATING_SHRINK_MARGIN.
  const unshrunkMargin = regHome - regAway;
  const homeCourtMargin = homeSchedule - awaySchedule;
  const rawMargin =
    homeCourtMargin + shrinkMargin * (unshrunkMargin - homeCourtMargin);

  // A posted total settles including overtime, so the projection has to carry
  // the expected overtime contribution or every Over reads ~0.7 points cheap.
  // P(regulation ends level) is the normal density at a zero margin, and the
  // geometric term covers a second overtime following the first.
  const otPossessions = (expectedPossessions * C.OT_MINUTES) / C.REGULATION_MINUTES;
  const otTotalPoints = ((homeEff + awayEff) / 100) * otPossessions;
  const pTie =
    Math.exp(-(rawMargin * rawMargin) / (2 * marginSd * marginSd)) /
    (marginSd * Math.sqrt(2 * Math.PI));
  const pTieInOt = 1 / (C.OT_SCORE_SD * Math.SQRT2 * Math.sqrt(2 * Math.PI));
  const expectedOvertimePoints = (pTie * otTotalPoints) / (1 - pTieInOt);

  // Totals regress toward the league mean rather than toward zero.
  const unshrunkTotal = regHome + regAway + expectedOvertimePoints;
  const rawTotal =
    C.LEAGUE_MEAN_TOTAL + C.RATING_SHRINK_TOTAL * (unshrunkTotal - C.LEAGUE_MEAN_TOTAL);

  // What the book's numbers say. A home line of -4.5 means the market
  // projects the home side to win by 4.5.
  const marketMargin = game.odds?.spread ? -game.odds.spread.homeLine : null;
  const marketTotal = game.odds?.total ? game.odds.total.line : null;

  // Possessions the market's total implies at our efficiency estimates. When
  // this is far from our pace estimate, pace is the input to distrust.
  const combinedEff = (homeEff + awayEff) / 100;
  const marketImpliedPossessions =
    marketTotal != null && combinedEff > 0 ? marketTotal / combinedEff : null;

  const marginDivergence = marketMargin == null ? null : rawMargin - marketMargin;
  const totalDivergence = marketTotal == null ? null : rawTotal - marketTotal;

  // Regress toward the market in (margin, total) space, then convert back.
  const w = anchorWeight ?? C.MARKET_ANCHOR_WEIGHT;
  const anchoredMargin = marketMargin == null ? rawMargin : rawMargin * (1 - w) + marketMargin * w;
  const anchoredTotal = marketTotal == null ? rawTotal : rawTotal * (1 - w) + marketTotal * w;
  const homeScore = (anchoredTotal + anchoredMargin) / 2;
  const awayScore = (anchoredTotal - anchoredMargin) / 2;

  // What the simulation should average before overtime is played out.
  const regulationTotal = anchoredTotal - expectedOvertimePoints;
  const regulation = {
    homeScore: (regulationTotal + anchoredMargin) / 2,
    awayScore: (regulationTotal - anchoredMargin) / 2,
    total: regulationTotal,
  };

  return {
    expectedPossessions,
    paceFactor,
    leagueAvgRating,
    anchorWeight: w,
    market: {
      margin: marketMargin,
      total: marketTotal,
      impliedPossessions: marketImpliedPossessions,
    },
    divergence: {
      margin: marginDivergence,
      total: totalDivergence,
      marginExcess:
        marginDivergence == null
          ? 0
          : Math.max(Math.abs(marginDivergence) - C.MAX_TRUSTED_MARGIN_DIVERGENCE, 0),
      totalExcess:
        totalDivergence == null
          ? 0
          : Math.max(Math.abs(totalDivergence) - C.MAX_TRUSTED_TOTAL_DIVERGENCE, 0),
    },
    regulation,
    expectedOvertimePoints,
    // The shrinkage and spread this projection was actually built with. The
    // simulation has to draw from the same SD the projection assumed, or the
    // prices disagree with the point estimate they came from.
    blendWeight,
    shrinkMargin,
    marginSd,
    currentSeasonGames: {
      home: game.home.currentSeasonGames ?? 0,
      away: game.away.currentSeasonGames ?? 0,
    },
    unshrunk: { margin: unshrunkMargin, total: unshrunkTotal },
    raw: { homeScore: regHome, awayScore: regAway, margin: rawMargin, total: rawTotal },
    home: {
      efficiency: homeEff,
      rawRatings: home,
      scheduleAdj: homeSchedule,
      expectedScore: homeScore,
      // PPG implied by this team's own rating and pace, for sanity-checking
      // the projection against observed scoring.
      impliedSeasonPPG: (home.off / 100) * home.pace,
    },
    away: {
      efficiency: awayEff,
      rawRatings: away,
      scheduleAdj: awaySchedule,
      expectedScore: awayScore,
      impliedSeasonPPG: (away.off / 100) * away.pace,
    },
    expectedTotal: homeScore + awayScore,
    expectedMargin: homeScore - awayScore, // positive = home favored
  };
}

// Split the calibrated score variance into the three components the
// simulation draws: a shared possession shock, a shared scoring-environment
// shock, and each team's own noise. Derived from MARGIN_SD / TOTAL_SD so the
// simulated spread and total can't disagree about how volatile a game is.
export function varianceComponents(projection) {
  const C = MODEL_CONSTANTS;
  // Blended ratings earn a tighter margin residual, so the spread the
  // simulation draws from is the projection's own, not the prior-season
  // constant. Falling back to the constant keeps a hand-built projection
  // (and every existing test) behaving exactly as before.
  const marginSd = projection.marginSd ?? C.MARGIN_SD;
  const teamVar = (C.TOTAL_SD ** 2 + marginSd ** 2) / 4;
  const covTarget = (C.TOTAL_SD ** 2 - marginSd ** 2) / 4;

  // Points each team gains per extra possession.
  const effHome = projection.home.efficiency / 100;
  const effAway = projection.away.efficiency / 100;
  const possVar = C.POSSESSION_SD ** 2;

  // The shared possession shock already supplies some covariance; a shared
  // scoring-environment shock tops it up to the calibration target.
  const covFromPace = effHome * effAway * possVar;
  const sharedVar = Math.max(covTarget - covFromPace, 0);

  const idioVar = (eff) => Math.max(teamVar - eff * eff * possVar - sharedVar, 1);

  return {
    teamSd: Math.sqrt(teamVar),
    correlation: covTarget / teamVar,
    possessionSd: C.POSSESSION_SD,
    sharedSd: Math.sqrt(sharedVar),
    homeIdioSd: Math.sqrt(idioVar(effHome)),
    awayIdioSd: Math.sqrt(idioVar(effAway)),
  };
}

// ---------------------------------------------------------------------------
// Player prop projection
// ---------------------------------------------------------------------------

// Expected stat line before per-simulation noise:
//   per-minute rate x projected minutes x usage x matchup x pace
export function projectProp(prop, game, projection) {
  const b = prop.baseline;
  if (!b || !b.perGame || !b.minutes) {
    return { insufficientData: true, expected: null };
  }
  const perMinute = b.perGame / b.minutes;
  const usageFactor = prop.usageFactor ?? 1;
  const matchupFactor = prop.matchupFactor ?? 1;
  const formFactor = prop.formFactor ?? 1;
  const minutes = prop.projectedMinutes ?? b.minutes;

  // A prop only cares about the pace of the game it is in, relative to the
  // pace baked into the player's own per-minute rate.
  const paceFactor = projection.expectedPossessions / (b.pace ?? MODEL_CONSTANTS.LEAGUE_AVG_PACE);

  const expected = perMinute * minutes * usageFactor * matchupFactor * formFactor * paceFactor;
  return {
    insufficientData: false,
    perMinute,
    minutes,
    usageFactor,
    matchupFactor,
    formFactor,
    paceFactor,
    expected,
  };
}

// ---------------------------------------------------------------------------
// Whole-player games: double-doubles and scoring thresholds
// ---------------------------------------------------------------------------

// Stats that can plausibly reach 10 in a game. Steals and blocks are tracked
// but a 10-steal game is close enough to never that including them in the
// double-double test adds noise rather than accuracy.
export const DOUBLE_DOUBLE_STATS = ['points', 'rebounds', 'assists'];

// Scoring marks reported for every player, so "around 20-something" can be
// answered without a posted line to price against.
export const POINTS_THRESHOLDS = [10, 15, 20, 25, 30, 35, 40];

// A double-double is a JOINT event, so it cannot be assembled from separate
// per-stat probabilities: points and rebounds are correlated through the
// minutes a player actually gets, and multiplying independent marginals
// understates a big night and overstates a quiet one. This projects every stat
// for one player off a single rate table so the simulation can draw them
// together, inside one shared minutes draw.
export function projectPlayerGame(entry, game, projection) {
  const rate = entry.rate;
  if (!rate || !rate.usableSample || !rate.perMinute) {
    return { insufficientData: true, player: entry.player, means: null };
  }
  const minutes = entry.projectedMinutes ?? rate.minutesPerGame;
  if (!minutes || !Number.isFinite(minutes)) {
    return { insufficientData: true, player: entry.player, means: null };
  }

  const paceFactor =
    projection.expectedPossessions / (entry.pace ?? MODEL_CONSTANTS.LEAGUE_AVG_PACE);
  const usageFactor = entry.usageFactor ?? 1;
  const matchupFactor = entry.matchupFactor ?? 1;

  const perMinute = {};
  const means = {};
  for (const stat of Object.keys(rate.perMinute)) {
    const r = rate.perMinute[stat];
    if (r == null || !Number.isFinite(r)) continue;
    perMinute[stat] = r;
    means[stat] = r * minutes * usageFactor * matchupFactor * paceFactor;
  }

  return {
    insufficientData: false,
    player: entry.player,
    team: entry.team ?? rate.team ?? null,
    minutes,
    perMinute,
    means,
    usageFactor,
    matchupFactor,
    paceFactor,
    sampleNote: rate.sampleNote ?? null,
    games: rate.games ?? null,
  };
}

// Draw one realisation of a stat. Counting stats go through a Gamma-mixed
// Poisson (integer outcomes, so "3+ threes" style thresholds and pushes on
// whole-number lines price correctly); points-like stats use a Gamma.
function sampleStat(statKind, mean, rand) {
  const shape = STAT_SHAPES[statKind] ?? STAT_SHAPES.points;
  if (mean <= 0) return 0;
  if (shape.kind === 'continuous') {
    const k = 1 / (shape.cv * shape.cv);
    return gammaSample(rand, k, mean / k);
  }
  const phi = shape.phi ?? 1;
  if (phi <= 1) return poissonSample(mean, rand);
  // E[G] = 1, Var[G] = (phi - 1) / mean  =>  Var[X] = phi * mean
  const k = mean / (phi - 1);
  const g = gammaSample(rand, k, 1 / k);
  return poissonSample(mean * g, rand);
}

// ---------------------------------------------------------------------------
// Monte Carlo driver
// ---------------------------------------------------------------------------

export function simulateGame(game, { numSims = 10000, seed = 42, anchorWeight } = {}) {
  const C = MODEL_CONSTANTS;
  const rand = mulberry32(seed);
  const projection = projectGame(game, { anchorWeight });
  const v = varianceComponents(projection);

  const effHome = projection.home.efficiency / 100;
  const effAway = projection.away.efficiency / 100;

  // Scores stay possession-driven so props inherit a real pace shock, but each
  // side carries a constant offset that lands its mean on the market-anchored
  // projection rather than the unanchored one.
  const homeOffset =
    projection.regulation.homeScore -
    (effHome * projection.expectedPossessions + projection.home.scheduleAdj);
  const awayOffset =
    projection.regulation.awayScore -
    (effAway * projection.expectedPossessions + projection.away.scheduleAdj);

  // Whole-player entries, drawn jointly so a double-double is counted as the
  // one event it is.
  const players = (game.players ?? []).map((entry) => {
    const projected = projectPlayerGame(entry, game, projection);
    return {
      entry,
      projected,
      samples: 0,
      doubleDouble: 0,
      tripleDouble: 0,
      // Points thresholds worth reporting without needing a posted line.
      pointsAtLeast: new Map(),
      statTotals: {},
      statAtLeastTen: {},
      pointsDist: new Map(),
    };
  });

  const props = (game.props ?? []).map((prop) => ({
    prop,
    projected: projectProp(prop, game, projection),
    over: 0,
    push: 0,
    under: 0,
    hits: 0, // for threshold props: count of sims clearing the threshold
    total: 0,
    samples: 0,
    // Full outcome distribution, so any alternate line can be priced off this
    // run instead of needing its own simulation.
    dist: new Map(),
  }));

  const tally = {
    homeWin: 0,
    awayWin: 0,
    homeScore: 0,
    awayScore: 0,
    totalPoints: 0,
    margin: 0,
    marginAbs: 0,
    blowout: 0,
    overtime: 0,
    homeCover: 0,
    homePush: 0,
    awayCover: 0,
    over: 0,
    totalPush: 0,
    under: 0,
    possessions: 0,
  };

  const spreadLine = game.odds?.spread?.homeLine ?? null; // negative = home favored
  const totalLine = game.odds?.total?.line ?? null;

  // Full distributions of each quantity, so alternate lines and team totals can
  // be priced from this same run instead of needing their own simulation.
  const dist = { home: new Map(), away: new Map(), margin: new Map(), total: new Map() };
  const bump = (m, k) => m.set(k, (m.get(k) ?? 0) + 1);

  for (let i = 0; i < numSims; i++) {
    // Shared shocks: how many possessions this game runs, and whether the
    // ball is going in for everybody tonight.
    const possessions = Math.max(
      gaussianSample(rand, projection.expectedPossessions, v.possessionSd),
      70
    );
    const shared = gaussianSample(rand, 0, v.sharedSd);

    let home = Math.round(
      effHome * possessions +
        projection.home.scheduleAdj +
        homeOffset +
        shared +
        gaussianSample(rand, 0, v.homeIdioSd)
    );
    let away = Math.round(
      effAway * possessions +
        projection.away.scheduleAdj +
        awayOffset +
        shared +
        gaussianSample(rand, 0, v.awayIdioSd)
    );

    // Regulation can't end level: play overtime periods until it breaks.
    let otPeriods = 0;
    const otPossessions = (projection.expectedPossessions * C.OT_MINUTES) / C.REGULATION_MINUTES;
    while (home === away && otPeriods < C.MAX_OT_PERIODS) {
      otPeriods += 1;
      home += Math.round(gaussianSample(rand, effHome * otPossessions, C.OT_SCORE_SD));
      away += Math.round(gaussianSample(rand, effAway * otPossessions, C.OT_SCORE_SD));
    }
    if (home === away) {
      // Exhausted the OT cap: award it to the stronger side.
      if (effHome >= effAway) home += 1;
      else away += 1;
    }

    const margin = home - away;
    const total = home + away;

    if (margin > 0) tally.homeWin += 1;
    else tally.awayWin += 1;
    tally.homeScore += home;
    tally.awayScore += away;
    tally.totalPoints += total;
    tally.margin += margin;
    tally.marginAbs += Math.abs(margin);
    tally.possessions += possessions;
    if (otPeriods > 0) tally.overtime += 1;
    const isBlowout = Math.abs(margin) >= C.BLOWOUT_MARGIN;
    if (isBlowout) tally.blowout += 1;

    bump(dist.home, home);
    bump(dist.away, away);
    bump(dist.margin, margin);
    bump(dist.total, total);

    // Spread: a whole-number line can push, so count the three outcomes
    // separately instead of folding pushes into one side.
    if (spreadLine !== null) {
      const adjusted = margin + spreadLine; // > 0 means the home side covered
      if (adjusted > 0) tally.homeCover += 1;
      else if (adjusted === 0) tally.homePush += 1;
      else tally.awayCover += 1;
    }

    if (totalLine !== null) {
      if (total > totalLine) tally.over += 1;
      else if (total === totalLine) tally.totalPush += 1;
      else tally.under += 1;
    }

    // Props share this simulation's pace and blowout state.
    const simPaceFactor = possessions / projection.expectedPossessions;

    // One minutes draw per player, then every stat off it. This is what makes
    // the stats correlated: a 40-minute night lifts points AND rebounds
    // together, which is exactly the dependence a double-double lives on.
    for (const slot of players) {
      const pr = slot.projected;
      if (pr.insufficientData) continue;
      const e = slot.entry;

      let minutes = pr.minutes * (1 + gaussianSample(rand, 0, e.minutesVolatility ?? 0.08));
      if (isBlowout && !e.benchPlayer) minutes *= C.BLOWOUT_MINUTES_FACTOR;
      minutes = clamp(minutes, 0, 46);
      const scale = (minutes / pr.minutes) * simPaceFactor;

      let tens = 0;
      let points = 0;
      for (const stat of Object.keys(pr.means)) {
        const value = sampleStat(stat, pr.means[stat] * scale, rand);
        slot.statTotals[stat] = (slot.statTotals[stat] ?? 0) + value;
        if (value >= 10 && DOUBLE_DOUBLE_STATS.includes(stat)) {
          tens += 1;
          slot.statAtLeastTen[stat] = (slot.statAtLeastTen[stat] ?? 0) + 1;
        }
        if (stat === 'points') points = value;
      }

      slot.samples += 1;
      if (tens >= 2) slot.doubleDouble += 1;
      if (tens >= 3) slot.tripleDouble += 1;

      const whole = Math.round(points);
      slot.pointsDist.set(whole, (slot.pointsDist.get(whole) ?? 0) + 1);
      for (const t of POINTS_THRESHOLDS) {
        if (points >= t) slot.pointsAtLeast.set(t, (slot.pointsAtLeast.get(t) ?? 0) + 1);
      }
    }
    for (const entry of props) {
      const pr = entry.projected;
      if (pr.insufficientData) continue;
      const p = entry.prop;

      let minutes = pr.minutes * (1 + gaussianSample(rand, 0, p.minutesVolatility ?? 0.05));
      if (isBlowout && !p.benchPlayer) minutes *= C.BLOWOUT_MINUTES_FACTOR;
      minutes = clamp(minutes, 0, 46);

      const mean = pr.perMinute * minutes * pr.usageFactor * pr.matchupFactor *
        pr.formFactor * pr.paceFactor * simPaceFactor;
      const value = sampleStat(p.stat, mean, rand);

      entry.total += value;
      entry.samples += 1;
      // Continuous stats are rounded for the histogram; a points line is
      // always a whole or half number so nothing is lost.
      const bucket = Math.round(value);
      entry.dist.set(bucket, (entry.dist.get(bucket) ?? 0) + 1);
      if (p.threshold != null) {
        if (value >= p.threshold) entry.hits += 1;
      } else if (value > p.line) entry.over += 1;
      else if (value === p.line) entry.push += 1;
      else entry.under += 1;
    }
  }

  const p = (n) => n / numSims;
  const probs = {
    homeWin: p(tally.homeWin),
    awayWin: p(tally.awayWin),
    homeCover: p(tally.homeCover),
    homePush: p(tally.homePush),
    awayCover: p(tally.awayCover),
    over: p(tally.over),
    totalPush: p(tally.totalPush),
    under: p(tally.under),
    overtime: p(tally.overtime),
    blowout: p(tally.blowout),
  };

  const means = {
    homeScore: tally.homeScore / numSims,
    awayScore: tally.awayScore / numSims,
    total: tally.totalPoints / numSims,
    margin: tally.margin / numSims,
    absMargin: tally.marginAbs / numSims,
    possessions: tally.possessions / numSims,
  };

  const propResults = props.map((entry) => {
    if (entry.projected.insufficientData) {
      return { prop: entry.prop, projected: entry.projected, insufficientData: true };
    }
    const n = entry.samples;
    return {
      prop: entry.prop,
      projected: entry.projected,
      insufficientData: false,
      dist: entry.dist,
      samples: n,
      simulatedMean: entry.total / n,
      overProb: entry.prop.threshold != null ? entry.hits / n : entry.over / n,
      pushProb: entry.prop.threshold != null ? 0 : entry.push / n,
      underProb: entry.prop.threshold != null ? 1 - entry.hits / n : entry.under / n,
    };
  });

  const playerResults = players.map((slot) => {
    const pr = slot.projected;
    if (pr.insufficientData || slot.samples === 0) {
      return { ...pr, insufficientData: true, player: pr.player ?? slot.entry.player };
    }
    const n = slot.samples;
    return {
      player: pr.player,
      team: pr.team,
      minutes: pr.minutes,
      games: pr.games,
      sampleNote: pr.sampleNote,
      insufficientData: false,
      samples: n,
      means: pr.means,
      simulatedMeans: Object.fromEntries(
        Object.entries(slot.statTotals).map(([stat, total]) => [stat, total / n])
      ),
      doubleDouble: slot.doubleDouble / n,
      tripleDouble: slot.tripleDouble / n,
      atLeastTen: Object.fromEntries(
        DOUBLE_DOUBLE_STATS.map((stat) => [stat, (slot.statAtLeastTen[stat] ?? 0) / n])
      ),
      pointsAtLeast: Object.fromEntries(
        POINTS_THRESHOLDS.map((t) => [t, (slot.pointsAtLeast.get(t) ?? 0) / n])
      ),
      pointsDist: slot.pointsDist,
    };
  });

  return {
    numSims,
    seed,
    projection,
    variance: v,
    probs,
    means,
    propResults,
    playerResults,
    dist,
  };
}

// ---------------------------------------------------------------------------
// Pricing arbitrary lines off a recorded distribution
// ---------------------------------------------------------------------------

// P(X > line), P(X === line), P(X < line) for any line, from the simulated
// distribution. A whole-number line can push; a half-point line cannot.
export function priceLine(distribution, numSims, line) {
  let over = 0;
  let push = 0;
  let under = 0;
  distribution.forEach((count, value) => {
    if (value > line) over += count;
    else if (value === line) push += count;
    else under += count;
  });
  return { overProb: over / numSims, pushProb: push / numSims, underProb: under / numSims };
}

// Half-point steps either side of a centre, used to build a ladder.
function ladder(centre, steps) {
  const base = Math.round(centre * 2) / 2;
  return steps.map((d) => base + d);
}

// Every market the simulation can price beyond the three the feed posts:
// each team's total, and alternate spreads and totals.
//
// ESPN's public scoreboard carries no prices for these, so by default they come
// back as fair odds to shop rather than as edges. Supply prices via
// `game.odds.teamTotals` / `altSpreads` / `altTotals` and they are scored like
// any other market.
export function derivedMarkets(game, sim, { ledger = [], veto = null } = {}) {
  const { dist, numSims, means } = sim;
  const rows = [];

  const add = ({ label, market, side, distribution, line, price, invert = false }) => {
    const p = priceLine(distribution, numSims, line);
    const modelProb = invert ? p.underProb : p.overProb;
    if (price == null) {
      const settleProb =
        p.pushProb > 0 && p.pushProb < 1 ? modelProb / (1 - p.pushProb) : modelProb;
      rows.push({
        label,
        market,
        side,
        gameId: game.id,
        line,
        modelProb,
        settleProb,
        pushProb: p.pushProb,
        price: null,
        fairOdds: probToAmerican(settleProb),
        priced: false,
        qualifies: false,
        recommendation: 'SHOP — model price only, no posted line in the feed',
      });
      return;
    }
    rows.push({
      ...marketRow({
        label,
        market,
        side,
        gameId: game.id,
        modelProb,
        pushProb: p.pushProb,
        price,
        penalties: ledger,
        veto,
      }),
      line,
      priced: true,
    });
  };

  const posted = game.odds ?? {};
  const teamTotals = posted.teamTotals ?? {};
  const mainSpread = posted.spread?.homeLine ?? -Math.round(means.margin * 2) / 2;
  const mainTotal = posted.total?.line ?? Math.round(means.total * 2) / 2;

  // --- Team totals, centred on each side's projected score ---
  [
    { key: 'home', team: game.home, distribution: dist.home, mean: means.homeScore },
    { key: 'away', team: game.away, distribution: dist.away, mean: means.awayScore },
  ].forEach(({ key, team, distribution, mean }) => {
    ladder(mean, [-3, 0, 3]).forEach((line) => {
      const supplied = teamTotals[key]?.[String(line)];
      add({
        label: `${team.code} team total Over ${line}`,
        market: 'teamTotal',
        side: `${key}-over`,
        distribution,
        line,
        price: supplied?.over ?? null,
      });
      add({
        label: `${team.code} team total Under ${line}`,
        market: 'teamTotal',
        side: `${key}-under`,
        distribution,
        line,
        price: supplied?.under ?? null,
        invert: true,
      });
    });
  });

  // --- Alternate spreads, stepping away from the posted number ---
  ladder(mainSpread, [-5, -2.5, 2.5, 5].filter((d) => d !== 0)).forEach((line) => {
    const supplied = posted.altSpreads?.[String(line)];
    const fmt = (n) => (n > 0 ? `+${n}` : `${n}`);
    // A home line of -4.5 covers when margin - 4.5 > 0, i.e. margin > 4.5.
    add({
      label: `${game.home.code} ${fmt(line)} (alt)`,
      market: 'altSpread',
      side: 'home',
      distribution: dist.margin,
      line: -line,
      price: supplied?.home ?? null,
    });
    add({
      label: `${game.away.code} ${fmt(-line)} (alt)`,
      market: 'altSpread',
      side: 'away',
      distribution: dist.margin,
      line: -line,
      price: supplied?.away ?? null,
      invert: true,
    });
  });

  // --- Alternate totals ---
  ladder(mainTotal, [-6, -3, 3, 6]).forEach((line) => {
    const supplied = posted.altTotals?.[String(line)];
    add({
      label: `Over ${line} (alt)`,
      market: 'altTotal',
      side: 'over',
      distribution: dist.total,
      line,
      price: supplied?.over ?? null,
    });
    add({
      label: `Under ${line} (alt)`,
      market: 'altTotal',
      side: 'under',
      distribution: dist.total,
      line,
      price: supplied?.under ?? null,
      invert: true,
    });
  });

  return rows;
}

// For a prop whose line you can move, the useful question is not "is the over
// good" but "at which line, and at what price". This prices a ladder off the
// recorded distribution and, for each rung, states the price the market would
// have to offer for the bet to clear the gate once penalties are applied.
//
// `penaltyTotal` is the charge that applies to this prop, which is what makes
// the required price honest rather than theoretical.
export function propLadder(propResult, lines, { penaltyTotal = 0 } = {}) {
  if (!propResult || propResult.insufficientData || !propResult.dist) return [];

  return lines.map((line) => {
    const p = priceLine(propResult.dist, propResult.samples, line);
    const settleProb =
      p.pushProb > 0 && p.pushProb < 1 ? p.overProb / (1 - p.pushProb) : p.overProb;

    // adjustedEdge = modelProb - impliedProb - penalties >= MIN, so the
    // market has to price the outcome at or below this probability.
    const maxImplied = settleProb - penaltyTotal - BET_RULES.MIN_ADJUSTED_EDGE;

    return {
      line,
      overProb: settleProb,
      underProb: 1 - settleProb,
      pushProb: p.pushProb,
      fairOver: probToAmerican(settleProb),
      fairUnder: probToAmerican(1 - settleProb),
      // null when no price could ever clear the gate at this line.
      requiredOverPrice: maxImplied > 0.001 ? probToAmerican(maxImplied) : null,
      qualifiesAtFair: false, // fair odds are break-even by definition
    };
  });
}

// ---------------------------------------------------------------------------
// Reading the simulated distribution
// ---------------------------------------------------------------------------

// The value at a given percentile of a recorded distribution. The simulation
// has always run tens of thousands of iterations; reporting only the mean threw
// away everything the spread had to say about how wide an outcome range is.
export function percentile(distribution, numSims, p) {
  const target = p * numSims;
  const values = [...distribution.keys()].sort((a, b) => a - b);
  let cumulative = 0;
  for (const value of values) {
    cumulative += distribution.get(value);
    if (cumulative >= target) return value;
  }
  return values[values.length - 1] ?? null;
}

// Probability the quantity lands in [lo, hi].
export function probBetween(distribution, numSims, lo, hi) {
  let count = 0;
  distribution.forEach((n, value) => {
    if (value >= lo && value <= hi) count += n;
  });
  return count / numSims;
}

// Everything the Monte Carlo run knows beyond the mean: where the middle of
// the distribution sits, how wide the tails are, and how often the game turns
// into the kind of blowout that changes what a prop is worth.
export function distributionSummary(sim) {
  const { dist, numSims } = sim;
  const band = (d) => ({
    p5: percentile(d, numSims, 0.05),
    p25: percentile(d, numSims, 0.25),
    median: percentile(d, numSims, 0.5),
    p75: percentile(d, numSims, 0.75),
    p95: percentile(d, numSims, 0.95),
  });

  const margin = band(dist.margin);
  const total = band(dist.total);

  return {
    numSims,
    margin,
    total,
    home: band(dist.home),
    away: band(dist.away),
    // The 90% interval is the honest headline: a projection quoted without it
    // reads far more precise than the model actually is.
    marginRange90: [margin.p5, margin.p95],
    totalRange90: [total.p5, total.p95],
    homeWin: sim.probs.homeWin,
    blowout: sim.probs.blowout,
    overtime: sim.probs.overtime,
    // How often the game lands within a basket either way of the median.
    coinFlipBand: probBetween(dist.margin, numSims, -3, 3),
  };
}

// Percentile band for a simulated prop, so a prop projection carries the same
// honesty about its range as a game projection.
export function propDistribution(propResult) {
  if (!propResult || propResult.insufficientData || !propResult.dist) return null;
  const { dist, samples } = propResult;
  return {
    samples,
    p10: percentile(dist, samples, 0.1),
    p25: percentile(dist, samples, 0.25),
    median: percentile(dist, samples, 0.5),
    p75: percentile(dist, samples, 0.75),
    p90: percentile(dist, samples, 0.9),
    mean: propResult.simulatedMean,
  };
}

// ---------------------------------------------------------------------------
// Confidence dampener
// ---------------------------------------------------------------------------

// Build the penalty ledger for a whole game. Each entry is a named amount in
// probability points; the sum is what gets subtracted from a raw edge.
export function gamePenalties(game, sim) {
  const ledger = [];
  const add = (amount, reason) => ledger.push({ amount, reason });
  const q = game.dataQuality ?? {};

  if (q.noCurrentSeasonData)
    add(PENALTIES.NO_CURRENT_SEASON_DATA, 'No current-season data — prior-season ratings only');
  if (q.gamesPlayedNotIngested)
    add(PENALTIES.BEHIND_MARKET, `Behind the market: ${q.gamesPlayedNotIngested}`);
  if (q.estimatedInputs?.length)
    add(PENALTIES.ESTIMATED_INPUT, `Estimated inputs: ${q.estimatedInputs.join(', ')}`);
  if (q.marketDisagreement)
    add(PENALTIES.MARKET_DISAGREEMENT, `Books disagree on the number (${q.marketDisagreement})`);
  if (q.lineMovedAgainst)
    add(PENALTIES.LINE_MOVED_AGAINST, `Line moved against the model (${q.lineMovedAgainst})`);
  // Prefer a structured injury list when the feed supplied one; fall back to a
  // curated note, which can only be charged at the flat rate.
  if (Array.isArray(game.injuries) && game.injuries.length > 0) {
    injuryPenalties(game.injuries).forEach((e) => add(e.amount, e.reason));
  } else if (q.injuryNewsUncertainty) {
    add(PENALTIES.INJURY_NEWS_UNCERTAINTY, `Injury/news uncertainty: ${q.injuryNewsUncertainty}`);
  }
  if (q.lineupUnconfirmed)
    add(PENALTIES.LINEUP_UNCONFIRMED, `Lineup unconfirmed: ${q.lineupUnconfirmed}`);

  [game.home, game.away].forEach((team) => {
    if (team.turnover === 'high')
      add(PENALTIES.HEAVY_ROSTER_TURNOVER, `${team.code}: heavy roster turnover`);
    else if (team.turnover === 'moderate')
      add(PENALTIES.MODERATE_ROSTER_TURNOVER, `${team.code}: moderate roster turnover`);
    else if (team.turnover !== 'low')
      // Unassessed is not the same as unchanged. Charging nothing here let the
      // model look most confident about exactly the teams nobody had looked at.
      add(PENALTIES.UNASSESSED_ROSTER, `${team.code}: roster turnover not assessed`);
    if (team.recentForm && team.recentForm.games && team.recentForm.games < 5)
      add(PENALTIES.SMALL_SAMPLE_TEAM, `${team.code}: ${team.recentForm.games}-game sample`);
  });

  if (game.context?.home?.backToBack) add(PENALTIES.BACK_TO_BACK, `${game.home.code}: back-to-back`);
  if (game.context?.away?.backToBack) add(PENALTIES.BACK_TO_BACK, `${game.away.code}: back-to-back`);

  if (sim.probs.blowout >= 0.3)
    add(PENALTIES.BLOWOUT_RISK, `Blowout risk ${(100 * sim.probs.blowout).toFixed(0)}%`);

  // Disagreeing with the market by a wide margin is evidence against our own
  // inputs, so it is charged for by the point.
  const C = MODEL_CONSTANTS;
  const d = sim.projection.divergence;
  if (d.marginExcess > 0)
    add(
      d.marginExcess * C.DIVERGENCE_PENALTY_PER_POINT,
      `Model margin is ${Math.abs(d.margin).toFixed(1)} pts off the spread ` +
        `(${d.marginExcess.toFixed(1)} beyond the ${C.MAX_TRUSTED_MARGIN_DIVERGENCE}-pt trust band)`
    );
  if (d.totalExcess > 0)
    add(
      d.totalExcess * C.DIVERGENCE_PENALTY_PER_POINT,
      `Model total is ${Math.abs(d.total).toFixed(1)} pts off the posted total ` +
        `(${d.totalExcess.toFixed(1)} beyond the ${C.MAX_TRUSTED_TOTAL_DIVERGENCE}-pt trust band)`
    );

  const [lo, hi] = BET_RULES.COIN_FLIP_BAND;
  if (sim.probs.homeWin > lo && sim.probs.homeWin < hi)
    add(PENALTIES.COIN_FLIP, 'Model sees a coin flip');

  return ledger;
}

// A ruled-out starter and five absent reserves are not the same uncertainty, so
// the ledger is built from who is actually missing. `starter` is set by the data
// layer from the projected lineups.
export function injuryPenalties(injuries) {
  const entries = [];
  const isOut = (status) => /^(out|doubtful)$/i.test(status ?? '');
  const starters = injuries.filter((i) => i.starter);
  const reserves = injuries.filter((i) => !i.starter);

  starters.forEach((i) => {
    const amount = isOut(i.status)
      ? PENALTIES.INJURY_STARTER_OUT
      : PENALTIES.INJURY_STARTER_QUESTIONABLE;
    entries.push({
      amount,
      reason: `${i.team} projected starter ${i.player} ${String(i.status).toLowerCase()}${
        i.detail ? ` (${i.detail})` : ''
      }`,
    });
  });

  const reserveRaw = reserves.reduce(
    (sum, i) =>
      sum +
      (isOut(i.status)
        ? PENALTIES.INJURY_RESERVE_OUT
        : PENALTIES.INJURY_RESERVE_QUESTIONABLE),
    0
  );
  if (reserveRaw > 0) {
    const amount = Math.min(reserveRaw, PENALTIES.INJURY_RESERVE_CAP);
    const names = reserves.map((i) => `${i.player} (${i.team})`).join(', ');
    entries.push({
      amount,
      reason: `${reserves.length} reserve${reserves.length === 1 ? '' : 's'} unavailable: ${names}`,
    });
  }

  return entries;
}

// A prop whose line sits far from our projection is reporting a problem with
// the line, not an opportunity. Returns a reason string when the gap is wide
// enough that the row should not be treated as a bet at all.
export function propLineVeto(prop, projectedValue) {
  if (projectedValue == null) return null;
  const line = prop.threshold != null ? prop.threshold - 0.5 : prop.line;
  if (line == null || line <= 0) return null;

  const gap = Math.abs(projectedValue - line);
  const pct = gap / line;
  if (pct < MODEL_CONSTANTS.MAX_TRUSTED_PROP_DIVERGENCE_PCT) return null;
  return (
    `projection ${projectedValue.toFixed(1)} is ${gap.toFixed(1)} off the ${line} line ` +
    `(${(100 * pct).toFixed(0)}%) — the line is the more likely error`
  );
}

// Prop-specific penalties, layered on top of the game ledger.
export function propPenalties(prop, simProp) {
  const ledger = [];
  const add = (amount, reason) => ledger.push({ amount, reason });
  const f = prop.flags ?? {};

  if (f.smallSample)
    add(PENALTIES.SMALL_SAMPLE_PLAYER, `${prop.player}: ${f.smallSample}`);
  if (f.estimatedBaseline)
    add(PENALTIES.ESTIMATED_INPUT, `${prop.player}: baseline estimated (${f.estimatedBaseline})`);
  if (f.roleChange) add(PENALTIES.ROLE_CHANGE, `${prop.player}: ${f.roleChange}`);
  if (f.streaky) add(PENALTIES.STREAKY_PLAYER, `${prop.player}: streaky production`);
  if (f.injuryReturn)
    add(PENALTIES.INJURY_NEWS_UNCERTAINTY, `${prop.player}: ${f.injuryReturn}`);
  if ((prop.minutesVolatility ?? 0) >= 0.08)
    add(PENALTIES.MINUTES_VOLATILITY, `${prop.player}: volatile minutes`);
  if (f.estimatedPrice)
    add(PENALTIES.ESTIMATED_INPUT, `${prop.player}: one side of the price inferred`);

  return ledger;
}

// A moneyline priced longer than the ceiling is never a recommendation. The
// edge on a small probability is not estimable to the accuracy the price needs.
export function priceVeto(market, price) {
  if (market !== 'moneyline' || price == null) return null;
  if (price < BET_RULES.MAX_MONEYLINE_PRICE) return null;
  return (
    `moneyline priced +${price}, past the +${BET_RULES.MAX_MONEYLINE_PRICE} ceiling — ` +
    'a small probability cannot be estimated accurately enough to price it'
  );
}

// Divergence past the veto multiple takes the whole game off the board: the
// model and the market cannot both be describing the same game, and we are
// the side without a trading desk.
export function divergenceVeto(projection) {
  const C = MODEL_CONSTANTS;
  const d = projection.divergence;
  const reasons = [];
  if (d.margin != null && Math.abs(d.margin) >= C.MAX_TRUSTED_MARGIN_DIVERGENCE * C.DIVERGENCE_VETO_MULTIPLE)
    reasons.push(`model margin ${Math.abs(d.margin).toFixed(1)} pts off the spread`);
  if (d.total != null && Math.abs(d.total) >= C.MAX_TRUSTED_TOTAL_DIVERGENCE * C.DIVERGENCE_VETO_MULTIPLE)
    reasons.push(`model total ${Math.abs(d.total).toFixed(1)} pts off the posted total`);
  return reasons.length ? reasons.join('; ') : null;
}

export function sumPenalties(ledger) {
  const raw = ledger.reduce((a, e) => a + e.amount, 0);
  return Math.min(raw, BET_RULES.MAX_TOTAL_PENALTY);
}

// 0-10 conviction score: starts high and falls with the penalty ledger.
export function confidenceFromPenalties(ledger) {
  const raw = ledger.reduce((a, e) => a + e.amount, 0);
  return clamp(+(9.5 - raw * 28).toFixed(1), 1, 10);
}

// ---------------------------------------------------------------------------
// Market pricing
// ---------------------------------------------------------------------------

// One row of the betting board: model probability vs the posted price, with
// the raw edge, the penalty-adjusted edge, and a recommendation.
function marketRow({
  label,
  market,
  modelProb,
  price,
  pushProb = 0,
  noVigProb = null,
  penalties,
  gameId,
  side,
  veto = null,
}) {
  const implied = americanToProb(price);
  const penaltyTotal = sumPenalties(penalties);

  // With a pushable line, the money only settles on the non-push outcomes, so
  // compare the book's price against the model's no-push probability.
  const settleProb = pushProb > 0 && pushProb < 1 ? modelProb / (1 - pushProb) : modelProb;

  const rawEdge = settleProb - implied;
  const adjustedEdge = rawEdge - penaltyTotal;
  const confidence = confidenceFromPenalties(penalties);

  // Hard rules, applied before any edge arithmetic can promote a row. These
  // are vetoes rather than penalties on purpose: a penalty just moves a row
  // down a ranking it should not be on at all.
  const effectiveVeto = veto ?? priceVeto(market, price);

  const qualifies =
    !effectiveVeto &&
    adjustedEdge >= BET_RULES.MIN_ADJUSTED_EDGE &&
    confidence >= BET_RULES.MIN_CONFIDENCE;

  return {
    label,
    market,
    gameId,
    side,
    modelProb,
    settleProb,
    pushProb,
    price,
    implied,
    noVigProb,
    // Beating the de-vigged market is the harder, more honest test than
    // beating the posted price, so carry both.
    edgeVsNoVig: noVigProb == null ? null : settleProb - noVigProb,
    rawEdge,
    penaltyTotal,
    adjustedEdge,
    fairOdds: probToAmerican(settleProb),
    confidence,
    penalties,
    qualifies,
    veto: effectiveVeto,
    recommendation: qualifies
      ? 'BET'
      : veto
        ? `NO BET — model/market divergence (${veto})`
        : adjustedEdge >= BET_RULES.MIN_ADJUSTED_EDGE
          ? 'PASS — confidence below threshold'
          : rawEdge >= BET_RULES.MIN_ADJUSTED_EDGE
            ? 'PASS — edge eaten by uncertainty penalties'
            : 'PASS — no edge',
  };
}

export function analyzeGame(game, { numSims = 10000, seed = 42, anchorWeight } = {}) {
  const sim = simulateGame(game, { numSims, seed, anchorWeight });
  const { probs, means } = sim;
  const ledger = gamePenalties(game, sim);
  const veto = divergenceVeto(sim.projection);
  const o = game.odds ?? {};

  const rows = [];

  // --- Moneyline (the h2h market) ---
  if (o.moneyline) {
    const [noVigHome, noVigAway] = removeVig([
      americanToProb(o.moneyline.home),
      americanToProb(o.moneyline.away),
    ]);
    rows.push(
      marketRow({
        label: `${game.home.name} ML`,
        market: 'moneyline',
        side: 'home',
        gameId: game.id,
        modelProb: probs.homeWin,
        price: o.moneyline.home,
        noVigProb: noVigHome,
        penalties: ledger,
        veto,
      }),
      marketRow({
        label: `${game.away.name} ML`,
        market: 'moneyline',
        side: 'away',
        gameId: game.id,
        modelProb: probs.awayWin,
        price: o.moneyline.away,
        noVigProb: noVigAway,
        penalties: ledger,
        veto,
      })
    );
  }

  // --- Spread ---
  if (o.spread) {
    const line = o.spread.homeLine;
    const fmt = (n) => (n > 0 ? `+${n}` : `${n}`);
    const [noVigHome, noVigAway] = removeVig([
      americanToProb(o.spread.homePrice),
      americanToProb(o.spread.awayPrice),
    ]);
    rows.push(
      marketRow({
        label: `${game.home.name} ${fmt(line)}`,
        market: 'spread',
        side: 'home',
        gameId: game.id,
        modelProb: probs.homeCover,
        pushProb: probs.homePush,
        price: o.spread.homePrice,
        noVigProb: noVigHome,
        penalties: ledger,
        veto,
      }),
      marketRow({
        label: `${game.away.name} ${fmt(-line)}`,
        market: 'spread',
        side: 'away',
        gameId: game.id,
        modelProb: probs.awayCover,
        pushProb: probs.homePush,
        price: o.spread.awayPrice,
        noVigProb: noVigAway,
        penalties: ledger,
        veto,
      })
    );
  }

  // --- Total ---
  if (o.total) {
    const [noVigOver, noVigUnder] = removeVig([
      americanToProb(o.total.over),
      americanToProb(o.total.under),
    ]);
    rows.push(
      marketRow({
        label: `Over ${o.total.line}`,
        market: 'total',
        side: 'over',
        gameId: game.id,
        modelProb: probs.over,
        pushProb: probs.totalPush,
        price: o.total.over,
        noVigProb: noVigOver,
        penalties: ledger,
        veto,
      }),
      marketRow({
        label: `Under ${o.total.line}`,
        market: 'total',
        side: 'under',
        gameId: game.id,
        modelProb: probs.under,
        pushProb: probs.totalPush,
        price: o.total.under,
        noVigProb: noVigUnder,
        penalties: ledger,
        veto,
      })
    );
  }

  // --- Player props ---
  const propRows = [];
  sim.propResults.forEach((result) => {
    const prop = result.prop;
    if (result.insufficientData) {
      propRows.push({
        label: `${prop.player} ${prop.stat} ${prop.threshold != null ? `${prop.threshold}+` : prop.line}`,
        market: 'prop',
        gameId: game.id,
        prop,
        insufficientData: true,
        recommendation: 'NO PLAY — insufficient baseline data',
      });
      return;
    }
    const propLedger = [...ledger, ...propPenalties(prop, result)];
    // A line far from our projection vetoes the row outright.
    const lineVeto = propLineVeto(prop, result.simulatedMean);
    const propVeto = veto ?? lineVeto;
    const describe = prop.threshold != null ? `${prop.threshold}+ ${prop.stat}` : `${prop.stat} ${prop.line}`;

    if (prop.threshold != null) {
      propRows.push({
        ...marketRow({
          label: `${prop.player} ${describe}`,
          market: 'prop',
          side: 'yes',
          gameId: game.id,
          modelProb: result.overProb,
          price: prop.price,
          penalties: propLedger,
          veto: propVeto,
        }),
        prop,
        simulatedMean: result.simulatedMean,
        distribution: propDistribution(result),
        expected: result.projected.expected,
      });
      return;
    }

    const [noVigOver, noVigUnder] = removeVig([
      americanToProb(prop.over),
      americanToProb(prop.under),
    ]);
    propRows.push(
      {
        ...marketRow({
          label: `${prop.player} Over ${prop.line} ${prop.stat}`,
          market: 'prop',
          side: 'over',
          gameId: game.id,
          modelProb: result.overProb,
          pushProb: result.pushProb,
          price: prop.over,
          noVigProb: noVigOver,
          penalties: propLedger,
          veto: propVeto,
        }),
        prop,
        simulatedMean: result.simulatedMean,
        distribution: propDistribution(result),
        expected: result.projected.expected,
      },
      {
        ...marketRow({
          label: `${prop.player} Under ${prop.line} ${prop.stat}`,
          market: 'prop',
          side: 'under',
          gameId: game.id,
          modelProb: result.underProb,
          pushProb: result.pushProb,
          price: prop.under,
          noVigProb: noVigUnder,
          penalties: propLedger,
          veto: propVeto,
        }),
        prop,
        simulatedMean: result.simulatedMean,
        distribution: propDistribution(result),
        expected: result.projected.expected,
      }
    );
  });

  // Markets the simulation can price beyond the posted three. Unpriced rows
  // carry fair odds to shop and are never treated as bets.
  const derived = derivedMarkets(game, sim, { ledger, veto });

  const playable = [...rows, ...propRows, ...derived].filter(
    (r) => !r.insufficientData && r.priced !== false
  );
  const byEdge = playable.slice().sort((a, b) => b.adjustedEdge - a.adjustedEdge);
  const qualified = byEdge.filter((r) => r.qualifies);
  const confidence = confidenceFromPenalties(ledger);

  return {
    game,
    sim,
    projection: sim.projection,
    distribution: distributionSummary(sim),
    penalties: ledger,
    penaltyTotal: sumPenalties(ledger),
    confidence,
    veto,
    riskLevel: confidence >= 7.5 ? 'Low' : confidence >= 6 ? 'Medium' : 'High',
    markets: rows,
    props: propRows,
    derived,
    qualified,
    bestBet: qualified[0] ?? null,
    bestByEdge: byEdge[0] ?? null,
    summary: {
      predictedScore: {
        home: means.homeScore,
        away: means.awayScore,
      },
      predictedTotal: means.total,
      predictedMargin: means.margin,
      favorite: means.margin >= 0 ? game.home.name : game.away.name,
      homeWinProb: probs.homeWin,
      awayWinProb: probs.awayWin,
      overProb: probs.over,
      underProb: probs.under,
      homeCoverProb: probs.homeCover,
      awayCoverProb: probs.awayCover,
      blowoutProb: probs.blowout,
      overtimeProb: probs.overtime,
      possessions: means.possessions,
    },
  };
}

// ---------------------------------------------------------------------------
// Slate driver
// ---------------------------------------------------------------------------

export function analyzeSlate(games, options = {}) {
  const results = games.map((game, i) =>
    analyzeGame(game, { ...options, seed: (options.seed ?? 42) + i * 7919 })
  );

  // Rank every market on the slate by adjusted edge. `topBets` holds only the
  // rows that clear the gate; `topByEdge` is the leaderboard regardless, so a
  // thin slate reports "nothing qualifies" instead of inventing a card.
  const everyRow = results.flatMap((r) =>
    [...r.markets, ...r.props, ...r.derived].filter(
      (row) => !row.insufficientData && row.priced !== false
    )
  );
  const topByEdge = everyRow.slice().sort((a, b) => b.adjustedEdge - a.adjustedEdge).slice(0, 5);
  const topBets = everyRow
    .filter((row) => row.qualifies)
    .sort((a, b) => b.adjustedEdge - a.adjustedEdge)
    .slice(0, 5);

  return { results, topBets, topByEdge };
}
