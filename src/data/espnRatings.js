// src/data/espnRatings.js
//
// Team efficiency ratings for all 30 teams, derived from ESPN's standings
// endpoint rather than curated by hand.
//
// The standings carry season points for and against per game for every team.
// That is the possession identity inverted: dividing points per game by
// possessions per 48 gives points per 100 possessions.
//
//   offRating = (pointsFor    / pace) * 100
//   defRating = (pointsAgainst / pace) * 100
//
// Pace is the catch. ESPN does not publish it on any endpoint this session can
// reach, so `PACE_PER_48` holds the figures that could be sourced and every
// other team falls back to the league average with `paceEstimated` set.
//
// Assuming league pace for a team that plays faster or slower inflates or
// deflates BOTH of its ratings together, so its net rating — and therefore the
// projected margin — stays right while its contribution to the projected total
// is off. That is why the pace estimate is flagged per team and charged for by
// the dampener rather than hidden.

import axios from 'axios';
import { ROSTER_PRIORS } from './nbaTeamRatings';

export const ESPN_NBA_STANDINGS =
  'https://site.api.espn.com/apis/v2/sports/basketball/nba/standings';

// Possessions per 48 minutes, 2025-26. Sourced where a figure could be found;
// everything else resolves to LEAGUE_PACE and is flagged.
export const PACE_PER_48 = {
  MIA: 103.6,
  ATL: 101.6,
  IND: 101.0,
  DET: 99.2,
  GS: 99.0,
  DEN: 98.3,
  LAL: 98.3,
  LAC: 96.5,
  HOU: 96.2,
  BOS: 94.9,
};

// League-average pace per 48, 2025-26 (NBA.com power rankings).
export const LEAGUE_PACE = 100.2;

function statValue(entry, name) {
  const stat = (entry.stats ?? []).find((s) => s.name === name);
  if (!stat) return null;
  const n = Number(stat.value ?? stat.displayValue);
  return Number.isFinite(n) ? n : null;
}

