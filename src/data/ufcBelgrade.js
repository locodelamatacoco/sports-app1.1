// src/data/ufcBelgrade.js
//
// UFC Fight Night: Medić vs. Rodriguez — August 1, 2026, Belgrade Arena,
// Belgrade, Serbia (UFC's Serbian debut). Main card only.
//
// Moneylines are sourced (DraftKings/consensus via SI, MMA Mania, Hard Rock).
// Every other price is a fight-week estimate and is listed in
// `estimatedMarkets`, which makes it display-only — the model will not
// recommend a bet against a price it invented.

export const UFC_BELGRADE_CARD = {
  event: 'UFC Fight Night: Medić vs. Rodriguez — August 1, 2026 (Belgrade)',
  fights: [
    {
      id: 'belgrade-main',
      label: 'Main Event — Welterweight (5 rounds)',
      division: 'Welterweight',
      rounds: 5,
      publicTrap: true, // hometown hero headlining Serbia's first card
      estimatedMarkets: ['goesDistance', 'totalRounds', 'koA', 'koB', 'subA', 'subB', 'decA', 'decB'],
      notes:
        "Medić headlines his home country's debut card with a 100% career finish rate and three straight wins (Urbina, Salikhov, then sparking Geoff Neal in February). Rodriguez is 39, also on a three-fight streak, a durable high-volume southpaw boxer. Home-crowd + hometown-hero pricing is a classic public number. MLs sourced; all props estimated.",
      result: {
        winner: 'A',
        method: 'KO/TKO',
        round: 1,
        timeMin: 0.5,
        note: 'Medić TKO at 0:30 of round 1 — hometown demolition, his fourth straight win.',
      },
      fighterA: {
        name: 'Uroš Medić',
        record: '13-3',
        striking: {
          sigStrikesPerMin: 5.4,
          strikeDefense: 0.52,
          strikeAccuracy: 0.55,
          knockdownRate: 1.2, // huge one-shot power
          headStrikePct: 0.68,
          strikesAbsorbedPerMin: 4.1,
          powerRating: 9,
          pace: 8,
        },
        grappling: {
          takedownsPer15: 0.8,
          takedownAccuracy: 0.4,
          takedownDefense: 0.66,
          subAttemptsPer15: 0.6,
          controlRating: 4,
          scrambleAbility: 6,
        },
        factors: {
          age: 33,
          reach: 76,
          height: 73,
          stance: 'Orthodox',
          cardio: 5, // never been past round two in the UFC
          durability: 6,
          recentForm: 9,
          damageLastThree: 2,
          activityLevel: 2.5,
          shortNotice: false,
          weightCutConcerns: false,
          fiveRoundExp: 0, // first UFC main event
          oppStrength: 6,
          finishRate: 1.0, // finish-only fighter
          varianceRating: 8,
          ufcFights: 9,
          recentKOLoss: false,
          inconsistentPace: true,
        },
      },
      fighterB: {
        name: 'Daniel Rodriguez',
        record: '20-5',
        striking: {
          sigStrikesPerMin: 5.1,
          strikeDefense: 0.55,
          strikeAccuracy: 0.5,
          knockdownRate: 0.3,
          headStrikePct: 0.55,
          strikesAbsorbedPerMin: 4.4,
          powerRating: 6,
          pace: 8,
        },
        grappling: {
          takedownsPer15: 1.0,
          takedownAccuracy: 0.4,
          takedownDefense: 0.62,
          subAttemptsPer15: 0.3,
          controlRating: 5,
          scrambleAbility: 6,
        },
        factors: {
          age: 40,
          reach: 75,
          height: 72,
          stance: 'Southpaw',
          cardio: 8,
          durability: 7,
          recentForm: 8, // three-fight win streak
          damageLastThree: 4,
          activityLevel: 2,
          shortNotice: false,
          weightCutConcerns: false,
          fiveRoundExp: 1,
          oppStrength: 6,
          finishRate: 0.5,
          varianceRating: 4,
          ufcFights: 14,
          recentKOLoss: false,
          inconsistentPace: false,
        },
      },
      odds: {
        moneylineA: -380, // DraftKings
        moneylineB: 300,
        goesDistance: { yes: 175, no: -215 }, // estimated
        totalRounds: { line: 2.5, over: 105, under: -125 }, // estimated
        props: {
          koA: -110, // estimated
          koB: 800, // estimated
          subA: 1200, // estimated
          subB: 1800, // estimated
          decA: 500, // estimated
          decB: 700, // estimated
        },
      },
    },
    {
      id: 'belgrade-comain',
      label: 'Co-Main — Light Heavyweight',
      division: 'Light Heavyweight',
      rounds: 3,
      publicTrap: false,
      estimatedMarkets: ['goesDistance', 'totalRounds', 'koA', 'koB', 'subA', 'subB', 'decA', 'decB'],
      notes:
        'Błachowicz is 43 and winless in his last four (0-2-2), with one win since the Adesanya title defense in 2021. Stirling is 28, 10-0, and finished both of his 2026 appearances including Cutelaba. Textbook young-finisher-vs-faded-veteran. MLs sourced; props estimated.',
      result: {
        winner: 'A',
        method: 'KO/TKO',
        round: 1,
        note: 'Stirling knocked out Błachowicz in round 1; the 43-year-old former champ is now winless in five.',
      },
      fighterA: {
        name: 'Navajo Stirling',
        record: '10-0',
        striking: {
          sigStrikesPerMin: 4.2,
          strikeDefense: 0.6,
          strikeAccuracy: 0.52,
          knockdownRate: 0.6,
          headStrikePct: 0.6,
          strikesAbsorbedPerMin: 2.6,
          powerRating: 8,
          pace: 6,
        },
        grappling: {
          takedownsPer15: 1.6,
          takedownAccuracy: 0.5,
          takedownDefense: 0.72,
          subAttemptsPer15: 0.6,
          controlRating: 6,
          scrambleAbility: 6,
        },
        factors: {
          age: 29,
          reach: 79,
          height: 76,
          stance: 'Orthodox',
          cardio: 7,
          durability: 7,
          recentForm: 9,
          damageLastThree: 1,
          activityLevel: 3,
          shortNotice: false,
          weightCutConcerns: false,
          fiveRoundExp: 0,
          oppStrength: 5, // resume is still thin
          finishRate: 0.7,
          varianceRating: 4,
          ufcFights: 5,
          recentKOLoss: false,
          inconsistentPace: false,
        },
      },
      fighterB: {
        name: 'Jan Błachowicz',
        record: '29-11-2',
        striking: {
          sigStrikesPerMin: 3.6,
          strikeDefense: 0.56,
          strikeAccuracy: 0.48,
          knockdownRate: 0.4,
          headStrikePct: 0.5,
          strikesAbsorbedPerMin: 3.3,
          powerRating: 8,
          pace: 4,
        },
        grappling: {
          takedownsPer15: 1.1,
          takedownAccuracy: 0.42,
          takedownDefense: 0.7,
          subAttemptsPer15: 0.4,
          controlRating: 6,
          scrambleAbility: 5,
        },
        factors: {
          age: 43,
          reach: 78,
          height: 74,
          stance: 'Orthodox',
          cardio: 6,
          durability: 6,
          recentForm: 3, // 0-2-2 over his last four
          damageLastThree: 5,
          activityLevel: 0.7, // long layoff after shoulder surgery
          shortNotice: false,
          weightCutConcerns: false,
          fiveRoundExp: 5,
          oppStrength: 9,
          finishRate: 0.6,
          varianceRating: 5,
          ufcFights: 22,
          recentKOLoss: false,
          inconsistentPace: false,
        },
      },
      odds: {
        moneylineA: -325,
        moneylineB: 260,
        goesDistance: { yes: -105, no: -125 }, // estimated
        totalRounds: { line: 2.5, over: -140, under: 115 }, // estimated
        props: {
          koA: 175, // estimated
          koB: 500, // estimated
          subA: 700, // estimated
          subB: 1600, // estimated
          decA: 250, // estimated
          decB: 700, // estimated
        },
      },
    },
    {
      id: 'belgrade-rakic',
      label: 'Main Card — Heavyweight',
      division: 'Heavyweight',
      rounds: 3,
      publicTrap: false,
      estimatedMarkets: ['goesDistance', 'totalRounds', 'koA', 'koB', 'subA', 'subB', 'decA', 'decB'],
      notes:
        "Rakić is a -360 favorite despite a four-fight losing streak, moving up to heavyweight for the first time; Tybura is a 40-year-old ranked veteran with a deep grappling base. The market is pricing Rakić's athletic ceiling, not his recent results — the model is built to question exactly this shape of number. MLs sourced; props estimated.",
      result: {
        winner: 'A',
        method: 'Decision',
        round: 3,
        note: 'Rakić by unanimous decision in his heavyweight debut. The near-bet on Tybura +285 (5.5% edge, below the 7% gate) would have lost.',
      },
      fighterA: {
        name: 'Aleksandar Rakić',
        record: '14-6',
        striking: {
          sigStrikesPerMin: 3.9,
          strikeDefense: 0.57,
          strikeAccuracy: 0.5,
          knockdownRate: 0.5,
          headStrikePct: 0.55,
          strikesAbsorbedPerMin: 3.2,
          powerRating: 8,
          pace: 5,
        },
        grappling: {
          takedownsPer15: 0.9,
          takedownAccuracy: 0.42,
          takedownDefense: 0.68,
          subAttemptsPer15: 0.2,
          controlRating: 5,
          scrambleAbility: 5,
        },
        factors: {
          age: 34,
          reach: 78,
          height: 76,
          stance: 'Orthodox',
          cardio: 5, // knee injury history, fades late
          durability: 6,
          recentForm: 2, // four-fight losing streak
          damageLastThree: 5,
          activityLevel: 1.2,
          shortNotice: false,
          weightCutConcerns: false, // moving up, no cut
          fiveRoundExp: 2,
          oppStrength: 9,
          finishRate: 0.6,
          varianceRating: 5,
          ufcFights: 12,
          recentKOLoss: true,
          inconsistentPace: false,
        },
      },
      fighterB: {
        name: 'Marcin Tybura',
        record: '27-11',
        striking: {
          sigStrikesPerMin: 3.4,
          strikeDefense: 0.54,
          strikeAccuracy: 0.5,
          knockdownRate: 0.3,
          headStrikePct: 0.5,
          strikesAbsorbedPerMin: 3.5,
          powerRating: 6,
          pace: 6,
        },
        grappling: {
          takedownsPer15: 2.0,
          takedownAccuracy: 0.42,
          takedownDefense: 0.66,
          subAttemptsPer15: 0.7,
          controlRating: 7,
          scrambleAbility: 6,
        },
        factors: {
          age: 40,
          reach: 78,
          height: 75,
          stance: 'Orthodox',
          cardio: 7,
          durability: 6,
          recentForm: 5,
          damageLastThree: 4,
          activityLevel: 2,
          shortNotice: false,
          weightCutConcerns: false,
          fiveRoundExp: 1,
          oppStrength: 8,
          finishRate: 0.55,
          varianceRating: 4,
          ufcFights: 24,
          recentKOLoss: false,
          inconsistentPace: false,
        },
      },
      odds: {
        moneylineA: -360,
        moneylineB: 285,
        goesDistance: { yes: -120, no: -110 }, // estimated
        totalRounds: { line: 2.5, over: -145, under: 120 }, // estimated
        props: {
          koA: 160, // estimated
          koB: 550, // estimated
          subA: 1400, // estimated
          subB: 700, // estimated
          decA: 280, // estimated
          decB: 650, // estimated
        },
      },
    },
    {
      id: 'belgrade-todorovic',
      label: 'Main Card — Middleweight',
      division: 'Middleweight',
      rounds: 3,
      publicTrap: false,
      estimatedMarkets: ['goesDistance', 'totalRounds', 'koA', 'koB', 'subA', 'subB', 'decA', 'decB'],
      notes:
        'Todorović (13-6, 4-6 UFC) fights at home against Valentin (11-6, 1-3 UFC). Two fighters with losing octagon records — thin, low-quality inputs on both sides. MLs sourced; props estimated.',
      result: {
        winner: 'A',
        method: 'Submission',
        round: 1,
        timeMin: 4.23,
        note: 'Valentin submitted Todorović at 4:14 of round 1.',
      },
      fighterA: {
        name: 'Robert Valentin',
        record: '11-6 (1 NC)',
        striking: {
          sigStrikesPerMin: 4.3,
          strikeDefense: 0.54,
          strikeAccuracy: 0.47,
          knockdownRate: 0.4,
          headStrikePct: 0.58,
          strikesAbsorbedPerMin: 3.8,
          powerRating: 6,
          pace: 7,
        },
        grappling: {
          takedownsPer15: 1.2,
          takedownAccuracy: 0.4,
          takedownDefense: 0.6,
          subAttemptsPer15: 0.5,
          controlRating: 5,
          scrambleAbility: 6,
        },
        factors: {
          age: 29,
          reach: 75,
          height: 73,
          stance: 'Orthodox',
          cardio: 7,
          durability: 6,
          recentForm: 5,
          damageLastThree: 3,
          activityLevel: 2,
          shortNotice: false,
          weightCutConcerns: false,
          fiveRoundExp: 0,
          oppStrength: 5,
          finishRate: 0.6,
          varianceRating: 5,
          ufcFights: 4,
          recentKOLoss: false,
          inconsistentPace: false,
        },
      },
      fighterB: {
        name: 'Duško Todorović',
        record: '13-6',
        striking: {
          sigStrikesPerMin: 4.0,
          strikeDefense: 0.5,
          strikeAccuracy: 0.5,
          knockdownRate: 0.4,
          headStrikePct: 0.55,
          strikesAbsorbedPerMin: 4.5,
          powerRating: 7,
          pace: 7,
        },
        grappling: {
          takedownsPer15: 1.8,
          takedownAccuracy: 0.45,
          takedownDefense: 0.55,
          subAttemptsPer15: 0.6,
          controlRating: 6,
          scrambleAbility: 5,
        },
        factors: {
          age: 32,
          reach: 74,
          height: 73,
          stance: 'Orthodox',
          cardio: 6,
          durability: 5, // stopped several times in the UFC
          recentForm: 5,
          damageLastThree: 5,
          activityLevel: 2,
          shortNotice: false,
          weightCutConcerns: false,
          fiveRoundExp: 0,
          oppStrength: 6,
          finishRate: 0.7,
          varianceRating: 6,
          ufcFights: 10,
          recentKOLoss: true,
          inconsistentPace: false,
        },
      },
      odds: {
        moneylineA: -155,
        moneylineB: 130,
        goesDistance: { yes: -130, no: 110 }, // estimated
        totalRounds: { line: 2.5, over: -155, under: 125 }, // estimated
        props: {
          koA: 300, // estimated
          koB: 260, // estimated
          subA: 900, // estimated
          subB: 800, // estimated
          decA: 220, // estimated
          decB: 450, // estimated
        },
      },
    },
    {
      id: 'belgrade-cepo',
      label: 'Main Card — Middleweight',
      division: 'Middleweight',
      rounds: 3,
      publicTrap: false,
      estimatedMarkets: ['goesDistance', 'totalRounds', 'koA', 'koB', 'subA', 'subB', 'decA', 'decB'],
      notes:
        'Čepo (14-3) debuts at home with a 100% finish rate — all 14 wins in round one. Urbina (7-4, 1-3 UFC) has been knocked out in round one in each of his last two. Zero UFC tape on Čepo makes this the least reliable profile on the card. MLs sourced; props estimated.',
      result: {
        winner: 'B',
        method: 'KO/TKO',
        round: 1,
        timeMin: 1.02,
        note: 'Urbina stopped Čepo in 61 seconds — the raw model had Čepo at 96.7% on regional tape, and the confidence gate (4.3/10) correctly refused the bet.',
      },
      fighterA: {
        name: 'Vlasto Čepo',
        record: '14-3',
        striking: {
          sigStrikesPerMin: 5.5,
          strikeDefense: 0.5,
          strikeAccuracy: 0.55,
          knockdownRate: 1.4,
          headStrikePct: 0.68,
          strikesAbsorbedPerMin: 4.0,
          powerRating: 9,
          pace: 8,
        },
        grappling: {
          takedownsPer15: 1.2,
          takedownAccuracy: 0.45,
          takedownDefense: 0.6,
          subAttemptsPer15: 1.2,
          controlRating: 5,
          scrambleAbility: 6,
        },
        factors: {
          age: 28,
          reach: 76,
          height: 74,
          stance: 'Orthodox',
          cardio: 4, // has literally never seen round two
          durability: 6,
          recentForm: 8,
          damageLastThree: 1,
          activityLevel: 2.5,
          shortNotice: false,
          weightCutConcerns: false,
          fiveRoundExp: 0,
          oppStrength: 3, // regional competition
          finishRate: 1.0,
          varianceRating: 8,
          ufcFights: 0, // promotional debut
          recentKOLoss: false,
          inconsistentPace: true,
        },
      },
      fighterB: {
        name: 'Gilbert Urbina',
        record: '7-4',
        striking: {
          sigStrikesPerMin: 3.4,
          strikeDefense: 0.46,
          strikeAccuracy: 0.45,
          knockdownRate: 0.2,
          headStrikePct: 0.55,
          strikesAbsorbedPerMin: 5.0,
          powerRating: 5,
          pace: 6,
        },
        grappling: {
          takedownsPer15: 1.5,
          takedownAccuracy: 0.4,
          takedownDefense: 0.5,
          subAttemptsPer15: 0.8,
          controlRating: 5,
          scrambleAbility: 5,
        },
        factors: {
          age: 31,
          reach: 78,
          height: 74,
          stance: 'Southpaw',
          cardio: 6,
          durability: 4, // R1 KO'd in each of his last two
          recentForm: 2,
          damageLastThree: 7,
          activityLevel: 1.5,
          shortNotice: false,
          weightCutConcerns: false,
          fiveRoundExp: 0,
          oppStrength: 5,
          finishRate: 0.6,
          varianceRating: 6,
          ufcFights: 4,
          recentKOLoss: true,
          inconsistentPace: false,
        },
      },
      odds: {
        moneylineA: -355,
        moneylineB: 280,
        goesDistance: { yes: 200, no: -250 }, // estimated
        totalRounds: { line: 1.5, over: 110, under: -130 }, // estimated
        props: {
          koA: -140, // estimated
          koB: 700, // estimated
          subA: 800, // estimated
          subB: 900, // estimated
          decA: 650, // estimated
          decB: 1200, // estimated
        },
      },
    },
    {
      id: 'belgrade-janicic',
      label: 'Main Card — Lightweight',
      division: 'Lightweight',
      rounds: 3,
      publicTrap: false,
      estimatedMarkets: ['goesDistance', 'totalRounds', 'koA', 'koB', 'subA', 'subB', 'decA', 'decB'],
      notes:
        'Both men are making their UFC debuts — Janičić (19-3) on an eight-fight streak, Gugnon (9-2). No octagon tape on either fighter; these are the weakest inputs on the card and the model should say so. MLs sourced; props estimated.',
      result: {
        winner: 'A',
        method: 'Submission',
        round: 1,
        timeMin: 1.35,
        note: 'Gugnon submitted Janičić with a rear-naked choke at 1:21 of round 1 in a battle of debutants.',
      },
      fighterA: {
        name: 'Noah Gugnon',
        record: '9-2',
        striking: {
          sigStrikesPerMin: 4.4,
          strikeDefense: 0.55,
          strikeAccuracy: 0.48,
          knockdownRate: 0.4,
          headStrikePct: 0.58,
          strikesAbsorbedPerMin: 3.4,
          powerRating: 6,
          pace: 7,
        },
        grappling: {
          takedownsPer15: 1.6,
          takedownAccuracy: 0.45,
          takedownDefense: 0.65,
          subAttemptsPer15: 0.7,
          controlRating: 6,
          scrambleAbility: 6,
        },
        factors: {
          age: 27,
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
          finishRate: 0.55,
          varianceRating: 5,
          ufcFights: 0,
          recentKOLoss: false,
          inconsistentPace: false,
        },
      },
      fighterB: {
        name: 'Miloš Janičić',
        record: '19-3',
        striking: {
          sigStrikesPerMin: 4.1,
          strikeDefense: 0.53,
          strikeAccuracy: 0.5,
          knockdownRate: 0.5,
          headStrikePct: 0.6,
          strikesAbsorbedPerMin: 3.6,
          powerRating: 7,
          pace: 7,
        },
        grappling: {
          takedownsPer15: 1.8,
          takedownAccuracy: 0.45,
          takedownDefense: 0.62,
          subAttemptsPer15: 1.0,
          controlRating: 6,
          scrambleAbility: 6,
        },
        factors: {
          age: 29,
          reach: 73,
          height: 71,
          stance: 'Orthodox',
          cardio: 7,
          durability: 7,
          recentForm: 8, // eight-fight win streak
          damageLastThree: 2,
          activityLevel: 2.5,
          shortNotice: false,
          weightCutConcerns: false,
          fiveRoundExp: 0,
          oppStrength: 3,
          finishRate: 0.8,
          varianceRating: 5,
          ufcFights: 0,
          recentKOLoss: false,
          inconsistentPace: false,
        },
      },
      odds: {
        moneylineA: -120,
        moneylineB: 100,
        goesDistance: { yes: -140, no: 115 }, // estimated
        totalRounds: { line: 2.5, over: -165, under: 135 }, // estimated
        props: {
          koA: 350, // estimated
          koB: 280, // estimated
          subA: 800, // estimated
          subB: 600, // estimated
          decA: 260, // estimated
          decB: 300, // estimated
        },
      },
    },
  ],
};
