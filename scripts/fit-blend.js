// scripts/fit-blend.js
//
// Measure what blending this season's form into last season's ratings is
// worth, and fit the constants it needs. Every number quoted for the blend
// comes from here, so it can be re-run rather than taken on trust.
//
//   node scripts/fit-blend.js          # fit on 2026, test on 2025
//   node scripts/fit-blend.js 2026 2025
//
// Two things make this honest:
//
//   - The walk-forward is strictly causal. A game is projected from its two
//     teams' results BEFORE it, never including it.
//   - Fitting and testing happen in DIFFERENT seasons. A within-season split
//     flatters the blend badly, because both halves share the same
//     accumulated team state: split that way the model reads 73.9%
//     straight-up and claims 88.9% in its 67.5% bucket, which would beat the
//     market outright. Across seasons the same setup reads 66%, which is
//     merely good. The first number is an artifact; this script exists so
//     nobody has to rediscover that.

require('./_loader.cjs');

const axios = require('axios');
const { ratingsFromStandings, CURRENT_SEASON_K, MIN_GAMES_FOR_BLEND, blendWeight } =
  require('../src/data/espnRatings.js');
const { calibrationBuckets, normalCdf } = require('../src/models/backtest.js');
const { MODEL_CONSTANTS } = require('../src/models/nbaSimulator.js');

const STANDINGS = 'https://site.api.espn.com/apis/v2/sports/basketball/nba/standings';
const SCOREBOARD = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard';

const monthsFor = (y) => [`${y - 1}10`, `${y - 1}11`, `${y - 1}12`, `${y}01`, `${y}02`, `${y}03`, `${y}04`];

