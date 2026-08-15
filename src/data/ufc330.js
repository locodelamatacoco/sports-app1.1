// src/data/ufc330.js
//
// UFC 330: Makhachev vs. Machado Garry — August 15, 2026, Xfinity Mobile
// Arena, Philadelphia. Main card.
//
// Moneylines sourced (DraftKings/consensus via SI, Forbes, CBS Sports,
// MMA News). All other prices are fight-week estimates, declared in
// `estimatedMarkets` and therefore display-only — the model will not
// recommend a bet against a price it invented.

export const UFC_330_CARD = {
  event: 'UFC 330: Makhachev vs. Machado Garry — August 15, 2026 (Philadelphia)',
  fights: [
    {
      id: 'ufc330-main',
      label: 'Main Event — Welterweight Title (5 rounds)',
      division: 'Welterweight',
      rounds: 5,
      publicTrap: false,
      estimatedMarkets: ['goesDistance', 'totalRounds', 'koA', 'koB', 'subA', 'subB', 'decA', 'decB'],
      notes:
        'Makhachev defends the welterweight belt on a 16-fight win streak — a win passes Anderson Silva for the longest in UFC history. Machado Garry is undefeated, coming off wins over Prates and Belal Muhammad, with a big height/reach edge but a grappling test ahead of him. MLs sourced; props estimated.',
      fighterA: {
        name: 'Islam Makhachev',
        record: '28-1',
        striking: {
          sigStrikesPerMin: 3.2,
          strikeDefense: 0.62,
          strikeAccuracy: 0.58,
          knockdownRate: 0.3,
          headStrikePct: 0.5,
          strikesAbsorbedPerMin: 1.6, // barely gets hit
          powerRating: 7,
          pace: 7,
        },
        grappling: {
          takedownsPer15: 3.4,
          takedownAccuracy: 0.62,
          takedownDefense: 0.87,
          subAttemptsPer15: 1.2,
          controlRating: 10,
          scrambleAbility: 9,
        },
        factors: {
          age: 34,
          reach: 70,
          height: 70,
          stance: 'Southpaw',
          cardio: 10,
          durability: 9,
          recentForm: 10,
          damageLastThree: 1,
          activityLevel: 1.5,
          shortNotice: false,
          weightCutConcerns: false, // up at 170 now, easier cut
          fiveRoundExp: 7,
          oppStrength: 10,
          finishRate: 0.68,
          varianceRating: 2, // the most reliable profile in the sport
          ufcFights: 17,
          recentKOLoss: false,
          inconsistentPace: false,
        },
      },
      fighterB: {
        name: 'Ian Machado Garry',
        record: '19-0',
        striking: {
          sigStrikesPerMin: 4.6,
          strikeDefense: 0.61,
          strikeAccuracy: 0.51,
          knockdownRate: 0.3,
          headStrikePct: 0.55,
          strikesAbsorbedPerMin: 2.9,
          powerRating: 6,
          pace: 8,
        },
        grappling: {
          takedownsPer15: 0.9,
          takedownAccuracy: 0.45,
          takedownDefense: 0.72, // untested against this level of wrestling
          subAttemptsPer15: 0.3,
          controlRating: 5,
          scrambleAbility: 7,
        },
        factors: {
          age: 28,
          reach: 75,
          height: 75,
          stance: 'Orthodox',
          cardio: 8,
          durability: 7,
          recentForm: 9, // beat Prates and Belal Muhammad
          damageLastThree: 2,
          activityLevel: 2,
          shortNotice: false,
          weightCutConcerns: false,
          fiveRoundExp: 1,
          oppStrength: 9,
          finishRate: 0.53,
          varianceRating: 3,
          ufcFights: 11,
          recentKOLoss: false,
          inconsistentPace: false,
        },
      },
      odds: {
        moneylineA: -360,
        moneylineB: 285,
        goesDistance: { yes: -150, no: 125 }, // estimated
        totalRounds: { line: 3.5, over: -160, under: 130 }, // estimated
        props: {
          koA: 500, // estimated
          koB: 800, // estimated
          subA: 300, // estimated
          subB: 2500, // estimated
          decA: 130, // estimated
          decB: 600, // estimated
        },
      },
    },
    {
      id: 'ufc330-comain',
      label: "Co-Main — Women's Strawweight Title (5 rounds)",
      division: "Women's Strawweight",
      rounds: 5,
      publicTrap: false,
      estimatedMarkets: ['goesDistance', 'totalRounds', 'koA', 'koB', 'subA', 'subB', 'decA', 'decB'],
      notes:
        "Dern's first defense of the strawweight belt against Robertson — a grappler-vs-grappler title fight between the two most active submission threats in the division. Dern is the superior pure BJJ player; Robertson is the bigger, more physical top-control wrestler. MLs sourced; props estimated.",
      fighterA: {
        name: 'Mackenzie Dern',
        record: '17-5',
        striking: {
          sigStrikesPerMin: 4.4,
          strikeDefense: 0.55,
          strikeAccuracy: 0.44,
          knockdownRate: 0.2,
          headStrikePct: 0.6,
          strikesAbsorbedPerMin: 4.3, // hittable in exchanges
          powerRating: 5,
          pace: 8,
        },
        grappling: {
          takedownsPer15: 1.3,
          takedownAccuracy: 0.4,
          takedownDefense: 0.6,
          subAttemptsPer15: 2.8, // elite submission volume
          controlRating: 7,
          scrambleAbility: 9,
        },
        factors: {
          age: 33,
          reach: 63,
          height: 64,
          stance: 'Orthodox',
          cardio: 7,
          durability: 7,
          recentForm: 9, // won the title in her last outing
          damageLastThree: 3,
          activityLevel: 2,
          shortNotice: false,
          weightCutConcerns: true, // long history of missed weight at 115
          fiveRoundExp: 1,
          oppStrength: 8,
          finishRate: 0.65,
          varianceRating: 5,
          ufcFights: 17,
          recentKOLoss: false,
          inconsistentPace: false,
        },
      },
      fighterB: {
        name: 'Gillian Robertson',
        record: '15-8',
        striking: {
          sigStrikesPerMin: 3.3,
          strikeDefense: 0.5,
          strikeAccuracy: 0.46,
          knockdownRate: 0.15,
          headStrikePct: 0.5,
          strikesAbsorbedPerMin: 3.6,
          powerRating: 4,
          pace: 6,
        },
        grappling: {
          takedownsPer15: 3.6,
          takedownAccuracy: 0.45,
          takedownDefense: 0.58,
          subAttemptsPer15: 2.2, // most subs in women's UFC history
          controlRating: 8,
          scrambleAbility: 7,
        },
        factors: {
          age: 31,
          reach: 65,
          height: 65,
          stance: 'Orthodox',
          cardio: 7,
          durability: 6,
          recentForm: 7,
          damageLastThree: 3,
          activityLevel: 2.5,
          shortNotice: false,
          weightCutConcerns: false,
          fiveRoundExp: 0,
          oppStrength: 7,
          finishRate: 0.73,
          varianceRating: 5,
          ufcFights: 17,
          recentKOLoss: false,
          inconsistentPace: false,
        },
      },
      odds: {
        moneylineA: -198,
        moneylineB: 164,
        goesDistance: { yes: 120, no: -145 }, // estimated
        totalRounds: { line: 3.5, over: -125, under: 105 }, // estimated
        props: {
          koA: 900, // estimated
          koB: 1600, // estimated
          subA: 250, // estimated
          subB: 450, // estimated
          decA: 200, // estimated
          decB: 450, // estimated
        },
      },
    },
    {
      id: 'ufc330-turner',
      label: 'Main Card — Lightweight',
      division: 'Lightweight',
      rounds: 3,
      publicTrap: false,
      estimatedMarkets: ['goesDistance', 'totalRounds', 'koA', 'koB', 'subA', 'subB', 'decA', 'decB'],
      notes:
        'A true pick-em (-112/-108). Turner is a 6\'3" finisher with an enormous reach edge coming off a first-round TKO, but has been stopped himself; Fernandes is the younger, steadier prospect. MLs sourced; props estimated.',
      fighterA: {
        name: 'Jalin Turner',
        record: '15-8',
        striking: {
          sigStrikesPerMin: 4.5,
          strikeDefense: 0.54,
          strikeAccuracy: 0.5,
          knockdownRate: 0.7,
          headStrikePct: 0.62,
          strikesAbsorbedPerMin: 4.4,
          powerRating: 8,
          pace: 7,
        },
        grappling: {
          takedownsPer15: 0.6,
          takedownAccuracy: 0.4,
          takedownDefense: 0.62,
          subAttemptsPer15: 1.0,
          controlRating: 4,
          scrambleAbility: 6,
        },
        factors: {
          age: 31,
          reach: 77, // massive for the division
          height: 75,
          stance: 'Southpaw',
          cardio: 5, // has faded in longer fights
          durability: 5,
          recentForm: 7, // R1 TKO last time out
          damageLastThree: 4,
          activityLevel: 1.5,
          shortNotice: false,
          weightCutConcerns: true, // notoriously brutal cut to 155
          fiveRoundExp: 0,
          oppStrength: 7,
          finishRate: 0.87,
          varianceRating: 8,
          ufcFights: 12,
          recentKOLoss: false,
          inconsistentPace: true,
        },
      },
      fighterB: {
        name: 'Kauê Fernandes',
        record: '11-2',
        striking: {
          sigStrikesPerMin: 4.2,
          strikeDefense: 0.56,
          strikeAccuracy: 0.5,
          knockdownRate: 0.35,
          headStrikePct: 0.55,
          strikesAbsorbedPerMin: 3.2,
          powerRating: 6,
          pace: 7,
        },
        grappling: {
          takedownsPer15: 1.6,
          takedownAccuracy: 0.45,
          takedownDefense: 0.68,
          subAttemptsPer15: 0.7,
          controlRating: 6,
          scrambleAbility: 7,
        },
        factors: {
          age: 27,
          reach: 73,
          height: 71,
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
          finishRate: 0.64,
          varianceRating: 4,
          ufcFights: 4,
          recentKOLoss: false,
          inconsistentPace: false,
        },
      },
      odds: {
        moneylineA: -112,
        moneylineB: -108,
        goesDistance: { yes: 135, no: -165 }, // estimated
        totalRounds: { line: 2.5, over: 110, under: -130 }, // estimated
        props: {
          koA: 210, // estimated
          koB: 400, // estimated
          subA: 800, // estimated
          subB: 700, // estimated
          decA: 450, // estimated
          decB: 330, // estimated
        },
      },
    },
    {
      id: 'ufc330-malik',
      label: 'Main Card — Middleweight',
      division: 'Middleweight',
      rounds: 3,
      publicTrap: false,
      estimatedMarkets: ['goesDistance', 'totalRounds', 'koA', 'koB', 'subA', 'subB', 'decA', 'decB'],
      notes:
        'Abdul-Malik is an undefeated finisher being matched up at -700 against Stoltzfus, a durable journeyman grappler with a losing octagon record. Huge-favorite pricing with little value either way. MLs sourced; props estimated.',
      fighterA: {
        name: 'Mansur Abdul-Malik',
        record: '11-0',
        striking: {
          sigStrikesPerMin: 5.6,
          strikeDefense: 0.58,
          strikeAccuracy: 0.55,
          knockdownRate: 0.9,
          headStrikePct: 0.62,
          strikesAbsorbedPerMin: 3.0,
          powerRating: 8,
          pace: 8,
        },
        grappling: {
          takedownsPer15: 1.4,
          takedownAccuracy: 0.5,
          takedownDefense: 0.7,
          subAttemptsPer15: 0.5,
          controlRating: 6,
          scrambleAbility: 6,
        },
        factors: {
          age: 28,
          reach: 76,
          height: 73,
          stance: 'Orthodox',
          cardio: 7,
          durability: 7,
          recentForm: 9,
          damageLastThree: 1,
          activityLevel: 3,
          shortNotice: false,
          weightCutConcerns: false,
          fiveRoundExp: 0,
          oppStrength: 4, // resume is thin
          finishRate: 0.9,
          varianceRating: 5,
          ufcFights: 5,
          recentKOLoss: false,
          inconsistentPace: false,
        },
      },
      fighterB: {
        name: 'Dustin Stoltzfus',
        record: '15-7',
        striking: {
          sigStrikesPerMin: 3.2,
          strikeDefense: 0.52,
          strikeAccuracy: 0.44,
          knockdownRate: 0.1,
          headStrikePct: 0.5,
          strikesAbsorbedPerMin: 4.1,
          powerRating: 4,
          pace: 6,
        },
        grappling: {
          takedownsPer15: 2.2,
          takedownAccuracy: 0.4,
          takedownDefense: 0.6,
          subAttemptsPer15: 0.9,
          controlRating: 6,
          scrambleAbility: 6,
        },
        factors: {
          age: 34,
          reach: 74,
          height: 73,
          stance: 'Orthodox',
          cardio: 7,
          durability: 6,
          recentForm: 4,
          damageLastThree: 4,
          activityLevel: 2,
          shortNotice: false,
          weightCutConcerns: false,
          fiveRoundExp: 0,
          oppStrength: 6,
          finishRate: 0.47,
          varianceRating: 3,
          ufcFights: 9,
          recentKOLoss: false,
          inconsistentPace: false,
        },
      },
      odds: {
        moneylineA: -700,
        moneylineB: 500,
        goesDistance: { yes: 175, no: -215 }, // estimated
        totalRounds: { line: 1.5, over: -140, under: 115 }, // estimated
        props: {
          koA: -125, // estimated
          koB: 1600, // estimated
          subA: 700, // estimated
          subB: 1400, // estimated
          decA: 350, // estimated
          decB: 1200, // estimated
        },
      },
    },
    {
      id: 'ufc330-ribovics',
      label: 'Main Card — Lightweight',
      division: 'Lightweight',
      rounds: 3,
      publicTrap: false,
      estimatedMarkets: ['goesDistance', 'totalRounds', 'koA', 'koB', 'subA', 'subB', 'decA', 'decB'],
      notes:
        'Ribovics (-700) against a 40-year-old Edson Barboza (+500) whose legendary career has entered its decline phase. Age-cliff and damage-accumulation flags all point one way, and the price already reflects it. MLs sourced; props estimated.',
      fighterA: {
        name: 'Esteban Ribovics',
        record: '14-2',
        striking: {
          sigStrikesPerMin: 5.8,
          strikeDefense: 0.55,
          strikeAccuracy: 0.48,
          knockdownRate: 0.6,
          headStrikePct: 0.62,
          strikesAbsorbedPerMin: 4.4,
          powerRating: 8,
          pace: 9,
        },
        grappling: {
          takedownsPer15: 0.5,
          takedownAccuracy: 0.4,
          takedownDefense: 0.7,
          subAttemptsPer15: 0.4,
          controlRating: 4,
          scrambleAbility: 6,
        },
        factors: {
          age: 29,
          reach: 72,
          height: 71,
          stance: 'Orthodox',
          cardio: 8,
          durability: 7,
          recentForm: 8,
          damageLastThree: 3,
          activityLevel: 2.5,
          shortNotice: false,
          weightCutConcerns: false,
          fiveRoundExp: 0,
          oppStrength: 7,
          finishRate: 0.71,
          varianceRating: 6,
          ufcFights: 6,
          recentKOLoss: false,
          inconsistentPace: false,
        },
      },
      fighterB: {
        name: 'Edson Barboza',
        record: '24-13',
        striking: {
          sigStrikesPerMin: 3.9,
          strikeDefense: 0.58,
          strikeAccuracy: 0.44,
          knockdownRate: 0.5,
          headStrikePct: 0.5,
          strikesAbsorbedPerMin: 4.0,
          powerRating: 8, // the leg kicks never left
          pace: 6,
        },
        grappling: {
          takedownsPer15: 0.3,
          takedownAccuracy: 0.35,
          takedownDefense: 0.62,
          subAttemptsPer15: 0.1,
          controlRating: 3,
          scrambleAbility: 5,
        },
        factors: {
          age: 40,
          reach: 75,
          height: 71,
          stance: 'Orthodox',
          cardio: 6,
          durability: 4, // stopped repeatedly in recent years
          recentForm: 3,
          damageLastThree: 7,
          activityLevel: 1.5,
          shortNotice: false,
          weightCutConcerns: false,
          fiveRoundExp: 2,
          oppStrength: 8,
          finishRate: 0.63,
          varianceRating: 5,
          ufcFights: 30,
          recentKOLoss: true,
          inconsistentPace: false,
        },
      },
      odds: {
        moneylineA: -700,
        moneylineB: 500,
        goesDistance: { yes: 130, no: -160 }, // estimated
        totalRounds: { line: 2.5, over: -115, under: -105 }, // estimated
        props: {
          koA: 100, // estimated
          koB: 1100, // estimated
          subA: 1600, // estimated
          subB: 2500, // estimated
          decA: 210, // estimated
          decB: 900, // estimated
        },
      },
    },
  ],
};
