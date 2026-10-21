// scripts/backtest.js
//
// Re-run the out-of-sample backtest against live ESPN data.
//
//   node scripts/backtest.js            # 2024-25 ratings -> 2025-26 games
//   node scripts/backtest.js 2025 2026  # prior season, then target season
//
// Ratings always come from the season BEFORE the games being predicted, which
// is the shape the model runs in production. Rating a season from its own
// results and then predicting it would flatter the model and mean nothing.

require('./_loader.cjs');

const axios = require('axios');
const { ratingsFromStandings } = require('../src/data/espnRatings.js');
const { backtest, constantsReport } = require('../src/models/backtest.js');
const { MODEL_CONSTANTS } = require('../src/models/nbaSimulator.js');

const STANDINGS = 'https://site.api.espn.com/apis/v2/sports/basketball/nba/standings';
const SCOREBOARD = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard';

// A season runs October to June; the scoreboard accepts a whole month at a
// time, so the year is covered in a handful of requests rather than ~250.
function monthsFor(seasonEndYear) {
  const start = seasonEndYear - 1;
  return [
    `${start}10`, `${start}11`, `${start}12`,
    `${seasonEndYear}01`, `${seasonEndYear}02`, `${seasonEndYear}03`, `${seasonEndYear}04`,
  ];
}

async function fetchFinals(seasonEndYear) {
  const seen = new Map();
  for (const month of monthsFor(seasonEndYear)) {
    const { data } = await axios.get(`${SCOREBOARD}?dates=${month}&limit=1000`);
    for (const event of data.events ?? []) {
      if (!event.status?.type?.completed) continue;
      if (event.season?.type !== 2) continue; // regular season only
      const c = event.competitions?.[0];
      const home = c?.competitors?.find((x) => x.homeAway === 'home');
      const away = c?.competitors?.find((x) => x.homeAway === 'away');
      if (home?.score == null || away?.score == null) continue;
      const date = event.date.slice(0, 10);
      const key = `${date}-${away.team.abbreviation}-${home.team.abbreviation}`;
      if (seen.has(key)) continue;
      seen.set(key, {
        date,
        away: away.team.abbreviation,
        home: home.team.abbreviation,
        as: Number(away.score),
        hs: Number(home.score),
      });
    }
  }
  return [...seen.values()];
}

async function main() {
  const priorSeason = Number(process.argv[2] ?? 2025);
  const targetSeason = Number(process.argv[3] ?? 2026);

  const { data: standings } = await axios.get(`${STANDINGS}?season=${priorSeason}`);
  const prior = ratingsFromStandings(standings);
  const fixtures = await fetchFinals(targetSeason);

  console.log(
    `Ratings from ${priorSeason - 1}-${String(priorSeason).slice(2)} ` +
      `(${prior.count} teams), predicting ${targetSeason - 1}-${String(targetSeason).slice(2)} ` +
      `(${fixtures.length} games)\n`
  );

  const r = backtest(fixtures, prior.teams, { leagueContext: prior.league });
  const f = (x, d = 2) => (x == null ? '-' : x.toFixed(d));

  console.log(`Projected ${r.n} games, skipped ${r.skipped} for missing ratings\n`);
  console.log(`margin  bias ${f(r.margin.mean, 3)}  SD ${f(r.margin.sd)}  MAE ${f(r.margin.mae)}`);
  console.log(`total   bias ${f(r.total.mean, 3)}  SD ${f(r.total.sd)}  MAE ${f(r.total.mae)}`);
  console.log(
    `\nobserved home margin ${f(r.observedHomeCourt)}  mean total ${f(r.observedTotal)}`
  );
  console.log(
    `straight-up accuracy ${(100 * r.winAccuracy).toFixed(1)}%  ` +
      `(always-home baseline ${(100 * r.homeWinRate).toFixed(1)}%)`
  );

  const c = constantsReport(r);
  console.log('\nCONSTANTS  current -> measured');
  console.log(`  HOME_COURT_POINTS  ${c.homeCourt.current} -> ${f(c.homeCourt.suggested)}`);
  console.log(`  MARGIN_SD          ${c.marginSd.current} -> ${f(c.marginSd.measured)}`);
  console.log(`  TOTAL_SD           ${c.totalSd.current} -> ${f(c.totalSd.measured)}`);
  console.log(
    `  (shrinkage in force: margin ${MODEL_CONSTANTS.RATING_SHRINK_MARGIN}, ` +
      `total ${MODEL_CONSTANTS.RATING_SHRINK_TOTAL})`
  );

  const weighted = r.calibration.reduce((a, b) => a + Math.abs(b.gap) * b.n, 0) / r.n;
  console.log(`\nCALIBRATION  mean |gap| ${(100 * weighted).toFixed(2)} points`);
  r.calibration.forEach((b) =>
    console.log(
      `  ${`${(100 * b.lo).toFixed(0)}-${(100 * Math.min(b.hi, 1)).toFixed(0)}%`.padEnd(10)}` +
        ` n=${String(b.n).padStart(4)}  predicted ${(100 * b.predicted).toFixed(1)}%` +
        `  actual ${(100 * b.actual).toFixed(1)}%` +
        `  gap ${b.gap >= 0 ? '+' : ''}${(100 * b.gap).toFixed(1)}`
    )
  );
}

main().catch((err) => {
  console.error('Backtest failed:', err.message ?? err);
  process.exit(1);
});
