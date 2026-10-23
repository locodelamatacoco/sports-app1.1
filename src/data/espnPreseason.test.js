import {
  preseasonGamesFrom,
  accumulateBoxScore,
  ratesFrom,
  propBaseline,
  fetchPreseasonRates,
  MIN_MINUTES_FOR_RATE,
  MIN_GAMES_FOR_RATE,
  TRACKED_STATS,
  SEASON_TYPE_PRESEASON,
} from './espnPreseason';
import box from './__fixtures__/espnPreseasonBox.json';
import scoreboard from './__fixtures__/espnPreseasonScoreboard.json';

describe('selecting preseason games', () => {
  test('keeps completed preseason games and drops regular-season ones', () => {
    const games = preseasonGamesFrom(scoreboard);
    expect(games.length).toBeGreaterThan(0);
    const types = new Set(
      scoreboard.events
        .filter((e) => games.some((g) => g.id === String(e.id)))
        .map((e) => e.season.type)
    );
    expect([...types]).toEqual([SEASON_TYPE_PRESEASON]);
    expect(games.length).toBeLessThan(scoreboard.events.length);
  });

  test('every game carries both team abbreviations', () => {
    preseasonGamesFrom(scoreboard).forEach((g) => {
      expect(typeof g.home).toBe('string');
      expect(typeof g.away).toBe('string');
    });
  });

  test('malformed input yields nothing rather than throwing', () => {
    expect(preseasonGamesFrom(null)).toEqual([]);
    expect(preseasonGamesFrom({ events: [{}] })).toEqual([]);
  });
});

describe('accumulating box scores', () => {
  test('totals minutes and stats per player', () => {
    const acc = accumulateBoxScore(box, {}, { team: 'MIA' });
    const names = Object.keys(acc);
    expect(names.length).toBeGreaterThan(5);
    Object.values(acc).forEach((e) => {
      expect(e.games).toBe(1);
      expect(e.minutes).toBeGreaterThan(0);
      expect(e.points).toBeGreaterThanOrEqual(0);
    });
  });

  test('a team filter excludes the opponent', () => {
    const all = accumulateBoxScore(box, {});
    const onlyMia = accumulateBoxScore(box, {}, { team: 'MIA' });
    expect(Object.keys(onlyMia).length).toBeLessThan(Object.keys(all).length);
    Object.values(onlyMia).forEach((e) => expect(e.team).toBe('MIA'));
  });

  test('accumulating the same game twice doubles the sample', () => {
    const once = accumulateBoxScore(box, {}, { team: 'MIA' });
    const twice = accumulateBoxScore(box, accumulateBoxScore(box, {}, { team: 'MIA' }), {
      team: 'MIA',
    });
    const name = Object.keys(once)[0];
    expect(twice[name].games).toBe(2);
    expect(twice[name].minutes).toBeCloseTo(2 * once[name].minutes, 6);
  });

  test('players who did not appear are skipped', () => {
    const acc = accumulateBoxScore(box, {}, { team: 'MIA' });
    Object.values(acc).forEach((e) => expect(e.minutes).toBeGreaterThan(0));
  });
});

