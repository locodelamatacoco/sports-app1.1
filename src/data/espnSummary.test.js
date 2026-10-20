import { mapSummary, enrichGame, mapScoreboard } from './espnNba';
import { injuryPenalties, gamePenalties, simulateGame, PENALTIES } from '../models/nbaSimulator';
import scoreboard from './__fixtures__/espnScoreboard.json';
import summary from './__fixtures__/espnSummary.json';

const okcSa = () => mapScoreboard(scoreboard).games.find((g) => g.id === 'okc-sa');

describe('mapSummary', () => {
  const mapped = mapSummary(summary);

  test('reads the injury report and marks who is a projected starter', () => {
    expect(mapped.injuries.length).toBeGreaterThan(0);
    const harris = mapped.injuries.find((i) => i.player === 'Tobias Harris');
    expect(harris).toMatchObject({ team: 'SA', status: 'Out', starter: false });
    // Nobody in this fixture's report is in either projected starting five.
    expect(mapped.injuries.every((i) => i.starter === false)).toBe(true);
  });

  test('reads an explicit price on each side of the total', () => {
    expect(mapped.total.line).toBe(230.5);
    expect(mapped.total.over).toBe(-108);
    expect(mapped.total.under).toBe(-112);
  });

  test("carries ESPN's own projection as a fraction, for comparison only", () => {
    expect(mapped.espnPredictor.home).toBeCloseTo(0.526, 3);
    expect(mapped.espnPredictor.away).toBeCloseTo(0.474, 3);
  });

  test('a missing or empty summary is handled', () => {
    expect(mapSummary(null)).toBeNull();
    const empty = mapSummary({});
    expect(empty.injuries).toEqual([]);
    expect(empty.total).toBeNull();
    expect(empty.espnPredictor).toBeNull();
  });
});

describe('enrichGame', () => {
  test('the summary total prices are applied to the game', () => {
    // This payload already prices the total on the scoreboard, so enrichment
    // refreshes rather than fills it. Both paths must land real numbers.
    const after = enrichGame(okcSa(), mapSummary(summary));
    expect(after.odds.total.line).toBe(230.5);
    expect(after.odds.total.over).toBe(-108);
    expect(after.odds.total.under).toBe(-112);
  });

  test('when the feed had no total price, enrichment fills it and clears the flag', () => {
    // A scoreboard that omits total pricing falls back to -110 and flags it.
    const stripped = JSON.parse(JSON.stringify(scoreboard));
    stripped.events.forEach((e) => {
      e.competitions[0].odds.forEach((o) => {
        delete o.total;
      });
    });
    const bare = mapScoreboard(stripped).games.find((g) => g.id === 'okc-sa');
    expect(bare.odds.total.over).toBe(-110);
    expect(bare.dataQuality.estimatedInputs.join(' ')).toMatch(/total juice/);

    const after = enrichGame(bare, mapSummary(summary));
    expect(after.odds.total.over).toBe(-108);
    expect(after.odds.total.under).toBe(-112);
    expect(after.dataQuality.estimatedInputs.join(' ')).not.toMatch(/total juice/);
  });

  test('the structured injury list supersedes the curated note', () => {
    const before = okcSa();
    expect(before.dataQuality.injuryNewsUncertainty).toBeTruthy();

    const after = enrichGame(before, mapSummary(summary));
    expect(after.injuries.length).toBeGreaterThan(0);
    // Otherwise the same absences would be charged for twice.
    expect(after.dataQuality.injuryNewsUncertainty).toBeNull();
  });

  test('enriching does not mutate the original game', () => {
    const before = okcSa();
    const snapshot = JSON.stringify(before);
    enrichGame(before, mapSummary(summary));
    expect(JSON.stringify(before)).toBe(snapshot);
  });

  test('a null summary leaves the game untouched', () => {
    const before = okcSa();
    expect(enrichGame(before, null)).toBe(before);
  });
});

describe('injuryPenalties', () => {
  test('a ruled-out starter costs far more than a ruled-out reserve', () => {
    const starter = injuryPenalties([
      { team: 'SA', player: 'Victor Wembanyama', status: 'Out', starter: true },
    ]);
    const reserve = injuryPenalties([
      { team: 'SA', player: 'Deep Bench', status: 'Out', starter: false },
    ]);
    expect(starter[0].amount).toBe(PENALTIES.INJURY_STARTER_OUT);
    expect(reserve[0].amount).toBe(PENALTIES.INJURY_RESERVE_OUT);
    expect(starter[0].amount).toBeGreaterThan(reserve[0].amount * 4);
    expect(starter[0].reason).toMatch(/projected starter/);
  });

  test('a questionable starter costs less than one ruled out', () => {
    const out = injuryPenalties([{ team: 'X', player: 'A', status: 'Out', starter: true }]);
    const dtd = injuryPenalties([
      { team: 'X', player: 'A', status: 'Day-To-Day', starter: true },
    ]);
    expect(dtd[0].amount).toBeLessThan(out[0].amount);
  });

  test('doubtful is treated as out', () => {
    const doubtful = injuryPenalties([
      { team: 'X', player: 'A', status: 'Doubtful', starter: true },
    ]);
    expect(doubtful[0].amount).toBe(PENALTIES.INJURY_STARTER_OUT);
  });

  test('a pile of absent reserves is capped', () => {
    const many = injuryPenalties(
      Array.from({ length: 12 }, (_, i) => ({
        team: 'X',
        player: `Reserve ${i}`,
        status: 'Out',
        starter: false,
      }))
    );
    expect(many).toHaveLength(1);
    expect(many[0].amount).toBe(PENALTIES.INJURY_RESERVE_CAP);
    expect(many[0].reason).toMatch(/12 reserves unavailable/);
  });

  test('an empty report costs nothing', () => {
    expect(injuryPenalties([])).toEqual([]);
  });
});

describe('the ledger prefers live injuries over the curated note', () => {
  test('five absent reserves cost less than the old flat rate', () => {
    const plain = okcSa();
    const enriched = enrichGame(plain, mapSummary(summary));
    const sim = simulateGame(enriched, { numSims: 1500, seed: 3 });

    const flat = gamePenalties(plain, simulateGame(plain, { numSims: 1500, seed: 3 }));
    const live = gamePenalties(enriched, sim);

    const injuryCost = (ledger) =>
      ledger
        .filter((e) => /injur|reserve|starter/i.test(e.reason))
        .reduce((a, e) => a + e.amount, 0);

    expect(injuryCost(flat)).toBe(PENALTIES.INJURY_NEWS_UNCERTAINTY);
    expect(injuryCost(live)).toBeLessThan(injuryCost(flat));
    expect(live.map((e) => e.reason).join(' ')).toMatch(/reserves unavailable/);
  });

  test('a ruled-out starter is charged the full rate', () => {
    const game = enrichGame(okcSa(), mapSummary(summary));
    game.injuries = [
      { team: 'SA', player: 'Victor Wembanyama', status: 'Out', starter: true },
    ];
    const ledger = gamePenalties(game, simulateGame(game, { numSims: 1200, seed: 4 }));
    const reasons = ledger.map((e) => e.reason).join(' | ');
    expect(reasons).toMatch(/projected starter Victor Wembanyama out/i);
  });
});
