// scripts/log-board.js
//
// Snapshot tonight's board BEFORE tip-off.
//
// ESPN strips odds from completed games, so a line not recorded before the
// game is gone for good. That is what stopped the backtest measuring
// profitability: there were no historical closing prices to beat. Running this
// nightly is the only way that question becomes answerable, and every night it
// is skipped is a night that can never be graded.
//
//   node scripts/log-board.js            # today
//   node scripts/log-board.js 20261022   # a specific date
//
// Writes board-log/YYYY-MM-DD.json. Re-running the same date overwrites it,
// so the last run before tip-off is the one that counts.

require('./_loader.cjs');

const fs = require('fs');
const path = require('path');
const { fetchNbaSlate } = require('../src/data/espnNba.js');
const { fetchSeasonRates } = require('../src/data/espnSeasonRates.js');
const { analyzeSlate, POINTS_THRESHOLDS } = require('../src/models/nbaSimulator.js');

const OUT_DIR = path.join(__dirname, '..', 'board-log');

// Below this a player's minutes make the projection noise rather than a read.
const MIN_MINUTES_TO_PROJECT = 18;

// Season-to-date box scores come from whole months; a slate in the first days
// of a month still needs the previous one.
function monthsFor(isoDate) {
  const [y, m] = isoDate.split('-').map(Number);
  const prev = m === 1 ? `${y - 1}12` : `${y}${String(m - 1).padStart(2, '0')}`;
  return [prev, `${y}${String(m).padStart(2, '0')}`];
}
// The run the board is reported from. Matching what is quoted in chat means a
// stored band can be checked against a published one.
const NUM_SIMS = 60000;

