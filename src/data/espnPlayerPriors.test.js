import {
  priorFromStats,
  fetchPlayerPrior,
  fetchPlayerPriors,
  priorBlendWeight,
  blendPlayerRate,
  applyPriors,
  PLAYER_PRIOR_K,
} from './espnPlayerPriors';

const NAMES = [
  'gamesPlayed', 'gamesStarted', 'avgMinutes', 'avgFieldGoalsMade-avgFieldGoalsAttempted',
  'fieldGoalPct', 'avgRebounds', 'avgAssists', 'avgBlocks', 'avgSteals', 'avgPoints',
];
const row = (year, games, minutes, rebounds, assists, points) => ({
  season: { year },
  stats: [String(games), '0', String(minutes), '8-15', '45.0', String(rebounds), String(assists), '0.5', '0.8', String(points)],
});
const payload = (rows) => ({ categories: [{ name: 'averages', names: NAMES, statistics: rows }] });

describe('reading a prior season off the athlete feed', () => {
  test('picks the requested season and converts to per-minute', () => {
    const p = priorFromStats(payload([row(2025, 70, 30, 9, 4, 24), row(2026, 72, 36, 12, 6, 27)]), 2026);
    expect(p.season).toBe(2026);
    expect(p.games).toBe(72);
    expect(p.minutesPerGame).toBe(36);
    expect(p.perMinute.points).toBeCloseTo(27 / 36, 8);
    expect(p.perMinute.rebounds).toBeCloseTo(12 / 36, 8);
    expect(p.perMinute.assists).toBeCloseTo(6 / 36, 8);
  });

  test('a traded player has several rows for one season; the fuller one wins', () => {
    const p = priorFromStats(
      payload([row(2026, 18, 20, 4, 2, 10), row(2026, 55, 34, 10, 5, 25)]),
      2026
    );
    expect(p.games).toBe(55);
    expect(p.minutesPerGame).toBe(34);
  });

  test('a missing season, zero minutes, or a malformed payload yields nothing', () => {
    expect(priorFromStats(payload([row(2024, 70, 30, 9, 4, 24)]), 2026)).toBeNull();
    expect(priorFromStats(payload([row(2026, 1, 0, 0, 0, 0)]), 2026)).toBeNull();
    expect(priorFromStats({ categories: [] }, 2026)).toBeNull();
    expect(priorFromStats(null, 2026)).toBeNull();
  });
});

describe('the fitted prior weight', () => {
  test('a player with no games this season is all prior', () => {
    expect(priorBlendWeight(0, PLAYER_PRIOR_K)).toBe(0);
    expect(priorBlendWeight(null, PLAYER_PRIOR_K)).toBe(0);
  });

  test('weight rises with games and never reaches one', () => {
    const w4 = priorBlendWeight(4, PLAYER_PRIOR_K);
    const w40 = priorBlendWeight(40, PLAYER_PRIOR_K);
    expect(w4).toBeCloseTo(4 / 16, 10); // four games earn a quarter of the say
    expect(w40).toBeGreaterThan(w4);
    expect(priorBlendWeight(100000, PLAYER_PRIOR_K)).toBeLessThan(1);
  });
});

describe('blending a rate toward its prior', () => {
  const rate = {
    player: 'Cold Start',
    games: 4,
    minutesPerGame: 30,
    perMinute: { points: 0.18, rebounds: 0.2, assists: 0.1 },
    usableSample: true,
    sampleNote: '4 games this season',
  };
  const prior = { season: 2026, games: 70, minutesPerGame: 32, perMinute: { points: 0.38, rebounds: 0.22, assists: 0.12 } };

  test('a four-game cold streak is pulled most of the way back', () => {
    const b = blendPlayerRate(rate, prior, PLAYER_PRIOR_K);
    const w = 4 / 16;
    expect(b.perMinute.points).toBeCloseTo(0.18 * w + 0.38 * (1 - w), 10);
    // This is the Mikal Bridges case: 5.4 points a game becomes 10.3.
    expect(rate.perMinute.points * rate.minutesPerGame).toBeCloseTo(5.4, 6);
    expect(b.perMinute.points * b.minutesPerGame).toBeGreaterThan(9);
    expect(b.priorBlendWeight).toBeCloseTo(w, 10);
  });

  test('minutes regress too, since a four-game load is just as noisy', () => {
    const b = blendPlayerRate(rate, prior, PLAYER_PRIOR_K);
    expect(b.minutesPerGame).toBeGreaterThan(30);
    expect(b.minutesPerGame).toBeLessThan(32);
  });

  test('the note says what was blended, so a reader cannot mistake it', () => {
    expect(blendPlayerRate(rate, prior, PLAYER_PRIOR_K).sampleNote).toMatch(/blended 25\/75 with 2025-26/);
  });

  test('a rookie with no prior keeps their own rate and is marked', () => {
    const b = blendPlayerRate(rate, null, PLAYER_PRIOR_K);
    expect(b.perMinute.points).toBe(0.18);
    expect(b.priorBlendWeight).toBe(1);
  });

  test('a stat the prior does not carry is left alone', () => {
    const partial = { ...prior, perMinute: { points: 0.38 } };
    const b = blendPlayerRate({ ...rate, perMinute: { points: 0.18, threes: 0.05 } }, partial, PLAYER_PRIOR_K);
    expect(b.perMinute.threes).toBe(0.05);
  });

  test('applyPriors blends a whole table and skips the absent', () => {
    const out = applyPriors({ A: { ...rate, player: 'A' }, B: { ...rate, player: 'B' } }, { A: prior });
    expect(out.A.priorBlendWeight).toBeCloseTo(4 / 16, 10);
    expect(out.B.priorBlendWeight).toBe(1);
  });
});

describe('fetching', () => {
  test('a failed request is null rather than a throw', async () => {
    const client = { get: jest.fn(() => Promise.reject(new Error('503'))) };
    expect(await fetchPlayerPrior({ athleteId: '1', season: 2026, client })).toBeNull();
  });

  test('no athlete id makes no request', async () => {
    const client = { get: jest.fn() };
    expect(await fetchPlayerPrior({ athleteId: null, season: 2026, client })).toBeNull();
    expect(client.get).not.toHaveBeenCalled();
  });

  test('many players are fetched and keyed by name, skipping those without ids', async () => {
    const client = {
      get: jest.fn(() => Promise.resolve({ data: payload([row(2026, 70, 30, 9, 4, 24)]) })),
    };
    const out = await fetchPlayerPriors({
      players: [
        { player: 'One', athleteId: '1' },
        { player: 'Two', athleteId: '2' },
        { player: 'NoId', athleteId: null },
      ],
      season: 2026,
      client,
    });
    expect(Object.keys(out).sort()).toEqual(['One', 'Two']);
    expect(client.get).toHaveBeenCalledTimes(2);
  });
});
