import {
  parseAmerican,
  parseLine,
  pickOdds,
  marketDisagreementFrom,
  mapEvent,
  mapScoreboard,
  fetchNbaSlate,
  SIGNIFICANT_LINE_MOVE,
} from './espnNba';
import { PROP_SETS } from './nbaGames';
import { TEAM_RATINGS, ratingsFor } from './nbaTeamRatings';
import { analyzeSlate } from '../models/nbaSimulator';
import scoreboard from './__fixtures__/espnScoreboard.json';

describe('odds string parsing', () => {
  test('american prices parse, including the plus sign and EVEN', () => {
    expect(parseAmerican('+110')).toBe(110);
    expect(parseAmerican('-130')).toBe(-130);
    expect(parseAmerican(-105)).toBe(-105);
    expect(parseAmerican('EVEN')).toBe(100);
    expect(parseAmerican(undefined)).toBeNull();
    expect(parseAmerican('not a price')).toBeNull();
  });

  test('spread lines parse, with a pick-em reading as zero', () => {
    expect(parseLine('+1.5')).toBe(1.5);
    expect(parseLine('-4.5')).toBe(-4.5);
    expect(parseLine('PK')).toBe(0);
    expect(parseLine(null)).toBeNull();
  });
});

describe('provider selection', () => {
  test('prefers a named book over whatever comes first', () => {
    const chosen = pickOdds([
      { provider: { id: 999, name: 'Composite' }, spread: '-3' },
      { provider: { id: 100, name: 'DraftKings' }, spread: '-2.5' },
    ]);
    expect(chosen.provider.name).toBe('DraftKings');
  });

  test('returns null when a game has no priced market', () => {
    expect(pickOdds([])).toBeNull();
    expect(pickOdds(undefined)).toBeNull();
  });

  test('disagreement is only reported when books actually differ', () => {
    expect(
      marketDisagreementFrom([
        { spread: '-1.5', overUnder: '230.5' },
        { spread: '-1.5', overUnder: '230.5' },
      ])
    ).toBeNull();

    const spread = marketDisagreementFrom([
      { spread: '-1.5', overUnder: '230.5' },
      { spread: '-3.5', overUnder: '233' },
    ]);
    expect(spread).toMatch(/spread/);
    expect(spread).toMatch(/total/);
  });
});

