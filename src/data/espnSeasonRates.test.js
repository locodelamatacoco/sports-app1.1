import {
  regularSeasonGamesFrom,
  seasonBaseline,
  fetchSeasonRates,
  SEASON_TYPE_REGULAR,
} from './espnSeasonRates';

const scoreboardWith = (events) => ({ events });
const game = (id, type, completed, home = 'BOS', away = 'BKN') => ({
  id,
  date: '2026-10-25T23:00Z',
  season: { type },
  status: { type: { completed } },
  competitions: [
    {
      competitors: [
        { homeAway: 'home', team: { abbreviation: home } },
        { homeAway: 'away', team: { abbreviation: away } },
      ],
    },
  ],
});

describe('selecting completed regular-season games', () => {
  test('keeps only completed games of the regular season', () => {
    const picked = regularSeasonGamesFrom(
      scoreboardWith([
        game('1', SEASON_TYPE_REGULAR, true),
        game('2', SEASON_TYPE_REGULAR, false), // in progress
        game('3', 1, true), // preseason
        game('4', 3, true), // postseason
      ])
    );
    expect(picked.map((g) => g.id)).toEqual(['1']);
    expect(picked[0]).toEqual(
      expect.objectContaining({ home: 'BOS', away: 'BKN', date: '2026-10-25' })
    );
  });

  test('malformed payloads yield nothing rather than throwing', () => {
    expect(regularSeasonGamesFrom(null)).toEqual([]);
    expect(regularSeasonGamesFrom({})).toEqual([]);
    expect(regularSeasonGamesFrom(scoreboardWith([{ id: 'x' }]))).toEqual([]);
    expect(
      regularSeasonGamesFrom(scoreboardWith([{ ...game('5', 2, true), competitions: [{}] }]))
    ).toEqual([]);
  });
});

describe('season baselines', () => {
  const rate = {
    player: 'A Player',
    games: 4,
    totalMinutes: 128,
    minutesPerGame: 32,
    perMinute: { points: 0.625, rebounds: 0.25, threes: NaN },
    usableSample: true,
    sampleNote: '4 games this season, 128 total minutes',
  };

  test('a usable rate becomes a per-game baseline at its own minutes', () => {
    const b = seasonBaseline(rate, 'points', { pace: 100 });
    expect(b.baseline.perGame).toBeCloseTo(20, 6);
    expect(b.baseline.minutes).toBe(32);
    expect(b.flags.smallSample).toMatch(/4 games this season/);
    // Its own minutes are a real load, so nothing is flagged as estimated.
    expect(b.flags.estimatedBaseline).toBeUndefined();
  });

  test('overriding minutes rescales the baseline and says so', () => {
    const b = seasonBaseline(rate, 'points', { projectedMinutes: 24, pace: 100 });
    expect(b.baseline.perGame).toBeCloseTo(15, 6);
    expect(b.flags.estimatedBaseline).toMatch(/24 min against 32.0 mpg/);
  });

  test('a trivial minutes change is not worth flagging', () => {
    const b = seasonBaseline(rate, 'points', { projectedMinutes: 33, pace: 100 });
    expect(b.flags.estimatedBaseline).toBeUndefined();
  });

  test('an unusable sample or an unmeasured stat refuses to project', () => {
    expect(seasonBaseline({ ...rate, usableSample: false }, 'points', {})).toBeNull();
    // Advertised but never accumulated: must not become NaN downstream.
    expect(seasonBaseline(rate, 'threes', {})).toBeNull();
    expect(seasonBaseline(rate, 'blocks', {})).toBeNull();
    expect(seasonBaseline(null, 'points', {})).toBeNull();
  });
});

describe('fetchSeasonRates', () => {
  const summary = {
    boxscore: {
      players: [
        {
          team: { abbreviation: 'BOS' },
          statistics: [
            {
              keys: ['minutes', 'points', 'rebounds', 'assists'],
              athletes: [
                { athlete: { displayName: 'Starter' }, stats: ['36', '24', '8', '5'] },
                { athlete: { displayName: 'Did Not Play' }, stats: ['0', '0', '0', '0'] },
              ],
            },
          ],
        },
      ],
    },
  };

  test('accumulates one summary per completed game and reports the sample', async () => {
    const client = {
      get: jest.fn((url) =>
        /summary/.test(url)
          ? Promise.resolve({ data: summary })
          : Promise.resolve({
              data: scoreboardWith([game('1', 2, true), game('2', 2, true)]),
            })
      ),
    };
    const out = await fetchSeasonRates({ months: ['202610'], client });
    expect(out.games).toBe(2);
    expect(out.failed).toBe(0);
    // One scoreboard call, then one summary per game.
    expect(client.get).toHaveBeenCalledTimes(3);
    const starter = out.rates.Starter;
    expect(starter.games).toBe(2);
    expect(starter.minutesPerGame).toBe(36);
    expect(starter.perMinute.points).toBeCloseTo(24 / 36, 8);
    // The note must say THIS season, not preseason, or a caller reading it
    // will misjudge where the number came from.
    expect(starter.sampleNote).toMatch(/2 games this season/);
    // A player who logged no minutes is not a zero-rate player.
    expect(out.rates['Did Not Play']).toBeUndefined();
  });

  test('the same game listed in two months is counted once', async () => {
    const client = {
      get: jest.fn((url) =>
        /summary/.test(url)
          ? Promise.resolve({ data: summary })
          : Promise.resolve({ data: scoreboardWith([game('1', 2, true)]) })
      ),
    };
    const out = await fetchSeasonRates({ months: ['202610', '202611'], client });
    expect(out.games).toBe(1);
    expect(out.rates.Starter.games).toBe(1);
  });

  test('a failed box score is counted, not fatal', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const client = {
      get: jest.fn((url) =>
        /summary/.test(url)
          ? Promise.reject(new Error('503'))
          : Promise.resolve({ data: scoreboardWith([game('1', 2, true)]) })
      ),
    };
    const out = await fetchSeasonRates({ months: ['202610'], client });
    expect(out.failed).toBe(1);
    expect(out.rates).toEqual({});
    warn.mockRestore();
  });

  test('a team filter narrows the games fetched', async () => {
    const client = {
      get: jest.fn((url) =>
        /summary/.test(url)
          ? Promise.resolve({ data: summary })
          : Promise.resolve({
              data: scoreboardWith([
                game('1', 2, true, 'BOS', 'BKN'),
                game('2', 2, true, 'LAL', 'POR'),
              ]),
            })
      ),
    };
    const out = await fetchSeasonRates({ months: ['202610'], team: 'BOS', client });
    expect(out.games).toBe(1);
  });
});
