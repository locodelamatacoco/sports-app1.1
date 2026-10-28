// scripts/fit-player-blend.js
//
// Fit the prior-games-equivalent k for blending a player's current-season
// per-minute rate toward last season's.
//
//   node scripts/fit-player-blend.js
//
// Walk-forward and causal: each appearance is predicted from the player's
// games BEFORE it plus their prior season, never including the game itself.
// Prediction is per-minute rate times the minutes actually played, so this
// measures the rate estimate and not a minutes forecast.
//
// k = 0 is the model as it stood on 2026-10-28: current season only, no prior.
// That is what read Mikal Bridges at 5.5 points against an 11.5 line, so the
// question this answers is how much of a four-game sample to believe.

require('./_loader.cjs');

const { fetchSeasonRates } = require('../src/data/espnSeasonRates.js');
const { fetchPlayerPriors, priorBlendWeight } = require('../src/data/espnPlayerPriors.js');

const STATS = ['points', 'rebounds', 'assists'];
const MIN_MINUTES = 12; // an appearance short enough to be noise either way

async function main() {
  const month = process.argv[2] ?? '202610';
  const priorSeason = Number(process.argv[3] ?? 2026);

  const season = await fetchSeasonRates({ months: [month] });
  const all = Object.values(season.rates);
  // Players with enough of a role for the question to matter.
  const pool = all.filter((r) => r.minutesPerGame >= 18 && (r.perGame?.length ?? 0) >= 2);
  console.log(
    `${season.games} games walked, ${all.length} players, ${pool.length} with a role\n` +
      `fetching ${priorSeason - 1}-${String(priorSeason).slice(2)} priors...`
  );

  const priors = await fetchPlayerPriors({ players: pool, season: priorSeason });
  const withPrior = pool.filter((r) => priors[r.player]);
  console.log(`${withPrior.length} of ${pool.length} have a prior season\n`);

  const Ks = [0, 1, 2, 3, 4, 6, 8, 12, 16, 24, 40, 1e9];
  const results = [];
  for (const k of Ks) {
    const err = Object.fromEntries(STATS.map((s) => [s, { se: 0, ae: 0, n: 0 }]));
    for (const rate of withPrior) {
      const prior = priors[rate.player];
      const games = rate.perGame.slice();
      // Running totals of games strictly before the one being predicted.
      const acc = { minutes: 0, n: 0, ...Object.fromEntries(STATS.map((s) => [s, 0])) };
      for (const g of games) {
        if (acc.n >= 1 && g.minutes >= MIN_MINUTES) {
          const w = priorBlendWeight(acc.n, k);
          for (const stat of STATS) {
            const cur = acc.minutes > 0 ? acc[stat] / acc.minutes : null;
            const pri = prior.perMinute?.[stat];
            if (cur == null || pri == null) continue;
            const rateHat = k >= 1e9 ? pri : cur * w + pri * (1 - w);
            const predicted = rateHat * g.minutes;
            const actual = g[stat];
            err[stat].se += (predicted - actual) ** 2;
            err[stat].ae += Math.abs(predicted - actual);
            err[stat].n += 1;
          }
        }
        acc.n += 1;
        acc.minutes += g.minutes;
        for (const stat of STATS) acc[stat] += g[stat];
      }
    }
    results.push({
      k,
      per: Object.fromEntries(
        STATS.map((s) => [s, { rmse: Math.sqrt(err[s].se / err[s].n), mae: err[s].ae / err[s].n, n: err[s].n }])
      ),
    });
  }

  const label = (k) => (k === 0 ? 'this season only' : k >= 1e9 ? 'prior season only' : `k=${k}`);
  console.log('   weighting              points RMSE   reb RMSE   ast RMSE     n');
  for (const r of results) {
    console.log(
      `  ${label(r.k).padEnd(22)} ${r.per.points.rmse.toFixed(3).padStart(10)} ` +
        `${r.per.rebounds.rmse.toFixed(3).padStart(10)} ${r.per.assists.rmse.toFixed(3).padStart(10)}` +
        `  ${String(r.per.points.n).padStart(5)}`
    );
  }
  for (const stat of STATS) {
    const best = results.slice().sort((a, b) => a.per[stat].rmse - b.per[stat].rmse)[0];
    const none = results.find((r) => r.k === 0);
    console.log(
      `\nbest for ${stat}: ${label(best.k)} at RMSE ${best.per[stat].rmse.toFixed(3)} ` +
        `vs ${none.per[stat].rmse.toFixed(3)} for this season alone ` +
        `(${(100 * (1 - best.per[stat].rmse / none.per[stat].rmse)).toFixed(1)}% better)`
    );
  }
  console.log(
    `\nWith ${results[0].per.points.n} predicted appearances this is a rough fit, not a settled` +
      '\nconstant; re-run it as the season lengthens.'
  );
}

main().catch((err) => {
  console.error('Player blend fit failed:', err.message ?? err);
  process.exit(1);
});
