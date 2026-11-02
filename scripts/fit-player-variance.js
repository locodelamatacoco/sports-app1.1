// scripts/fit-player-variance.js
//
// Fit how much a player's minutes swing night to night, by asking which
// assumption makes the model's probabilities come true.
//
//   node scripts/fit-player-variance.js
//
// The simulation drew every player's minutes with one 8% SD. Measured from
// this season's box scores, real night-to-night variation runs about 10% for
// 35-minute starters, 30% for 18-minute reserves and over 50% at the end of the
// bench. Too narrow a minutes draw makes every distribution too narrow, which
// is the failure seen on 2026-10-28: players the model gave a 1.8% chance of 20
// points got there 10.2% of the time.
//
// The raw measured spread is NOT used directly: four to eight games inflate a
// spread estimate, and blowouts — modelled separately — are inside it. Instead
// each candidate is scored walk-forward: every appearance is predicted from the
// player's earlier games plus last season (the k=12 blend in force), and the
// predicted probabilities of reaching 10/15/20/25/30 points and of a
// double-double are scored against what happened. The candidate with the best
// log loss wins.

require('./_loader.cjs');

const { fetchSeasonRates } = require('../src/data/espnSeasonRates.js');
const { fetchPlayerPriors, PLAYER_PRIOR_K, priorBlendWeight } = require('../src/data/espnPlayerPriors.js');
const { MODEL_CONSTANTS, STAT_SHAPES, roleMinutesSpread } = require('../src/models/nbaSimulator.js');
const { mulberry32, gammaSample, poissonSample, gaussianSample } = require('../src/models/oddsMath.js');

const DRAWS = 1500;
const THRESHOLDS = [10, 15, 20, 25, 30];
const BLOWOUT_RATE = 0.29; // the slate-average share of blowout sims

// Measured minutes spread by role lives in the simulator, so the fit and the
// model can never describe different curves. Candidates scale it.

function sampleStat(stat, mean, rand, pointsCv) {
  if (mean <= 0) return 0;
  const shape = stat === 'points' ? { kind: 'continuous', cv: pointsCv } : STAT_SHAPES[stat];
  if (shape.kind === 'continuous') {
    const k = 1 / (shape.cv * shape.cv);
    return gammaSample(rand, k, mean / k);
  }
  const phi = shape.phi ?? 1;
  if (phi <= 1) return poissonSample(mean, rand);
  const k = mean / (phi - 1);
  return poissonSample(mean * gammaSample(rand, k, 1 / k), rand);
}

