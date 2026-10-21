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
// Reports two things separately, because they answer different questions:
//   - every priced market, which measures whether the model's lean is right
//   - the bets that actually qualified, which is the only line that reflects
//     what the model told you to do

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
        const outcome = settleMarket(market, final.away, final.home);
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
        const outcome = settleMarket(market, final.away, final.home);
        if (outcome !== null) record(qualifying, outcome, market.price);
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
}

main().catch((err) => {
  console.error('Failed to grade:', err.message ?? err);
  process.exit(1);
});
