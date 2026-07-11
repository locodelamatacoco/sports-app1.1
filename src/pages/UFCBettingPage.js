// src/pages/UFCBettingPage.js
import React, { useCallback, useEffect, useState } from 'react';
import { analyzeCard, formatAmerican, probToAmerican } from '../models/ufcSimulator';
import { UFC_CARD } from '../data/ufcFights';

const NUM_SIMS = 10000;

const pct = (x, digits = 1) => `${(100 * x).toFixed(digits)}%`;
const signedPct = (x) => `${x >= 0 ? '+' : ''}${(100 * x).toFixed(1)}%`;

function EdgeTag({ edge }) {
  const cls = edge >= 0.05 ? 'edge-pos' : edge <= -0.05 ? 'edge-neg' : 'edge-flat';
  return <span className={`ufc-edge ${cls}`}>{signedPct(edge)}</span>;
}

function PropLine({ title, row }) {
  return (
    <li>
      <span className="ufc-prop-title">{title}:</span> {row.label} — model{' '}
      {pct(row.modelProb)} vs book {formatAmerican(row.bookOdds)} (implied{' '}
      {pct(row.implied)}) <EdgeTag edge={row.edge} />
    </li>
  );
}

function BreakdownBar({ label, prob }) {
  return (
    <div className="ufc-breakdown-row">
      <span className="ufc-breakdown-label">{label}</span>
      <div className="ufc-breakdown-bar-bg">
        <div className="ufc-breakdown-bar" style={{ width: `${Math.max(prob * 100, 1)}%` }} />
      </div>
      <span className="ufc-breakdown-pct">{pct(prob)}</span>
    </div>
  );
}

