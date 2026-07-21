// src/pages/UFCBettingPage.js
import React, { useCallback, useEffect, useState } from 'react';
import { analyzeCard, formatAmerican, probToAmerican } from '../models/ufcSimulator';
import { UFC_CARD } from '../data/ufcFights';
import { UFC_329_CARD } from '../data/ufc329';
import { UFC_OKC_CARD } from '../data/ufcOkc';

const CARDS = [
  { key: 'okc', title: 'UFC OKC (Jul 18)', card: UFC_OKC_CARD },
  { key: 'ufc329', title: 'UFC 329 (Jul 11)', card: UFC_329_CARD },
  { key: 'demo', title: 'Demo Card', card: UFC_CARD },
];

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
      {pct(row.modelProb)}, blended {pct(row.blendProb)} vs book{' '}
      {formatAmerican(row.bookOdds)}
      {row.estimated ? ' (est. price)' : ''} (implied {pct(row.implied)}){' '}
      <EdgeTag edge={row.edge} />
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

function ResultBanner({ grading }) {
  const { actual, actualWinnerName, predictedWinnerCorrect, bets, netUnits } = grading;
  return (
    <div className={`ufc-result-banner ${predictedWinnerCorrect ? 'hit' : 'miss'}`}>
      <div>
        <strong>RESULT:</strong> {actualWinnerName} by {actual.method}
        {actual.method !== 'Decision' && actual.method !== 'Draw' ? `, round ${actual.round}` : ''}{' '}
        — model pick {predictedWinnerCorrect ? '✓ correct' : '✗ wrong'}
      </div>
      {actual.note && <div className="ufc-result-note">{actual.note}</div>}
      {bets.length > 0 && (
        <div className="ufc-result-bets">
          {bets.map((b) => (
            <span key={b.label} className={`ufc-bet-chip ${b.outcome}`}>
              {b.outcome === 'win' ? '✓' : b.outcome === 'loss' ? '✗' : '–'} {b.label}{' '}
              {formatAmerican(b.bookOdds)} ({b.units >= 0 ? '+' : ''}
              {b.units.toFixed(2)}u)
            </span>
          ))}
          <span className="ufc-bet-chip net">
            Net {netUnits >= 0 ? '+' : ''}
            {netUnits.toFixed(2)}u
          </span>
        </div>
      )}
    </div>
  );
}

function CardRecord({ results }) {
  const graded = results.filter((r) => r.grading);
  if (graded.length === 0) return null;
  const winnersRight = graded.filter((r) => r.grading.predictedWinnerCorrect).length;
  const bets = graded.flatMap((r) => r.grading.bets);
  const wins = bets.filter((b) => b.outcome === 'win').length;
  const losses = bets.filter((b) => b.outcome === 'loss').length;
  const net = bets.reduce((sum, b) => sum + b.units, 0);
  return (
    <div className="ufc-card-record">
      <strong>Card graded:</strong> predicted winners {winnersRight}/{graded.length} · qualified
      bets {wins}-{losses}
      {bets.length - wins - losses > 0 ? `-${bets.length - wins - losses}` : ''} ·{' '}
      <span className={net >= 0 ? 'edge-pos ufc-edge' : 'edge-neg ufc-edge'}>
        {net >= 0 ? '+' : ''}
        {net.toFixed(2)}u flat-betting
      </span>
    </div>
  );
}

