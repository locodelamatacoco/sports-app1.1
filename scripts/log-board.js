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
const { analyzeSlate } = require('../src/models/nbaSimulator.js');

const OUT_DIR = path.join(__dirname, '..', 'board-log');
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

  const { results } = analyzeSlate(slate.games, { numSims: NUM_SIMS, seed: 2026 });

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
        // Props carry their own band; game markets read theirs off the game.
        simulatedMean: m.simulatedMean != null ? +m.simulatedMean.toFixed(2) : null,
        propBand: m.distribution
          ? [m.distribution.p10, m.distribution.median, m.distribution.p90]
          : null,
      })),
  }));

  // Rank every priced market across the slate exactly as the published Top 5
  // was derived, and store the rank. Re-deriving it later from stored edges
  // fails as soon as the model is recalibrated, which is precisely what
  // happened to the first logged slate.
  const ranked = record
    .flatMap((g) => g.markets.map((m) => ({ gameId: g.gameId, label: m.label, m })))
    .sort((a, b) => b.m.adjustedEdge - a.m.adjustedEdge);
  ranked.forEach((entry, index) => {
    entry.m.slateRank = index + 1;
  });

  const snapshot = {
    loggedAt: new Date().toISOString(),
    publishedTop5: ranked.slice(0, 5).map((e) => ({
      rank: e.m.slateRank,
      gameId: e.gameId,
      label: e.label,
      price: e.m.price,
      adjustedEdge: e.m.adjustedEdge,
    })),
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

  const priced = record.reduce((a, g) => a + g.markets.length, 0);
  const qualifying = record.reduce((a, g) => a + g.markets.filter((m) => m.qualifies).length, 0);
  console.log(`Logged ${record.length} games, ${priced} priced markets, ${qualifying} qualifying.`);
  console.log(path.relative(process.cwd(), file));
}

main().catch((err) => {
  console.error('Failed to log the board:', err.message ?? err);
  process.exit(1);
});
