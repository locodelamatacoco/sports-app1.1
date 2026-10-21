// src/data/nbaTeamRatings.js
//
// Curated team efficiency inputs, keyed by ESPN team abbreviation.
//
// These cannot come from the live feed. ESPN's public scoreboard carries the
// slate, the venue, and the sportsbook lines, but not offensive/defensive
// rating or pace — those live behind `site.web.api.espn.com`, which the
// session's network policy does not reach. So the split is:
//
//   LIVE (espnNba.js)  — games, teams, tip time, venue, ML/spread/total,
//                        opening and current lines
//   CURATED (here)     — off/def rating, pace, roster-change priors
//
// Ratings are 2025-26 regular season, points per 100 possessions. Pace is
// possessions per 48 minutes on a league-average-99.5 scale (see
// `PACE_SCALE_NOTE`). `rosterAdj` is our own prior, not a measurement.

export const LEAGUE_AVG = {
  rating: 114.4,
  pace: 99.5,
  paceSd: 1.84,
};

export const PACE_SCALE_NOTE =
  'Only Boston\'s pace is directly sourced (95.6, slowest in the league). The ' +
  'rest are mapped from published pace ranks with a 1.84-possession league SD, ' +
  'which reproduces Boston\'s sourced figure at rank 30.';

// Roster-change priors, keyed by ESPN abbreviation. These are JUDGEMENT, not
// measurement: what we think a roster change is worth per 100 possessions, and
// how much of the team turned over. They overlay the ratings derived from the
// standings feed, and the dampener charges for every one of them.
export const ROSTER_PRIORS = {
  BOS: { rosterAdj: { off: -2.5, def: 0.5 }, turnover: 'high' },
  DET: { rosterAdj: { off: 1.0, def: 0.5 }, turnover: 'moderate' },
  PHI: { rosterAdj: { off: 4.5, def: -0.5 }, turnover: 'high' },
  NY: { rosterAdj: { off: 0, def: 0 }, turnover: 'low' },
  OKC: { rosterAdj: { off: 0, def: 0 }, turnover: 'low' },
  SA: { rosterAdj: { off: 1.0, def: -0.5 }, turnover: 'moderate' },
};

export const TEAM_RATINGS = {
  BOS: {
    code: 'BOS',
    name: 'Boston Celtics',
    record: '56-26 (2025-26)',
    ratings: { off: 120.0, def: 111.7, pace: 95.6 }, // off 2nd, def 4th, slowest pace
    // Lost Jaylen Brown (28.7 ppg, 36.2% usage — 2nd in the NBA), added Paul
    // George, and Jayson Tatum returns from a 16-game season. The market
    // disagrees with the direction of this adjustment; left in as our honest
    // prior, with the divergence guard there to stop it being bet.
    rosterAdj: { off: -2.5, def: 0.5 },
    turnover: 'high',
  },
  DET: {
    code: 'DET',
    name: 'Detroit Pistons',
    record: '60-22 (2025-26)',
    ratings: { off: 117.3, def: 108.9, pace: 99.4 }, // off 9th, def 2nd, pace 16th
    // Cunningham/Duren/Thompson core intact; John Collins and Duncan Robinson
    // project into the starting five.
    rosterAdj: { off: 1.0, def: 0.5 },
    turnover: 'moderate',
    paceEstimated: true,
  },
  PHI: {
    code: 'PHI',
    name: 'Philadelphia 76ers',
    record: '45-37 (2025-26)',
    ratings: { off: 114.3, def: 114.4, pace: 100.0 }, // off 16th, def 17th, net -0.1, pace 13th
    // The largest judgement in the file: last season's ratings describe a team
    // that had neither LeBron James nor Jaylen Brown on it. Both now project
    // into the starting five.
    rosterAdj: { off: 4.5, def: -0.5 },
    turnover: 'high',
    paceEstimated: true,
  },
  NY: {
    code: 'NYK',
    name: 'New York Knicks',
    record: '53-29 (2025-26)',
    ratings: { off: 118.7, def: 112.3, pace: 99.5 }, // off 3rd, def 7th; pace not sourced
    // Defending champions with the core five intact.
    rosterAdj: { off: 0, def: 0 },
    turnover: 'low',
    paceEstimated: true,
  },
  OKC: {
    code: 'OKC',
    name: 'Oklahoma City Thunder',
    record: '64-18 (2025-26)',
    ratings: { off: 117.6, def: 106.5, pace: 99.0 }, // off 7th, def 1st, net +11.1, pace 18th
    rosterAdj: { off: 0, def: 0 },
    turnover: 'low',
    paceEstimated: true,
  },
  SA: {
    code: 'SAS',
    name: 'San Antonio Spurs',
    record: '62-20 (2025-26)',
    ratings: { off: 118.7, def: 110.4, pace: 99.8 }, // off 4th, def 3rd, net +8.4, pace 14th
    // Dylan Harper into a three-guard starting group beside Fox and Castle.
    rosterAdj: { off: 1.0, def: -0.5 },
    turnover: 'moderate',
    paceEstimated: true,
  },
};

// A team we have no sourced ratings for resolves to league average and is
// flagged, so the model degrades into "no opinion" rather than quietly
// inventing a rating. Only six teams are covered above; the rest of the league
// needs its 2025-26 figures filled in before the model has anything to say
// about those games.
export function ratingsFor(abbreviation) {
  const known = TEAM_RATINGS[abbreviation];
  if (known) return { ...known, ratingsSourced: true };
  return {
    code: abbreviation,
    name: abbreviation,
    record: null,
    ratings: { off: LEAGUE_AVG.rating, def: LEAGUE_AVG.rating, pace: LEAGUE_AVG.pace },
    rosterAdj: { off: 0, def: 0 },
    turnover: 'unknown',
    ratingsSourced: false,
    paceEstimated: true,
  };
}
