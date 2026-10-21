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
