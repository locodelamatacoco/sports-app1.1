// src/data/espnPreseason.js
//
// Current-roster baselines from this season's preseason box scores.
//
// Why this matters more than it looks: every team rating in the model comes
// from LAST season's standings, which describe rosters that no longer exist.
// Miami's 2025-26 numbers were posted by a team without Giannis Antetokounmpo
// on it. Preseason is the only current-roster data that exists before the
// season starts, and it is the only source of player baselines at all, since
// ESPN publishes no per-player season projections.
//
// It is also terrible data, and the module is built to say so:
//
//   - Two to six games per team, so every rate is a small sample.
//   - Starters play ~15-20 minutes, not ~32. PER-GAME numbers are therefore
//     useless and only PER-MINUTE rates transfer. `projectedMinutes` is a
//     separate prior the caller supplies, and the dampener charges for it.
//   - Rotations are experiments. Deep bench players post rates they will never
//     repeat against real opponents.
//
// So this returns per-minute rates plus the sample size behind each one, and
// never a per-game number dressed up as a projection.

import axios from 'axios';

export const ESPN_NBA_SCOREBOARD =
  'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard';
export const ESPN_NBA_SUMMARY =
  'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary';

// ESPN season types: 1 preseason, 2 regular season.
export const SEASON_TYPE_PRESEASON = 1;

// Below this many minutes a line is noise from a blowout's closing stretch.
export const MIN_MINUTES_FOR_RATE = 24;

// And minutes alone cannot express sample size: one 31-minute game clears the
// minutes floor while telling you almost nothing, which is how a 38-point
// opening night briefly read as a 38-point baseline. Both floors must pass.
export const MIN_GAMES_FOR_RATE = 3;

const STAT_KEYS = {
  minutes: 'minutes',
  points: 'points',
  rebounds: 'rebounds',
  assists: 'assists',
  steals: 'steals',
  blocks: 'blocks',
  // Box scores give made-attempted as one cell; numberFrom takes the made half.
  threes: 'threePointFieldGoalsMade-threePointFieldGoalsAttempted',
};

// Every counting stat the accumulator tracks. Keeping this in one place is what
// stops a stat being exposed as a rate without ever being summed.
export const TRACKED_STATS = ['points', 'rebounds', 'assists', 'steals', 'blocks', 'threes'];

// Box-score cells arrive as strings, and made-attempted pairs as "7-12".
function numberFrom(value) {
  if (value == null) return null;
  const first = String(value).split('-')[0];
  const n = Number(first);
  return Number.isFinite(n) ? n : null;
}

export function preseasonGamesFrom(scoreboard) {
  const out = [];
  for (const event of scoreboard?.events ?? []) {
    if (event.season?.type !== SEASON_TYPE_PRESEASON) continue;
    if (!event.status?.type?.completed) continue;
    const c = event.competitions?.[0];
    const home = c?.competitors?.find((x) => x.homeAway === 'home');
    const away = c?.competitors?.find((x) => x.homeAway === 'away');
    if (!home?.team || !away?.team) continue;
    out.push({
      id: String(event.id),
      date: event.date?.slice(0, 10) ?? null,
      home: home.team.abbreviation,
      away: away.team.abbreviation,
    });
  }
  return out;
}

// Fold one game's box score into a running per-player accumulator.
export function accumulateBoxScore(summary, accumulator = {}, { team = null } = {}) {
  for (const teamBlock of summary?.boxscore?.players ?? []) {
    const abbr = teamBlock.team?.abbreviation;
    if (team && abbr !== team) continue;
    for (const group of teamBlock.statistics ?? []) {
      const keys = group.keys ?? [];
      const at = (stats, key) => {
        const i = keys.indexOf(STAT_KEYS[key] ?? key);
        return i < 0 ? null : numberFrom(stats[i]);
      };
      for (const athlete of group.athletes ?? []) {
        const name = athlete.athlete?.displayName;
        const stats = athlete.stats ?? [];
        if (!name || stats.length === 0) continue;
        const minutes = at(stats, 'minutes');
        if (minutes == null || minutes <= 0) continue;

        const entry = (accumulator[name] = accumulator[name] ?? {
          player: name,
          team: abbr,
          games: 0,
          minutes: 0,
          ...Object.fromEntries(TRACKED_STATS.map((stat) => [stat, 0])),
        });
        entry.games += 1;
        entry.minutes += minutes;
        // Keep the latest team, so a mid-season move is not stuck on the old one.
        entry.team = abbr ?? entry.team;
        for (const stat of TRACKED_STATS) {
          entry[stat] += at(stats, stat) ?? 0;
        }
      }
    }
  }
  return accumulator;
}

// Per-minute rates, with the sample behind them attached so a caller cannot
// use the rate without seeing how thin it is.
export function ratesFrom(accumulator) {
  const out = {};
  for (const entry of Object.values(accumulator)) {
    const usable =
      entry.minutes >= MIN_MINUTES_FOR_RATE && entry.games >= MIN_GAMES_FOR_RATE;
    out[entry.player] = {
      player: entry.player,
      team: entry.team,
      games: entry.games,
      totalMinutes: entry.minutes,
      minutesPerGame: entry.minutes / entry.games,
      perMinute: Object.fromEntries(
        TRACKED_STATS.map((stat) => [stat, entry[stat] / entry.minutes])
      ),
      // Thin enough that the model should decline rather than project.
      usableSample: usable,
      sampleNote: `${entry.games} preseason game${entry.games === 1 ? '' : 's'}, ${entry.minutes.toFixed(0)} total minutes`,
    };
  }
  return out;
}

// Turn a per-minute rate into a prop baseline the simulator accepts. The
// caller must supply `projectedMinutes` — preseason minutes are not a
// regular-season load and the module will not pretend otherwise.
export function propBaseline(rate, stat, { projectedMinutes, pace }) {
  if (!rate || !rate.usableSample) return null;
  const perMinute = rate.perMinute[stat];
  if (perMinute == null || !Number.isFinite(perMinute)) return null;
  return {
    baseline: {
      perGame: perMinute * projectedMinutes,
      minutes: projectedMinutes,
      pace,
    },
    projectedMinutes,
    flags: {
      smallSample: rate.sampleNote,
      estimatedBaseline: `projected ${projectedMinutes} min is a prior; preseason load was ${rate.minutesPerGame.toFixed(1)} mpg`,
    },
  };
}

// `month` is YYYYMM covering the preseason (October for a normal calendar).
export async function fetchPreseasonRates({ month, team = null, client = axios, signal } = {}) {
  const { data } = await client.get(`${ESPN_NBA_SCOREBOARD}?dates=${month}&limit=1000`, {
    signal,
  });
  const games = preseasonGamesFrom(data).filter(
    (g) => !team || g.home === team || g.away === team
  );

  const accumulator = {};
  for (const game of games) {
    try {
      const { data: summary } = await client.get(`${ESPN_NBA_SUMMARY}?event=${game.id}`, {
        signal,
      });
      accumulateBoxScore(summary, accumulator, { team });
    } catch (err) {
      console.warn(`Preseason box score unavailable for ${game.id}:`, err?.message ?? err);
    }
  }
  return { games: games.length, rates: ratesFrom(accumulator) };
}
