// src/data/ufcOkc.js
//
// UFC Fight Night: du Plessis vs. Usman — July 18, 2026, Paycom Center,
// Oklahoma City. Main-card matchups; stat profiles hand-built from public
// career stats and fight-week reporting. Moneylines sourced from
// DraftKings/consensus (CBS Sports, SportsLine, MMA Mania); the main-event
// round total line (3.5) is sourced. All other prop prices are estimates —
// treat those edges as indicative only.

export const UFC_OKC_CARD = {
  event: 'UFC Fight Night: du Plessis vs. Usman — July 18, 2026 (Oklahoma City)',
  fights: [
    {
      id: 'okc-main',
      label: 'Main Event — Middleweight (5 rounds)',
      division: 'Middleweight',
      rounds: 5,
      publicTrap: false,
      estimatedMarkets: ['goesDistance', 'totalRounds', 'koA', 'koB', 'subA', 'subB', 'decA', 'decB'],
      notes:
        "du Plessis' first fight since Chimaev took his belt and exposed his takedown defense; Usman is 39, moving up from welterweight after 13 months off, but remains an elite wrestler with a champion's control game. MLs and the 3.5 total sourced; other props estimated.",
      result: {
        winner: 'A',
        method: 'Decision',
        round: 5,
        note: 'du Plessis by unanimous decision — the ex-champ returned to the win column; the 39-year-old Usman could not impose his wrestling.',
      },
      fighterA: {
        name: 'Dricus du Plessis',
        record: '23-3',
        striking: {
          sigStrikesPerMin: 5.9,
          strikeDefense: 0.49, // hittable — relies on durability and pressure
          strikeAccuracy: 0.55,
          knockdownRate: 0.5,
          headStrikePct: 0.6,
          strikesAbsorbedPerMin: 4.2,
          powerRating: 8,
          pace: 8,
        },
        grappling: {
          takedownsPer15: 1.8,
          takedownAccuracy: 0.45,
          takedownDefense: 0.51, // the hole Chimaev drove a truck through
          subAttemptsPer15: 0.8,
          controlRating: 6,
          scrambleAbility: 6,
        },
        factors: {
          age: 32,
          reach: 76,
          height: 73,
          stance: 'Switch',
          cardio: 8,
          durability: 8,
          recentForm: 5, // dominant title run, then one-sided loss to Chimaev
          damageLastThree: 3,
          activityLevel: 1.5,
          shortNotice: false,
          weightCutConcerns: false,
          fiveRoundExp: 6,
          oppStrength: 9,
          finishRate: 0.8,
          varianceRating: 6, // chaotic, awkward rhythm
          ufcFights: 10,
          recentKOLoss: false,
          inconsistentPace: true,
        },
      },
      fighterB: {
        name: 'Kamaru Usman',
        record: '21-4',
        striking: {
          sigStrikesPerMin: 4.4,
          strikeDefense: 0.57,
          strikeAccuracy: 0.52,
          knockdownRate: 0.4,
          headStrikePct: 0.55,
          strikesAbsorbedPerMin: 2.7,
          powerRating: 6, // power hasn't followed him up a division
          pace: 6,
        },
        grappling: {
          takedownsPer15: 2.6,
          takedownAccuracy: 0.47,
          takedownDefense: 0.92,
          subAttemptsPer15: 0.2,
          controlRating: 8,
          scrambleAbility: 7,
        },
        factors: {
          age: 39,
          reach: 76,
          height: 72,
          stance: 'Orthodox',
          cardio: 8,
          durability: 7, // Edwards head-kick KO now four fights back
          recentForm: 6, // convincing decision over Buckley in June 2025
          damageLastThree: 3,
          activityLevel: 0.8, // one fight in ~2.5 years
          shortNotice: false,
          weightCutConcerns: false, // moving up — but undersized at MW
          fiveRoundExp: 8,
          oppStrength: 9,
          finishRate: 0.45,
          varianceRating: 3, // most consistent grinder of his era
          ufcFights: 20,
          recentKOLoss: false,
          inconsistentPace: false,
        },
      },
      odds: {
        moneylineA: -245, // DraftKings
        moneylineB: 200,
        goesDistance: { yes: 140, no: -170 }, // estimated
        totalRounds: { line: 3.5, over: -115, under: -105 }, // line sourced, prices estimated
        props: {
          koA: 160, // estimated
          koB: 900, // estimated
          subA: 500, // estimated
          subB: 1400, // estimated
          decA: 330, // estimated
          decB: 320, // estimated
        },
      },
    },
    {
      id: 'okc-comain',
      label: 'Co-Main — Middleweight',
      division: 'Middleweight',
      rounds: 3,
      publicTrap: false,
      estimatedMarkets: ['goesDistance', 'totalRounds', 'koA', 'koB', 'subA', 'subB', 'decA', 'decB'],
      notes:
        'Duncan rides a four-fight streak (three 2025 wins incl. back-to-back spinning-attack finishes, then a decision over Dolidze in March); Cannonier is 42, in year 12 on the roster, and has split his last six. MLs sourced; props estimated.',
      result: {
        winner: 'A',
        method: 'Decision',
        round: 3,
        note: 'Duncan by unanimous decision, extending his streak to five.',
      },
      fighterA: {
        name: 'Christian Leroy Duncan',
        record: '12-2',
        striking: {
          sigStrikesPerMin: 4.0,
          strikeDefense: 0.62, // rangy and elusive
          strikeAccuracy: 0.54,
          knockdownRate: 0.7,
          headStrikePct: 0.6,
          strikesAbsorbedPerMin: 2.6,
          powerRating: 8,
          pace: 6,
        },
        grappling: {
          takedownsPer15: 0.7,
          takedownAccuracy: 0.55,
          takedownDefense: 0.78,
          subAttemptsPer15: 0.2,
          controlRating: 4,
          scrambleAbility: 6,
        },
        factors: {
          age: 30,
          reach: 79,
          height: 73,
          stance: 'Southpaw',
          cardio: 7,
          durability: 7,
          recentForm: 8,
          damageLastThree: 1,
          activityLevel: 2.5,
          shortNotice: false,
          weightCutConcerns: false,
          fiveRoundExp: 0,
          oppStrength: 6,
          finishRate: 0.7,
          varianceRating: 5, // spinning-attack flash carries risk
          ufcFights: 9,
          recentKOLoss: false,
          inconsistentPace: true, // patient, low-output stretches
        },
      },
      fighterB: {
        name: 'Jared Cannonier',
        record: '18-9',
        striking: {
          sigStrikesPerMin: 4.5,
          strikeDefense: 0.56,
          strikeAccuracy: 0.49,
          knockdownRate: 0.5,
          headStrikePct: 0.55,
          strikesAbsorbedPerMin: 3.9,
          powerRating: 8,
          pace: 6,
        },
        grappling: {
          takedownsPer15: 0.4,
          takedownAccuracy: 0.45,
          takedownDefense: 0.72,
          subAttemptsPer15: 0.1,
          controlRating: 4,
          scrambleAbility: 5,
        },
        factors: {
          age: 42,
          reach: 77,
          height: 71,
          stance: 'Switch',
          cardio: 6,
          durability: 6, // stopped by Imavov in 2024, 12 years of wear
          recentForm: 5, // split of last six incl. KO of Rodrigues
          damageLastThree: 4,
          activityLevel: 1.5,
          shortNotice: false,
          weightCutConcerns: false,
          fiveRoundExp: 4,
          oppStrength: 8,
          finishRate: 0.65,
          varianceRating: 4,
          ufcFights: 17,
          recentKOLoss: false,
          inconsistentPace: false,
        },
      },
      odds: {
        moneylineA: -370,
        moneylineB: 265,
        goesDistance: { yes: 110, no: -135 }, // estimated
        totalRounds: { line: 2.5, over: -130, under: 105 }, // estimated
        props: {
          koA: 105, // estimated
          koB: 450, // estimated
          subA: 1200, // estimated
          subB: 2000, // estimated
          decA: 250, // estimated
          decB: 700, // estimated
        },
      },
    },
    {
      id: 'okc-hooper',
      label: 'Main Card — Lightweight',
      division: 'Lightweight',
      rounds: 3,
      publicTrap: false,
      estimatedMarkets: ['goesDistance', 'totalRounds', 'koA', 'koB', 'subA', 'subB', 'decA', 'decB'],
      notes:
        'Hooper, 26, has grown from teenage prospect into a legitimate submission machine on a long win streak; Ramirez is a hittable brawler with three UFC fights. MLs sourced; props estimated.',
      result: {
        winner: 'A',
        method: 'Submission',
        round: 1,
        timeMin: 2.25,
        note: 'Hooper rear-naked choke at 2:15 of round 1 — the exact grappler-underrated-by-the-engine scenario flagged before the fight.',
      },
      fighterA: {
        name: 'Chase Hooper',
        record: '17-3-1',
        striking: {
          sigStrikesPerMin: 3.5,
          strikeDefense: 0.45, // still the weak phase
          strikeAccuracy: 0.55,
          knockdownRate: 0.2,
          headStrikePct: 0.5,
          strikesAbsorbedPerMin: 3.3,
          powerRating: 4,
          pace: 7,
        },
        grappling: {
          takedownsPer15: 2.5,
          takedownAccuracy: 0.4,
          takedownDefense: 0.55,
          subAttemptsPer15: 2.5, // elite attempt volume
          controlRating: 7,
          scrambleAbility: 9,
        },
        factors: {
          age: 26,
          reach: 71,
          height: 73,
          stance: 'Orthodox',
          cardio: 8,
          durability: 7,
          recentForm: 8,
          damageLastThree: 2,
          activityLevel: 2.5,
          shortNotice: false,
          weightCutConcerns: false,
          fiveRoundExp: 0,
          oppStrength: 5,
          finishRate: 0.75,
          varianceRating: 5,
          ufcFights: 14,
          recentKOLoss: false,
          inconsistentPace: false,
        },
      },
      fighterB: {
        name: 'Mitch Ramirez',
        record: '9-3',
        striking: {
          sigStrikesPerMin: 4.8,
          strikeDefense: 0.48,
          strikeAccuracy: 0.45,
          knockdownRate: 0.5,
          headStrikePct: 0.62,
          strikesAbsorbedPerMin: 5.5, // brawls happily
          powerRating: 7,
          pace: 8,
        },
        grappling: {
          takedownsPer15: 0.5,
          takedownAccuracy: 0.35,
          takedownDefense: 0.6,
          subAttemptsPer15: 0.2,
          controlRating: 3,
          scrambleAbility: 4,
        },
        factors: {
          age: 28,
          reach: 72,
          height: 70,
          stance: 'Orthodox',
          cardio: 6,
          durability: 6,
          recentForm: 5,
          damageLastThree: 4,
          activityLevel: 2.5,
          shortNotice: false,
          weightCutConcerns: false,
          fiveRoundExp: 0,
          oppStrength: 4,
          finishRate: 0.7,
          varianceRating: 7,
          ufcFights: 3, // low UFC sample
          recentKOLoss: false,
          inconsistentPace: false,
        },
      },
      odds: {
        moneylineA: -370,
        moneylineB: 265,
        goesDistance: { yes: 145, no: -175 }, // estimated
        totalRounds: { line: 2.5, over: 120, under: -145 }, // estimated
        props: {
          koA: 600, // estimated
          koB: 400, // estimated
          subA: 100, // estimated — the market's expected outcome
          subB: 2500, // estimated
          decA: 330, // estimated
          decB: 900, // estimated
        },
      },
    },
    {
      id: 'okc-mcmillen',
      label: 'Main Card — Featherweight',
      division: 'Featherweight',
      rounds: 3,
      publicTrap: false,
      estimatedMarkets: ['goesDistance', 'totalRounds', 'koA', 'koB', 'subA', 'subB', 'decA', 'decB'],
      notes:
        'Two Contender Series-era prospects with tiny UFC samples — exactly the kind of fight the model is built to pass on. Stat profiles here carry the most uncertainty on the card. MLs sourced; props estimated.',
      result: {
        winner: 'A',
        method: 'KO/TKO',
        round: 3,
        timeMin: 3.48,
        note: 'McMillen TKO at 3:29 of round 3 after landing a UFC three-round-record 252 significant strikes. Performance of the Night.',
      },
      fighterA: {
        name: 'Tommy McMillen',
        record: '9-1',
        striking: {
          sigStrikesPerMin: 4.5,
          strikeDefense: 0.52,
          strikeAccuracy: 0.48,
          knockdownRate: 0.5,
          headStrikePct: 0.58,
          strikesAbsorbedPerMin: 3.5,
          powerRating: 6,
          pace: 7,
        },
        grappling: {
          takedownsPer15: 1.5,
          takedownAccuracy: 0.45,
          takedownDefense: 0.65,
          subAttemptsPer15: 0.8,
          controlRating: 5,
          scrambleAbility: 6,
        },
        factors: {
          age: 26,
          reach: 72,
          height: 70,
          stance: 'Orthodox',
          cardio: 7,
          durability: 7,
          recentForm: 7,
          damageLastThree: 2,
          activityLevel: 2.5,
          shortNotice: false,
          weightCutConcerns: false,
          fiveRoundExp: 0,
          oppStrength: 3,
          finishRate: 0.65,
          varianceRating: 5,
          ufcFights: 2, // low UFC sample
          recentKOLoss: false,
          inconsistentPace: false,
        },
      },
      fighterB: {
        name: 'Alberto Montes',
        record: '10-2',
        striking: {
          sigStrikesPerMin: 4.2,
          strikeDefense: 0.54,
          strikeAccuracy: 0.47,
          knockdownRate: 0.4,
          headStrikePct: 0.55,
          strikesAbsorbedPerMin: 3.6,
          powerRating: 6,
          pace: 6,
        },
        grappling: {
          takedownsPer15: 1.2,
          takedownAccuracy: 0.4,
          takedownDefense: 0.62,
          subAttemptsPer15: 0.6,
          controlRating: 5,
          scrambleAbility: 6,
        },
        factors: {
          age: 25,
          reach: 73,
          height: 71,
          stance: 'Southpaw',
          cardio: 7,
          durability: 7,
          recentForm: 6,
          damageLastThree: 2,
          activityLevel: 2,
          shortNotice: false,
          weightCutConcerns: false,
          fiveRoundExp: 0,
          oppStrength: 3,
          finishRate: 0.6,
          varianceRating: 5,
          ufcFights: 3, // low UFC sample
          recentKOLoss: false,
          inconsistentPace: false,
        },
      },
      odds: {
        moneylineA: -157,
        moneylineB: 123,
        goesDistance: { yes: -140, no: 115 }, // estimated
        totalRounds: { line: 2.5, over: -160, under: 130 }, // estimated
        props: {
          koA: 250, // estimated
          koB: 330, // estimated
          subA: 700, // estimated
          subB: 800, // estimated
          decA: 260, // estimated
          decB: 400, // estimated
        },
      },
    },
  ],
};
