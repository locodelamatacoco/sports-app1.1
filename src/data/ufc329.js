// src/data/ufc329.js
//
// UFC 329: McGregor vs. Holloway 2 — July 11, 2026, T-Mobile Arena, Las Vegas.
// Main-card matchups with stat profiles built from public career stats and
// recent form as of fight week. Moneylines and main-event method props are
// sourced from sportsbooks (DraftKings/consensus via covers.com, CBS Sports,
// Yahoo); prop prices marked `propsEstimated` were not directly sourced and
// are fight-week estimates — treat those edges as indicative only.

export const UFC_329_CARD = {
  event: 'UFC 329: McGregor vs. Holloway 2 — July 11, 2026 (Las Vegas)',
  fights: [
    {
      id: 'ufc329-main',
      label: 'Main Event — Welterweight (5 rounds)',
      division: 'Welterweight',
      rounds: 5,
      // 91% of handle is on McGregor and the line has crashed from -480s
      // to about -235 on Holloway — classic public steam on the name brand.
      publicTrap: false,
      propsEstimated: ['goesDistance', 'totalRounds', 'decB-ish'],
      notes:
        'McGregor returns from a 5-year layoff at 37; Holloway (27-9) debuts at welterweight after a decision loss to Oliveira in March. Book MLs and McGregor/Holloway KO-dec-sub props sourced; distance and round-total prices estimated.',
      fighterA: {
        name: 'Max Holloway',
        record: '27-9',
        striking: {
          sigStrikesPerMin: 7.2,
          strikeDefense: 0.59,
          strikeAccuracy: 0.48,
          knockdownRate: 0.28,
          headStrikePct: 0.62,
          strikesAbsorbedPerMin: 4.9,
          powerRating: 6,
          pace: 10,
        },
        grappling: {
          takedownsPer15: 0.4,
          takedownAccuracy: 0.55,
          takedownDefense: 0.83,
          subAttemptsPer15: 0.2,
          controlRating: 4,
          scrambleAbility: 7,
        },
        factors: {
          age: 34,
          reach: 69,
          height: 71,
          stance: 'Orthodox',
          cardio: 10,
          durability: 8,
          recentForm: 6, // L Oliveira (UD, Mar 2026), W Poirier, L Topuria (KO)
          damageLastThree: 5,
          activityLevel: 2,
          shortNotice: false,
          weightCutConcerns: false, // moving UP to 170
          fiveRoundExp: 5,
          oppStrength: 9,
          finishRate: 0.45,
          varianceRating: 3,
          ufcFights: 32,
          recentKOLoss: false, // Topuria KO was Oct 2024, two fights back
          inconsistentPace: false,
        },
      },
      fighterB: {
        name: 'Conor McGregor',
        record: '22-6',
        striking: {
          sigStrikesPerMin: 5.3,
          strikeDefense: 0.54,
          strikeAccuracy: 0.49,
          knockdownRate: 1.5,
          headStrikePct: 0.7,
          strikesAbsorbedPerMin: 4.5,
          powerRating: 9,
          pace: 7,
        },
        grappling: {
          takedownsPer15: 0.7,
          takedownAccuracy: 0.55,
          takedownDefense: 0.67,
          subAttemptsPer15: 0.1,
          controlRating: 4,
          scrambleAbility: 5,
        },
        factors: {
          age: 37,
          reach: 74,
          height: 69,
          stance: 'Southpaw',
          cardio: 4, // historically fades hard after round 2
          durability: 5,
          recentForm: 3, // TKO loss (leg) to Poirier July 2021, then 5-year layoff
          damageLastThree: 6,
          activityLevel: 0.2, // one fight since Jan 2021
          shortNotice: false,
          weightCutConcerns: false,
          fiveRoundExp: 3,
          oppStrength: 8,
          finishRate: 0.86,
          varianceRating: 8,
          ufcFights: 15,
          recentKOLoss: true, // last result is a TKO loss
          inconsistentPace: true,
        },
      },
      odds: {
        moneylineA: -235, // consensus; DK -265
        moneylineB: 200, // DK +215, consensus +183/+205
        goesDistance: { yes: 240, no: -300 }, // estimated
        totalRounds: { line: 2.5, over: -130, under: 100 }, // estimated
        props: {
          koA: -140, // Holloway by KO/TKO (sourced)
          koB: 250, // McGregor by KO/TKO (sourced)
          subA: 2000, // estimated
          subB: 2500, // sourced
          decA: 350, // estimated
          decB: 1200, // sourced
        },
      },
    },
    {
      id: 'ufc329-comain',
      label: 'Co-Main — Lightweight',
      division: 'Lightweight',
      rounds: 3,
      publicTrap: false,
      propsEstimated: ['method props', 'goesDistance'],
      notes:
        'Saint Denis rides a four-fight finish streak (all inside two rounds); Pimblett returns from a 15-month layoff after stopping Chandler. MLs and under 2.5 (-160) sourced; method props estimated.',
      fighterA: {
        name: 'Benoît Saint Denis',
        record: '16-3 (1 NC)',
        striking: {
          sigStrikesPerMin: 4.8,
          strikeDefense: 0.47, // eats a lot of return fire
          strikeAccuracy: 0.5,
          knockdownRate: 0.4,
          headStrikePct: 0.6,
          strikesAbsorbedPerMin: 5.3,
          powerRating: 7,
          pace: 9,
        },
        grappling: {
          takedownsPer15: 3.2,
          takedownAccuracy: 0.45,
          takedownDefense: 0.62,
          subAttemptsPer15: 1.6,
          controlRating: 7,
          scrambleAbility: 7,
        },
        factors: {
          age: 30,
          reach: 73,
          height: 71,
          stance: 'Southpaw',
          cardio: 7,
          durability: 6, // stopped by Poirier in 2024
          recentForm: 8,
          damageLastThree: 2,
          activityLevel: 2.5,
          shortNotice: false,
          weightCutConcerns: false,
          fiveRoundExp: 1,
          oppStrength: 7,
          finishRate: 0.9,
          varianceRating: 7,
          ufcFights: 10,
          recentKOLoss: false,
          inconsistentPace: false,
        },
      },
      fighterB: {
        name: 'Paddy Pimblett',
        record: '23-3',
        striking: {
          sigStrikesPerMin: 4.4,
          strikeDefense: 0.55,
          strikeAccuracy: 0.47,
          knockdownRate: 0.3,
          headStrikePct: 0.55,
          strikesAbsorbedPerMin: 3.4,
          powerRating: 6,
          pace: 7,
        },
        grappling: {
          takedownsPer15: 1.8,
          takedownAccuracy: 0.45,
          takedownDefense: 0.58,
          subAttemptsPer15: 1.1,
          controlRating: 6,
          scrambleAbility: 7,
        },
        factors: {
          age: 31,
          reach: 73,
          height: 70,
          stance: 'Orthodox',
          cardio: 6,
          durability: 8, // famously tough
          recentForm: 8, // TKO'd Chandler in his last outing
          damageLastThree: 2,
          activityLevel: 1, // ~15-month layoff
          shortNotice: false,
          weightCutConcerns: true, // big between camps, hard cuts to 155
          fiveRoundExp: 0,
          oppStrength: 6,
          finishRate: 0.7,
          varianceRating: 6,
          ufcFights: 8,
          recentKOLoss: false,
          inconsistentPace: true, // slow starts
        },
      },
      odds: {
        moneylineA: -148,
        moneylineB: 124,
        goesDistance: { yes: 170, no: -210 }, // estimated
        totalRounds: { line: 2.5, over: 130, under: -160 }, // under sourced
        props: {
          koA: 240, // estimated
          koB: 700, // estimated
          subA: 260, // estimated
          subB: 450, // estimated
          decA: 500, // estimated
          decB: 550, // estimated
        },
      },
    },
    {
      id: 'ufc329-sandhagen',
      label: 'Main Card — Bantamweight',
      division: 'Bantamweight',
      rounds: 3,
      // 60% of bets / 81% of handle on the underdog Bautista — the dog is
      // the public side here, not the favorite, so no trap flag.
      publicTrap: false,
      propsEstimated: ['all props'],
      notes:
        'Sandhagen returns from his failed title bid against Dvalishvili; Bautista is 9-1 in his last 10 and submitted Vinicius Oliveira in February. MLs sourced (DK); props estimated.',
      fighterA: {
        name: 'Cory Sandhagen',
        record: '18-6',
        striking: {
          sigStrikesPerMin: 4.9,
          strikeDefense: 0.6,
          strikeAccuracy: 0.44,
          knockdownRate: 0.35,
          headStrikePct: 0.6,
          strikesAbsorbedPerMin: 3.6,
          powerRating: 7,
          pace: 8,
        },
        grappling: {
          takedownsPer15: 1.0,
          takedownAccuracy: 0.5,
          takedownDefense: 0.62,
          subAttemptsPer15: 0.4,
          controlRating: 5,
          scrambleAbility: 8,
        },
        factors: {
          age: 34,
          reach: 70,
          height: 71,
          stance: 'Switch',
          cardio: 8,
          durability: 7,
          recentForm: 5, // L Dvalishvili (title), W Figueiredo (TKO), L Umar
          damageLastThree: 3,
          activityLevel: 1.5,
          shortNotice: false,
          weightCutConcerns: false,
          fiveRoundExp: 4,
          oppStrength: 9,
          finishRate: 0.5,
          varianceRating: 4,
          ufcFights: 19,
          recentKOLoss: false,
          inconsistentPace: false,
        },
      },
      fighterB: {
        name: 'Mario Bautista',
        record: '16-3',
        striking: {
          sigStrikesPerMin: 4.9,
          strikeDefense: 0.55,
          strikeAccuracy: 0.5,
          knockdownRate: 0.2,
          headStrikePct: 0.55,
          strikesAbsorbedPerMin: 3.9,
          powerRating: 5,
          pace: 8,
        },
        grappling: {
          takedownsPer15: 2.2,
          takedownAccuracy: 0.4,
          takedownDefense: 0.65,
          subAttemptsPer15: 0.9,
          controlRating: 6,
          scrambleAbility: 7,
        },
        factors: {
          age: 32,
          reach: 70,
          height: 69,
          stance: 'Orthodox',
          cardio: 8,
          durability: 7,
          recentForm: 7, // W (sub) V. Oliveira Feb 2026 after Umar loss
          damageLastThree: 2,
          activityLevel: 2,
          shortNotice: false,
          weightCutConcerns: false,
          fiveRoundExp: 0,
          oppStrength: 7,
          finishRate: 0.5,
          varianceRating: 4,
          ufcFights: 13,
          recentKOLoss: false,
          inconsistentPace: false,
        },
      },
      odds: {
        moneylineA: -142,
        moneylineB: 120,
        goesDistance: { yes: -165, no: 135 }, // estimated
        totalRounds: { line: 2.5, over: -220, under: 175 }, // estimated
        props: {
          koA: 400, // estimated
          koB: 900, // estimated
          subA: 1200, // estimated
          subB: 800, // estimated
          decA: 150, // estimated
          decB: 260, // estimated
        },
      },
    },
    {
      id: 'ufc329-royval',
      label: 'Main Card — Flyweight',
      division: 'Flyweight',
      rounds: 3,
      publicTrap: false,
      propsEstimated: ['all props'],
      notes:
        'Royval on a two-fight slide (FOTY loss to Van, R1 stoppage vs Kape in December); Kavanagh is an unbeaten rising striker. 80% of handle on Kavanagh. MLs sourced; props estimated.',
      fighterA: {
        name: "Lone'er Kavanagh",
        record: '10-0',
        striking: {
          sigStrikesPerMin: 4.3,
          strikeDefense: 0.62, // elusive karate style
          strikeAccuracy: 0.52,
          knockdownRate: 0.5,
          headStrikePct: 0.6,
          strikesAbsorbedPerMin: 2.8,
          powerRating: 7,
          pace: 6,
        },
        grappling: {
          takedownsPer15: 0.7,
          takedownAccuracy: 0.5,
          takedownDefense: 0.75,
          subAttemptsPer15: 0.2,
          controlRating: 4,
          scrambleAbility: 6,
        },
        factors: {
          age: 27,
          reach: 70,
          height: 68,
          stance: 'Orthodox',
          cardio: 7,
          durability: 7,
          recentForm: 8,
          damageLastThree: 1,
          activityLevel: 2.5,
          shortNotice: false,
          weightCutConcerns: false,
          fiveRoundExp: 0,
          oppStrength: 5, // untested against ranked opposition
          finishRate: 0.5,
          varianceRating: 4,
          ufcFights: 5,
          recentKOLoss: false,
          inconsistentPace: false,
        },
      },
      fighterB: {
        name: 'Brandon Royval',
        record: '16-9',
        striking: {
          sigStrikesPerMin: 5.2,
          strikeDefense: 0.52,
          strikeAccuracy: 0.47,
          knockdownRate: 0.3,
          headStrikePct: 0.6,
          strikesAbsorbedPerMin: 4.6,
          powerRating: 5,
          pace: 9,
        },
        grappling: {
          takedownsPer15: 1.0,
          takedownAccuracy: 0.4,
          takedownDefense: 0.55,
          subAttemptsPer15: 1.8,
          controlRating: 4,
          scrambleAbility: 9,
        },
        factors: {
          age: 33,
          reach: 68,
          height: 68,
          stance: 'Southpaw',
          cardio: 8,
          durability: 5,
          recentForm: 3, // two-fight slide, stopped in R1 by Kape in December
          damageLastThree: 5,
          activityLevel: 2,
          shortNotice: false,
          weightCutConcerns: false,
          fiveRoundExp: 2,
          oppStrength: 9,
          finishRate: 0.65,
          varianceRating: 8,
          ufcFights: 13,
          recentKOLoss: true,
          inconsistentPace: false,
        },
      },
      odds: {
        moneylineA: -220,
        moneylineB: 180,
        goesDistance: { yes: -130, no: 105 }, // estimated
        totalRounds: { line: 2.5, over: -160, under: 130 }, // estimated
        props: {
          koA: 250, // estimated
          koB: 700, // estimated
          subA: 1400, // estimated
          subB: 550, // estimated
          decA: 160, // estimated
          decB: 500, // estimated
        },
      },
    },
    {
      id: 'ufc329-green',
      label: 'Main Card — Lightweight',
      division: 'Lightweight',
      rounds: 3,
      publicTrap: false,
      propsEstimated: ['all props'],
      notes:
        'Green just turned 40 and has absorbed heavy damage in recent fights; McKinney is an all-or-nothing round-one finisher with notorious cardio. MLs sourced; props estimated.',
      fighterA: {
        name: 'King Green',
        record: '32-16-1 (1 NC)',
        striking: {
          sigStrikesPerMin: 5.7,
          strikeDefense: 0.52,
          strikeAccuracy: 0.44,
          knockdownRate: 0.2,
          headStrikePct: 0.55,
          strikesAbsorbedPerMin: 4.9,
          powerRating: 5,
          pace: 9,
        },
        grappling: {
          takedownsPer15: 0.4,
          takedownAccuracy: 0.4,
          takedownDefense: 0.62,
          subAttemptsPer15: 0.3,
          controlRating: 3,
          scrambleAbility: 6,
        },
        factors: {
          age: 40,
          reach: 73,
          height: 70,
          stance: 'Switch',
          cardio: 8,
          durability: 5, // KO'd by Ruffy head kick in 2025, lots of wear
          recentForm: 4,
          damageLastThree: 6,
          activityLevel: 2,
          shortNotice: false,
          weightCutConcerns: false,
          fiveRoundExp: 1,
          oppStrength: 7,
          finishRate: 0.35,
          varianceRating: 5,
          ufcFights: 33,
          recentKOLoss: true,
          inconsistentPace: false,
        },
      },
      fighterB: {
        name: 'Terrance McKinney',
        record: '16-8',
        striking: {
          sigStrikesPerMin: 3.6,
          strikeDefense: 0.5,
          strikeAccuracy: 0.5,
          knockdownRate: 0.6,
          headStrikePct: 0.65,
          strikesAbsorbedPerMin: 3.2,
          powerRating: 8,
          pace: 8, // blitzes round one, then collapses
        },
        grappling: {
          takedownsPer15: 2.8,
          takedownAccuracy: 0.55,
          takedownDefense: 0.6,
          subAttemptsPer15: 1.4,
          controlRating: 5,
          scrambleAbility: 6,
        },
        factors: {
          age: 31,
          reach: 76,
          height: 72,
          stance: 'Orthodox',
          cardio: 2, // infamous gas tank
          durability: 4,
          recentForm: 5,
          damageLastThree: 4,
          activityLevel: 2.5,
          shortNotice: false,
          weightCutConcerns: false,
          fiveRoundExp: 0,
          oppStrength: 5,
          finishRate: 1.0, // every career win is a finish
          varianceRating: 10,
          ufcFights: 12,
          recentKOLoss: true,
          inconsistentPace: true,
        },
      },
      odds: {
        moneylineA: -105,
        moneylineB: -115,
        goesDistance: { yes: 145, no: -175 }, // estimated
        totalRounds: { line: 1.5, over: -140, under: 110 }, // estimated
        props: {
          koA: 500, // estimated
          koB: 220, // estimated
          subA: 1600, // estimated
          subB: 380, // estimated
          decA: 200, // estimated
          decB: 750, // estimated
        },
      },
    },
  ],
};
