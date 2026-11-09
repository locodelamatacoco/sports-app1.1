// scripts/prop-segments.js
//
// Is there ANY slice of the prop leans that beats the book?
//
//   node scripts/prop-segments.js
//
// Grades every logged prop lean (the side the model preferred, raw edge > 0)
// and splits the record by raw-edge band, adjusted-edge band, stat, side and
// price. A slice is only worth acting on if it clears a bar corrected for the
// number of slices looked at — with a dozen cuts, one will look good by chance
// — AND has a reason it should work. Everything else is reported as noise.

require('./_loader.cjs');

const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { settleMarket, unitProfit } = require('../src/models/settle.js');

const DIR = path.join(__dirname, '..', 'board-log');
const SUMMARY = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary';

async function boxFor(espnId) {
  const { data } = await axios.get(`${SUMMARY}?event=${espnId}`);
  const box = {};
  for (const tb of data.boxscore?.players ?? []) for (const grp of tb.statistics ?? []) {
    const keys = grp.keys ?? [];
    for (const a of grp.athletes ?? []) {
      const n = a.athlete?.displayName;
      const st = a.stats ?? [];
      if (!n || !st.length) continue;
      const num = (k) => { const i = keys.indexOf(k); if (i < 0) return null; const v = Number(String(st[i]).split('-')[0]); return Number.isFinite(v) ? v : null; };
      if (num('minutes') == null) continue;
      box[n] = { points: num('points'), rebounds: num('rebounds'), assists: num('assists') };
    }
  }
  return box;
}

async function main() {
  const files = fs.readdirSync(DIR).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
  const rows = [];
  for (const f of files) {
    const snap = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
    for (const g of snap.games) {
      if (!g.markets.some((m) => m.market === 'prop')) continue;
      let box;
      try { box = await boxFor(g.espnId); } catch { continue; }
      const fam = new Map();
      for (const m of g.markets) {
        if (m.market !== 'prop') continue;
        const k = `${m.player}:${m.stat}:${m.line}`;
        const c = fam.get(k);
        if (!c || m.rawEdge > c.rawEdge) fam.set(k, m);
      }
      for (const m of fam.values()) {
        if (m.rawEdge <= 0) continue;
        const o = settleMarket(m, 0, 0, box);
        if (o === null || o === 'push') continue;
        rows.push({ date: snap.slateDate, stat: m.stat, side: m.side, price: m.price, raw: m.rawEdge, adj: m.adjustedEdge, veto: !!m.veto, units: unitProfit(m.price, o) });
      }
    }
  }

  const stats = (v) => {
    const n = v.length;
    const mu = v.reduce((a, r) => a + r.units, 0) / n;
    const sd = Math.sqrt(v.reduce((a, r) => a + (r.units - mu) ** 2, 0) / Math.max(n - 1, 1));
    return { n, units: mu * n, roi: mu, t: mu / (sd / Math.sqrt(n)) };
  };
  const slices = [];
  const add = (label, v) => { if (v.length >= 30) slices.push({ label, ...stats(v) }); };
  add('ALL prop leans', rows);
  add('not vetoed', rows.filter((r) => !r.veto));
  add('vetoed (line far from projection)', rows.filter((r) => r.veto));
  for (const [lo, hi] of [[0, 0.05], [0.05, 0.1], [0.1, 0.15], [0.15, 1]]) add(`raw edge ${lo * 100}-${hi === 1 ? '+' : hi * 100}%`, rows.filter((r) => r.raw >= lo && r.raw < hi));
  for (const [lo, hi] of [[-1, -0.1], [-0.1, -0.05], [-0.05, 1]]) add(`adjusted edge ${lo === -1 ? 'below' : lo * 100}${lo === -1 ? ' -10' : ' to ' + (hi === 1 ? '+' : hi * 100)}%`, rows.filter((r) => r.adj >= lo && r.adj < hi));
  add('points', rows.filter((r) => r.stat === 'points'));
  add('rebounds', rows.filter((r) => r.stat === 'rebounds'));
  add('overs', rows.filter((r) => r.side === 'over'));
  add('unders', rows.filter((r) => r.side === 'under'));
  add('plus-money prices', rows.filter((r) => r.price > 0));
  add('minus-money prices', rows.filter((r) => r.price < 0));

  const tests = slices.length - 1;
  // Bonferroni-corrected one-sided 5%: z for 0.05 / tests.
  const zCut = { 1: 1.645, 5: 2.33, 10: 2.58, 15: 2.71, 20: 2.81 };
  const need = zCut[Object.keys(zCut).map(Number).filter((k) => k <= tests).pop()] ?? 2.81;
  console.log(`${rows.length} graded prop leans over ${new Set(rows.map((r) => r.date)).size} nights; ${tests} slices tested, so a slice needs t > ${need} to count\n`);
  console.log('  slice                                   bets      units      ROI       t');
  for (const s of slices) {
    console.log(`  ${s.label.padEnd(38)} ${String(s.n).padStart(5)}  ${(s.units >= 0 ? '+' : '') + s.units.toFixed(2).padStart(7)}u  ${(100 * s.roi).toFixed(1).padStart(6)}%  ${s.t.toFixed(2).padStart(6)}${s.t > need ? '  <- clears the bar' : ''}`);
  }
  const winners = slices.slice(1).filter((s) => s.t > need);
  console.log(winners.length ? `\n${winners.length} slice(s) clear the corrected bar.` : '\nNo slice clears the corrected bar: nothing here beats the book beyond chance.');
}

main().catch((err) => { console.error('Segment test failed:', err.stack ?? err.message ?? err); process.exit(1); });
