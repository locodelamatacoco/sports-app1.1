// src/data/nbaGames.js
//
// Curated NBA inputs that the live ESPN feed cannot supply, plus an offline
// fallback slate.
//
// `espnNba.js` fetches the day's games and sportsbook lines and merges them
// with `PROP_SETS` and `CURATED_CONTEXT` from this file, keyed by an
// `AWAY@HOME` matchup of ESPN team abbreviations. Team efficiency ratings live
// in `nbaTeamRatings.js`. `NBA_SLATE` below is the hand-entered snapshot used
// when the feed is unreachable.
//
// SOURCING RULES FOR THIS FILE
// ----------------------------
// Every number is one of three things, and the model treats them differently:
//
//   1. SOURCED   — reported by a book or a stats outlet. Used as-is.
//   2. ESTIMATED — inferred from a rank, a neighbouring figure, or the other
//                  side of a two-way price. Flagged so the confidence
//                  dampener charges for it.
//   3. JUDGEMENT — our own prior, mainly `rosterAdj` (in nbaTeamRatings.js)
//                  and `usageFactor`. Flagged as roster turnover so the
//                  dampener charges for it too.
//
// Opening night is the worst-case input environment for this model: no
// current-season form, no current-season minutes, and several rosters that
// barely resemble the teams that produced last season's ratings. The dampener
// is expected to reject most of the board, and that is the correct output
// rather than a failure.

import { TEAM_RATINGS, PACE_SCALE_NOTE } from './nbaTeamRatings';

export { PACE_SCALE_NOTE };

