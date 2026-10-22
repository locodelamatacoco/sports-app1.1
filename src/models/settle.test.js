import {
  settleMarket,
  settleProp,
  propPlayerFrom,
  propStatFrom,
  propThresholdFrom,
  propLineFrom,
  homeLineFor,
  lineFromLabel,
  unitProfit,
  emptyTally,
  recordOutcome,
  tallySummary,
} from './settle';

// Bulls @ Raptors, a real logged row: Toronto -10.5, total 237.5.
const CHI_TOR = { away: 113, home: 121 }; // home by 8, total 234

describe('reading lines off a label', () => {
  test('pulls signed numbers, including from alternate rows', () => {
    expect(lineFromLabel('Toronto Raptors -10.5')).toBe(-10.5);
    expect(lineFromLabel('Chicago Bulls +10.5')).toBe(10.5);
    expect(lineFromLabel('Over 237.5')).toBe(237.5);
    expect(lineFromLabel('Under 231.5 (alt)')).toBe(231.5);
    expect(lineFromLabel('Toronto Raptors ML')).toBeNull();
    expect(lineFromLabel(undefined)).toBeNull();
  });

  test('both sides of a spread resolve to the same home line', () => {
    const home = { market: 'spread', side: 'home', label: 'Toronto Raptors -10.5' };
    const away = { market: 'spread', side: 'away', label: 'Chicago Bulls +10.5' };
    expect(homeLineFor(home)).toBe(-10.5);
    expect(homeLineFor(away)).toBe(-10.5);
  });
});

describe('settling against a final score', () => {
  const s = (m) => settleMarket(m, CHI_TOR.away, CHI_TOR.home);

  test('moneyline', () => {
    expect(s({ market: 'moneyline', side: 'home' })).toBe(true);
    expect(s({ market: 'moneyline', side: 'away' })).toBe(false);
  });

  test('a favourite that wins by less than the spread does not cover', () => {
    // Toronto won by 8 but was laying 10.5.
    expect(s({ market: 'spread', side: 'home', label: 'Toronto Raptors -10.5' })).toBe(false);
    expect(s({ market: 'spread', side: 'away', label: 'Chicago Bulls +10.5' })).toBe(true);
  });

  test('both sides of a spread never agree', () => {
    for (const line of [-12.5, -8.5, -3.5, 1.5, 6.5]) {
      const home = s({ market: 'spread', side: 'home', label: `Home ${line}` });
      const away = s({ market: 'spread', side: 'away', label: `Away ${-line}` });
      expect(home).not.toBe(away);
    }
  });

  test('a whole-number spread landing exactly is a push', () => {
    // Home by 8 against a line of -8.
    expect(s({ market: 'spread', side: 'home', label: 'Home -8' })).toBe('push');
    expect(s({ market: 'spread', side: 'away', label: 'Away +8' })).toBe('push');
  });

  test('totals', () => {
    expect(s({ market: 'total', side: 'over', label: 'Over 237.5' })).toBe(false);
    expect(s({ market: 'total', side: 'under', label: 'Under 237.5' })).toBe(true);
    expect(s({ market: 'total', side: 'over', label: 'Over 230.5' })).toBe(true);
    expect(s({ market: 'total', side: 'over', label: 'Over 234' })).toBe('push');
  });

  test('alternate spreads use the stored margin threshold', () => {
    // derivedMarkets stores `line` as the margin the home side must beat, which
    // is the NEGATIVE of the home line: laying 12 points is line: 12.
    expect(homeLineFor({ market: 'altSpread', line: 12 })).toBe(-12);

    // Home won by 8.
    expect(s({ market: 'altSpread', side: 'home', line: 5 })).toBe(true); // 8 > 5
    expect(s({ market: 'altSpread', side: 'home', line: 12 })).toBe(false); // 8 < 12
    expect(s({ market: 'altSpread', side: 'away', line: 12 })).toBe(true);
    expect(s({ market: 'altSpread', side: 'home', line: -5 })).toBe(true); // getting points
    expect(s({ market: 'altSpread', side: 'home', line: 8 })).toBe('push');
  });

  test('team totals read the right side score', () => {
    expect(s({ market: 'teamTotal', side: 'home-over', line: 115.5 })).toBe(true);
    expect(s({ market: 'teamTotal', side: 'home-under', line: 115.5 })).toBe(false);
    expect(s({ market: 'teamTotal', side: 'away-over', line: 115.5 })).toBe(false);
    expect(s({ market: 'teamTotal', side: 'away-under', line: 115.5 })).toBe(true);
    expect(s({ market: 'teamTotal', side: 'home-over', line: 121 })).toBe('push');
  });

  test('a player prop is reported unsettleable, not guessed', () => {
    expect(s({ market: 'prop', side: 'over', label: 'Someone Over 8.5 rebounds' })).toBeNull();
  });

  test('a market with no readable line is unsettleable', () => {
    expect(s({ market: 'spread', side: 'home', label: 'Toronto Raptors' })).toBeNull();
    expect(s({ market: 'total', side: 'over', label: 'Over' })).toBeNull();
  });
});