function FightCard({ analysis }) {
  const [showDetails, setShowDetails] = useState(false);
  const { fight, sim, summary, confidence, avoidReasons, valueBets, bestBet, bestProps, markets, roundProps, projections } = analysis;
  const { fighterA, fighterB } = fight;
  const p = sim.probs;

  return (
    <div className="ufc-fight-card">
      <div className="ufc-fight-header">
        <span className="ufc-fight-label">{fight.label}</span>
        <h2 className="ufc-fight-title">
          FIGHT: {fighterA.name} ({fighterA.record}) vs {fighterB.name} ({fighterB.record})
        </h2>
        <span className="ufc-fight-odds">
          Book: {fighterA.name} {formatAmerican(fight.odds.moneylineA)} / {fighterB.name}{' '}
          {formatAmerican(fight.odds.moneylineB)} · {fight.rounds} rounds ·{' '}
          {sim.numSims.toLocaleString()} simulations
        </span>
      </div>

      {avoidReasons.length > 0 && (
        <div className="ufc-avoid-banner">
          ⚠ {avoidReasons.join(' · ')}
        </div>
      )}

      <div className="ufc-summary-grid">
        <div><strong>Predicted Winner:</strong> {summary.predictedWinner}</div>
        <div><strong>Win Probability:</strong> {pct(summary.winProbability)}</div>
        <div><strong>Implied Odds:</strong> {formatAmerican(summary.impliedOdds)} (fair price)</div>
        <div>
          <strong>Betting Edge:</strong> <EdgeTag edge={summary.bettingEdge} /> vs moneyline
        </div>
        <div>
          <strong>Confidence Score:</strong> {summary.confidenceScore.toFixed(1)}/10
        </div>
        <div>
          <strong>Risk Level:</strong>{' '}
          <span className={`ufc-risk ufc-risk-${summary.riskLevel.toLowerCase()}`}>
            {summary.riskLevel}
          </span>
        </div>
        <div><strong>Most Likely Method:</strong> {summary.mostLikelyMethod}</div>
        <div><strong>Finish Probability:</strong> {pct(summary.finishProbability)}</div>
        <div><strong>Fight Goes Distance:</strong> {pct(summary.goesDistance)}</div>
        <div>
          <strong>Best Value Bet:</strong>{' '}
          {bestBet ? (
            <>
              {bestBet.label} {formatAmerican(bestBet.bookOdds)} <EdgeTag edge={bestBet.edge} />
            </>
          ) : (
            'PASS — no qualifying edge'
          )}
        </div>
      </div>

      <div className="ufc-section">
        <h3>Best Props</h3>
        <ul className="ufc-prop-list">
          <PropLine title="KO/TKO" row={bestProps.ko} />
          <PropLine title="Submission" row={bestProps.sub} />
          <PropLine title="Decision" row={bestProps.dec} />
          <PropLine title="Over/Under Rounds" row={bestProps.rounds} />
        </ul>
      </div>

      <div className="ufc-section">
        <h3>Simulation Breakdown</h3>
        <BreakdownBar label={`${fighterA.name} by KO/TKO`} prob={p.aKO} />
        <BreakdownBar label={`${fighterA.name} by Submission`} prob={p.aSub} />
        <BreakdownBar label={`${fighterA.name} by Decision`} prob={p.aDec} />
        <BreakdownBar label={`${fighterB.name} by KO/TKO`} prob={p.bKO} />
        <BreakdownBar label={`${fighterB.name} by Submission`} prob={p.bSub} />
        <BreakdownBar label={`${fighterB.name} by Decision`} prob={p.bDec} />
        <BreakdownBar label="Draw" prob={p.draw} />
      </div>

      {valueBets.length > 0 && (
        <div className="ufc-section">
          <h3>Qualified Value Bets</h3>
          <ul className="ufc-prop-list">
            {valueBets.map((v) => (
              <li key={v.label}>
                {v.label} {formatAmerican(v.bookOdds)} — model {pct(v.modelProb)} vs implied{' '}
                {pct(v.implied)} <EdgeTag edge={v.edge} />
              </li>
            ))}
          </ul>
        </div>
      )}

      <button className="ufc-details-toggle" onClick={() => setShowDetails(!showDetails)}>
        {showDetails ? 'Hide' : 'Show'} full market board, round props & projections
      </button>

      {showDetails && (
        <div className="ufc-details">
          <h3>Market Board (model vs book)</h3>
          <div className="ufc-table-wrap">
            <table className="ufc-table">
              <thead>
                <tr>
                  <th>Market</th>
                  <th>Model %</th>
                  <th>Fair Odds</th>
                  <th>Book</th>
                  <th>Implied %</th>
                  <th>Edge</th>
                </tr>
              </thead>
              <tbody>
                {markets.map((m) => (
                  <tr key={m.label}>
                    <td>{m.label}</td>
                    <td>{pct(m.modelProb)}</td>
                    <td>{formatAmerican(m.fairOdds)}</td>
                    <td>{formatAmerican(m.bookOdds)}</td>
                    <td>{pct(m.implied)}</td>
                    <td><EdgeTag edge={m.edge} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h3>Round Betting Props (model fair prices)</h3>
          <ul className="ufc-prop-list">
            {roundProps.map((r) => (
              <li key={r.label}>
                {r.label}: {pct(r.modelProb)} (fair {formatAmerican(r.fairOdds)})
              </li>
            ))}
            <li>
              Fight goes the distance: {pct(p.goesDistance)} (fair{' '}
              {formatAmerican(probToAmerican(p.goesDistance))})
            </li>
          </ul>

          <h3>Poisson Projections</h3>
          <ul className="ufc-prop-list">
            <li>
              {fighterA.name}: {projections.fighterA.expectedStrikes} sig strikes,{' '}
              {projections.fighterA.expectedTakedowns} takedowns, KO path{' '}
              {pct(projections.fighterA.koProb)}, sub path {pct(projections.fighterA.subProb)}
            </li>
            <li>
              {fighterB.name}: {projections.fighterB.expectedStrikes} sig strikes,{' '}
              {projections.fighterB.expectedTakedowns} takedowns, KO path{' '}
              {pct(projections.fighterB.koProb)}, sub path {pct(projections.fighterB.subProb)}
            </li>
            <li>
              Analytic finish probability {pct(projections.finishProb)} · decision{' '}
              {pct(projections.decisionProb)} · simulated expected rounds{' '}
              {p.expectedRounds.toFixed(2)}
            </li>
          </ul>

          {confidence.penalties.length > 0 && (
            <>
              <h3>Confidence Dampeners</h3>
              <ul className="ufc-prop-list">
                {confidence.penalties.map((pen) => (
                  <li key={pen}>{pen}</li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default function UFCBettingPage() {
  const [results, setResults] = useState(null);
  const [running, setRunning] = useState(true);
  const [seed, setSeed] = useState(42);

  const run = useCallback((simSeed) => {
    setRunning(true);
    // Defer so the "running" state paints before the sims block the thread
    setTimeout(() => {
      setResults(analyzeCard(UFC_CARD.fights, { numSims: NUM_SIMS, seed: simSeed }));
      setRunning(false);
    }, 30);
  }, []);

  useEffect(() => {
    run(seed);
  }, [run, seed]);

  return (
    <div
      className="container"
      style={{ padding: '50px 20px 40px', minHeight: 'calc(100vh - 180px)' }}
    >
      <h1 className="page-title">UFC Betting Model</h1>
      <p className="ufc-subtitle">
        {UFC_CARD.event} — round-by-round Monte Carlo engine ({NUM_SIMS.toLocaleString()}{' '}
        simulations per fight) with Poisson strike projections, pace/fatigue scaling, damage
        accumulation, and sportsbook edge detection.
      </p>

      <div className="ufc-controls">
        <button
          className="ufc-rerun-btn"
          disabled={running}
          onClick={() => setSeed(Math.floor(Math.random() * 1e9))}
        >
          {running ? 'Simulating…' : '↻ Re-run simulations'}
        </button>
        <span className="ufc-bet-rules">
          Bet rules: favorites ≥5% edge · underdogs ≥7% edge · confidence ≥6.5/10
        </span>
      </div>

      {running && !results ? (
        <p className="ufc-loading">Running {NUM_SIMS.toLocaleString()} simulations per fight…</p>
      ) : (
        results && results.map((analysis) => <FightCard key={analysis.fight.id} analysis={analysis} />)
      )}

      <p className="ufc-disclaimer">
        Demo mode: fighters, stats, and sportsbook odds are sample data. Model output is for
        entertainment/analysis only — not betting advice.
      </p>
    </div>
  );
}