// Player prop inputs, keyed by AWAY@HOME using ESPN abbreviations. ESPN's
// scoreboard carries no player props, so both the lines and the baselines are
// gathered by hand; a prop with `baseline: null` is one we could not source and
// is reported as NO PLAY instead of being modelled off a guess.
export const PROP_SETS = {
  'BOS@DET': [
    {
      id: 'cunningham-ast',
      player: 'Cade Cunningham',
      team: 'DET',
      stat: 'assists',
      line: 8.5,
      over: -136, // FanDuel (sourced)
      under: 110, // inferred from a standard hold
      baseline: { perGame: 9.9, minutes: 35, pace: 99.4 }, // 9.9 apg = 2nd in the NBA, 2025-26
      projectedMinutes: 35,
      minutesVolatility: 0.05,
      matchupFactor: 0.97, // Boston's defence ranked 4th by rating
      flags: {
        estimatedBaseline: 'minutes estimated',
        estimatedPrice: true,
      },
    },
    {
      id: 'cunningham-stl',
      player: 'Cade Cunningham',
      team: 'DET',
      stat: 'steals',
      threshold: 2,
      price: 156, // Kalshi (sourced)
      baseline: null, // no steals-per-game baseline sourced
      flags: {},
    },
    {
      id: 'tatum-pts-25',
      player: 'Jayson Tatum',
      team: 'BOS',
      stat: 'points',
      threshold: 25,
      price: -192, // DraftKings most-bet prop (sourced)
      baseline: { perGame: 21.8, minutes: 33, pace: 95.6 }, // 2025-26: 16 games, 41.1% FG
      projectedMinutes: 33,
      minutesVolatility: 0.07,
      // Judgement: partial bounce-back from an injury-shortened season
      // toward pre-injury production.
      formFactor: 1.08,
      matchupFactor: 0.96, // Detroit's defence ranked 2nd by rating
      flags: {
        smallSample: 'only 16 games played in 2025-26',
        injuryReturn: 'returning from an injury-shortened season',
        estimatedBaseline: 'minutes estimated; bounce-back factor is our prior',
      },
    },
    {
      id: 'tatum-reb',
      player: 'Jayson Tatum',
      team: 'BOS',
      stat: 'rebounds',
      line: 8.5,
      over: -114, // SportsbookReview (sourced)
      under: -106, // inferred
      baseline: { perGame: 10.7, minutes: 33, pace: 95.6 }, // 10.7 rpg across the same 16 games
      projectedMinutes: 33,
      minutesVolatility: 0.07,
      matchupFactor: 0.98,
      flags: {
        smallSample: 'only 16 games played in 2025-26',
        injuryReturn: 'returning from an injury-shortened season',
        estimatedPrice: true,
      },
    },
    {
      id: 'tatum-3pm',
      player: 'Jayson Tatum',
      team: 'BOS',
      stat: 'threes',
      threshold: 3,
      price: -146, // DraftKings most-bet prop (sourced)
      baseline: null, // no 3PM-per-game baseline sourced
      flags: {},
    },
    {
      id: 'white-3pm',
      player: 'Derrick White',
      team: 'BOS',
      stat: 'threes',
      threshold: 3,
      price: -117, // DraftKings (sourced)
      baseline: null, // only a 3P% figure was available, not 3PM per game
      flags: {},
    },
    {
      id: 'george-pts',
      player: 'Paul George',
      team: 'BOS',
      stat: 'points',
      line: 9.5,
      over: -110, // inferred — no price sourced
      under: -110,
      baseline: null, // no 2025-26 per-game baseline sourced
      flags: { estimatedPrice: true },
    },
  ],

  'PHI@NY': [
    {
      id: 'brunson-pts',
      player: 'Jalen Brunson',
      team: 'NYK',
      stat: 'points',
      line: 27.5,
      over: -106, // inferred from the sourced under
      under: -114, // DraftKings (sourced)
      baseline: { perGame: 28.4, minutes: 35, pace: 99.5 }, // led the NBA in scoring in 2025-26
      projectedMinutes: 35,
      minutesVolatility: 0.05,
      matchupFactor: 1.02, // Philadelphia's defence ranked 17th by rating
      flags: {
        estimatedBaseline: 'minutes estimated',
        estimatedPrice: true,
      },
    },
    {
      id: 'brunson-ast',
      player: 'Jalen Brunson',
      team: 'NYK',
      stat: 'assists',
      line: 6.5,
      over: -118, // FanDuel (sourced)
      under: -102, // inferred
      baseline: { perGame: 6.8, minutes: 35, pace: 99.5 },
      projectedMinutes: 35,
      minutesVolatility: 0.05,
      matchupFactor: 1.01,
      flags: {
        estimatedBaseline: 'minutes estimated',
        estimatedPrice: true,
      },
    },
    {
      id: 'jbrown-pts-20',
      player: 'Jaylen Brown',
      team: 'PHI',
      stat: 'points',
      threshold: 20,
      price: -156, // DraftKings (sourced)
      baseline: { perGame: 28.7, minutes: 34, pace: 95.6 }, // 2025-26 with Boston, 36.2% usage (2nd)
      projectedMinutes: 34,
      minutesVolatility: 0.08,
      // Judgement: 36.2% usage is not available to him beside James,
      // Embiid and Maxey. This is a large, unverifiable haircut.
      usageFactor: 0.74,
      matchupFactor: 0.99,
      flags: {
        roleChange: 'new team; usage share drops sharply from 36.2% alongside James/Embiid/Maxey',
        estimatedBaseline: 'minutes and usage share are both our priors',
      },
    },
  ],

  // 2026-10-21. Lines gathered from published previews (FanDuel, BetMGM,
  // Yahoo, Bleacher Nation, The Lines) — ESPN carries no prop market. Baselines
  // are 2025-26 season figures, which are a far better sample than this
  // season's preseason: Adebayo played 73 games at 32.4 mpg, while his
  // preseason was 2 games at 14.5 mpg because he sat the last three with groin
  // tightness. Preseason rates had Larsson at 27.0 per 36; his season rate is
  // 15.5 per 36, so preseason overstated him by about 75%.
  // 2026-10-23. Lines from published previews (SportsbookReview citing FanDuel
  // and DraftKings, Sports Mole) — ESPN carries no prop market. Baselines are
  // 2025-26 season figures. Current-season baselines are NOT used: every team
  // has played one or two games, which `espnPreseason`'s sample floors
  // correctly reject.
  // Dimers flagged both of these with prices on the morning of 2026-10-23.
  'POR@SAC': [
    {
      id: 'avdija-ast',
      player: 'Deni Avdija',
      team: 'POR',
      stat: 'assists',
      line: 4.5,
      over: -125, // Dimers
      under: 105, // inferred
      baseline: { perGame: 6.8, minutes: 34, pace: 99.5 }, // 24.2 pts / 6.7 reb / 6.8 ast
      projectedMinutes: 34,
      minutesVolatility: 0.06,
      matchupFactor: 1.0,
      flags: { estimatedBaseline: 'minutes estimated', estimatedPrice: true },
    },
  ],

  'TOR@WSH': [
    {
      id: 'kawhi-pts',
      player: 'Kawhi Leonard',
      team: 'TOR',
      stat: 'points',
      line: 23.5,
      over: -116, // Dimers
      under: -104, // inferred
      // Sources conflict badly on his 2025-26 scoring: Basketball-Reference's
      // leaders page says 27.9 while another stats site says 24.3. On a 23.5
      // line that gap is decisive, so the conservative figure is used and the
      // conflict is charged for rather than split quietly down the middle.
      baseline: { perGame: 24.3, minutes: 34, pace: 99.5 },
      projectedMinutes: 34,
      minutesVolatility: 0.07,
      matchupFactor: 1.02, // Washington had the league's worst defensive rating
      flags: {
        estimatedBaseline: 'sources disagree on his scoring average, 24.3 vs 27.9; the lower is used',
        estimatedPrice: true,
      },
    },
  ],

  'NY@BOS': [
    {
      id: 'anunoby-3pm',
      player: 'OG Anunoby',
      team: 'NY',
      stat: 'threes',
      threshold: 3, // "Over 2.5 made threes"
      price: 142, // FanDuel via SportsbookReview
      baseline: { perGame: 2.3, minutes: 33.2, pace: 99.5 }, // 67 games, 38.6% on 6.1 att
      projectedMinutes: 33.2,
      minutesVolatility: 0.06,
      matchupFactor: 0.96, // Boston's defence ranked 4th by rating last season
      flags: {},
    },
    {
      id: 'george-pts',
      player: 'Paul George',
      team: 'BOS',
      stat: 'points',
      line: 17.5,
      over: -112, // DraftKings via SportsbookReview
      under: -108,
      // No 2025-26 per-game figure could be sourced, and one 38-point opening
      // night is not a baseline. Reported as NO PLAY rather than projected.
      baseline: null,
      flags: {},
    },
  ],

  // Luka's points line could not be confirmed for this game: preview articles
  // quoted 25.5, 30.5, 31.5 and 32.5, several of them for a Warriors game that
  // is not on this slate. Nothing here until a book's own number is in hand.
  'LAC@LAL': [],

  'MIN@MIA': [
    {
      id: 'adebayo-pts-17plus',
      player: 'Bam Adebayo',
      team: 'MIA',
      stat: 'points',
      threshold: 17,
      price: -121, // Bleacher Nation (book unnamed)
      baseline: { perGame: 20.1, minutes: 32.4, pace: 103.6 }, // 73 games, 2025-26
      projectedMinutes: 32.4,
      minutesVolatility: 0.07,
      // JUDGEMENT: Giannis Antetokounmpo now takes a usage share Adebayo did
      // not have to share last season. This haircut is the single biggest
      // assumption in the row.
      usageFactor: 0.88,
      matchupFactor: 0.98,
      flags: {
        roleChange: 'Giannis arrival redistributes usage — haircut is our prior',
        injuryReturn: 'missed the last three preseason games with right groin tightness',
      },
    },
    {
      id: 'adebayo-reb',
      player: 'Bam Adebayo',
      team: 'MIA',
      stat: 'rebounds',
      line: 9.5,
      over: -110, // no book price found
      under: -110,
      baseline: { perGame: 10.0, minutes: 32.4, pace: 103.6 },
      projectedMinutes: 32.4,
      minutesVolatility: 0.07,
      usageFactor: 0.88,
      matchupFactor: 0.98,
      flags: {
        roleChange: 'Giannis arrival takes frontcourt rebounds',
        injuryReturn: 'missed the last three preseason games with right groin tightness',
        estimatedPrice: true,
      },
    },
    {
      id: 'larsson-pts-11plus',
      player: 'Pelle Larsson',
      team: 'MIA',
      stat: 'points',
      threshold: 11,
      price: -130, // Bleacher Nation
      baseline: { perGame: 11.4, minutes: 26.4, pace: 103.6 }, // 70 games, 54 starts
      projectedMinutes: 26.4,
      minutesVolatility: 0.09,
      usageFactor: 0.88,
      matchupFactor: 0.98,
      flags: {
        roleChange: 'Giannis arrival redistributes usage — haircut is our prior',
        estimatedBaseline: 'reports suggest he may start, which would lift minutes above 26.4',
      },
    },
  ],

  'OKC@SA': [
    {
      id: 'wemby-pts',
      player: 'Victor Wembanyama',
      team: 'SAS',
      stat: 'points',
      line: 26.5,
      over: 108, // inferred from the sourced under
      under: -132, // Caesars (sourced)
      // No points-per-game figure was sourced; one outlet ranked him 13th
      // in scoring, which puts him in the mid-20s. This is an inference.
      baseline: { perGame: 25.0, minutes: 32, pace: 99.8 },
      projectedMinutes: 32,
      minutesVolatility: 0.07,
      matchupFactor: 0.95, // Oklahoma City had the league's best defence
      flags: {
        estimatedBaseline: 'points-per-game inferred from a scoring rank, not sourced',
        estimatedPrice: true,
      },
    },
    {
      id: 'wemby-reb',
      player: 'Victor Wembanyama',
      team: 'SAS',
      stat: 'rebounds',
      line: 11.5,
      over: -125, // inferred from the sourced under
      under: 113, // Polymarket (sourced)
      baseline: { perGame: 10.9, minutes: 32, pace: 99.8 }, // 2nd in the NBA in rebounding, 2025-26
      projectedMinutes: 32,
      minutesVolatility: 0.07,
      matchupFactor: 0.97,
      flags: {
        estimatedBaseline: 'minutes estimated',
        estimatedPrice: true,
      },
    },
    {
      id: 'wemby-ast',
      player: 'Victor Wembanyama',
      team: 'SAS',
      stat: 'assists',
      threshold: 4,
      price: 137, // Kalshi (sourced)
      baseline: null, // no assists-per-game baseline sourced
      flags: {},
    },
  ],
};

