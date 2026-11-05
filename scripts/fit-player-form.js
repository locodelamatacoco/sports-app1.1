// scripts/fit-player-form.js
//
// Two questions about a player's recent games, answered walk-forward before
// either is allowed into the model:
//
//   1. FORM. Should a player's last five games count for more than the rest
//      of their season? Each appearance is predicted from the player's games
//      before it (blended with last season at k=12, as in production), with
//      the current-season rate built as (1-f) x season-to-date + f x last-5.
//      f = 0 is the model in force. Prediction is rate x the minutes actually
//      played, so this scores the rate and not a minutes guess.
//
//   2. STREAKINESS. Is a player whose scoring has swung from game to game
//      harder to predict NEXT game than the model's spread already allows?
//      If so, the spec's "streaky player -3%" is earning its place; if not,
//      it is charging for noise the distribution already prices.
//
//   node scripts/fit-player-form.js

require('./_loader.cjs');

const { fetchSeasonRates } = require('../src/data/espnSeasonRates.js');
const { fetchPlayerPriors, PLAYER_PRIOR_K, priorBlendWeight } = require('../src/data/espnPlayerPriors.js');

const STATS = ['points', 'rebounds', 'assists'];
const LAST = 5;
const MIN_MINUTES = 12;

const mean = (v) => v.reduce((a, b) => a + b, 0) / v.length;
const sd = (v) => {
  const m = mean(v);
  return Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(v.length - 1, 1));
};