const fmtPct = (x) => `${Math.round(x * 100)}%`;
const TAPE_SECTIONS = [
  {
    title: 'Striking',
    rows: [
      ['Sig. strikes landed/min', (f) => f.striking.sigStrikesPerMin, 'high'],
      ['Strike accuracy', (f) => fmtPct(f.striking.strikeAccuracy), 'high'],
      ['Strike defense', (f) => fmtPct(f.striking.strikeDefense), 'high'],
      ['Absorbed/min', (f) => f.striking.strikesAbsorbedPerMin, 'low'],
      ['Knockdowns/15 min', (f) => f.striking.knockdownRate, 'high'],
      ['Head strike share', (f) => fmtPct(f.striking.headStrikePct), null],
      ['Power (0-10)', (f) => f.striking.powerRating, 'high'],
      ['Pace/output (0-10)', (f) => f.striking.pace, 'high'],
    ],
  },
  {
    title: 'Grappling',
    rows: [
      ['Takedowns/15 min', (f) => f.grappling.takedownsPer15, 'high'],
      ['Takedown accuracy', (f) => fmtPct(f.grappling.takedownAccuracy), 'high'],
      ['Takedown defense', (f) => fmtPct(f.grappling.takedownDefense), 'high'],
      ['Sub attempts/15 min', (f) => f.grappling.subAttemptsPer15, 'high'],
      ['Control (0-10)', (f) => f.grappling.controlRating, 'high'],
      ['Scrambling (0-10)', (f) => f.grappling.scrambleAbility, 'high'],
    ],
  },
  {
    title: 'Fighter Factors',
    rows: [
      ['Age', (f) => f.factors.age, 'low'],
      ['Height', (f) => `${f.factors.height}"`, 'high'],
      ['Reach', (f) => `${f.factors.reach}"`, 'high'],
      ['Stance', (f) => f.factors.stance, null],
      ['Cardio (0-10)', (f) => f.factors.cardio, 'high'],
      ['Durability/chin (0-10)', (f) => f.factors.durability, 'high'],
      ['Recent form (0-10)', (f) => f.factors.recentForm, 'high'],
      ['Damage last 3 (0-10)', (f) => f.factors.damageLastThree, 'low'],
      ['Fights/year', (f) => f.factors.activityLevel, 'high'],
      ['Five-round fights', (f) => f.factors.fiveRoundExp, 'high'],
      ['Opposition strength (0-10)', (f) => f.factors.oppStrength, 'high'],
      ['Career finish rate', (f) => fmtPct(f.factors.finishRate), null],
      ['Variance (0-10)', (f) => f.factors.varianceRating, 'low'],
      ['UFC fights', (f) => f.factors.ufcFights, 'high'],
      [
        'Red flags',
        (f) =>
          [
            f.factors.shortNotice && 'short notice',
            f.factors.weightCutConcerns && 'weight cut',
            f.factors.recentKOLoss && 'recent KO loss',
            f.factors.inconsistentPace && 'inconsistent pace',
          ]
            .filter(Boolean)
            .join(', ') || '—',
        null,
      ],
    ],
  },
];

