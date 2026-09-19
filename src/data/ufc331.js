// src/data/ufc331.js
//
// UFC 331: Van vs. Pantoja 2 — September 19, 2026, Crypto.com Arena,
// Los Angeles. Main card (prelims 6pm ET, main card 9pm ET).
//
// Moneylines sourced (DraftKings/consensus via SI, Hard Rock, SportsLine,
// MMA Mania). All other prices are fight-week estimates, declared in
// `estimatedMarkets` and therefore display-only — the model will not
// recommend a bet against a price it invented.

export const UFC_331_CARD = {
  event: 'UFC 331: Van vs. Pantoja 2 — September 19, 2026 (Los Angeles)',
  fights: [
    {
      id: 'ufc331-main',
      label: 'Main Event — Flyweight Title (5 rounds)',
      division: 'Flyweight',
      rounds: 5,
      publicTrap: false,
      estimatedMarkets: ['goesDistance', 'totalRounds', 'koA', 'koB', 'subA', 'subB', 'decA', 'decB'],
      notes:
        'Rematch of a title fight that lasted 26 seconds — Pantoja dislocated his elbow falling after Van caught a kick, so neither man really got tested. Van has since defended against Tatsuro Taira. Pantoja, 36, is chasing a rare reclaimed flyweight belt. MLs sourced; props estimated.',
      fighterA: {
        name: 'Joshua Van',
        record: '17-2',
        striking: {
          sigStrikesPerMin: 6.8, // elite volume for the division
          strikeDefense: 0.56,
          strikeAccuracy: 0.48,
          knockdownRate: 0.5,
          headStrikePct: 0.55,
          strikesAbsorbedPerMin: 4.8, // takes a lot back
          powerRating: 7,
          pace: 10,
        },
        grappling: {
          takedownsPer15: 0.5,
          takedownAccuracy: 0.4,
          takedownDefense: 0.68,
          subAttemptsPer15: 0.2,
          controlRating: 4,
          scrambleAbility: 7,
        },
        factors: {
          age: 24,
          reach: 67,
          height: 65,
          stance: 'Orthodox',
          cardio: 10,
          durability: 9, // famously hard to hurt
          recentForm: 9,
          damageLastThree: 4,
          activityLevel: 3, // extremely active
          shortNotice: false,
          weightCutConcerns: false,
          fiveRoundExp: 2,
          oppStrength: 8,
          finishRate: 0.53,
          varianceRating: 3,
          ufcFights: 11,
          recentKOLoss: false,
          inconsistentPace: false,
        },
      },
      fighterB: {
        name: 'Alexandre Pantoja',
        record: '30-6',
        striking: {
          sigStrikesPerMin: 4.6,
          strikeDefense: 0.58,
          strikeAccuracy: 0.49,
          knockdownRate: 0.35,
          headStrikePct: 0.55,
          strikesAbsorbedPerMin: 3.9,
          powerRating: 6,
          pace: 8,
        },
        grappling: {
          takedownsPer15: 2.4,
          takedownAccuracy: 0.42,
          takedownDefense: 0.72,
          subAttemptsPer15: 1.6, // elite back-take/RNC threat
          controlRating: 7,
          scrambleAbility: 9,
        },
        factors: {
          age: 36,
          reach: 67,
          height: 65,
          stance: 'Orthodox',
          cardio: 9,
          durability: 8,
          recentForm: 6, // title reign, then the 26-second injury loss
          damageLastThree: 4,
          activityLevel: 1.5,
          shortNotice: false,
          weightCutConcerns: false,
          fiveRoundExp: 5,
          oppStrength: 9,
          finishRate: 0.63,
          varianceRating: 4,
          ufcFights: 16,
          recentKOLoss: false, // the loss was an injury stoppage, not damage
          inconsistentPace: false,
        },
      },
      odds: {
        moneylineA: -148, // DraftKings; consensus -130/-142
        moneylineB: 124,
        goesDistance: { yes: -145, no: 120 }, // estimated
        totalRounds: { line: 3.5, over: -170, under: 140 }, // estimated
        props: {
          koA: 450, // estimated
          koB: 900, // estimated
          subA: 2000, // estimated
          subB: 550, // estimated
          decA: 175, // estimated
          decB: 380, // estimated
        },
      },
    },
    {
      id: 'ufc331-comain',
      label: 'Co-Main — Lightweight',
      division: 'Lightweight',
      rounds: 3,
      publicTrap: false,
      estimatedMarkets: ['goesDistance', 'totalRounds', 'koA', 'koB', 'subA', 'subB', 'decA', 'decB'],
      notes:
        'Tsarukyan returns from a long layoff (he withdrew from a title shot against Makhachev with a back injury) against Ruffy, who knocked out Michael Chandler in round one in June. Elite wrestler vs explosive counter-striker. MLs sourced; props estimated.',
      fighterA: {
        name: 'Arman Tsarukyan',
        record: '23-3',
        striking: {
          sigStrikesPerMin: 4.6,
          strikeDefense: 0.58,
          strikeAccuracy: 0.5,
          knockdownRate: 0.3,
          headStrikePct: 0.52,
          strikesAbsorbedPerMin: 3.1,
          powerRating: 6,
          pace: 8,
        },
        grappling: {
          takedownsPer15: 3.6,
          takedownAccuracy: 0.48,
          takedownDefense: 0.76,
          subAttemptsPer15: 0.9,
          controlRating: 8,
          scrambleAbility: 8,
        },
        factors: {
          age: 29,
          reach: 72,
          height: 69,
          stance: 'Orthodox',
          cardio: 9,
          durability: 8,
          recentForm: 8, // five-fight streak before the layoff
          damageLastThree: 2,
          activityLevel: 0.6, // long layoff — ring rust flag
          shortNotice: false,
          weightCutConcerns: false,
          fiveRoundExp: 2,
          oppStrength: 9,
          finishRate: 0.6,
          varianceRating: 3,
          ufcFights: 12,
          recentKOLoss: false,
          inconsistentPace: false,
        },
      },
      fighterB: {
        name: 'Maurício Ruffy',
        record: '14-2',
        striking: {
          sigStrikesPerMin: 4.9,
          strikeDefense: 0.57,
          strikeAccuracy: 0.5,
          knockdownRate: 0.9, // highlight-reel finisher
          headStrikePct: 0.65,
          strikesAbsorbedPerMin: 3.4,
          powerRating: 9,
          pace: 7,
        },
        grappling: {
          takedownsPer15: 0.4,
          takedownAccuracy: 0.35,
          takedownDefense: 0.55, // the obvious hole against a wrestler
          subAttemptsPer15: 0.2,
          controlRating: 3,
          scrambleAbility: 5,
        },
        factors: {
          age: 30,
          reach: 74,
          height: 71,
          stance: 'Orthodox',
          cardio: 6,
          durability: 7,
          recentForm: 9, // R1 KO of Chandler
          damageLastThree: 2,
          activityLevel: 2.5,
          shortNotice: false,
          weightCutConcerns: false,
          fiveRoundExp: 0,
          oppStrength: 6,
          finishRate: 0.79,
          varianceRating: 7,
          ufcFights: 6,
          recentKOLoss: false,
          inconsistentPace: false,
        },
      },
      odds: {
        moneylineA: -310,
        moneylineB: 250,
        goesDistance: { yes: -125, no: 105 }, // estimated
        totalRounds: { line: 2.5, over: -155, under: 130 }, // estimated
        props: {
          koA: 450, // estimated
          koB: 400, // estimated
          subA: 400, // estimated
          subB: 2500, // estimated
          decA: 150, // estimated
          decB: 900, // estimated
        },
      },
    },
    {
      id: 'ufc331-pitbull',
      label: 'Main Card — Featherweight',
      division: 'Featherweight',
      rounds: 3,
      publicTrap: false,
      estimatedMarkets: ['goesDistance', 'totalRounds', 'koA', 'koB', 'subA', 'subB', 'decA', 'decB'],
      notes:
        'Patrício Pitbull, the Bellator great, is 39 and has struggled to translate his dominance to the UFC roster. Choi Doo-ho is the resurgent Korean Superboy. Age-cliff and damage flags both point the same way. MLs sourced; props estimated.',
      fighterA: {
        name: 'Choi Doo-ho',
        record: '15-4',
        striking: {
          sigStrikesPerMin: 4.7,
          strikeDefense: 0.54,
          strikeAccuracy: 0.48,
          knockdownRate: 0.9,
          headStrikePct: 0.66,
          strikesAbsorbedPerMin: 4.2,
          powerRating: 8,
          pace: 7,
        },
        grappling: {
          takedownsPer15: 0.4,
          takedownAccuracy: 0.4,
          takedownDefense: 0.64,
          subAttemptsPer15: 0.3,
          controlRating: 4,
          scrambleAbility: 6,
        },
        factors: {
          age: 35,
          reach: 71,
          height: 69,
          stance: 'Orthodox',
          cardio: 6,
          durability: 6,
          recentForm: 7,
          damageLastThree: 4,
          activityLevel: 1.5,
          shortNotice: false,
          weightCutConcerns: false,
          fiveRoundExp: 0,
          oppStrength: 6,
          finishRate: 0.8,
          varianceRating: 6,
          ufcFights: 9,
          recentKOLoss: false,
          inconsistentPace: false,
        },
      },
      fighterB: {
        name: 'Patrício Pitbull',
        record: '36-8',
        striking: {
          sigStrikesPerMin: 3.8,
          strikeDefense: 0.55,
          strikeAccuracy: 0.45,
          knockdownRate: 0.5,
          headStrikePct: 0.58,
          strikesAbsorbedPerMin: 3.9,
          powerRating: 7,
          pace: 6,
        },
        grappling: {
          takedownsPer15: 0.9,
          takedownAccuracy: 0.4,
          takedownDefense: 0.66,
          subAttemptsPer15: 0.6,
          controlRating: 5,
          scrambleAbility: 6,
        },
        factors: {
          age: 39,
          reach: 70,
          height: 68,
          stance: 'Orthodox',
          cardio: 7,
          durability: 6,
          recentForm: 4, // has not looked like the Bellator version in the UFC
          damageLastThree: 5,
          activityLevel: 1.5,
          shortNotice: false,
          weightCutConcerns: false,
          fiveRoundExp: 3,
          oppStrength: 8,
          finishRate: 0.61,
          varianceRating: 4,
          ufcFights: 3, // low UFC sample despite a huge career
          recentKOLoss: false,
          inconsistentPace: false,
        },
      },
      odds: {
        moneylineA: -270,
        moneylineB: 220,
        goesDistance: { yes: -115, no: -105 }, // estimated
        totalRounds: { line: 2.5, over: -145, under: 120 }, // estimated
        props: {
          koA: 175, // estimated
          koB: 500, // estimated
          subA: 1600, // estimated
          subB: 1200, // estimated
          decA: 220, // estimated
          decB: 450, // estimated
        },
      },
    },
    {
      id: 'ufc331-steveson',
      label: 'Main Card — Heavyweight',
      division: 'Heavyweight',
      rounds: 3,
      publicTrap: false,
      estimatedMarkets: ['goesDistance', 'totalRounds', 'koA', 'koB', 'subA', 'subB', 'decA', 'decB'],
      notes:
        'Olympic gold medalist Steveson at -2400 against a late-notice-level opponent. The most extreme price on the card and exactly the shape the huge-favorite filter exists for — note UFC 330, where a -700 favorite was submitted outright. MLs sourced; props estimated.',
      fighterA: {
        name: 'Gable Steveson',
        record: '4-0',
        striking: {
          sigStrikesPerMin: 3.6,
          strikeDefense: 0.5,
          strikeAccuracy: 0.52,
          knockdownRate: 0.5,
          headStrikePct: 0.55,
          strikesAbsorbedPerMin: 3.0,
          powerRating: 8,
          pace: 6,
        },
        grappling: {
          takedownsPer15: 5.0, // Olympic-level wrestling
          takedownAccuracy: 0.6,
          takedownDefense: 0.85,
          subAttemptsPer15: 0.6,
          controlRating: 9,
          scrambleAbility: 8,
        },
        factors: {
          age: 26,
          reach: 75,
          height: 73,
          stance: 'Orthodox',
          cardio: 6, // heavyweight gas tank still unproven
          durability: 6,
          recentForm: 8,
          damageLastThree: 1,
          activityLevel: 2,
          shortNotice: false,
          weightCutConcerns: false,
          fiveRoundExp: 0,
          oppStrength: 2, // has not faced ranked opposition
          finishRate: 0.75,
          varianceRating: 5,
          ufcFights: 2, // low UFC sample
          recentKOLoss: false,
          inconsistentPace: false,
        },
      },
      fighterB: {
        name: 'Sean Sharaf',
        record: '7-2',
        striking: {
          sigStrikesPerMin: 3.4,
          strikeDefense: 0.46,
          strikeAccuracy: 0.44,
          knockdownRate: 0.6,
          headStrikePct: 0.6,
          strikesAbsorbedPerMin: 4.8,
          powerRating: 7,
          pace: 5,
        },
        grappling: {
          takedownsPer15: 0.5,
          takedownAccuracy: 0.3,
          takedownDefense: 0.4,
          subAttemptsPer15: 0.2,
          controlRating: 3,
          scrambleAbility: 3,
        },
        factors: {
          age: 30,
          reach: 76,
          height: 75,
          stance: 'Orthodox',
          cardio: 4,
          durability: 5,
          recentForm: 5,
          damageLastThree: 3,
          activityLevel: 1.5,
          shortNotice: false,
          weightCutConcerns: false,
          fiveRoundExp: 0,
          oppStrength: 2,
          finishRate: 0.71,
          varianceRating: 7,
          ufcFights: 1, // low UFC sample
          recentKOLoss: false,
          inconsistentPace: false,
        },
      },
      odds: {
        moneylineA: -2400,
        moneylineB: 1200,
        goesDistance: { yes: 180, no: -220 }, // estimated
        totalRounds: { line: 1.5, over: -130, under: 105 }, // estimated
        props: {
          koA: 110, // estimated
          koB: 1400, // estimated
          subA: 250, // estimated
          subB: 3000, // estimated
          decA: 275, // estimated
          decB: 2500, // estimated
        },
      },
    },
    {
      id: 'ufc331-vera',
      label: 'Featured — Bantamweight',
      division: 'Bantamweight',
      rounds: 3,
      publicTrap: false,
      estimatedMarkets: ['goesDistance', 'totalRounds', 'koA', 'koB', 'subA', 'subB', 'decA', 'decB'],
      notes:
        'Card placement may be late prelims rather than main card. Vera is a former title challenger and one of the most durable fighters in the division, but the market has him as a live dog against Jourdain — notable, since Vera is rarely finished. MLs sourced; props estimated.',
      fighterA: {
        name: 'Charles Jourdain',
        record: '16-8-1',
        striking: {
          sigStrikesPerMin: 4.8,
          strikeDefense: 0.54,
          strikeAccuracy: 0.45,
          knockdownRate: 0.5,
          headStrikePct: 0.6,
          strikesAbsorbedPerMin: 4.4,
          powerRating: 7,
          pace: 8,
        },
        grappling: {
          takedownsPer15: 1.2,
          takedownAccuracy: 0.4,
          takedownDefense: 0.6,
          subAttemptsPer15: 0.9,
          controlRating: 4,
          scrambleAbility: 6,
        },
        factors: {
          age: 30,
          reach: 71,
          height: 69,
          stance: 'Southpaw',
          cardio: 7,
          durability: 6,
          recentForm: 6,
          damageLastThree: 4,
          activityLevel: 2.5,
          shortNotice: false,
          weightCutConcerns: false,
          fiveRoundExp: 0,
          oppStrength: 6,
          finishRate: 0.56,
          varianceRating: 6,
          ufcFights: 14,
          recentKOLoss: false,
          inconsistentPace: true,
        },
      },
      fighterB: {
        name: 'Marlon Vera',
        record: '24-10-1',
        striking: {
          sigStrikesPerMin: 4.2,
          strikeDefense: 0.57,
          strikeAccuracy: 0.47,
          knockdownRate: 0.4,
          headStrikePct: 0.52,
          strikesAbsorbedPerMin: 4.3,
          powerRating: 7,
          pace: 6, // notorious slow starter, strong finisher
        },
        grappling: {
          takedownsPer15: 0.8,
          takedownAccuracy: 0.4,
          takedownDefense: 0.62,
          subAttemptsPer15: 0.8,
          controlRating: 5,
          scrambleAbility: 7,
        },
        factors: {
          age: 33,
          reach: 70,
          height: 68,
          stance: 'Orthodox',
          cardio: 8,
          durability: 9, // almost never finished
          recentForm: 4, // rough recent stretch against elite opposition
          damageLastThree: 5,
          activityLevel: 2,
          shortNotice: false,
          weightCutConcerns: false,
          fiveRoundExp: 3,
          oppStrength: 9,
          finishRate: 0.58,
          varianceRating: 4,
          ufcFights: 23,
          recentKOLoss: false,
          inconsistentPace: true,
        },
      },
      odds: {
        moneylineA: -205,
        moneylineB: 170,
        goesDistance: { yes: -180, no: 150 }, // estimated
        totalRounds: { line: 2.5, over: -200, under: 165 }, // estimated
        props: {
          koA: 450, // estimated
          koB: 650, // estimated
          subA: 900, // estimated
          subB: 1100, // estimated
          decA: 160, // estimated
          decB: 320, // estimated
        },
      },
    },
  ],
};
