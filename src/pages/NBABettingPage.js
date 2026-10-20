// src/pages/NBABettingPage.js
import React, { useCallback, useEffect, useState } from 'react';
import { analyzeSlate, formatAmerican, MODEL_CONSTANTS, BET_RULES } from '../models/nbaSimulator';
import { NBA_SLATE } from '../data/nbaGames';
import { fetchNbaSlate } from '../data/espnNba';

const NUM_SIMS = 20000;

const pct = (x, digits = 1) => `${(100 * x).toFixed(digits)}%`;
const signedPct = (x) => `${x >= 0 ? '+' : ''}${(100 * x).toFixed(1)}%`;
const signedPts = (x) => `${x >= 0 ? '+' : ''}${x.toFixed(1)}`;

function EdgeTag({ edge }) {
  const cls = edge >= 0.05 ? 'edge-pos' : edge <= -0.05 ? 'edge-neg' : 'edge-flat';
  return <span className={`nba-edge ${cls}`}>{signedPct(edge)}</span>;
}

function RecTag({ row }) {
  if (row.insufficientData) return <span className="nba-rec nba-rec-none">NO PLAY</span>;
  if (row.qualifies) return <span className="nba-rec nba-rec-bet">BET</span>;
  if (row.veto) return <span className="nba-rec nba-rec-veto">NO BET</span>;
  return <span className="nba-rec nba-rec-pass">PASS</span>;
}