// Injury and lineup uncertainty, which this ESPN endpoint does not expose.
// Keyed the same way as PROP_SETS.
export const CURATED_CONTEXT = {
  'BOS@DET': {
    injuryNewsUncertainty: null,
    lineupUnconfirmed:
      'BOS 4th and 5th starters vary across outlets (Walsh/Scheierman/Hauser, Robinson/Queta)',
  },
  'PHI@NY': {
    injuryNewsUncertainty:
      'Anfernee Simons (PHI) day-to-day with a hamstring issue after missing the preseason',
    lineupUnconfirmed:
      'no official lineup release; outlets label the same fives both "projected" and "confirmed"',
  },
  'NY@BOS': {
    injuryNewsUncertainty: null, // the live feed supplies this game's report
    lineupUnconfirmed: 'books disagree on the number: BOS -1.5 to -2.5 and the total 221.5 to 224.5',
  },
  'LAC@LAL': {
    injuryNewsUncertainty: null,
    lineupUnconfirmed:
      'books disagree sharply: LAL -4.5 to -9.5 and the total 228.5 to 234.5 across outlets',
  },
  'MIN@MIA': {
    injuryNewsUncertainty: null, // the live feed supplies this game's report
    lineupUnconfirmed:
      'Larsson may start per beat reporting; no official Heat lineup released, and the Giannis-era rotation is unseen',
  },
  'OKC@SA': {
    injuryNewsUncertainty:
      'SAS without Tobias Harris (calf) and Jayden Quaintance (knee); OKC without Oweh, Sorber and Topic — none are starters',
    lineupUnconfirmed: 'no confirmed OKC starting five published',
  },
};

