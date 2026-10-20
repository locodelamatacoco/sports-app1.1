// src/data/espnNba.js
//
// Live NBA slate from ESPN's public scoreboard, mapped into the shape
// `nbaSimulator` expects.
//
// What the feed actually provides: the day's games, teams, venue, tip time,
// and DraftKings pricing for the moneyline, spread, and total — each with an
// opening and a current number, which is what lets line movement be detected
// rather than hand-noted. What it does not provide: efficiency ratings, pace,
// injuries, or player props. Those come from the curated modules, and anything
// missing is flagged in `dataQuality` so the dampener charges for it.
//
// The fetch and the mapping are deliberately separate: `mapScoreboard` is pure,
// so it can be tested against a recorded payload with no network.

import axios from 'axios';
import { ratingsFor, LEAGUE_AVG } from './nbaTeamRatings';
import { PROP_SETS, CURATED_CONTEXT } from './nbaGames';

export const ESPN_NBA_SCOREBOARD =
  'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard';

// Opening-to-current movement at or beyond this many points is treated as the
// market reacting to information our inputs do not contain.
export const SIGNIFICANT_LINE_MOVE = 2.0;

// "+110" / "-130" / "EVEN" -> a number the odds helpers can use.
export function parseAmerican(value) {
  if (value == null) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const text = String(value).trim();
  if (/^(even|ev|pk)$/i.test(text)) return 100;
  const n = Number(text.replace(/^\+/, ''));
  return Number.isFinite(n) ? n : null;
}

// Spread lines arrive as "+1.5" / "-4.5" / "EVEN".
export function parseLine(value) {
  if (value == null) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const text = String(value).trim();
  if (/^(even|ev|pk)$/i.test(text)) return 0;
  const n = Number(text.replace(/^\+/, ''));
  return Number.isFinite(n) ? n : null;
}

// ESPN nests prices as { close: { odds }, open: { odds } } but older payloads
// put the value directly on the node, so read both shapes.
function readPrice(node, phase) {
  if (!node) return null;
  if (node[phase]?.odds != null) return parseAmerican(node[phase].odds);
  if (phase === 'close' && node.odds != null) return parseAmerican(node.odds);
  return null;
}

function readLine(node, phase) {
  if (!node) return null;
  if (node[phase]?.line != null) return parseLine(node[phase].line);
  if (phase === 'close' && node.line != null) return parseLine(node.line);
  return null;
}

// Prefer a named book over a composite line so one consistent set of prices
// drives every market on the game.
export function pickOdds(oddsList = []) {
  if (!oddsList.length) return null;
  const byProvider = (id) => oddsList.find((o) => String(o.provider?.id) === String(id));
  return byProvider(100) || byProvider(2000) || oddsList[0];
}

// When the feed carries more than one book, the spread of their numbers is a
// real market-disagreement signal rather than a curated guess.
export function marketDisagreementFrom(oddsList = []) {
  const notes = [];
  const spreads = oddsList.map((o) => parseLine(o.spread)).filter((n) => n != null);
  const totals = oddsList.map((o) => parseLine(o.overUnder)).filter((n) => n != null);
  const range = (xs) => Math.max(...xs) - Math.min(...xs);
  if (spreads.length > 1 && range(spreads) >= 1)
    notes.push(`spread ${Math.min(...spreads)} to ${Math.max(...spreads)} across books`);
  if (totals.length > 1 && range(totals) >= 1)
    notes.push(`total ${Math.min(...totals)} to ${Math.max(...totals)} across books`);
  return notes.length ? notes.join('; ') : null;
}