async function main() {
  // ESPN's default scoreboard can still be serving the previous slate, whose
  // games are final and therefore carry no odds. Always ask for an explicit
  // date so "tonight" means tonight.
  const dateArg = process.argv[2] ?? new Date().toISOString().slice(0, 10).replace(/-/g, '');
  // Normalise to YYYY-MM-DD: the feed omits its own date field when asked for
  // an explicit one, and the grader keys logs by ISO date.
  const isoDate = `${dateArg.slice(0, 4)}-${dateArg.slice(4, 6)}-${dateArg.slice(6, 8)}`;
  const slate = await fetchNbaSlate({ date: dateArg });

  if (slate.games.length === 0) {
    console.log('No games with priced markets found — nothing to log.');
    return;
  }

  // Player projections are published in chat, so they have to be recorded or
  // they cannot be graded later — the same reason the market lines are logged
  // before tip-off. 28 double-double and scoring calls went out on 2026-10-27
  // and none of them were written down anywhere.
  let season = { games: 0, rates: {} };
  try {
    season = await fetchSeasonRates({ months: monthsFor(isoDate) });
  } catch (err) {
    console.warn('Season player rates unavailable:', err?.message ?? err);
  }
  const usable = Object.values(season.rates).filter((r) => r.usableSample);

  const withPlayers = slate.games.map((game) => {
    const codes = [game.away.code, game.home.code];
    const players = usable
      .filter((r) => codes.includes(r.team) && r.minutesPerGame >= MIN_MINUTES_TO_PROJECT)
      .map((rate) => ({
        player: rate.player,
        team: rate.team,
        rate,
        pace: rate.team === game.home.code ? game.home.ratings.pace : game.away.ratings.pace,
        minutesVolatility: 0.08,
      }));
    return { ...game, players };
  });

  const { results } = analyzeSlate(withPlayers, { numSims: NUM_SIMS, seed: 2026 });

  // Record the price alongside the model's read. Only priced markets are worth
  // logging: an unpriced row cannot be graded against anything.
  const record = results.map((r) => ({
    gameId: r.game.id,
    espnId: r.game.espnId,
    label: r.game.label,
    tipoff: r.game.tipoff,
    book: r.game.book,
    away: r.game.away.code,
    home: r.game.home.code,
    projectedAway: +r.summary.predictedScore.away.toFixed(2),
    projectedHome: +r.summary.predictedScore.home.toFixed(2),
    projectedTotal: +r.summary.predictedTotal.toFixed(2),
    projectedMargin: +r.summary.predictedMargin.toFixed(2),
    unshrunkMargin: +r.projection.unshrunk.margin.toFixed(2),
    confidence: r.confidence,
    // The simulated spread, not only its mean. A projection stored without its
    // range cannot later be checked for the overconfidence the backtest found.
    distribution: {
      marginRange90: r.distribution.marginRange90,
      totalRange90: r.distribution.totalRange90,
      marginMedian: r.distribution.margin.median,
      totalMedian: r.distribution.total.median,
      marginQuartiles: [r.distribution.margin.p25, r.distribution.margin.p75],
      totalQuartiles: [r.distribution.total.p25, r.distribution.total.p75],
      coinFlipBand: +r.distribution.coinFlipBand.toFixed(4),
      blowout: +r.distribution.blowout.toFixed(4),
      overtime: +r.distribution.overtime.toFixed(4),
    },
    penaltyTotal: +r.penaltyTotal.toFixed(4),
    veto: r.veto,
    odds: r.game.odds,
    // Every player projection published for this game, so the double-double
    // and scoring calls are gradeable against a box score.
    players: (r.sim.playerResults ?? [])
      .filter((p) => !p.insufficientData)
      .map((p) => ({
        player: p.player,
        team: p.team,
        games: p.games,
        projectedMinutes: +p.minutes.toFixed(1),
        projected: {
          points: +p.simulatedMeans.points.toFixed(2),
          rebounds: +(p.simulatedMeans.rebounds ?? 0).toFixed(2),
          assists: +(p.simulatedMeans.assists ?? 0).toFixed(2),
        },
        doubleDouble: +p.doubleDouble.toFixed(4),
        tripleDouble: +p.tripleDouble.toFixed(4),
        atLeastTen: Object.fromEntries(
          Object.entries(p.atLeastTen).map(([k, v]) => [k, +v.toFixed(4)])
        ),
        pointsAtLeast: Object.fromEntries(
          POINTS_THRESHOLDS.map((t) => [t, +p.pointsAtLeast[t].toFixed(4)])
        ),
      }))
      .sort((a, b) => b.doubleDouble - a.doubleDouble),
    markets: [...r.markets, ...r.props, ...r.derived]
      .filter((m) => !m.insufficientData && m.priced !== false)
      .map((m) => ({
        label: m.label,
        market: m.market,
        side: m.side,
        line: m.line ?? m.prop?.line ?? null,
        // Recorded explicitly so grading never has to parse the label.
        player: m.prop?.player ?? null,
        stat: m.prop?.stat ?? null,
        threshold: m.prop?.threshold ?? null,
        price: m.price,
        modelProb: +m.settleProb.toFixed(4),
        impliedProb: +m.implied.toFixed(4),
        rawEdge: +m.rawEdge.toFixed(4),
        adjustedEdge: +m.adjustedEdge.toFixed(4),
        qualifies: m.qualifies,
        // Why a row is off the board, recorded per market. The slate-level
        // counter read this field before anything wrote it, so every log said
        // nothing had been screened out while the ceiling was in fact firing.
        veto: m.veto ?? null,
        // Props carry their own band; game markets read theirs off the game.
        simulatedMean: m.simulatedMean != null ? +m.simulatedMean.toFixed(2) : null,
        propBand: m.distribution
          ? [m.distribution.p10, m.distribution.median, m.distribution.p90]
          : null,
      })),
  }));

  // Rank by adjusted edge for ANALYSIS ONLY. This was the published Top 5
  // selector and it does not work: over six slates the top five went 4-11 for
  // -6.23u while ranks 6-40 went 25-17 for +9.73u, and both ranking signals
  // correlate with unit profit at roughly zero (raw edge -0.05, confidence
  // -0.10). The rank is still stored so `npm run diagnose` can keep testing
  // whether that stays true, but nothing is published off it.
  const ranked = record
    .flatMap((g) => g.markets.map((m) => ({ gameId: g.gameId, label: m.label, m })))
    .sort((a, b) => b.m.adjustedEdge - a.m.adjustedEdge);
  ranked.forEach((entry, index) => {
    entry.m.slateRank = index + 1;
  });

  // What is actually published as a bet: rows that clear BET_RULES, and
  // nothing else. A ranking the model cannot justify is not a recommendation.
  const published = record.flatMap((g) =>
    g.markets
      .filter((m) => m.qualifies)
      .map((m) => ({
        rank: m.slateRank,
        gameId: g.gameId,
        label: m.label,
        price: m.price,
        adjustedEdge: m.adjustedEdge,
      }))
  );

  const snapshot = {
    loggedAt: new Date().toISOString(),
    published,
    // The screen behind the output: every surviving row the model leans on.
    // Its record IS the "leans" line in the grader, which is the honest
    // measure of the projection as opposed to a selection from it.
    screenedOut: record.reduce((a, g) => a + g.markets.filter((m) => m.veto).length, 0),
    slateDate: slate.date ?? isoDate,
    numSims: NUM_SIMS,
    // Grading later has to know what the model believed at the time, or an
    // improvement to the model will silently rewrite its own history.
    constants: require('../src/models/nbaSimulator.js').MODEL_CONSTANTS,
    games: record,
  };

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const stamp = snapshot.slateDate;
  const file = path.join(OUT_DIR, `${stamp}.json`);
  fs.writeFileSync(file, `${JSON.stringify(snapshot, null, 2)}\n`);

  const projected = record.reduce((a, g) => a + g.players.length, 0);
  const priced = record.reduce((a, g) => a + g.markets.length, 0);
  const qualifying = record.reduce((a, g) => a + g.markets.filter((m) => m.qualifies).length, 0);
  console.log(
    `Logged ${record.length} games, ${priced} priced markets, ${qualifying} qualifying, ` +
      `${projected} player projections from ${season.games} box scores.`
  );
  console.log(path.relative(process.cwd(), file));
}

main().catch((err) => {
  console.error('Failed to log the board:', err.message ?? err);
  process.exit(1);
});