async function fetchFinals(season) {
  const seen = new Map();
  for (const month of monthsFor(season)) {
    const { data } = await axios.get(`${SCOREBOARD}?dates=${month}&limit=1000`);
    for (const event of data.events ?? []) {
      if (!event.status?.type?.completed || event.season?.type !== 2) continue;
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
  return [...seen.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

// The possession identity without shrinkage, anchoring or home court, so the
// slope fitted against it IS the shrinkage the model should apply.
function rawMarginFor(home, away, leagueRating) {
  const poss = (home.pace + away.pace) / 2;
  const hOff = (home.pf / home.pace) * 100;
  const hDef = (home.pa / home.pace) * 100;
  const aOff = (away.pf / away.pace) * 100;
  const aDef = (away.pa / away.pace) * 100;
  const hs = ((hOff * (aDef / leagueRating)) / 100) * poss;
  const as = ((aOff * (hDef / leagueRating)) / 100) * poss;
  return hs - as;
}

function ols(xs, ys) {
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < n; i += 1) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
  }
  const slope = sxy / sxx;
  return { slope, intercept: my - slope * mx };
}

const sd = (v) => {
  const m = v.reduce((a, b) => a + b, 0) / v.length;
  return Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / (v.length - 1));
};

// Walk a season forward, emitting one row per game with the raw margin the
// ratings implied at that point and the blend weight they carried.
async function walkSeason(season, { blend }) {
  const { data: standings } = await axios.get(`${STANDINGS}?season=${season - 1}`);
  const prior = ratingsFromStandings(standings);
  const fixtures = await fetchFinals(season);
  const acc = {};
  const touch = (code) => {
    acc[code] = acc[code] ?? { n: 0, pf: 0, pa: 0 };
    return acc[code];
  };

  const rows = [];
  for (const f of fixtures) {
    const ha = touch(f.home);
    const aa = touch(f.away);
    const side = (code, state) => {
      const entry = prior.teams[code];
      if (!entry) return null;
      const w = blend ? blendWeight(state.n) : 0;
      if (w === 0) {
        return { pf: entry.pointsFor, pa: entry.pointsAgainst, pace: entry.ratings.pace, w: 0 };
      }
      return {
        pf: entry.pointsFor * (1 - w) + (state.pf / state.n) * w,
        pa: entry.pointsAgainst * (1 - w) + (state.pa / state.n) * w,
        pace: entry.ratings.pace,
        w,
      };
    };
    const h = side(f.home, ha);
    const a = side(f.away, aa);
    if (h && a) {
      rows.push({
        rawMargin: rawMarginFor(h, a, prior.league.rating),
        actMargin: f.hs - f.as,
        w: (h.w + a.w) / 2,
      });
    }
    ha.n += 1; ha.pf += f.hs; ha.pa += f.as;
    aa.n += 1; aa.pf += f.as; aa.pa += f.hs;
  }
  return rows;
}

function evaluate(name, fitRows, testRows, slopeFor) {
  const predict = (rows) => rows.map((r) => MODEL_CONSTANTS.HOME_COURT_POINTS + slopeFor(r.w) * r.rawMargin);
  const fitPred = predict(fitRows);
  const fitSd = sd(fitRows.map((r, i) => r.actMargin - fitPred[i]));
  const testPred = predict(testRows);
  const res = testRows.map((r, i) => r.actMargin - testPred[i]);
  const rmse = Math.sqrt(res.reduce((a, b) => a + b * b, 0) / res.length);
  const su = testRows.filter((r, i) => (testPred[i] > 0) === (r.actMargin > 0)).length / testRows.length;
  const cal = calibrationBuckets(
    testRows.map((r, i) => ({
      homeWinProb: Math.min(0.999, Math.max(0.001, normalCdf(testPred[i] / fitSd))),
      actualMargin: r.actMargin,
    }))
  );
  const gap = cal.reduce((a, b) => a + Math.abs(b.gap) * b.n, 0) / testRows.length;
  console.log(
    `  ${name.padEnd(30)} SD ${fitSd.toFixed(2)}  test RMSE ${rmse.toFixed(3)}  ` +
      `SU ${(100 * su).toFixed(1)}%  calib |gap| ${(100 * gap).toFixed(2)}pts`
  );
  return { fitSd, rmse, su, gap };
}

async function main() {
  const fitSeason = Number(process.argv[2] ?? 2026);
  const testSeason = Number(process.argv[3] ?? 2025);

  console.log(
    `Fitting on ${fitSeason - 1}-${String(fitSeason).slice(2)}, ` +
      `testing on ${testSeason - 1}-${String(testSeason).slice(2)}\n` +
      `k=${CURRENT_SEASON_K}, gate at ${MIN_GAMES_FOR_BLEND} games played\n`
  );

  const [fitPrior, testPrior, fitBlend, testBlend] = await Promise.all([
    walkSeason(fitSeason, { blend: false }),
    walkSeason(testSeason, { blend: false }),
    walkSeason(fitSeason, { blend: true }),
    walkSeason(testSeason, { blend: true }),
  ]);

  // Each regime's own fitted slope, so neither is handicapped by the other's.
  const priorFit = ols(fitPrior.map((r) => r.rawMargin), fitPrior.map((r) => r.actMargin));
  const atFullWeight = fitBlend.filter((r) => r.w > 0.7);
  const blendFit = ols(atFullWeight.map((r) => r.rawMargin), atFullWeight.map((r) => r.actMargin));

  console.log(`fitted shrinkage: prior-season ${priorFit.slope.toFixed(3)}, fully blended ${blendFit.slope.toFixed(3)}\n`);

  console.log('PRIOR-SEASON RATINGS ONLY');
  evaluate('flat shrink (in force)', fitPrior, testPrior, () => MODEL_CONSTANTS.RATING_SHRINK_MARGIN);

  console.log('\nBLENDED RATINGS');
  evaluate('flat shrink (wrong for these)', fitBlend, testBlend, () => MODEL_CONSTANTS.RATING_SHRINK_MARGIN);
  evaluate('shrink scaled by blend weight', fitBlend, testBlend, (w) =>
    MODEL_CONSTANTS.RATING_SHRINK_MARGIN +
    (MODEL_CONSTANTS.RATING_SHRINK_MARGIN_BLENDED - MODEL_CONSTANTS.RATING_SHRINK_MARGIN) * w
  );

  const ws = testBlend.map((r) => r.w).sort((a, b) => a - b);
  console.log(
    `\n${ws.filter((w) => w === 0).length} of ${ws.length} test games sat below the gate ` +
      `(median weight ${ws[Math.floor(ws.length / 2)].toFixed(2)})`
  );
  console.log(
    `constants in force: shrink ${MODEL_CONSTANTS.RATING_SHRINK_MARGIN} -> ` +
      `${MODEL_CONSTANTS.RATING_SHRINK_MARGIN_BLENDED}, ` +
      `MARGIN_SD ${MODEL_CONSTANTS.MARGIN_SD} -> ${MODEL_CONSTANTS.MARGIN_SD_BLENDED}`
  );
}

main().catch((err) => {
  console.error('Blend fit failed:', err.message ?? err);
  process.exit(1);
});