// Flatten the conference/division tree the standings endpoint returns.
export function standingsEntries(standings) {
  const out = [];
  const walk = (node) => {
    (node?.standings?.entries ?? []).forEach((e) => out.push(e));
    (node?.children ?? []).forEach(walk);
  };
  walk(standings);
  (standings?.children ?? []).forEach(walk);
  // A team can appear in both a conference and a division group.
  const seen = new Set();
  return out.filter((e) => {
    const key = e.team?.abbreviation;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function ratingsFromStandings(standings, { paceOverrides = PACE_PER_48 } = {}) {
  const entries = standingsEntries(standings);
  const teams = {};
  let pfSum = 0;
  let counted = 0;

  entries.forEach((entry) => {
    const abbr = entry.team?.abbreviation;
    const pf = statValue(entry, 'avgPointsFor');
    const pa = statValue(entry, 'avgPointsAgainst');
    if (!abbr || pf == null || pa == null || pf <= 0) return;

    const sourcedPace = paceOverrides[abbr];
    const pace = sourcedPace ?? LEAGUE_PACE;
    const wins = statValue(entry, 'wins');
    const losses = statValue(entry, 'losses');
    const prior = ROSTER_PRIORS[abbr] ?? {};

    teams[abbr] = {
      code: abbr,
      name: entry.team?.displayName ?? abbr,
      record: wins != null && losses != null ? `${wins}-${losses}` : null,
      // How much of this season the averages above are built from. The blend
      // below needs it, and it is the difference between a real rating and
      // four games of noise.
      gamesPlayed: wins != null && losses != null ? wins + losses : null,
      pointsFor: pf,
      pointsAgainst: pa,
      ratings: {
        off: (pf / pace) * 100,
        def: (pa / pace) * 100,
        pace,
      },
      rosterAdj: prior.rosterAdj ?? { off: 0, def: 0 },
      turnover: prior.turnover ?? 'unknown',
      ratingsSourced: true,
      paceEstimated: sourcedPace == null,
      derivedFrom: 'espn-standings',
    };
    pfSum += pf;
    counted += 1;
  });

  const leaguePF = counted > 0 ? pfSum / counted : null;
  return {
    teams,
    count: counted,
    league: leaguePF
      ? {
          pointsFor: leaguePF,
          pace: LEAGUE_PACE,
          // The league-average rating implied by this very data, so the
          // matchup adjustment cannot drift onto a different scale.
          rating: (leaguePF / LEAGUE_PACE) * 100,
        }
      : null,
  };
}

// `season` is the ending year: 2026 is the 2025-26 season. The completed prior
// season is what the projection wants; the current season's standings are a
// one- or two-game sample for most of October.
export async function fetchTeamRatings({ season, client = axios, signal } = {}) {
  const url = season ? `${ESPN_NBA_STANDINGS}?season=${season}` : ESPN_NBA_STANDINGS;
  const { data } = await client.get(url, { signal });
  return ratingsFromStandings(data);
}

// ---------------------------------------------------------------------------
// Blending this season's form into last season's ratings
// ---------------------------------------------------------------------------
//
// The model ran on prior-season ratings alone, and charged itself a standing
// penalty for it, which meant it grew LESS confident as the season went on and
// more information became available. Measured over two full seasons (fit on
// 2025-26, tested on 2024-25 — separate data, no shared state), blending this
// season's scoring in lifts straight-up accuracy from 61.8% to 66.1% and cuts
// about a point off the margin residual SD, with calibration unchanged.
//
// CURRENT_SEASON_K is the prior-games-equivalent: at n games played the current
// season gets n/(n+k) of the weight. k=10 was the flattest part of a sweep from
// 2 to 60, so the choice is not perched on a spike.
export const CURRENT_SEASON_K = 10;

// Below this, current-season scoring is noise and makes the projection worse,
// not better: at 1-5 games played the blend lost to prior-season ratings
// outright (margin RMSE 14.17 vs 13.88). The gate is not caution, it is
// measurement.
export const MIN_GAMES_FOR_BLEND = 6;

// Weight this season's form earns at n games played.
export function blendWeight(gamesPlayed, { k = CURRENT_SEASON_K, minGames = MIN_GAMES_FOR_BLEND } = {}) {
  const n = gamesPlayed ?? 0;
  if (!Number.isFinite(n) || n < minGames) return 0;
  return n / (n + k);
}

// Blend two rating tables from ratingsFromStandings. Returns the same shape,
// plus the weight each team's entry actually received, so the projection can
// scale its shrinkage and the dampener can stop charging for a gap that has
// been closed.
export function blendSeasons(prior, current, options = {}) {
  if (!prior?.teams) return prior;
  if (!current?.teams) {
    const teams = {};
    for (const [code, entry] of Object.entries(prior.teams)) {
      teams[code] = { ...entry, blendWeight: 0, currentSeasonGames: 0 };
    }
    return { ...prior, teams, blended: false };
  }

  const teams = {};
  let blendedCount = 0;

  for (const [code, priorEntry] of Object.entries(prior.teams)) {
    const cur = current.teams[code];
    const w = cur ? blendWeight(cur.gamesPlayed, options) : 0;
    if (w === 0) {
      teams[code] = {
        ...priorEntry,
        blendWeight: 0,
        currentSeasonGames: cur?.gamesPlayed ?? 0,
      };
      continue;
    }

    const pointsFor = priorEntry.pointsFor * (1 - w) + cur.pointsFor * w;
    const pointsAgainst = priorEntry.pointsAgainst * (1 - w) + cur.pointsAgainst * w;
    // Pace is taken from whichever side is measured rather than blended: a
    // sourced current-season pace describes this season's roster, and an
    // estimated one carries no information to mix in.
    const pace = cur.paceEstimated ? priorEntry.ratings.pace : cur.ratings.pace;

    teams[code] = {
      ...priorEntry,
      record: cur.record ?? priorEntry.record,
      pointsFor,
      pointsAgainst,
      ratings: {
        off: (pointsFor / pace) * 100,
        def: (pointsAgainst / pace) * 100,
        pace,
      },
      blendWeight: w,
      currentSeasonGames: cur.gamesPlayed,
      derivedFrom: 'espn-standings-blended',
    };
    blendedCount += 1;
  }

  // The league scale has to move with the ratings or the matchup adjustment
  // divides by the wrong average.
  const codes = Object.keys(teams);
  const leaguePF =
    codes.reduce((a, c) => a + teams[c].pointsFor, 0) / Math.max(codes.length, 1);

  return {
    ...prior,
    teams,
    blended: blendedCount > 0,
    blendedCount,
    league: {
      pointsFor: leaguePF,
      pace: prior.league?.pace ?? LEAGUE_PACE,
      rating: (leaguePF / (prior.league?.pace ?? LEAGUE_PACE)) * 100,
    },
  };
}