// Projected starting fives, by ESPN team abbreviation. ESPN does not publish a
// reliable pregame starting five on the endpoints this session can reach, and
// the injury penalty needs to know whether an absence is a starter or the
// twelfth man — five deep-bench absences are not the same uncertainty as one
// ruled-out star. Gathered from beat reporting; treat as projected, not
// confirmed.
export const PROJECTED_STARTERS = {
  BOS: ['Derrick White', 'Paul George', 'Jayson Tatum'], // 4th and 5th spots unsettled
  DET: ['Cade Cunningham', 'Duncan Robinson', 'Ausar Thompson', 'John Collins', 'Jalen Duren'],
  PHI: ['Tyrese Maxey', 'VJ Edgecombe', 'Jaylen Brown', 'LeBron James', 'Joel Embiid'],
  NY: ['Jalen Brunson', 'Mikal Bridges', 'Josh Hart', 'OG Anunoby', 'Karl-Anthony Towns'],
  SA: ["De'Aaron Fox", 'Dylan Harper', 'Stephon Castle', 'Devin Vassell', 'Victor Wembanyama'],
  OKC: ['Shai Gilgeous-Alexander', 'Jalen Williams', 'Chet Holmgren'], // full five not published
};

// ---------------------------------------------------------------------------
// Offline fallback slate
// ---------------------------------------------------------------------------
//
// Hand-entered snapshot of 2026-10-20 opening night, used when the ESPN feed
// cannot be reached. The odds here are a DraftKings snapshot taken by hand and
// will drift from the live board; the live path is the one to trust.