function TaleOfTheTape({ fighterA, fighterB }) {
  return (
    <div className="ufc-table-wrap">
      <table className="ufc-table ufc-tape-table">
        <thead>
          <tr>
            <th>Tale of the Tape</th>
            <th>{fighterA.name}</th>
            <th>{fighterB.name}</th>
          </tr>
        </thead>
        <tbody>
          {TAPE_SECTIONS.map((section) => (
            <React.Fragment key={section.title}>
              <tr className="ufc-tape-section">
                <td colSpan={3}>{section.title}</td>
              </tr>
              {section.rows.map(([label, get, better]) => {
                const a = get(fighterA);
                const b = get(fighterB);
                let aWins = false;
                let bWins = false;
                if (better && typeof a === 'number' && typeof b === 'number' && a !== b) {
                  aWins = better === 'high' ? a > b : a < b;
                  bWins = !aWins;
                }
                return (
                  <tr key={label}>
                    <td>{label}</td>
                    <td className={aWins ? 'ufc-tape-adv' : ''}>{a}</td>
                    <td className={bWins ? 'ufc-tape-adv' : ''}>{b}</td>
                  </tr>
                );
              })}
            </React.Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FightCard({ analysis }) {
  const [showDetails, setShowDetails] = useState(false);
  const { fight, sim, summary, confidence, grading, avoidReasons, valueBets, bestBet, bestProps, markets, roundProps, projections } = analysis;
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

      {fight.notes && <p className="ufc-fight-notes">{fight.notes}</p>}

      {grading && <ResultBanner grading={grading} />}

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
          (blended)
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
                {v.label} {formatAmerican(v.bookOdds)} — model {pct(v.modelProb)}, blended{' '}
                {pct(v.blendProb)} vs implied {pct(v.implied)} <EdgeTag edge={v.edge} />
              </li>
            ))}
          </ul>
        </div>
      )}

      <button className="ufc-details-toggle" onClick={() => setShowDetails(!showDetails)}>
        {showDetails ? 'Hide' : 'Show'} tale of the tape, market board, round props & projections
      </button>

      {showDetails && (
        <div className="ufc-details">
          <TaleOfTheTape fighterA={fighterA} fighterB={fighterB} />

          <h3>Market Board (model vs book)</h3>
          <div className="ufc-table-wrap">
            <table className="ufc-table">
              <thead>
                <tr>
                  <th>Market</th>
                  <th>Model %</th>
                  <th>Blend %</th>
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
                    <td>{pct(m.blendProb)}</td>
                    <td>{formatAmerican(m.fairOdds)}</td>
                    <td>
                      {formatAmerican(m.bookOdds)}
                      {m.estimated ? <span className="ufc-est-tag"> est.</span> : ''}
                    </td>
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
  const [cardKey, setCardKey] = useState(CARDS[0].key);

  const activeCard = CARDS.find((c) => c.key === cardKey).card;

  const run = useCallback((simSeed, card) => {
    setRunning(true);
    // Defer so the "running" state paints before the sims block the thread
    setTimeout(() => {
      setResults(analyzeCard(card.fights, { numSims: NUM_SIMS, seed: simSeed }));
      setRunning(false);
    }, 30);
  }, []);

  useEffect(() => {
    run(seed, activeCard);
  }, [run, seed, activeCard]);

  return (
    <div
      className="container"
      style={{ padding: '50px 20px 40px', minHeight: 'calc(100vh - 180px)' }}
    >
      <h1 className="page-title">UFC Betting Model</h1>
      <p className="ufc-subtitle">
        {activeCard.event} — round-by-round Monte Carlo engine ({NUM_SIMS.toLocaleString()}{' '}
        simulations per fight) with Poisson strike projections, pace/fatigue scaling, damage
        accumulation, and sportsbook edge detection.
      </p>

      <div className="ufc-controls">
        <div className="ufc-card-tabs">
          {CARDS.map((c) => (
            <button
              key={c.key}
              className={`ufc-card-tab ${c.key === cardKey ? 'active' : ''}`}
              onClick={() => setCardKey(c.key)}
            >
              {c.title}
            </button>
          ))}
        </div>
        <button
          className="ufc-rerun-btn"
          disabled={running}
          onClick={() => setSeed(Math.floor(Math.random() * 1e9))}
        >
          {running ? 'Simulating…' : '↻ Re-run simulations'}
        </button>
        <span className="ufc-bet-rules">
          Bet rules: market-blended edges (closing line is the prior) · favorites ≥5% ·
          underdogs ≥7% · confidence ≥6.5/10 · sourced prices only · max 2 bets/fight
        </span>
      </div>

      {running && !results ? (
        <p className="ufc-loading">Running {NUM_SIMS.toLocaleString()} simulations per fight…</p>
      ) : (
        results && (
          <>
            <CardRecord results={results} />
            {results.map((analysis) => (
              <FightCard key={analysis.fight.id} analysis={analysis} />
            ))}
          </>
        )
      )}

      <p className="ufc-disclaimer">
        {cardKey === 'demo'
          ? 'Demo mode: fighters, stats, and sportsbook odds are sample data.'
          : 'Stat profiles are hand-built from public career stats and fight-week reporting; prop prices flagged as estimated in each fight’s notes were not directly sourced.'}{' '}
        Model output is for entertainment/analysis only — not betting advice.
      </p>
    </div>
  );
}
