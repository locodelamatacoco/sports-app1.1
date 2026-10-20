// src/data/nbaGames.js
//
// NBA slate for 2026-10-20 (opening night of the 2026-27 season).
//
// SOURCING RULES FOR THIS FILE
// ----------------------------
// Every number below is one of three things, and the model treats them
// differently:
//
//   1. SOURCED   — reported by a book or a stats outlet. Used as-is.
//   2. ESTIMATED — inferred from a rank, a neighbouring figure, or the other
//                  side of a two-way price. Flagged in `dataQuality` /
//                  `flags` so the confidence dampener charges for it.
//   3. JUDGEMENT — our own prior, mainly `rosterAdj` (what a roster change is
//                  worth per 100 possessions) and `usageFactor`. Flagged as
//                  roster turnover so the dampener charges for it too.
//
// Opening night is the worst-case input environment for this model: there is
// no current-season form, no current-season minutes, and several of these
// rosters barely resemble the teams that produced the ratings below. The
// dampener is expected to reject most of the board, and that is the correct
// output rather than a failure.
//
// Ratings are 2025-26 regular season, points per 100 possessions. Pace is
// possessions per 48 minutes on a league-average-99.5 scale; only Boston's
// figure is directly sourced (95.6, slowest in the league), the rest are
// mapped from published pace ranks using a 1.84-possession league SD, which
// reproduces Boston's sourced figure at rank 30.
//
// That scale checks out against the board: inverting each posted total
// through our efficiency estimates implies 96.7 possessions for BOS/DET,
// 99.0 for PHI/NYK and 102.7 for OKC/SAS — an average of 99.5, matching the
// league-average constant. The per-game ordering does not match as well
// (the market prices OKC/SAS about 3 possessions faster than the ranks
// suggest), which is why `projectGame` reports market-implied possessions
// next to its own and the dampener charges for the gap.

