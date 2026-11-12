// scripts/market-structure.js
//
// What the prop market itself looks like, with no model involved.
//
//   node scripts/market-structure.js
//
// Grades EVERY posted prop side in the logs at its posted price — not just
// the sides the model leaned on — and answers four questions a betting rule
// would have to rest on:
//
//   1. Is one side structurally better? (Overs are the public side.)
//   2. How much vig is left at the best posted price per side?
//   3. Do true arbitrages exist (same line, both sides adding to under 100%)?
//   4. Do middles pay (over posted at a lower line than the under; bet both)?
//
// The posted prices are the best available per side and may come from
// different books, so 3 and 4 need accounts at more than one book.

require('./_loader.cjs');

const axios = require('axios');
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'board-log');
const SUMMARY = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary';
const implied = (p) => (p > 0 ? 100 / (p + 100) : -p / (-p + 100));
const payout = (p) => (p > 0 ? p / 100 : 100 / -p);

function line(label, units, staked) {
  const n = units.length;
  if (n < 10) return console.log(`  ${label.padEnd(44)} n=${n}`);
  const mu = units.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(units.reduce((a, b) => a + (b - mu) ** 2, 0) / (n - 1)) || 1e-9;
  console.log(
    `  ${label.padEnd(44)} n=${String(n).padEnd(5)} ${(mu * n >= 0 ? '+' : '') + (mu * n).toFixed(2).padStart(7)}u  ` +
      `ROI ${((100 * mu) / staked).toFixed(1).padStart(5)}%  t=${(mu / (sd / Math.sqrt(n))).toFixed(2)}`
  );
}

async function main() {
  const rows = [];
  for (const f of fs.readdirSync(DIR).filter((x) => /^\d{4}-\d{2}-\d{2}\.json$/.test(x)).sort()) {
    const snap = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
    for (const g of snap.games) {
      const props = g.markets.filter((m) => m.market === 'prop' && m.line != null && m.player && (m.side === 'over' || m.side === 'under'));
      if (!props.length) continue;
      let data;
      try { ({ data } = await axios.get(`${SUMMARY}?event=${g.espnId}`)); } catch { continue; }
      const box = {};
      for (const tb of data.boxscore?.players ?? []) for (const grp of tb.statistics ?? []) {
        const keys = grp.keys ?? [];
        for (const a of grp.athletes ?? []) {
          const n = a.athlete?.displayName; const st = a.stats ?? [];
          if (!n || !st.length) continue;
          const num = (k) => { const i = keys.indexOf(k); if (i < 0) return null; const v = Number(String(st[i]).split('-')[0]); return Number.isFinite(v) ? v : null; };
          if (num('minutes') == null) continue;
          box[n] = { points: num('points'), rebounds: num('rebounds'), assists: num('assists') };
        }
      }
      for (const m of props) {
        const actual = box[m.player]?.[m.stat];
        if (actual == null) continue;
        const won = m.side === 'over' ? actual > m.line : actual < m.line;
        rows.push({ key: `${snap.slateDate}|${m.player}|${m.stat}`, side: m.side, stat: m.stat, line: m.line, price: m.price, actual, units: actual === m.line ? 0 : won ? payout(m.price) : -1 });
      }
    }
  }
  console.log(`${rows.length} graded prop sides\n`);

  console.log('1. EVERY POSTED SIDE AT ITS POSTED PRICE');
  for (const side of ['over', 'under']) line(`all ${side}s`, rows.filter((r) => r.side === side && r.actual !== r.line).map((r) => r.units), 1);
  for (const stat of ['points', 'rebounds']) for (const side of ['over', 'under'])
    line(`${stat} ${side}s`, rows.filter((r) => r.stat === stat && r.side === side && r.actual !== r.line).map((r) => r.units), 1);

  const groups = new Map();
  for (const r of rows) {
    const g = groups.get(r.key) ?? { over: [], under: [] };
    g[r.side].push(r);
    groups.set(r.key, g);
  }
  const holds = [];
  const arbs = [];
  const middles = { 1: [], 2: [] };
  const hits = { 1: [0, 0], 2: [0, 0] };
  for (const g of groups.values()) for (const o of g.over) for (const u of g.under) {
    if (o.line === u.line) {
      const hold = implied(o.price) + implied(u.price) - 1;
      holds.push(hold);
      if (hold < 0) arbs.push(o.units + u.units);
    } else if (o.line < u.line) {
      const gap = Math.min(2, Math.round(u.line - o.line));
      middles[gap].push(o.units + u.units);
      hits[gap][1] += 1;
      if (o.actual > o.line && o.actual < u.line) hits[gap][0] += 1;
    }
  }
  holds.sort((a, b) => a - b);
  console.log(`\n2. VIG LEFT AT THE BEST PRICE PER SIDE (${holds.length} lines posted two-sided)`);
  console.log(`  median hold ${(100 * holds[Math.floor(holds.length / 2)]).toFixed(1)}%; at or under 1%: ${holds.filter((h) => h <= 0.01).length}; below zero: ${holds.filter((h) => h < 0).length}`);
  console.log('\n3. ARBITRAGE: same line, both sides under 100% combined (1 unit each side)');
  line('all arbitrages', arbs, 2);
  console.log('\n4. MIDDLES: over at a lower line than the under (1 unit each side)');
  line('one point apart', middles[1], 2);
  line('two or more apart', middles[2], 2);
  for (const gap of [1, 2]) if (hits[gap][1]) console.log(`     landed in the middle ${hits[gap][0]}/${hits[gap][1]} (${((100 * hits[gap][0]) / hits[gap][1]).toFixed(1)}%)`);
}

main().catch((err) => { console.error('Market structure failed:', err.stack ?? err.message ?? err); process.exit(1); });