const FALLBACK_ODDS = {
  'BOS@DET': {
    moneyline: { away: -122, home: 102 },
    spread: { homeLine: 1.5, homePrice: -110, awayPrice: -110 },
    total: { line: 220.5, over: -110, under: -110 },
  },
  'PHI@NY': {
    moneyline: { away: 145, home: -170 },
    spread: { homeLine: -4.5, homePrice: -110, awayPrice: -110 },
    total: { line: 232.5, over: -110, under: -110 },
  },
  'OKC@SA': {
    moneyline: { away: -108, home: -112 },
    spread: { homeLine: -1.0, homePrice: -110, awayPrice: -110 },
    total: { line: 230.5, over: -110, under: -110 },
  },
};

const FALLBACK_META = {
  'BOS@DET': {
    id: 'bos-det',
    label: 'Celtics @ Pistons',
    tipoff: '3:00 PM ET',
    venue: 'Little Caesars Arena, Detroit',
    lineMovedAgainst:
      'opened DET -2.5, now BOS -1.5 — a 4-point move we cannot explain from our inputs',
    marketDisagreement:
      'total 220.5-222.5; one outlet posts DET -1.5 against a BOS -1.5 consensus',
  },
  'PHI@NY': {
    id: 'phi-nyk',
    label: '76ers @ Knicks',
    tipoff: '7:00 PM ET',
    venue: 'Madison Square Garden, New York',
    lineMovedAgainst: null,
    marketDisagreement: 'NYK ML ranges -170 to -180 across books',
  },
  'OKC@SA': {
    id: 'okc-sas',
    label: 'Thunder @ Spurs',
    tipoff: '9:30 PM ET',
    venue: 'Frost Bank Center, San Antonio',
    lineMovedAgainst: null,
    marketDisagreement:
      'spread runs SAS -1.5 to pick-em and the total 230.5-233 across books',
  },
};

function fallbackGame(matchup) {
  const [awayAbbr, homeAbbr] = matchup.split('@');
  const away = TEAM_RATINGS[awayAbbr];
  const home = TEAM_RATINGS[homeAbbr];
  const meta = FALLBACK_META[matchup];
  const estimated = [];
  if (away.paceEstimated) estimated.push(`${away.code} pace (from rank)`);
  if (home.paceEstimated) estimated.push(`${home.code} pace (from rank)`);
  estimated.push('spread and total juice');

  return {
    ...meta,
    source: 'fallback',
    book: 'hand-entered snapshot',
    away: { ...away, recentForm: null },
    home: { ...home, recentForm: null },
    context: {
      home: { restDays: 1, backToBack: false },
      away: { restDays: 1, backToBack: false },
    },
    odds: FALLBACK_ODDS[matchup],
    dataQuality: {
      noCurrentSeasonData: true,
      estimatedInputs: estimated,
      marketDisagreement: meta.marketDisagreement,
      lineMovedAgainst: meta.lineMovedAgainst,
      injuryNewsUncertainty: CURATED_CONTEXT[matchup].injuryNewsUncertainty,
      lineupUnconfirmed: CURATED_CONTEXT[matchup].lineupUnconfirmed,
    },
    props: PROP_SETS[matchup],
  };
}

export const NBA_SLATE = {
  date: '2026-10-20',
  label: 'NBA Opening Night - 2026-27 (offline snapshot)',
  games: ['BOS@DET', 'PHI@NY', 'OKC@SA'].map(fallbackGame),
};

export default NBA_SLATE;
