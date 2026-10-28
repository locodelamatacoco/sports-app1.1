// src/data/espnPlayerPriors.js
//
// Prior-season per-minute rates for a player.
//
// Early in a season a player's own rates are the wrong thing to project from.
// On 2026-10-28, four games in, the prop model read Mikal Bridges at 5.5 points
// a game against a posted line of 11.5 and called it a 28% edge. The rate was
// arithmetically correct — 22 points in 122 minutes — and completely wrong as a
// forecast. The market was pricing a full prior; the model had none.
//
// This supplies one: ESPN's athlete stats carry per-season averages, so last
// season's minutes and per-minute production are a request away. Blending the
// two is what makes an early-season prop projection mean anything, and the
// weight is fitted rather than assumed — see scripts/fit-player-blend.js.

import axios from 'axios';

export const ATHLETE_STATS =
  'https://site.web.api.espn.com/apis/common/v3/sports/basketball/nba/athletes';

// Stats the prop model projects, mapped to ESPN's average-column names.
const AVERAGE_COLUMNS = {
  points: 'avgPoints',
  rebounds: 'avgRebounds',
  assists: 'avgAssists',
  steals: 'avgSteals',
  blocks: 'avgBlocks',
};

export function priorFromStats(payload, season) {
  const averages = payload?.categories?.find((c) => c.name === 'averages');
  if (!averages) return null;
  const names = averages.names ?? [];
  const minutesIdx = names.indexOf('avgMinutes');
  const gamesIdx = names.indexOf('gamesPlayed');
  if (minutesIdx < 0) return null;

  // A player can have several rows for one season after a trade. Take the row
  // with the most games, which is the one that describes their season.
  const rows = (averages.statistics ?? []).filter(
    (row) => Number(row.season?.year) === season
  );
  if (rows.length === 0) return null;
  const row = rows.reduce((best, r) => {
    const g = Number(r.stats?.[gamesIdx] ?? 0);
    return g > Number(best.stats?.[gamesIdx] ?? 0) ? r : best;
  }, rows[0]);

  const minutes = Number(row.stats?.[minutesIdx]);
  const games = gamesIdx < 0 ? null : Number(row.stats?.[gamesIdx]);
  if (!Number.isFinite(minutes) || minutes <= 0) return null;

  const perMinute = {};
  for (const [stat, column] of Object.entries(AVERAGE_COLUMNS)) {
    const i = names.indexOf(column);
    if (i < 0) continue;
    const v = Number(row.stats?.[i]);
    if (Number.isFinite(v)) perMinute[stat] = v / minutes;
  }

  return {
    season,
    games: Number.isFinite(games) ? games : null,
    minutesPerGame: minutes,
    perMinute,
  };
}

export async function fetchPlayerPrior({ athleteId, season, client = axios, signal } = {}) {
  if (!athleteId) return null;
  try {
    const { data } = await client.get(`${ATHLETE_STATS}/${athleteId}/stats`, { signal });
    return priorFromStats(data, season);
  } catch (err) {
    return null;
  }
}

// Priors for many players at once, keyed by display name.
export async function fetchPlayerPriors({
  players,
  season,
  client = axios,
  signal,
  concurrency = 6,
} = {}) {
  const out = {};
  const queue = [...(players ?? [])].filter((p) => p.athleteId);
  let cursor = 0;
  const worker = async () => {
    while (cursor < queue.length) {
      const entry = queue[cursor];
      cursor += 1;
      const prior = await fetchPlayerPrior({ athleteId: entry.athleteId, season, client, signal });
      if (prior) out[entry.player] = prior;
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, worker));
  return out;
}

// Prior-games-equivalent, fitted by scripts/fit-player-blend.js over 524
// causally predicted appearances: at n games played this season the current
// rate gets n/(n+12) of the weight.
//
// The fit is emphatic about how wrong the unblended version was. Predicting
// points from this season alone scored RMSE 7.368; k=12 scores 5.510, a 25%
// improvement, and LAST SEASON ALONE scores 5.539 — better than this season's
// own four games. Rebounds agree on 12, assists prefer 6, and the curve is
// flat from 8 to 24, so this is not perched on a spike.
export const PLAYER_PRIOR_K = 12;

// Weight this season's own rate earns against the prior season, at n games.
// `k` is the prior-games-equivalent.
export function priorBlendWeight(games, k) {
  const n = games ?? 0;
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n / (n + k);
}

// Blend a current-season rate table toward a prior-season one.
export function blendPlayerRate(rate, prior, k) {
  if (!rate) return rate;
  if (!prior) return { ...rate, priorBlendWeight: 1, priorSeasonGames: null };
  const w = priorBlendWeight(rate.games, k);
  const perMinute = { ...rate.perMinute };
  for (const stat of Object.keys(perMinute)) {
    const cur = perMinute[stat];
    const pri = prior.perMinute?.[stat];
    if (cur == null || !Number.isFinite(cur) || pri == null || !Number.isFinite(pri)) continue;
    perMinute[stat] = cur * w + pri * (1 - w);
  }
  // Minutes regress too: a four-game minutes load is as noisy as the scoring.
  const minutesPerGame =
    rate.minutesPerGame * w + (prior.minutesPerGame ?? rate.minutesPerGame) * (1 - w);
  return {
    ...rate,
    perMinute,
    minutesPerGame,
    priorBlendWeight: w,
    priorSeasonGames: prior.games ?? null,
    sampleNote:
      `${rate.games} game${rate.games === 1 ? '' : 's'} this season blended ` +
      `${(100 * w).toFixed(0)}/${(100 * (1 - w)).toFixed(0)} with ${prior.season - 1}-${String(prior.season).slice(2)}`,
  };
}


// Blend a whole rate table against its priors. Players with no prior season
// keep their own rate and say so, rather than silently reading as settled.
export function applyPriors(rates, priors, k = PLAYER_PRIOR_K) {
  const out = {};
  for (const [name, rate] of Object.entries(rates ?? {})) {
    out[name] = blendPlayerRate(rate, priors?.[name] ?? null, k);
  }
  return out;
}
