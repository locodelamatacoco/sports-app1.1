// scripts/fit-prop-anchor.js
//
// How much should a prop projection lean on the book's own line?
//
//   node scripts/fit-prop-anchor.js
//
// Over 900+ graded prop leans the biggest model-vs-book gaps lost the most
// (raw edge 15%+: -16.1% ROI, t -2.38): when the two disagree a lot, the book
// is usually the one that is right. Game projections already lean 35% toward
// the market for this reason; props did not lean at all.
//
// Each logged prop is one player-stat-line with the model's simulated mean,
// the posted line and what happened. The anchored projection is
// (1 - w) x model + w x line, and this finds the w that predicts the outcome
// best. Nights are split in half by date to check the answer holds.

require('./_loader.cjs');

const axios = require('axios');
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'board-log');
const SUMMARY = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary';

async function main() {
  const files = fs.readdirSync(DIR).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
  const rows = [];
  for (const f of files) {
    const snap = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
    for (const g of snap.games) {
      // Logs from 2026-11-09 on carry the raw model mean separately; before
      // that, simulatedMean WAS the raw model mean.
      const props = g.markets
        .filter((m) => m.market === 'prop' && (m.modelMean ?? m.simulatedMean) != null && m.line != null)
        .map((m) => ({ ...m, simulatedMean: m.modelMean ?? m.simulatedMean }));
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
      const seen = new Set();
      for (const m of props) {
        const key = `${m.player}:${m.stat}:${m.line}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const actual = box[m.player]?.[m.stat];
        if (actual == null) continue;
        rows.push({ date: snap.slateDate, stat: m.stat, model: m.simulatedMean, line: m.line, actual });
      }
    }
  }
  const dates = [...new Set(rows.map((r) => r.date))].sort();
  const cut = dates[Math.floor(dates.length / 2)];
  const halves = { all: rows, early: rows.filter((r) => r.date < cut), late: rows.filter((r) => r.date >= cut) };
  console.log(`${rows.length} graded prop lines over ${dates.length} nights (split at ${cut})\n`);

  const rmse = (v, w) => Math.sqrt(v.reduce((a, r) => a + ((1 - w) * r.model + w * r.line - r.actual) ** 2, 0) / v.length);
  const W = [0, 0.2, 0.35, 0.5, 0.65, 0.8, 0.9, 1];
  console.log('  weight on the line     all      early      late');
  for (const w of W) {
    const tag = w === 0 ? ' (in force)' : w === 1 ? ' (line alone)' : '';
    console.log(`  w=${w.toFixed(2)}${tag.padEnd(14)} ${rmse(halves.all, w).toFixed(3).padStart(7)}  ${rmse(halves.early, w).toFixed(3).padStart(8)}  ${rmse(halves.late, w).toFixed(3).padStart(8)}`);
  }
  for (const [name, v] of Object.entries(halves)) {
    const best = W.slice().sort((a, b) => rmse(v, a) - rmse(v, b))[0];
    console.log(`  best for ${name.padEnd(6)} w=${best}`);
  }
  for (const stat of ['points', 'rebounds']) {
    const v = rows.filter((r) => r.stat === stat);
    if (v.length < 30) continue;
    const best = W.slice().sort((a, b) => rmse(v, a) - rmse(v, b))[0];
    console.log(`  ${stat.padEnd(9)} n=${v.length}  model alone ${rmse(v, 0).toFixed(3)}  line alone ${rmse(v, 1).toFixed(3)}  best w=${best} (${rmse(v, best).toFixed(3)})`);
  }
}

main().catch((err) => { console.error('Anchor fit failed:', err.stack ?? err.message ?? err); process.exit(1); });
