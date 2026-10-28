// scripts/grade-board.js
//
// Grade past board snapshots against final scores.
//
//   node scripts/grade-board.js          # every log found
//   node scripts/grade-board.js 2026-10-21
//
// Only settles markets whose outcome a final score determines — moneyline,
// spread, total, and their alternates. Player props need box scores and are
// counted as unsettled rather than guessed at.
//
// Reports three things separately, because they answer different questions:
//   - every priced market, which measures whether the model's lean is right
//   - the bets that actually qualified, which is the only line that reflects
//     what the model told you to do
//   - the rows published in chat as the slate's Top 5, which is what someone
//     reading along would actually have bet. That record has been the worst of
//     the three, and computing it by hand every slate is how it drifted out of
//     view; it is graded here so the question answers itself.

require('./_loader.cjs');

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const {
  settleMarket,
  emptyTally,
  recordOutcome,
  tallySummary,
} = require('../src/models/settle.js');

const LOG_DIR = path.join(__dirname, '..', 'board-log');
const SCOREBOARD =
  'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard';
const SUMMARY = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary';

// Player lines from a game's box score, keyed by display name. Needed because
// a final score cannot settle a player prop.
async function boxScoresFor(espnId) {
  const { data } = await axios.get(`${SUMMARY}?event=${espnId}`);
  const out = {};
  for (const teamBlock of data.boxscore?.players ?? []) {
    for (const group of teamBlock.statistics ?? []) {
      const keys = group.keys ?? [];
      const at = (stats, key) => {
        const i = keys.indexOf(key);
        if (i < 0) return null;
        // "7-12" for made-attempted pairs; the made count is what props use.
        const n = Number(String(stats[i]).split('-')[0]);
        return Number.isFinite(n) ? n : null;
      };
      for (const athlete of group.athletes ?? []) {
        const name = athlete.athlete?.displayName;
        const stats = athlete.stats ?? [];
        if (!name || stats.length === 0) continue;
        if (at(stats, 'minutes') == null) continue; // did not play
        out[name] = {
          points: at(stats, 'points'),
          rebounds: at(stats, 'rebounds'),
          assists: at(stats, 'assists'),
          steals: at(stats, 'steals'),
          blocks: at(stats, 'blocks'),
          threes: at(stats, 'threePointFieldGoalsMade-threePointFieldGoalsAttempted'),
        };
      }
    }
  }
  return out;
}

async function finalsFor(dates) {
  const byId = new Map();
  for (const date of dates) {
    const stamp = date.replace(/-/g, '');
    const { data } = await axios.get(`${SCOREBOARD}?dates=${stamp}&limit=1000`);
    for (const event of data.events ?? []) {
      if (!event.status?.type?.completed) continue;
      const c = event.competitions?.[0];
      const home = c?.competitors?.find((x) => x.homeAway === 'home');
      const away = c?.competitors?.find((x) => x.homeAway === 'away');
      if (home?.score == null || away?.score == null) continue;
      byId.set(String(event.id), { home: Number(home.score), away: Number(away.score) });
    }
  }
  return byId;
}

const tally = emptyTally;
const record = recordOutcome;

function show(name, t) {
  if (t.n === 0) {
    console.log(`  ${name.padEnd(22)} nothing settled`);
    return;
  }
  const s = tallySummary(t);
  const rate = s.winRate == null ? '-' : (100 * s.winRate).toFixed(1);
  const roi = s.roi == null ? '-' : (100 * s.roi).toFixed(1);
  console.log(
    `  ${name.padEnd(22)} ${s.won}-${s.lost}${s.push ? `-${s.push}` : ''} ` +
      `(${rate}%)  ${s.units >= 0 ? '+' : ''}${s.units.toFixed(2)}u  ROI ${roi}%`
  );
}

