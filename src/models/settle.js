// src/models/settle.js
//
// Settling logged markets against a final score.
//
// This lives beside the model rather than inside the grading script because
// getting it wrong silently corrupts every performance number that follows.
// The spread orientation in particular: a logged row carries its OWN side's
// line ("Raptors -10.5", "Bulls +10.5"), and both have to resolve to the same
// home-margin comparison.

// Pull the signed line off a label like "Toronto Raptors -10.5" or
// "Over 237.5". Returns null when the label has no number.
export function lineFromLabel(label) {
  if (typeof label !== 'string') return null;
  const match = /([+-]?\d+(?:\.\d+)?)\s*(?:\(alt\))?\s*$/.exec(label.trim());
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

// The home team's line, whichever side the row is for.
export function homeLineFor(market) {
  if (market.line != null) {
    // Derived alternate-spread rows store the margin threshold, not the line.
    return market.market === 'altSpread' ? -market.line : market.line;
  }
  const own = lineFromLabel(market.label);
  if (own == null) return null;
  return market.side === 'home' ? own : -own;
}

export function totalLineFor(market) {
  if (market.line != null) return market.line;
  return lineFromLabel(market.label);
}

// Which stat a prop row is about, read from the logged market shape.
const PROP_STAT_FROM_LABEL = [
  [/\bpoints?\b/i, 'points'],
  [/\brebounds?\b/i, 'rebounds'],
  [/\bassists?\b/i, 'assists'],
  [/\bthrees?\b|\b3pm\b|made threes/i, 'threes'],
  [/\bsteals?\b/i, 'steals'],
  [/\bblocks?\b/i, 'blocks'],
];

export function propStatFrom(market) {
  if (market.stat) return market.stat;
  for (const [pattern, stat] of PROP_STAT_FROM_LABEL) {
    if (pattern.test(market.label ?? '')) return stat;
  }
  return null;
}

// The player a prop row is about. Logged labels read "Bam Adebayo 17+ points"
// or "Bam Adebayo Over 9.5 rebounds", so the name is everything before the
// threshold or the Over/Under.
export function propPlayerFrom(market) {
  if (market.player) return market.player;
  const label = market.label ?? '';
  const match = /^(.+?)\s+(?:Over|Under|\d+\+)/.exec(label);
  return match ? match[1].trim() : null;
}

// Settle a player prop against that player's actual line. `boxScore` maps a
// stat name to the number the player posted. Returns null when the player is
// absent from the box score, which is NOT the same as a loss: a player who
// did not play usually voids the bet, and guessing either way would corrupt
// the record.
export function settleProp(market, boxScore) {
  if (!boxScore) return null;
  const stat = propStatFrom(market);
  if (!stat) return null;
  const actual = boxScore[stat];
  if (actual == null) return null;

  // A threshold row ("17+ points") wins at or above the threshold.
  const threshold = market.threshold ?? propThresholdFrom(market);
  if (threshold != null) return actual >= threshold;

  // Prop labels carry the number mid-string ("Over 9.5 rebounds"), so the
  // end-anchored reader used for spreads and totals will not find it.
  const line = market.line ?? propLineFrom(market);
  if (line == null) return null;
  if (actual === line) return 'push';
  return market.side === 'over' ? actual > line : actual < line;
}

// "Bam Adebayo 17+ points" -> 17
export function propThresholdFrom(market) {
  const match = /(\d+(?:\.\d+)?)\+/.exec(market.label ?? '');
  return match ? Number(match[1]) : null;
}

// "Bam Adebayo Over 9.5 rebounds" -> 9.5
export function propLineFrom(market) {
  const match = /\b(?:Over|Under)\s+(\d+(?:\.\d+)?)/i.exec(market.label ?? '');
  return match ? Number(match[1]) : null;
}

// Returns true (won), false (lost), 'push', or null when a final score cannot
// decide the market — a player prop, which needs a box score.
export function settleMarket(market, awayScore, homeScore, boxScores = null) {
  const margin = homeScore - awayScore;
  const total = homeScore + awayScore;

  if (market.market === 'prop') {
    if (!boxScores) return null;
    const player = propPlayerFrom(market);
    return player ? settleProp(market, boxScores[player]) : null;
  }

  switch (market.market) {
    case 'moneyline':
      if (margin === 0) return 'push'; // cannot happen in NBA, but never silently wrong
      return market.side === 'home' ? margin > 0 : margin < 0;

    case 'spread':
    case 'altSpread': {
      const homeLine = homeLineFor(market);
      if (homeLine == null) return null;
      const adjusted = margin + homeLine;
      if (adjusted === 0) return 'push';
      return market.side === 'home' ? adjusted > 0 : adjusted < 0;
    }

    case 'total':
    case 'altTotal': {
      const line = totalLineFor(market);
      if (line == null) return null;
      if (total === line) return 'push';
      return market.side === 'over' ? total > line : total < line;
    }

    case 'teamTotal': {
      if (market.line == null) return null;
      const score = market.side.startsWith('home') ? homeScore : awayScore;
      if (score === market.line) return 'push';
      return market.side.endsWith('over') ? score > market.line : score < market.line;
    }

    default:
      return null; // props
  }
}

// Profit in units on a one-unit stake at American odds.
export function unitProfit(price, outcome) {
  if (outcome === 'push') return 0;
  if (!outcome) return -1;
  return price > 0 ? price / 100 : 100 / -price;
}

export function emptyTally() {
  return { n: 0, won: 0, lost: 0, push: 0, units: 0 };
}

export function recordOutcome(tally, outcome, price) {
  tally.n += 1;
  if (outcome === 'push') {
    tally.push += 1;
    return tally;
  }
  if (outcome) tally.won += 1;
  else tally.lost += 1;
  tally.units += unitProfit(price, outcome);
  return tally;
}

export function tallySummary(tally) {
  const decided = tally.won + tally.lost;
  return {
    ...tally,
    decided,
    winRate: decided ? tally.won / decided : null,
    roi: decided ? tally.units / decided : null,
  };
}