export const NBA_SLATE = {
  date: '2026-10-20',
  label: 'NBA Opening Night — 2026-27',
  games: [
    // -----------------------------------------------------------------------
    {
      id: 'bos-det',
      label: 'Celtics @ Pistons',
      tipoff: '3:00 PM ET',
      venue: 'Little Caesars Arena, Detroit',
      away: {
        code: 'BOS',
        name: 'Boston Celtics',
        record: '56-26 (2025-26)',
        ratings: { off: 120.0, def: 111.7, pace: 95.6 }, // off 2nd, def 4th, slowest pace in the league
        // Lost Jaylen Brown (28.7 ppg, 36.2% usage — 2nd in the NBA), added
        // Paul George, and Jayson Tatum returns from a 16-game season.
        // The market disagrees with the direction of this adjustment: last
        // season's net ratings have these two teams level, which with home
        // court would make Detroit a ~2.5-point favourite, and instead the
        // line is Boston -1.5. Left in as our honest prior, and the
        // divergence guard is what stops it being bet.
        rosterAdj: { off: -2.5, def: 0.5 },
        turnover: 'high',
        recentForm: null, // no current-season sample on opening night
      },
      home: {
        code: 'DET',
        name: 'Detroit Pistons',
        record: '60-22 (2025-26)',
        ratings: { off: 117.3, def: 108.9, pace: 99.4 }, // off 9th, def 2nd, pace 16th
        // Cunningham/Duren/Thompson core intact; John Collins and Duncan
        // Robinson project into the starting five.
        rosterAdj: { off: 1.0, def: 0.5 },
        turnover: 'moderate',
        recentForm: null,
      },
      context: {
        home: { restDays: 1, backToBack: false },
        away: { restDays: 1, backToBack: false },
      },
      odds: {
        // DraftKings pricing, kept as one internally consistent book.
        moneyline: { away: -122, home: 102 },
        spread: { homeLine: 1.5, homePrice: -110, awayPrice: -110 },
        total: { line: 220.5, over: -110, under: -110 },
      },
      dataQuality: {
        noCurrentSeasonData: true,
        estimatedInputs: ['DET pace (from rank)', 'spread juice'],
        marketDisagreement: 'total 220.5–222.5; one outlet posts DET -1.5 against a BOS -1.5 consensus',
        lineMovedAgainst: 'opened DET -2.5, now BOS -1.5 — a 4-point move we cannot explain from our inputs',
        injuryNewsUncertainty: null,
        lineupUnconfirmed: 'BOS 4th and 5th starters vary across outlets (Walsh/Scheierman/Hauser, Robinson/Queta)',
      },
      props: [
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
    },

    // -----------------------------------------------------------------------
    {
      id: 'phi-nyk',
      label: '76ers @ Knicks',
      tipoff: '7:00 PM ET',
      venue: 'Madison Square Garden, New York',
      away: {
        code: 'PHI',
        name: 'Philadelphia 76ers',
        record: '45-37 (2025-26)',
        ratings: { off: 114.3, def: 114.4, pace: 100.0 }, // off 16th, def 17th, net -0.1 (18th), pace 13th
        // Judgement, and the single largest one on this slate: last season's
        // ratings describe a team that did not have LeBron James or Jaylen
        // Brown on it. Both now project into the starting five.
        rosterAdj: { off: 4.5, def: -0.5 },
        turnover: 'high',
        recentForm: null,
      },
      home: {
        code: 'NYK',
        name: 'New York Knicks',
        record: '53-29 (2025-26)',
        ratings: { off: 118.7, def: 112.3, pace: 99.5 }, // off 3rd, def 7th; pace not sourced
        // Defending champions with the core five intact.
        rosterAdj: { off: 0, def: 0 },
        turnover: 'low',
        recentForm: null,
      },
      context: {
        home: { restDays: 1, backToBack: false },
        away: { restDays: 1, backToBack: false },
      },
      odds: {
        moneyline: { away: 145, home: -170 },
        spread: { homeLine: -4.5, homePrice: -110, awayPrice: -110 },
        total: { line: 232.5, over: -110, under: -110 },
      },
      dataQuality: {
        noCurrentSeasonData: true,
        estimatedInputs: ['NYK pace (not sourced)', 'PHI pace (from rank)', 'spread and total juice'],
        marketDisagreement: 'NYK ML ranges -170 to -180 across books',
        lineMovedAgainst: null,
        injuryNewsUncertainty: 'a PHI veteran guard missed the entire preseason with hamstring soreness; availability unclear',
        lineupUnconfirmed: 'no official lineup release; outlets label the same fives both "projected" and "confirmed"',
      },
      props: [
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
    },

    // -----------------------------------------------------------------------
    {
      id: 'okc-sas',
      label: 'Thunder @ Spurs',
      tipoff: '9:30 PM ET',
      venue: 'Frost Bank Center, San Antonio',
      away: {
        code: 'OKC',
        name: 'Oklahoma City Thunder',
        record: '64-18 (2025-26)',
        ratings: { off: 117.6, def: 106.5, pace: 99.0 }, // off 7th, def 1st, net +11.1 (1st), pace 18th
        rosterAdj: { off: 0, def: 0 },
        turnover: 'low',
        recentForm: null,
      },
      home: {
        code: 'SAS',
        name: 'San Antonio Spurs',
        record: '62-20 (2025-26)',
        ratings: { off: 118.7, def: 110.4, pace: 99.8 }, // off 4th, def 3rd, net +8.4, pace 14th
        // Dylan Harper into a three-guard starting group beside Fox and Castle.
        rosterAdj: { off: 1.0, def: -0.5 },
        turnover: 'moderate',
        recentForm: null,
      },
      context: {
        home: { restDays: 1, backToBack: false },
        away: { restDays: 1, backToBack: false },
      },
      odds: {
        moneyline: { away: -108, home: -112 },
        spread: { homeLine: -1.0, homePrice: -110, awayPrice: -110 },
        total: { line: 230.5, over: -110, under: -110 },
      },
      dataQuality: {
        noCurrentSeasonData: true,
        estimatedInputs: ['OKC pace (from rank)', 'SAS pace (from rank)', 'spread juice'],
        marketDisagreement: 'spread runs SAS -1.5 to pick-em and the total 230.5–233 across books',
        lineMovedAgainst: null,
        injuryNewsUncertainty: 'SAS without Tobias Harris (calf) and Jayden Quaintance (knee); OKC without Oweh, Sorber and Topic — none are starters',
        lineupUnconfirmed: 'no confirmed OKC starting five published',
      },
      props: [
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
    },
  ],
};

export default NBA_SLATE;