async function main() {
  const season = await fetchSeasonRates({ months: ['202610', '202611'] });
  const pool = Object.values(season.rates).filter((r) => (r.perGame?.length ?? 0) >= 2);
  const priors = await fetchPlayerPriors({ players: pool, season: 2026 });
  console.log(`${season.games} games, ${pool.length} players, ${Object.keys(priors).length} with a prior season`);

  // Causal rows: each appearance after the first, predicted from before it.
  const rows = [];
  for (const rate of pool) {
    const prior = priors[rate.player] ?? null;
    const acc = { n: 0, minutes: 0, points: 0, rebounds: 0, assists: 0 };
    const games = rate.perGame.slice().sort((a, b) => String(a.date).localeCompare(String(b.date)));
    for (const g of games) {
      if (acc.n >= 1) {
        const w = prior ? priorBlendWeight(acc.n, PLAYER_PRIOR_K) : 1;
        const cur = (s) => acc[s] / Math.max(acc.minutes, 1);
        const per = (s) => (prior?.perMinute?.[s] != null ? cur(s) * w + prior.perMinute[s] * (1 - w) : cur(s));
        const mins = prior ? (acc.minutes / acc.n) * w + prior.minutesPerGame * (1 - w) : acc.minutes / acc.n;
        if (mins >= 8) {
          rows.push({
            date: g.date ?? '',
            mins,
            rate: { points: per('points'), rebounds: per('rebounds'), assists: per('assists') },
            actual: g,
          });
        }
      }
      acc.n += 1;
      acc.minutes += g.minutes;
      acc.points += g.points;
      acc.rebounds += g.rebounds;
      acc.assists += g.assists;
    }
  }
  console.log(`${rows.length} predicted appearances\n`);

  const scales = (process.env.SCALES ?? '0,0.65,1.0,1.2,1.4').split(',').map(Number);
  // 0.29 is the spread that was in force before this fit.
  const pointsCvs = (process.env.POINTS_CVS ?? '0.29,0.34,0.40,0.46').split(',').map(Number);
  const candidates = scales.map((k) =>
    k === 0
      ? { name: 'flat 0.08 (in force)', cv: () => 0.08 }
      : { name: `measured x${k.toFixed(2)}`, cv: (m) => Math.max(0.08, k * roleMinutesSpread(m)) }
  );

  // HALF=1 scores the first half of the season's appearances, HALF=2 the
  // second, so a winner can be checked for stability rather than taken from
  // one pass over everything.
  rows.sort((a, b) => (a.date < b.date ? -1 : 1));
  const half = process.env.HALF;
  const scored = half ? rows.slice(half === '1' ? 0 : Math.floor(rows.length / 2), half === '1' ? Math.floor(rows.length / 2) : rows.length) : rows;
  if (half) console.log(`scoring half ${half}: ${scored.length} appearances`);

  const results = [];
  for (const pointsCv of pointsCvs) {
    for (const cand of candidates) {
      const rand = mulberry32(2026);
      let logLoss = 0;
      let brier = 0;
      let n = 0;
      const buckets = new Map();
      const ddBuckets = new Map();
      for (const r of scored) {
        const cv = cand.cv(r.mins);
        const hits = new Array(THRESHOLDS.length).fill(0);
        let dd = 0;
        for (let d = 0; d < DRAWS; d += 1) {
          let m = r.mins * (1 + gaussianSample(rand, 0, cv));
          if (rand() < BLOWOUT_RATE) m *= MODEL_CONSTANTS.BLOWOUT_MINUTES_FACTOR;
          m = Math.min(Math.max(m, 0), 46);
          const p = sampleStat('points', r.rate.points * m, rand, pointsCv);
          const rb = sampleStat('rebounds', r.rate.rebounds * m, rand, pointsCv);
          const as = sampleStat('assists', r.rate.assists * m, rand, pointsCv);
          THRESHOLDS.forEach((t, i) => {
            if (p >= t) hits[i] += 1;
          });
          if ([p, rb, as].filter((v) => v >= 10).length >= 2) dd += 1;
        }
        const events = THRESHOLDS.map((t, i) => [hits[i] / DRAWS, r.actual.points >= t]);
        events.push([dd / DRAWS, [r.actual.points, r.actual.rebounds, r.actual.assists].filter((v) => v >= 10).length >= 2]);
        events.forEach(([prob, happened], idx) => {
          const p = Math.min(Math.max(prob, 1e-4), 1 - 1e-4);
          logLoss += happened ? -Math.log(p) : -Math.log(1 - p);
          brier += (prob - (happened ? 1 : 0)) ** 2;
          n += 1;
          const isDD = idx === THRESHOLDS.length;
          const key = Math.min(9, Math.floor(prob * 10));
          const map = isDD ? ddBuckets : buckets;
          const b = map.get(key) ?? { n: 0, pred: 0, hit: 0 };
          b.n += 1;
          b.pred += prob;
          b.hit += happened ? 1 : 0;
          map.set(key, b);
        });
      }
      results.push({ name: cand.name, pointsCv, logLoss: logLoss / n, brier: brier / n, buckets, ddBuckets });
    }
  }

  const base = results[0];
  console.log('minutes spread           points cv   log loss    Brier');
  for (const r of results) {
    const mark = r === base ? '  <- in force' : r.logLoss < base.logLoss ? `  ${(100 * (1 - r.logLoss / base.logLoss)).toFixed(1)}% better` : '';
    console.log(`  ${r.name.padEnd(24)} ${r.pointsCv.toFixed(2)}     ${r.logLoss.toFixed(4)}    ${r.brier.toFixed(4)}${mark}`);
  }
  const best = results.slice().sort((a, b) => a.logLoss - b.logLoss)[0];
  const show = (label, r) => {
    console.log(`\n${label}: ${r.name}, points cv ${r.pointsCv}`);
    console.log('  bucket      n    predicted   actual   (points thresholds)        dd: n   pred   actual');
    for (let k = 0; k <= 9; k += 1) {
      const b = r.buckets.get(k);
      const d = r.ddBuckets.get(k);
      if (!b && !d) continue;
      const bs = b ? `${String(b.n).padStart(5)}    ${(100 * b.pred / b.n).toFixed(1).padStart(5)}%   ${(100 * b.hit / b.n).toFixed(1).padStart(5)}%` : ''.padEnd(30);
      const ds = d ? `${String(d.n).padStart(5)}  ${(100 * d.pred / d.n).toFixed(1).padStart(5)}%  ${(100 * d.hit / d.n).toFixed(1).padStart(5)}%` : '';
      console.log(`  ${`${k * 10}-${k * 10 + 10}%`.padEnd(8)} ${bs}                ${ds}`);
    }
  };
  if (!process.env.QUIET) {
    show('IN FORCE', base);
    show('BEST', best);
  } else {
    console.log(`\nbest: ${best.name}, points cv ${best.pointsCv}  (log loss ${best.logLoss.toFixed(4)})`);
  }
}

main().catch((err) => {
  console.error('Variance fit failed:', err.stack ?? err.message ?? err);
  process.exit(1);
});