describe('bookkeeping', () => {
  test('unit profit follows the price', () => {
    expect(unitProfit(100, true)).toBeCloseTo(1, 10);
    expect(unitProfit(-110, true)).toBeCloseTo(0.909, 3);
    expect(unitProfit(190, true)).toBeCloseTo(1.9, 10);
    expect(unitProfit(-110, false)).toBe(-1);
    expect(unitProfit(-110, 'push')).toBe(0);
  });

  test('a push moves the count but not the money', () => {
    const t = emptyTally();
    recordOutcome(t, 'push', -110);
    expect(t).toMatchObject({ n: 1, won: 0, lost: 0, push: 1, units: 0 });
  });

  test('a break-even run at -110 shows a losing ROI', () => {
    // Five wins and five losses at -110 is how the vig actually gets you.
    const t = emptyTally();
    for (let i = 0; i < 5; i++) recordOutcome(t, true, -110);
    for (let i = 0; i < 5; i++) recordOutcome(t, false, -110);
    const s = tallySummary(t);
    expect(s.winRate).toBeCloseTo(0.5, 10);
    expect(s.units).toBeCloseTo(-0.4545, 3);
    expect(s.roi).toBeLessThan(0);
  });

  test('pushes are excluded from win rate and ROI denominators', () => {
    const t = emptyTally();
    recordOutcome(t, true, -110);
    recordOutcome(t, 'push', -110);
    const s = tallySummary(t);
    expect(s.n).toBe(2);
    expect(s.decided).toBe(1);
    expect(s.winRate).toBe(1);
  });
});

