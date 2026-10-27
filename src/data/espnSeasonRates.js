// src/data/espnSeasonRates.js
//
// Per-minute player rates from THIS season's completed games.
//
// Player baselines have been the model's binding constraint: lines could be
// read wholesale but baselines came one player at a time from search, so most
// of a board could never be priced. Every regular-season game already played
// has a box score on the same feed the slate comes from, which makes the whole
// league's rates a few requests away rather than a research task.
//
// The accumulation and rate maths live in espnPreseason.js, which is where
// they first landed; they were never preseason-specific — they read any
// summary's box score. Only the fetch differs: season type 2, and a date range
// instead of a single preseason month.

import axios from 'axios';
import {
  accumulateBoxScore,
  ratesFrom,
  TRACKED_STATS,
  MIN_MINUTES_FOR_RATE,
  MIN_GAMES_FOR_RATE,
} from './espnPreseason';

export const ESPN_NBA_SCOREBOARD =
  'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard';
export const ESPN_NBA_SUMMARY =
  'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary';

export const SEASON_TYPE_REGULAR = 2;

export { TRACKED_STATS, MIN_MINUTES_FOR_RATE, MIN_GAMES_FOR_RATE };

// Completed regular-season games in a scoreboard payload.
export function regularSeasonGamesFrom(scoreboard) {
  const out = [];
  for (const event of scoreboard?.events ?? []) {
    if (event.season?.type !== SEASON_TYPE_REGULAR) continue;
    if (!event.status?.type?.completed) continue;
    const competition = event.competitions?.[0];
    const home = competition?.competitors?.find((c) => c.homeAway === 'home');
    const away = competition?.competitors?.find((c) => c.homeAway === 'away');
    if (!home || !away) continue;
    out.push({
      id: String(event.id),
      date: event.date?.slice(0, 10) ?? null,
      home: home.team?.abbreviation ?? null,
      away: away.team?.abbreviation ?? null,
    });
  }
  return out;
}

// Rates are reported against the season they came from, so a caller cannot
// mistake three October games for a settled baseline.
function retagSample(rates) {
  const out = {};
  for (const [name, rate] of Object.entries(rates)) {
    out[name] = {
      ...rate,
      sampleNote:
        `${rate.games} game${rate.games === 1 ? '' : 's'} this season, ` +
        `${rate.totalMinutes.toFixed(0)} total minutes`,
    };
  }
  return out;
}

// A prop baseline from a season rate. Unlike the preseason version this does
// NOT require the caller to supply minutes: a regular-season minutes-per-game
// IS a regular-season load, so it stands as the prior unless overridden.
export function seasonBaseline(rate, stat, { projectedMinutes, pace } = {}) {
  if (!rate || !rate.usableSample) return null;
  const perMinute = rate.perMinute?.[stat];
  if (perMinute == null || !Number.isFinite(perMinute)) return null;
  const minutes = projectedMinutes ?? rate.minutesPerGame;
  return {
    baseline: { perGame: perMinute * minutes, minutes, pace },
    projectedMinutes: minutes,
    flags: {
      smallSample: rate.sampleNote,
      ...(projectedMinutes != null && Math.abs(projectedMinutes - rate.minutesPerGame) > 3
        ? {
            estimatedBaseline:
              `projected ${projectedMinutes} min against ` +
              `${rate.minutesPerGame.toFixed(1)} mpg so far`,
          }
        : {}),
    },
  };
}

// `months` are YYYYMM strings. The season to date is normally one or two.
export async function fetchSeasonRates({
  months,
  team = null,
  client = axios,
  signal,
} = {}) {
  const wanted = Array.isArray(months) ? months : [months];
  const games = [];
  const seen = new Set();
  for (const month of wanted) {
    const { data } = await client.get(`${ESPN_NBA_SCOREBOARD}?dates=${month}&limit=1000`, {
      signal,
    });
    for (const game of regularSeasonGamesFrom(data)) {
      if (seen.has(game.id)) continue;
      if (team && game.home !== team && game.away !== team) continue;
      seen.add(game.id);
      games.push(game);
    }
  }

  const accumulator = {};
  let failed = 0;
  for (const game of games) {
    try {
      const { data: summary } = await client.get(`${ESPN_NBA_SUMMARY}?event=${game.id}`, {
        signal,
      });
      accumulateBoxScore(summary, accumulator, { team });
    } catch (err) {
      failed += 1;
      console.warn(`Box score unavailable for ${game.id}:`, err?.message ?? err);
    }
  }

  return {
    games: games.length,
    failed,
    rates: retagSample(ratesFrom(accumulator)),
  };
}
