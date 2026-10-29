import { normalizeName, indexByName, marketsFromRow, propsFromLines, ruledOutFrom } from './propLines';

describe('matching a line-page name to a box-score name', () => {
  test('suffixes, punctuation, accents and case do not block a match', () => {
    expect(normalizeName('Darius Acuff Jr.')).toBe(normalizeName('Darius Acuff'));
    expect(normalizeName('Trey Murphy III')).toBe(normalizeName('Trey Murphy'));
    expect(normalizeName("De'Andre Hunter")).toBe(normalizeName('DeAndre Hunter'));
    expect(normalizeName('Nikola Jokić')).toBe(normalizeName('Nikola Jokic'));
    expect(normalizeName('Karl-Anthony Towns')).toBe(normalizeName('Karl Anthony Towns'));
  });

  test('two players who collapse to one name are dropped, not guessed', () => {
    const index = indexByName({ 'Gary Payton': {}, 'Gary Payton II': {} });
    expect(index.get('gary payton')).toBeNull();
  });
});

describe('splitting a posted row into markets', () => {
  test('one line for both sides is one two-sided market', () => {
    expect(
      marketsFromRow({ over: { line: 20.5, price: -110 }, under: { line: 20.5, price: -110 } })
    ).toEqual([{ line: 20.5, over: -110, under: -110 }]);
  });

  test('different lines per side are two one-sided markets', () => {
    expect(
      marketsFromRow({ over: { line: 23.5, price: -115 }, under: { line: 24.5, price: -119 } })
    ).toEqual([
      { line: 23.5, over: -115, under: null },
      { line: 24.5, over: null, under: -119 },
    ]);
  });

  test('a side with a price but no line is not a market', () => {
    expect(
      marketsFromRow({ over: { line: null, price: -164 }, under: { line: 3.5, price: -165 } })
    ).toEqual([{ line: 3.5, over: null, under: -165 }]);
    expect(marketsFromRow({ over: null, under: null })).toEqual([]);
  });
});

describe('building props for a slate', () => {
  const rate = (team, games = 4, usable = true) => ({
    team,
    games,
    minutesPerGame: 32,
    perMinute: { points: 0.6, rebounds: 0.25, assists: 0.15 },
    usableSample: usable,
    sampleNote: `${games} games this season`,
  });
  const games = [
    { id: 'a-b', away: { code: 'AAA', ratings: { pace: 100 } }, home: { code: 'BBB', ratings: { pace: 98 } } },
  ];
  const rates = {
    'Away Star Jr.': rate('AAA'),
    'Home Big': rate('BBB'),
    'Absent Team': rate('ZZZ'),
    'Two Games': rate('BBB', 2, false),
  };

  test("props attach to the player's own game, under the box-score spelling", () => {
    const { byGame, priced } = propsFromLines(
      [{ player: 'Away Star', stat: 'points', over: { line: 19.5, price: -110 }, under: { line: 19.5, price: -110 } }],
      { games, rates }
    );
    expect(priced).toBe(1);
    const [p] = byGame.get('a-b');
    expect(p.player).toBe('Away Star Jr.');
    expect(p.baseline.perGame).toBeCloseTo(0.6 * 32, 8);
    expect(p.baseline.pace).toBe(100);
  });

  test('the team comes from the box scores, so a stale row is excluded', () => {
    const { priced, excluded } = propsFromLines(
      [{ player: 'Absent Team', stat: 'points', over: { line: 10.5, price: -110 }, under: { line: 10.5, price: -110 } }],
      { games, rates }
    );
    expect(priced).toBe(0);
    expect(excluded.notPlaying).toEqual(['Absent Team (ZZZ)']);
  });

  test('a thin sample, an unknown name and an unmeasured stat are each reported', () => {
    const { excluded } = propsFromLines(
      [
        { player: 'Two Games', stat: 'points', over: { line: 8.5, price: -110 }, under: { line: 8.5, price: -110 } },
        { player: 'Nobody Known', stat: 'points', over: { line: 8.5, price: -110 }, under: null },
        { player: 'Home Big', stat: 'blocks', over: { line: 1.5, price: -110 }, under: null },
      ],
      { games, rates }
    );
    expect(excluded.thinSample).toEqual(['Two Games (2 games)']);
    expect(excluded.unmatched).toEqual(['Nobody Known']);
    expect(excluded.noBaseline).toEqual(['Home Big blocks']);
  });

  test('a split row prices as two one-sided props', () => {
    const { byGame, priced } = propsFromLines(
      [{ player: 'Home Big', stat: 'rebounds', over: { line: 7.5, price: -120 }, under: { line: 8.5, price: -136 } }],
      { games, rates }
    );
    expect(priced).toBe(2);
    const props = byGame.get('a-b');
    expect(props.map((p) => [p.line, p.over, p.under])).toEqual([
      [7.5, -120, null],
      [8.5, null, -136],
    ]);
  });
});

describe('players ruled out', () => {
  const games = [
    {
      id: 'a-b',
      away: { code: 'AAA', ratings: { pace: 100 } },
      home: { code: 'BBB', ratings: { pace: 98 } },
      injuries: [
        { player: 'Scratched Guard Jr.', team: 'AAA', status: 'Out' },
        { player: 'Doubtful Wing', team: 'AAA', status: 'Doubtful' },
        { player: 'Questionable Big', team: 'BBB', status: 'Questionable' },
      ],
    },
  ];
  const rate = (team) => ({
    team,
    games: 4,
    minutesPerGame: 30,
    perMinute: { points: 0.5, rebounds: 0.2 },
    usableSample: true,
  });
  const rates = {
    'Scratched Guard': rate('AAA'),
    'Doubtful Wing': rate('AAA'),
    'Questionable Big': rate('BBB'),
  };
  const line = (player) => ({
    player,
    stat: 'points',
    over: { line: 14.5, price: -110 },
    under: { line: 14.5, price: -110 },
  });

  test('out and doubtful are ruled out; questionable is not', () => {
    const out = ruledOutFrom(games);
    expect(out.has(normalizeName('Scratched Guard'))).toBe(true);
    expect(out.has(normalizeName('Doubtful Wing'))).toBe(true);
    expect(out.has(normalizeName('Questionable Big'))).toBe(false);
  });

  test('a stale line on a scratched player is not priced', () => {
    const { priced, excluded } = propsFromLines(
      ['Scratched Guard', 'Doubtful Wing', 'Questionable Big'].map(line),
      { games, rates }
    );
    expect(priced).toBe(1);
    expect(excluded.ruledOut).toEqual(['Scratched Guard', 'Doubtful Wing']);
  });
});