async function main() {
  const season = await fetchSeasonRates({ months: ['202610', '202611'] });
  const pool = Object.values(season.rates).filter((r) => (r.perGame?.length ?? 0) >= 3);
  const priors = await fetchPlayerPriors({ players: pool, season: 2026 });
  console.log(`${season.games} games, ${pool.length} players, ${Object.keys(priors).length} with a prior season\n`);

  // Causal rows: everything known before each appearance.
  const rows = [];
  for (const rate of pool) {
    const prior = priors[rate.player] ?? null;
    const games = rate.perGame.slice().sort((a, b) => String(a.date).localeCompare(String(b.date)));
    for (let i = 1; i < games.length; i += 1) {
      const g = games[i];
      if (g.minutes < MIN_MINUTES) continue;
      const before = games.slice(0, i);
      const recent = before.slice(-LAST);
      const per = (set, s) => set.reduce((a, x) => a + x[s], 0) / Math.max(set.reduce((a, x) => a + x.minutes, 0), 1);
      const ppmGames = before.filter((x) => x.minutes >= MIN_MINUTES).map((x) => x.points / x.minutes);
      rows.push({
        n: before.length,
        prior,
        actual: g,
        cur: Object.fromEntries(STATS.map((s) => [s, per(before, s)])),
        last: Object.fromEntries(STATS.map((s) => [s, per(recent, s)])),
        // Game-to-game spread of scoring rate, from games before this one.
        cv: ppmGames.length >= 4 && mean(ppmGames) > 0 ? sd(ppmGames) / mean(ppmGames) : null,
      });
    }
  }
  const informative = rows.filter((r) => r.n > LAST);
  console.log(`${rows.length} predicted appearances; ${informative.length} where last-5 differs from season-to-date\n`);

  const predict = (r, s, f) => {
    const curBlend = (1 - f) * r.cur[s] + f * r.last[s];
    const w = r.prior ? priorBlendWeight(r.n, PLAYER_PRIOR_K) : 1;
    const pri = r.prior?.perMinute?.[s];
    const rate = pri != null ? curBlend * w + pri * (1 - w) : curBlend;
    return rate * r.actual.minutes;
  };

  console.log('1. FORM — weight on the last five games (only appearances where it differs)');
  console.log('   f        points RMSE   reb RMSE   ast RMSE');
  const res = [];
  for (const f of [0, 0.25, 0.5, 0.75, 1]) {
    const e = Object.fromEntries(STATS.map((s) => [s, Math.sqrt(mean(informative.map((r) => (predict(r, s, f) - r.actual[s]) ** 2)))]));
    res.push({ f, ...e });
    console.log(`   ${f.toFixed(2)}${f === 0 ? ' (in force)' : '           '}  ${e.points.toFixed(3).padStart(8)}   ${e.rebounds.toFixed(3).padStart(8)}   ${e.assists.toFixed(3).padStart(8)}`);
  }
  const base = res[0];
  const best = res.slice().sort((a, b) => a.points - b.points)[0];
  // Paired check on points: is the best f's improvement more than noise?
  if (best.f !== 0) {
    const diffs = informative.map((r) => (predict(r, 'points', best.f) - r.actual.points) ** 2 - (predict(r, 'points', 0) - r.actual.points) ** 2);
    const t = mean(diffs) / (sd(diffs) / Math.sqrt(diffs.length));
    console.log(`   best f=${best.f}: points RMSE ${base.points.toFixed(3)} -> ${best.points.toFixed(3)}, paired t = ${t.toFixed(2)} (negative favours form)`);
  } else console.log('   best f=0: recent form adds nothing over season-to-date');

  console.log('\n2. STREAKINESS — next-game error by how much a player\'s scoring rate has swung');
  const withCv = rows.filter((r) => r.cv != null);
  const cuts = withCv.map((r) => r.cv).sort((a, b) => a - b);
  const q80 = cuts[Math.floor(cuts.length * 0.8)];
  const relErr = (r) => Math.abs(predict(r, 'points', 0) - r.actual.points) / Math.max(predict(r, 'points', 0), 1);
  const hi = withCv.filter((r) => r.cv >= q80).map(relErr);
  const lo = withCv.filter((r) => r.cv < q80).map(relErr);
  const t2 = (mean(hi) - mean(lo)) / Math.sqrt(sd(hi) ** 2 / hi.length + sd(lo) ** 2 / lo.length);
  console.log(`   ${withCv.length} appearances with 4+ prior games; streaky = top fifth, scoring-rate CV >= ${q80.toFixed(3)}`);
  console.log(`   streaky:     n=${hi.length}  mean relative points error ${(100 * mean(hi)).toFixed(1)}%`);
  console.log(`   the rest:    n=${lo.length}  mean relative points error ${(100 * mean(lo)).toFixed(1)}%`);
  console.log(`   difference ${(100 * (mean(hi) - mean(lo))).toFixed(1)} points, t = ${t2.toFixed(2)}`);
  console.log(t2 > 1.96 ? '   -> streaky players ARE harder to predict next game' : '   -> past swings do not predict a harder next game at this sample');

  // Bench players swing more AND miss by more in relative terms simply for
  // scoring less, so the raw comparison can be role in disguise. Control for
  // it twice: scale each miss by sqrt(expected points), the noise a count of
  // that size carries anyway, and rank streakiness WITHIN minutes bands so a
  // bench player is only compared with bench players.
  const bandOf = (r) => (r.actual.minutes < 20 ? 0 : r.actual.minutes < 28 ? 1 : 2);
  const scaled = (r) => Math.abs(predict(r, 'points', 0) - r.actual.points) / Math.sqrt(Math.max(predict(r, 'points', 0), 1));
  const hiS = [], loS = [];
  for (const b of [0, 1, 2]) {
    const grp = withCv.filter((r) => bandOf(r) === b);
    if (grp.length < 20) continue;
    const c = grp.map((r) => r.cv).sort((a, b2) => a - b2)[Math.floor(grp.length * 0.8)];
    for (const r of grp) (r.cv >= c ? hiS : loS).push(scaled(r));
  }
  const t3 = (mean(hiS) - mean(loS)) / Math.sqrt(sd(hiS) ** 2 / hiS.length + sd(loS) ** 2 / loS.length);
  console.log('\n   controlled for role (top fifth within each minutes band, misses scaled by sqrt of expected points):');
  console.log(`   streaky: n=${hiS.length}  scaled miss ${mean(hiS).toFixed(3)}   the rest: n=${loS.length}  scaled miss ${mean(loS).toFixed(3)}   t = ${t3.toFixed(2)}`);
  console.log(t3 > 1.645 ? '   -> survives the control (one-sided 5%): streakiness is its own uncertainty' : '   -> does not survive the control: the raw gap was role, not streakiness');
}

main().catch((err) => {
  console.error('Form fit failed:', err.stack ?? err.message ?? err);
  process.exit(1);
});