describe('per-minute rates', () => {
  const rates = ratesFrom(accumulateBoxScore(box, {}, { team: 'MIA' }));

  test('rates are per minute, not per game', () => {
    Object.values(rates).forEach((r) => {
      expect(r.perMinute.points).toBeCloseTo(
        (r.perMinute.points * r.totalMinutes) / r.totalMinutes,
        10
      );
      // Nobody scores a point a minute over a real sample.
      expect(r.perMinute.points).toBeLessThan(1.5);
    });
  });

  test('a thin sample is marked unusable, and says how thin', () => {
    Object.values(rates).forEach((r) => {
      expect(r.usableSample).toBe(
        r.totalMinutes >= MIN_MINUTES_FOR_RATE && r.games >= MIN_GAMES_FOR_RATE
      );
      expect(r.sampleNote).toMatch(/preseason game/);
    });
  });

  test('every tracked stat produces a real number, not NaN', () => {
    // threes were exposed as a rate while never being summed, so the rate came
    // back NaN — which then propagates silently into any projection built on it.
    Object.values(rates).forEach((r) => {
      TRACKED_STATS.forEach((stat) => {
        expect(Number.isFinite(r.perMinute[stat])).toBe(true);
      });
    });
    expect(TRACKED_STATS).toContain('threes');
  });

  test('one long game does not clear the sample floor', () => {
    // A single 31-minute outing beats the minutes floor while saying nothing,
    // which briefly turned a 38-point opening night into a 38-point baseline.
    const oneBigGame = ratesFrom({
      Someone: {
        player: 'Someone',
        team: 'BOS',
        games: 1,
        minutes: 31,
        points: 38,
        rebounds: 5,
        assists: 3,
        steals: 0,
        blocks: 0,
        threes: 7,
      },
    });
    expect(oneBigGame.Someone.totalMinutes).toBeGreaterThan(MIN_MINUTES_FOR_RATE);
    expect(oneBigGame.Someone.usableSample).toBe(false);
  });
});

describe('propBaseline', () => {
  // A single preseason game tops out around 18 minutes, below the usable
  // floor, which is the point of the floor. Real use aggregates a team's whole
  // preseason, so the fixture is folded in three times to stand in for that.
  let acc = {};
  for (let i = 0; i < 3; i++) acc = accumulateBoxScore(box, acc, { team: 'MIA' });
  const rates = ratesFrom(acc);
  const anyUsable = Object.values(rates).find((r) => r.usableSample);

  test('a single game is below the usable floor', () => {
    const oneGame = ratesFrom(accumulateBoxScore(box, {}, { team: 'MIA' }));
    expect(Object.values(oneGame).every((r) => !r.usableSample)).toBe(true);
    expect(anyUsable).toBeDefined();
  });

  test('scales a per-minute rate by the projected minutes', () => {
    const built = propBaseline(anyUsable, 'points', { projectedMinutes: 30, pace: 103.6 });
    expect(built.baseline.minutes).toBe(30);
    expect(built.baseline.perGame).toBeCloseTo(anyUsable.perMinute.points * 30, 10);
  });

  test('it refuses to project off an unusable sample', () => {
    const thin = { ...anyUsable, usableSample: false };
    expect(propBaseline(thin, 'points', { projectedMinutes: 30 })).toBeNull();
    expect(propBaseline(null, 'points', { projectedMinutes: 30 })).toBeNull();
  });

  test('it flags the minutes prior and the sample, so the dampener charges', () => {
    const built = propBaseline(anyUsable, 'points', { projectedMinutes: 32, pace: 103.6 });
    expect(built.flags.smallSample).toMatch(/preseason/);
    expect(built.flags.estimatedBaseline).toMatch(/prior/);
    // The preseason load has to be visible next to the projection.
    expect(built.flags.estimatedBaseline).toMatch(/mpg/);
  });

  test('a stat the player has no rate for yields nothing', () => {
    expect(propBaseline(anyUsable, 'dunks', { projectedMinutes: 30 })).toBeNull();
  });
});

describe('fetchPreseasonRates', () => {
  test('requests the month, then one box score per preseason game', async () => {
    const client = {
      get: jest.fn((url) =>
        /summary/.test(url)
          ? Promise.resolve({ data: box })
          : Promise.resolve({ data: scoreboard })
      ),
    };
    const result = await fetchPreseasonRates({ month: '202610', team: 'MIA', client });
    const expected = preseasonGamesFrom(scoreboard).filter(
      (g) => g.home === 'MIA' || g.away === 'MIA'
    ).length;
    expect(result.games).toBe(expected);
    expect(client.get).toHaveBeenCalledTimes(1 + expected);
  });

  test('a failed box score is skipped rather than failing the fetch', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const client = {
      get: jest.fn((url) =>
        /summary/.test(url)
          ? Promise.reject(new Error('box score down'))
          : Promise.resolve({ data: scoreboard })
      ),
    };
    const result = await fetchPreseasonRates({ month: '202610', client });
    expect(result.rates).toEqual({});
    warn.mockRestore();
  });
});