function tipoffLabel(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'America/New_York',
  })} ET`;
}

// Days of rest from the feed's own record of the team's previous game, when
// present. ESPN does not always include it, so default to a normal rest day
// rather than inventing a back-to-back.
function scheduleFor(competitor, eventDate) {
  const last = competitor?.team?.previousGameDate || competitor?.previousGameDate;
  if (!last || !eventDate) return { restDays: 1, backToBack: false };
  const days = Math.round((new Date(eventDate) - new Date(last)) / 86400000);
  if (!Number.isFinite(days) || days < 0) return { restDays: 1, backToBack: false };
  return { restDays: Math.max(days, 0), backToBack: days <= 1 };
}

export function mapEvent(event, { propSets = PROP_SETS, curated = CURATED_CONTEXT } = {}) {
  const competition = event?.competitions?.[0];
  if (!competition) return null;

  const home = competition.competitors?.find((c) => c.homeAway === 'home');
  const away = competition.competitors?.find((c) => c.homeAway === 'away');
  if (!home?.team || !away?.team) return null;

  const homeAbbr = home.team.abbreviation;
  const awayAbbr = away.team.abbreviation;
  const matchup = `${awayAbbr}@${homeAbbr}`;

  const homeTeam = ratingsFor(homeAbbr);
  const awayTeam = ratingsFor(awayAbbr);

  const book = pickOdds(competition.odds);
  if (!book) return null;

  // Spread is stored from the home side: negative means the home team is laying
  // points. `pointSpread` is explicit about which side each line belongs to, so
  // prefer it and fall back to the summary `spread` field.
  const homeLine = readLine(book.pointSpread?.home, 'close') ?? parseLine(book.spread);
  const openHomeLine = readLine(book.pointSpread?.home, 'open');
  const totalLine = parseLine(book.overUnder);

  const mlHome = readPrice(book.moneyline?.home, 'close') ?? parseAmerican(book.homeTeamOdds?.moneyLine);
  const mlAway = readPrice(book.moneyline?.away, 'close') ?? parseAmerican(book.awayTeamOdds?.moneyLine);
  const openMlHome = readPrice(book.moneyline?.home, 'open');
  const openMlAway = readPrice(book.moneyline?.away, 'open');

  // ESPN does not price the total's two sides separately on this endpoint, so
  // the standard -110 pair stands in and is flagged as inferred.
  const overPrice = readPrice(book.total?.over, 'close') ?? -110;
  const underPrice = readPrice(book.total?.under, 'close') ?? -110;
  const totalPricesInferred =
    readPrice(book.total?.over, 'close') == null || readPrice(book.total?.under, 'close') == null;

  const spreadHomePrice = readPrice(book.pointSpread?.home, 'close') ?? -110;
  const spreadAwayPrice = readPrice(book.pointSpread?.away, 'close') ?? -110;
  const spreadPricesInferred =
    readPrice(book.pointSpread?.home, 'close') == null ||
    readPrice(book.pointSpread?.away, 'close') == null;

  if (homeLine == null || totalLine == null || mlHome == null || mlAway == null) return null;

  const estimated = [];
  if (homeTeam.paceEstimated) estimated.push(`${homeTeam.code} pace (from rank)`);
  if (awayTeam.paceEstimated) estimated.push(`${awayTeam.code} pace (from rank)`);
  if (totalPricesInferred) estimated.push('total juice inferred');
  if (spreadPricesInferred) estimated.push('spread juice inferred');
  if (!homeTeam.ratingsSourced) estimated.push(`${homeAbbr} ratings unavailable — league average used`);
  if (!awayTeam.ratingsSourced) estimated.push(`${awayAbbr} ratings unavailable — league average used`);

  // Line movement, read straight off the feed's opening numbers.
  let lineMovedAgainst = null;
  if (openHomeLine != null && homeLine != null) {
    const move = homeLine - openHomeLine;
    if (Math.abs(move) >= SIGNIFICANT_LINE_MOVE) {
      const fmt = (n) => (n > 0 ? `+${n}` : `${n}`);
      lineMovedAgainst =
        `opened ${homeTeam.code} ${fmt(openHomeLine)}, now ${homeTeam.code} ${fmt(homeLine)} ` +
        `(${Math.abs(move).toFixed(1)}-pt move) — information our inputs do not contain`;
    }
  }

  const curatedGame = curated[matchup] ?? {};

  return {
    id: `${awayAbbr}-${homeAbbr}`.toLowerCase(),
    espnId: event.id,
    label: `${away.team.shortDisplayName ?? awayAbbr} @ ${home.team.shortDisplayName ?? homeAbbr}`,
    tipoff: tipoffLabel(event.date),
    venue: competition.venue?.fullName ?? '',
    source: 'espn',
    book: book.provider?.name ?? 'unknown book',
    away: {
      ...awayTeam,
      record: away.records?.find((r) => r.type === 'total')?.summary || awayTeam.record,
      recentForm: null,
    },
    home: {
      ...homeTeam,
      record: home.records?.find((r) => r.type === 'total')?.summary || homeTeam.record,
      recentForm: null,
    },
    context: {
      home: scheduleFor(home, event.date),
      away: scheduleFor(away, event.date),
    },
    odds: {
      moneyline: { home: mlHome, away: mlAway },
      spread: { homeLine, homePrice: spreadHomePrice, awayPrice: spreadAwayPrice },
      total: { line: totalLine, over: overPrice, under: underPrice },
      opening: {
        moneyline: { home: openMlHome, away: openMlAway },
        spreadHomeLine: openHomeLine,
      },
    },
    dataQuality: {
      // Records read 0-0 until games are played, which is the feed telling us
      // there is no current-season sample yet.
      noCurrentSeasonData: !hasPlayedGames(home) && !hasPlayedGames(away),
      estimatedInputs: estimated,
      marketDisagreement: marketDisagreementFrom(competition.odds),
      lineMovedAgainst,
      injuryNewsUncertainty: curatedGame.injuryNewsUncertainty ?? null,
      lineupUnconfirmed: curatedGame.lineupUnconfirmed ?? null,
    },
    props: propSets[matchup] ?? [],
  };
}

function hasPlayedGames(competitor) {
  const summary = competitor?.records?.find((r) => r.type === 'total')?.summary;
  if (!summary) return false;
  const [w, l] = summary.split('-').map(Number);
  return (w || 0) + (l || 0) > 0;
}

export function mapScoreboard(scoreboard, options = {}) {
  const events = scoreboard?.events ?? [];
  return {
    date: scoreboard?.day?.date ?? null,
    season: scoreboard?.season?.year ?? null,
    label: 'NBA — live slate from ESPN',
    skipped: events.length - events.map((e) => mapEvent(e, options)).filter(Boolean).length,
    games: events.map((e) => mapEvent(e, options)).filter(Boolean),
  };
}

// `date` is YYYYMMDD; omit it for today's slate.
export async function fetchNbaSlate({ date, client = axios, signal } = {}) {
  const url = date ? `${ESPN_NBA_SCOREBOARD}?dates=${date}` : ESPN_NBA_SCOREBOARD;
  const { data } = await client.get(url, { signal });
  return mapScoreboard(data);
}

export { LEAGUE_AVG };