describe('mapping the live scoreboard', () => {
  const slate = mapScoreboard(scoreboard);

  test('maps every event on the slate', () => {
    expect(slate.games).toHaveLength(3);
    expect(slate.skipped).toBe(0);
    expect(slate.date).toBe('2026-10-20');
  });

  test('reads the home-side spread, not the away side', () => {
    // The fixture has Boston as a 1.5-point road favourite, so Detroit at home
    // must come back as +1.5. Getting this backwards would invert every spread.
    const bosDet = slate.games.find((g) => g.id === 'bos-det');
    expect(bosDet.odds.spread.homeLine).toBe(1.5);
    expect(bosDet.home.code).toBe('DET');
    expect(bosDet.away.code).toBe('BOS');

    // New York is a 4.5-point home favourite, so its line is negative.
    const phiNy = slate.games.find((g) => g.id === 'phi-ny');
    expect(phiNy.odds.spread.homeLine).toBe(-4.5);
  });

  test('carries both sides of every price', () => {
    slate.games.forEach((g) => {
      expect(typeof g.odds.moneyline.home).toBe('number');
      expect(typeof g.odds.moneyline.away).toBe('number');
      expect(typeof g.odds.spread.homePrice).toBe('number');
      expect(typeof g.odds.spread.awayPrice).toBe('number');
      expect(typeof g.odds.total.line).toBe('number');
      expect(g.odds.total.line).toBeGreaterThan(150);
    });
  });

  test('merges the curated ratings onto the live teams', () => {
    const okcSa = slate.games.find((g) => g.id === 'okc-sa');
    expect(okcSa.away.ratings).toEqual(TEAM_RATINGS.OKC.ratings);
    expect(okcSa.home.ratings).toEqual(TEAM_RATINGS.SA.ratings);
    expect(okcSa.away.ratingsSourced).toBe(true);
  });

  test('attaches the curated prop set for the matchup', () => {
    const bosDet = slate.games.find((g) => g.id === 'bos-det');
    expect(bosDet.props).toBe(PROP_SETS['BOS@DET']);
    expect(bosDet.props.length).toBeGreaterThan(0);
  });

  test('detects line movement from the feed opening numbers', () => {
    // Detroit opened -2.5 and is now +1.5: a 4-point move the model's inputs
    // cannot account for.
    const bosDet = slate.games.find((g) => g.id === 'bos-det');
    expect(bosDet.odds.opening.spreadHomeLine).toBe(-2.5);
    expect(bosDet.dataQuality.lineMovedAgainst).toMatch(/4\.0-pt move/);

    // San Antonio opened and sits at the same number, so nothing is flagged.
    const okcSa = slate.games.find((g) => g.id === 'okc-sa');
    expect(okcSa.odds.opening.spreadHomeLine).toBe(okcSa.odds.spread.homeLine);
    expect(okcSa.dataQuality.lineMovedAgainst).toBeNull();
  });

  test('a 0-0 record is read as having no current-season sample', () => {
    slate.games.forEach((g) => expect(g.dataQuality.noCurrentSeasonData).toBe(true));
  });

  test('flags estimated pace inputs it inherited from the ratings file', () => {
    const okcSa = slate.games.find((g) => g.id === 'okc-sa');
    expect(okcSa.dataQuality.estimatedInputs.join(' ')).toMatch(/pace/);
  });

  test('a game with no priced market is skipped, not half-mapped', () => {
    const unpriced = {
      id: '1',
      date: '2026-10-20T19:00Z',
      competitions: [
        {
          odds: [],
          competitors: [
            { homeAway: 'home', team: { abbreviation: 'DET' } },
            { homeAway: 'away', team: { abbreviation: 'BOS' } },
          ],
        },
      ],
    };
    expect(mapEvent(unpriced)).toBeNull();
    const partial = mapScoreboard({ events: [unpriced, ...scoreboard.events] });
    expect(partial.games).toHaveLength(3);
    expect(partial.skipped).toBe(1);
  });

  test('malformed events do not throw', () => {
    expect(mapEvent({})).toBeNull();
    expect(mapEvent({ competitions: [{}] })).toBeNull();
    expect(mapScoreboard({})).toEqual(
      expect.objectContaining({ games: [], skipped: 0 })
    );
    expect(mapScoreboard(null).games).toEqual([]);
  });

  test('an unrated team degrades to league average and says so', () => {
    const unknown = ratingsFor('ZZZ');
    expect(unknown.ratingsSourced).toBe(false);
    expect(unknown.ratings.off).toBe(unknown.ratings.def); // no opinion either way

    const event = JSON.parse(JSON.stringify(scoreboard.events[0]));
    event.competitions[0].competitors.find((c) => c.homeAway === 'away').team.abbreviation = 'ZZZ';
    const mapped = mapEvent(event);
    expect(mapped.dataQuality.estimatedInputs.join(' ')).toMatch(/ZZZ ratings unavailable/);
  });

  test('the move threshold is the documented one', () => {
    expect(SIGNIFICANT_LINE_MOVE).toBe(2.0);
  });
});

describe('fetchNbaSlate', () => {
  test('requests today by default and maps the response', async () => {
    const client = { get: jest.fn().mockResolvedValue({ data: scoreboard }) };
    const slate = await fetchNbaSlate({ client });
    expect(client.get).toHaveBeenCalledTimes(1);
    expect(client.get.mock.calls[0][0]).not.toMatch(/dates=/);
    expect(slate.games).toHaveLength(3);
  });

  test('passes an explicit date through to the feed', async () => {
    const client = { get: jest.fn().mockResolvedValue({ data: scoreboard }) };
    await fetchNbaSlate({ date: '20261020', client });
    expect(client.get.mock.calls[0][0]).toMatch(/dates=20261020/);
  });

  test('propagates a transport failure so the caller can fall back', async () => {
    const client = { get: jest.fn().mockRejectedValue(new Error('network down')) };
    await expect(fetchNbaSlate({ client })).rejects.toThrow('network down');
  });
});

describe('the live slate drives the model end to end', () => {
  test('every live game produces a priced board', () => {
    const { results } = analyzeSlate(mapScoreboard(scoreboard).games, {
      numSims: 3000,
      seed: 2026,
    });
    expect(results).toHaveLength(3);
    results.forEach((r) => {
      expect(r.markets.length).toBeGreaterThanOrEqual(6);
      expect(r.summary.predictedTotal).toBeGreaterThan(190);
      expect(r.summary.predictedTotal).toBeLessThan(260);
      r.markets.forEach((row) => {
        expect(row.adjustedEdge).toBeCloseTo(row.rawEdge - row.penaltyTotal, 10);
      });
    });
  });
});
