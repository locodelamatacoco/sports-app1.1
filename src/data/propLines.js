// src/data/propLines.js
//
// Turn a night's posted prop lines into prop entries the simulator can price.
//
// Until this existed, props were priced in throwaway scripts and never
// logged, so a published read could not be graded — the failure the board log
// exists to prevent. Lines now live in board-log/lines/<date>.json, committed
// alongside the board, and log-board prices them through this module.
//
// Two decisions worth knowing:
//
//   - A player's TEAM comes from their own box scores, not from the line
//     source's matchup label. Line pages carry stale and mislabelled rows: one
//     served Jaylen Brown on a night Boston did not play. A player whose team
//     is not on tonight's slate is excluded rather than attached to the wrong
//     game.
//
//   - An over and an under posted at DIFFERENT lines are two markets, not one.
//     Line pages show the best price per side, usually from different books,
//     so "o23.5 -115 / u24.5 -119" becomes an over-only row at 23.5 and an
//     under-only row at 24.5, each judged against its own posted price.
//     Pairing them, or inventing a -110 for the missing side, misprices both.

import { seasonBaseline } from './espnSeasonRates';

const SUFFIXES = new Set(['jr', 'sr', 'ii', 'iii', 'iv', 'v']);

// Books and ESPN disagree on suffixes and punctuation ("Darius Acuff" against
// "Darius Acuff Jr.", "Trey Murphy" against "Trey Murphy III").
export function normalizeName(name) {
  return String(name ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[.'’]/g, '')
    .split(/[\s-]+/)
    .filter((part) => part && !SUFFIXES.has(part))
    .join(' ');
}

export function indexByName(rates) {
  const index = new Map();
  for (const [name, rate] of Object.entries(rates ?? {})) {
    const key = normalizeName(name);
    // Two players sharing a normalised name is ambiguous; drop both rather
    // than price one of them off the other's box scores.
    index.set(key, index.has(key) ? null : { name, rate });
  }
  return index;
}

// Split one posted row into the markets it actually represents.
export function marketsFromRow(row) {
  const over = row.over?.line != null && row.over?.price != null ? row.over : null;
  const under = row.under?.line != null && row.under?.price != null ? row.under : null;
  if (over && under && over.line === under.line) {
    return [{ line: over.line, over: over.price, under: under.price }];
  }
  const out = [];
  if (over) out.push({ line: over.line, over: over.price, under: null });
  if (under) out.push({ line: under.line, over: null, under: under.price });
  return out;
}

export function propsFromLines(lines, { games, rates, minutesVolatility = 0.08 } = {}) {
  const index = indexByName(rates);
  const byGame = new Map();
  const excluded = { unmatched: [], ambiguous: [], notPlaying: [], thinSample: [], noBaseline: [] };
  let priced = 0;

  for (const row of lines ?? []) {
    const hit = index.get(normalizeName(row.player));
    if (hit === undefined) {
      excluded.unmatched.push(row.player);
      continue;
    }
    if (hit === null) {
      excluded.ambiguous.push(row.player);
      continue;
    }
    const { name, rate } = hit;
    const game = (games ?? []).find(
      (g) => g.away?.code === rate.team || g.home?.code === rate.team
    );
    if (!game) {
      excluded.notPlaying.push(`${row.player} (${rate.team})`);
      continue;
    }
    if (!rate.usableSample) {
      excluded.thinSample.push(`${row.player} (${rate.games} games)`);
      continue;
    }
    const pace = rate.team === game.home.code ? game.home.ratings?.pace : game.away.ratings?.pace;
    const base = seasonBaseline(rate, row.stat, { pace });
    if (!base) {
      excluded.noBaseline.push(`${row.player} ${row.stat}`);
      continue;
    }

    for (const market of marketsFromRow(row)) {
      const list = byGame.get(game.id) ?? [];
      list.push({
        // The rate table's spelling, so grading finds the player in the box
        // score under the same name the projection used.
        player: name,
        stat: row.stat,
        line: market.line,
        over: market.over,
        under: market.under,
        baseline: base.baseline,
        projectedMinutes: base.projectedMinutes,
        minutesVolatility,
        flags: { ...base.flags },
      });
      byGame.set(game.id, list);
      priced += 1;
    }
  }

  return { byGame, priced, excluded };
}