function MarketTable({ rows, caption }) {
  return (
    <div className="nba-table-wrap">
      <table className="nba-table">
        <caption className="nba-table-caption">{caption}</caption>
        <thead>
          <tr>
            <th>Market</th>
            <th>Model</th>
            <th>Price</th>
            <th>Implied</th>
            <th>Raw edge</th>
            <th>Adj edge</th>
            <th>Call</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label} className={row.qualifies ? 'nba-row-bet' : undefined}>
              <td>
                {row.label}
                {row.prop && !row.insufficientData && (
                  <span className="nba-proj"> proj {row.simulatedMean.toFixed(1)}</span>
                )}
              </td>
              {row.insufficientData ? (
                <td colSpan={5} className="nba-insufficient">
                  No sourced baseline for this player — excluded from the board
                </td>
              ) : (
                <>
                  <td>{pct(row.settleProb)}</td>
                  <td>{formatAmerican(row.price)}</td>
                  <td>{pct(row.implied)}</td>
                  <td>
                    <EdgeTag edge={row.rawEdge} />
                  </td>
                  <td>
                    <EdgeTag edge={row.adjustedEdge} />
                  </td>
                </>
              )}
              <td>
                <RecTag row={row} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function GameCard({ analysis }) {
  const [showDetails, setShowDetails] = useState(false);
  const [showShop, setShowShop] = useState(false);
  const {
    game,
    sim,
    summary,
    projection,
    penalties,
    confidence,
    riskLevel,
    veto,
    markets,
    props,
    derived,
    bestBet,
  } = analysis;
  const shopRows = (derived ?? []).filter((r) => r.priced === false);
  const scoredDerived = (derived ?? []).filter((r) => r.priced);
  const o = game.odds;

  return (
    <div className="nba-game-card">
      <div className="nba-game-header">
        <span className="nba-game-label">
          {game.tipoff} · {game.venue}
        </span>
        <h2 className="nba-game-title">
          {game.away.name} @ {game.home.name}
        </h2>
        <span className="nba-game-odds">
          Board: {game.away.code} {formatAmerican(o.moneyline.away)} / {game.home.code}{' '}
          {formatAmerican(o.moneyline.home)} · {game.home.code}{' '}
          {o.spread.homeLine > 0 ? `+${o.spread.homeLine}` : o.spread.homeLine} · total {o.total.line} ·{' '}
          {sim.numSims.toLocaleString()} simulations
        </span>
      </div>

      {veto && <div className="nba-veto-banner">⛔ Game vetoed — {veto}</div>}

      <div className="nba-summary-grid">
        <div>
          <strong>Projected score:</strong> {game.away.code}{' '}
          {summary.predictedScore.away.toFixed(1)} — {game.home.code}{' '}
          {summary.predictedScore.home.toFixed(1)}
        </div>
        <div>
          <strong>Projected total:</strong> {summary.predictedTotal.toFixed(1)} (line {o.total.line})
        </div>
        <div>
          <strong>Projected margin:</strong> {summary.favorite} by{' '}
          {Math.abs(summary.predictedMargin).toFixed(1)}
        </div>
        <div>
          <strong>Moneyline:</strong> {game.home.code} {pct(summary.homeWinProb)} / {game.away.code}{' '}
          {pct(summary.awayWinProb)}
        </div>
        <div>
          <strong>Spread cover:</strong> {game.home.code} {pct(summary.homeCoverProb)} /{' '}
          {game.away.code} {pct(summary.awayCoverProb)}
        </div>
        <div>
          <strong>Total:</strong> over {pct(summary.overProb)} / under {pct(summary.underProb)}
        </div>
        <div>
          <strong>Possessions:</strong> {summary.possessions.toFixed(1)} model vs{' '}
          {projection.market.impliedPossessions
            ? projection.market.impliedPossessions.toFixed(1)
            : '—'}{' '}
          market-implied
        </div>
        <div>
          <strong>Blowout risk:</strong> {pct(summary.blowoutProb)} · OT {pct(summary.overtimeProb)}
        </div>
        {game.espnPredictor && (
          <div>
            <strong>ESPN predictor:</strong> {game.home.code}{' '}
            {pct(game.espnPredictor.home)} (independent read, not a model input)
          </div>
        )}
        <div>
          <strong>Confidence:</strong> {confidence}/10{' '}
          <span className={`nba-risk nba-risk-${riskLevel.toLowerCase()}`}>{riskLevel} risk</span>
        </div>
        <div>
          <strong>Best bet:</strong>{' '}
          {bestBet ? (
            <>
              {bestBet.label} {formatAmerican(bestBet.price)} <EdgeTag edge={bestBet.adjustedEdge} />
            </>
          ) : (
            'PASS — nothing clears the adjusted-edge gate'
          )}
        </div>
      </div>

      <MarketTable rows={markets} caption="Game markets" />
      {props.length > 0 && <MarketTable rows={props} caption="Player props" />}
      {scoredDerived.length > 0 && (
        <MarketTable rows={scoredDerived} caption="Team totals & alternate lines" />
      )}

      {shopRows.length > 0 && (
        <div className="nba-section">
          <button className="nba-details-toggle" onClick={() => setShowShop(!showShop)}>
            {showShop ? 'Hide' : 'Show'} {shopRows.length} model prices with no posted line
          </button>
          {showShop && (
            <>
              <p className="nba-note">
                The feed posts no price for these, so they carry the model's fair odds to shop
                against your own book rather than a verified edge. Supply prices in the slate data
                and they get scored like any other market.
              </p>
              <div className="nba-table-wrap">
                <table className="nba-table">
                  <thead>
                    <tr>
                      <th>Market</th>
                      <th>Model</th>
                      <th>Fair odds</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shopRows.map((row) => (
                      <tr key={row.label}>
                        <td>{row.label}</td>
                        <td>{pct(row.settleProb)}</td>
                        <td>{formatAmerican(row.fairOdds)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}

      <button className="nba-details-toggle" onClick={() => setShowDetails(!showDetails)}>
        {showDetails ? 'Hide' : 'Show'} confidence dampeners & projection detail
      </button>

      {showDetails && (
        <div className="nba-details">
          <h3>Confidence dampeners</h3>
          {penalties.length === 0 ? (
            <p className="nba-note">No penalties — clean inputs.</p>
          ) : (
            <ul className="nba-list">
              {penalties.map((p) => (
                <li key={p.reason}>
                  <span className="nba-penalty">−{pct(p.amount)}</span> {p.reason}
                </li>
              ))}
            </ul>
          )}

          {game.injuries?.length > 0 && (
            <>
              <h3>Injury report (live)</h3>
              <ul className="nba-list">
                {game.injuries.map((i) => (
                  <li key={`${i.team}-${i.player}`}>
                    {i.player} ({i.team}) — {i.status}
                    {i.detail ? `, ${i.detail}` : ''}
                    {i.starter ? ' · projected starter' : ''}
                  </li>
                ))}
              </ul>
            </>
          )}

          <h3>Projection detail</h3>
          <ul className="nba-list">
            <li>
              Expected possessions {projection.expectedPossessions.toFixed(1)} · pace factor{' '}
              {projection.paceFactor.toFixed(3)} · league average{' '}
              {MODEL_CONSTANTS.LEAGUE_AVG_PACE}
            </li>
            <li>
              Matchup-adjusted efficiency — {game.away.code}{' '}
              {projection.away.efficiency.toFixed(1)}, {game.home.code}{' '}
              {projection.home.efficiency.toFixed(1)} per 100 possessions
            </li>
            <li>
              Unanchored model line: {game.home.code} {signedPts(projection.raw.margin)}, total{' '}
              {projection.raw.total.toFixed(1)} · anchored{' '}
              {(100 * projection.anchorWeight).toFixed(0)}% toward the market
            </li>
            <li>
              Divergence vs market — margin{' '}
              {projection.divergence.margin == null
                ? '—'
                : `${signedPts(projection.divergence.margin)} pts`}
              , total{' '}
              {projection.divergence.total == null
                ? '—'
                : `${signedPts(projection.divergence.total)} pts`}
            </li>
            <li>
              Score variance — per-team SD {sim.variance.teamSd.toFixed(2)}, home/away correlation{' '}
              {sim.variance.correlation.toFixed(3)} (calibrated to a{' '}
              {MODEL_CONSTANTS.MARGIN_SD}-point margin SD and a {MODEL_CONSTANTS.TOTAL_SD}-point
              total SD)
            </li>
          </ul>
        </div>
      )}
    </div>
  );
}

export default function NBABettingPage() {
  const [slate, setSlate] = useState(null);
  const [source, setSource] = useState(null);
  const [running, setRunning] = useState(true);
  const [seed, setSeed] = useState(2026);

  // Pull the live board first; fall back to the hand-entered snapshot so the
  // page still renders something auditable if ESPN is unreachable.
  const load = useCallback(async () => {
    try {
      const live = await fetchNbaSlate({});
      if (live.games.length > 0) return { games: live.games, meta: live, live: true };
    } catch (err) {
      console.warn('ESPN slate unavailable, using offline snapshot:', err);
    }
    return { games: NBA_SLATE.games, meta: NBA_SLATE, live: false };
  }, []);

  const run = useCallback(
    async (simSeed) => {
      setRunning(true);
      const { games, meta, live } = await load();
      // Defer so the "running" state paints before the sims block the thread
      setTimeout(() => {
        setSource({ live, date: meta.date, book: games[0]?.book, count: games.length });
        setSlate(analyzeSlate(games, { numSims: NUM_SIMS, seed: simSeed }));
        setRunning(false);
      }, 30);
    },
    [load]
  );

  useEffect(() => {
    run(seed);
  }, [run, seed]);

  return (
    <div
      className="container"
      style={{ padding: '50px 20px 40px', minHeight: 'calc(100vh - 180px)' }}
    >
      <h1 className="page-title">NBA Betting Model</h1>
      {source && (
        <p className={`nba-source ${source.live ? 'nba-source-live' : 'nba-source-stale'}`}>
          {source.live
            ? `● Live board — ${source.count} game${source.count === 1 ? '' : 's'} from ESPN${
                source.book ? ` (${source.book} pricing)` : ''
              }${source.date ? ` · ${source.date}` : ''}`
            : '○ ESPN unreachable — showing the hand-entered offline snapshot, which will have drifted from the current board'}
        </p>
      )}
      <p className="nba-subtitle">
        Expected scores come from the possession identity
        (efficiency × possessions) rather than raw PPG, then {NUM_SIMS.toLocaleString()} correlated
        Monte Carlo simulations price the moneyline, spread, total, and player props. Every edge is
        reported raw and again after a ledger of uncertainty penalties; only the adjusted edge can
        qualify a bet.
      </p>

      <div className="nba-controls">
        <button
          className="nba-rerun-btn"
          disabled={running}
          onClick={() => setSeed(Math.floor(Math.random() * 1e9))}
        >
          {running ? 'Simulating…' : '↻ Re-run simulations'}
        </button>
        <span className="nba-bet-rules">
          Bet rules: adjusted edge ≥{pct(BET_RULES.MIN_ADJUSTED_EDGE, 0)} · confidence ≥
          {BET_RULES.MIN_CONFIDENCE}/10 · no model/market divergence veto
        </span>
      </div>

      {running && !slate ? (
        <p className="nba-loading">Running {NUM_SIMS.toLocaleString()} simulations per game…</p>
      ) : (
        slate && (
          <>
            <div className="nba-top-board">
              <h2>Top 5 by adjusted edge</h2>
              {slate.topBets.length === 0 && (
                <p className="nba-note">
                  <strong>No bet qualifies on this slate.</strong> The rows below are the best
                  available by adjusted edge, shown so the board stays auditable — none of them
                  clears the {pct(BET_RULES.MIN_ADJUSTED_EDGE, 0)} gate.
                </p>
              )}
              <ol className="nba-top-list">
                {(slate.topBets.length > 0 ? slate.topBets : slate.topByEdge).map((row) => (
                  <li key={`${row.gameId}-${row.label}`}>
                    <span className="nba-top-label">{row.label}</span>{' '}
                    {formatAmerican(row.price)} — model {pct(row.settleProb)}, raw{' '}
                    <EdgeTag edge={row.rawEdge} /> → adjusted <EdgeTag edge={row.adjustedEdge} />{' '}
                    <RecTag row={row} />
                  </li>
                ))}
              </ol>
            </div>

            {slate.results.map((analysis) => (
              <GameCard key={analysis.game.id} analysis={analysis} />
            ))}
          </>
        )
      )}

      <p className="nba-disclaimer">
        Team ratings are 2025-26 figures, player baselines are last-season per-game numbers, and
        several inputs are estimates or our own priors — each one is flagged in the dampener ledger
        on the game it affects. Model output is for analysis only, not betting advice.
      </p>
    </div>
  );
}