describe('settling player props from a box score', () => {
  // Real lines from 2026-10-21, Timberwolves at Heat.
  const box = {
    'Bam Adebayo': { points: 15, rebounds: 7, assists: 4, threes: 1, minutes: 31 },
    'Pelle Larsson': { points: 2, rebounds: 3, assists: 4, threes: 0, minutes: 24 },
    'Andrew Wiggins': { points: 11, rebounds: 2, assists: 1, threes: 1, minutes: 27 },
  };

  describe('reading a logged prop row', () => {
    test('pulls the player name out of the label', () => {
      expect(propPlayerFrom({ label: 'Bam Adebayo 17+ points' })).toBe('Bam Adebayo');
      expect(propPlayerFrom({ label: 'Bam Adebayo Over 9.5 rebounds' })).toBe('Bam Adebayo');
      expect(propPlayerFrom({ label: 'Shai Gilgeous-Alexander Under 30.5 points' })).toBe(
        'Shai Gilgeous-Alexander'
      );
      // An explicit field always wins over parsing.
      expect(propPlayerFrom({ player: 'Explicit', label: 'Other Over 1.5 points' })).toBe(
        'Explicit'
      );
    });

    test('pulls the stat out of the label', () => {
      expect(propStatFrom({ label: 'X 17+ points' })).toBe('points');
      expect(propStatFrom({ label: 'X Over 9.5 rebounds' })).toBe('rebounds');
      expect(propStatFrom({ label: 'X Over 6.5 assists' })).toBe('assists');
      expect(propStatFrom({ label: 'X 3+ threes' })).toBe('threes');
      expect(propStatFrom({ label: 'X Over 1.5 somethings' })).toBeNull();
    });

    test('reads a threshold and a mid-string line, which the spread reader cannot', () => {
      // lineFromLabel is end-anchored for "Raptors -10.5" and finds nothing here.
      expect(lineFromLabel('Bam Adebayo Over 9.5 rebounds')).toBeNull();
      expect(propLineFrom({ label: 'Bam Adebayo Over 9.5 rebounds' })).toBe(9.5);
      expect(propThresholdFrom({ label: 'Bam Adebayo 17+ points' })).toBe(17);
      expect(propThresholdFrom({ label: 'Bam Adebayo Over 9.5 rebounds' })).toBeNull();
    });
  });

  test('a threshold prop wins at or above the number', () => {
    // Adebayo scored exactly 15.
    expect(settleProp({ label: 'Bam Adebayo 15+ points' }, box['Bam Adebayo'])).toBe(true);
    expect(settleProp({ label: 'Bam Adebayo 16+ points' }, box['Bam Adebayo'])).toBe(false);
    expect(settleProp({ label: 'Bam Adebayo 17+ points' }, box['Bam Adebayo'])).toBe(false);
  });

  test('an over/under prop settles against the line', () => {
    const over = (line) =>
      settleProp(
        { label: `Bam Adebayo Over ${line} rebounds`, side: 'over' },
        box['Bam Adebayo']
      );
    expect(over(6.5)).toBe(true); // 7 rebounds
    expect(over(9.5)).toBe(false);
    expect(
      settleProp(
        { label: 'Bam Adebayo Under 9.5 rebounds', side: 'under' },
        box['Bam Adebayo']
      )
    ).toBe(true);
  });

  test('landing exactly on a whole-number line is a push', () => {
    expect(
      settleProp({ label: 'Bam Adebayo Over 15 points', side: 'over' }, box['Bam Adebayo'])
    ).toBe('push');
  });

  test('a player absent from the box score is void, not a loss', () => {
    // Guessing either way here would quietly corrupt the record: a player who
    // did not appear usually voids the bet.
    expect(settleProp({ label: 'Nobody 10+ points' }, box['Nobody'])).toBeNull();
    expect(settleProp({ label: 'Nobody 10+ points' }, undefined)).toBeNull();
  });

  test('settleMarket routes props through the box score', () => {
    const row = { market: 'prop', side: 'over', label: 'Pelle Larsson 11+ points' };
    // Larsson scored 2.
    expect(settleMarket(row, 106, 131, box)).toBe(false);
    // Without a box score it reports unsettleable rather than guessing.
    expect(settleMarket(row, 106, 131, null)).toBeNull();
  });

  test('the Wiggins and Larsson fades both settled as the model read them', () => {
    const wiggins = { market: 'prop', side: 'over', label: 'Andrew Wiggins 15+ points' };
    const larsson = { market: 'prop', side: 'over', label: 'Pelle Larsson 11+ points' };
    expect(settleMarket(wiggins, 106, 131, box)).toBe(false);
    expect(settleMarket(larsson, 106, 131, box)).toBe(false);
    // And the cushion lines the ladder pointed at did land.
    const cushion = { market: 'prop', side: 'over', label: 'Andrew Wiggins Over 10.5 points' };
    expect(settleMarket(cushion, 106, 131, box)).toBe(true);
  });
});