async function main() {
  const only = process.argv[2];
  if (!fs.existsSync(LOG_DIR)) {
    console.log('No board-log directory yet — run scripts/log-board.js before a slate.');
    return;
  }
  const files = fs
    .readdirSync(LOG_DIR)
    .filter((f) => f.endsWith('.json'))
    .filter((f) => !only || f === `${only}.json`)
    .sort();

  if (files.length === 0) {
    console.log('No matching board logs.');
    return;
  }

  const snapshots = files.map((f) => JSON.parse(fs.readFileSync(path.join(LOG_DIR, f), 'utf8')));
  const dates = [...new Set(snapshots.map((s) => s.slateDate).filter(Boolean))];
  const finals = await finalsFor(dates);

  const leaned = tally();
  const qualifying = tally();
  const called = tally();
  const calledRows = [];
  // Player projections are probabilities, not bets, so they are scored by
  // discrimination and Brier rather than units.
  const playerBuckets = [];
  let playerDnp = 0;
  const byKind = {};
  let unsettled = 0;
  let missingFinal = 0;
  let noLean = 0;

  for (const snap of snapshots) {
    for (const game of snap.games) {
      const final = finals.get(String(game.espnId));
      if (!final) {
        missingFinal += 1;
        continue;
      }

      // Only fetch a box score when the game actually has props logged.
      let boxScores = null;
      if (game.markets.some((m) => m.market === 'prop') || (game.players ?? []).length > 0) {
        try {
          boxScores = await boxScoresFor(game.espnId);
        } catch (err) {
          console.warn(`Box score unavailable for ${game.gameId}:`, err?.message ?? err);
        }
      }

      // Both sides of every market are logged, so grading all of them is
      // mechanically 50% and says nothing. Grade the ONE side the model
      // actually preferred in each market family.
      const families = new Map();
      for (const market of game.markets) {
        const key = `${market.market}:${market.line ?? ''}`;
        const best = families.get(key);
        if (!best || market.rawEdge > best.rawEdge) families.set(key, market);
      }

      for (const market of families.values()) {
        const outcome = settleMarket(market, final.away, final.home, boxScores);
        if (outcome === null) {
          unsettled += 1;
          continue;
        }
        // A model with no preference is not a lean worth counting.
        if (market.rawEdge <= 0) {
          noLean += 1;
          continue;
        }
        record(leaned, outcome, market.price);
        byKind[market.market] = byKind[market.market] ?? tally();
        record(byKind[market.market], outcome, market.price);
      }

      // Qualifying bets are graded as logged: these are specific
      // recommendations, not a family to pick a side from.
      for (const market of game.markets) {
        if (!market.qualifies) continue;
        const outcome = settleMarket(market, final.away, final.home, boxScores);
        if (outcome !== null) record(qualifying, outcome, market.price);
      }

      // Player projections. A box score is needed, and a player who did not
      // appear is void rather than a miss.
      for (const p of game.players ?? []) {
        if (!boxScores) break;
        const line = boxScores[p.player];
        if (!line || line.points == null) {
          playerDnp += 1;
          continue;
        }
        const tens = ['points', 'rebounds', 'assists'].filter(
          (stat) => (line[stat] ?? 0) >= 10
        ).length;
        playerBuckets.push({
          player: p.player,
          game: `${game.away}@${game.home}`,
          ddProb: p.doubleDouble,
          ddHit: tens >= 2,
          p20Prob: p.pointsAtLeast?.['20'] ?? p.pointsAtLeast?.[20] ?? null,
          p20Hit: (line.points ?? 0) >= 20,
          actual: line,
          projected: p.projected,
        });
      }

      // The published Top 5, matched back to the logged row by game and label.
      // Stored at log time precisely so recalibrating the model cannot rewrite
      // which rows were called.
      for (const top of snap.publishedTop5 ?? []) {
        if (top.gameId !== game.gameId) continue;
        const market = game.markets.find((m) => m.label === top.label);
        if (!market) continue;
        const outcome = settleMarket(market, final.away, final.home, boxScores);
        if (outcome === null) continue;
        record(called, outcome, market.price);
        calledRows.push({
          date: snap.slateDate,
          rank: top.rank,
          label: `${game.away}@${game.home} ${top.label}`,
          price: market.price,
          adjustedEdge: market.adjustedEdge,
          outcome,
        });
      }
    }
  }

  console.log(`Graded ${files.length} slate(s): ${files.join(', ')}`);
  if (missingFinal) console.log(`  ${missingFinal} game(s) not final yet — skipped`);
  if (unsettled) console.log(`  ${unsettled} market(s) need box scores (player props) — skipped`);

  if (noLean) console.log(`  ${noLean} market(s) where the model had no positive lean — skipped`);

  console.log('\nTHE SIDE THE MODEL LEANED (one per market family, raw edge > 0)');
  console.log('  Measures whether the projection is right, not whether it said to bet.');
  show('all leans', leaned);
  Object.entries(byKind)
    .sort((a, b) => b[1].n - a[1].n)
    .forEach(([kind, t]) => show(kind, t));

  console.log('\nQUALIFYING BETS ONLY (what the model actually told you to do)');
  show('qualifying', qualifying);
  if (qualifying.n === 0) {
    console.log('  The model passed on every market in these slates.');
  }

  if (playerBuckets.length > 0) {
    console.log('\nPLAYER PROJECTIONS (probabilities, so scored not staked)');
    console.log('  Brier: 0 is perfect, 0.25 is a coin flip on everything.');
    if (playerDnp) console.log(`  ${playerDnp} projected player(s) did not appear — void`);

    const score = (label, rows, probOf, hitOf) => {
      const usable = rows.filter((r) => probOf(r) != null);
      if (usable.length === 0) return;
      const hits = usable.filter(hitOf).length;
      const expected = usable.reduce((a, r) => a + probOf(r), 0);
      const brier = usable.reduce((a, r) => a + (probOf(r) - (hitOf(r) ? 1 : 0)) ** 2, 0) / usable.length;
      // Does a higher projected probability actually mean a likelier event?
      const sorted = usable.slice().sort((a, b) => probOf(b) - probOf(a));
      const topN = Math.max(1, Math.round(expected));
      const topHits = sorted.slice(0, topN).filter(hitOf).length;
      console.log(
        `  ${label.padEnd(18)} ${hits}/${usable.length} hit  expected ${expected.toFixed(1)}  ` +
          `Brier ${brier.toFixed(3)}  top ${topN} by model: ${topHits}/${topN}`
      );
      if (hits > expected * 1.15) console.log('      model UNDERconfident here');
      else if (hits < expected * 0.85) console.log('      model OVERconfident here');
    };

    score('double-double', playerBuckets, (r) => r.ddProb, (r) => r.ddHit);
    score('20+ points', playerBuckets, (r) => r.p20Prob, (r) => r.p20Hit);
  }

  console.log('\nCALLED SHOTS (the Top 5 rows published in chat)');
  console.log('  What someone reading along would have bet, qualifying or not.');
  show('called shots', called);
  calledRows
    .sort((a, b) => (a.date === b.date ? a.rank - b.rank : a.date < b.date ? -1 : 1))
    .forEach((r) => {
      // settleMarket returns a boolean, or 'push' — not a 'win'/'loss' string.
      const mark = r.outcome === 'push' ? 'PUSH' : r.outcome ? 'WIN ' : 'LOSS';
      console.log(
        `    ${mark} ${r.date} #${r.rank} ${r.label} ` +
          `(${r.price > 0 ? '+' : ''}${r.price}, adj ${(100 * r.adjustedEdge).toFixed(1)}%)`
      );
    });
}

main().catch((err) => {
  console.error('Failed to grade:', err.message ?? err);
  process.exit(1);
});
