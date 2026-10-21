import {
  ratingsFromStandings,
  standingsEntries,
  fetchTeamRatings,
  PACE_PER_48,
  LEAGUE_PACE,
} from './espnRatings';
import { ROSTER_PRIORS } from './nbaTeamRatings';
import standings from './__fixtures__/espnStandings.json';

describe('deriving ratings from the standings feed', () => {
  const derived = ratingsFromStandings(standings);

  test('covers all thirty teams, each only once', () => {
    expect(derived.count).toBe(30);
    expect(Object.keys(derived.teams)).toHaveLength(30);
    expect(standingsEntries(standings)).toHaveLength(30);
  });

  test('inverts the possession identity: points per game over pace', () => {
    const det = derived.teams.DET;
    const pace = PACE_PER_48.DET;
    expect(det.ratings.pace).toBe(pace);
    expect(det.ratings.off).toBeCloseTo((det.pointsFor / pace) * 100, 6);
    expect(det.ratings.def).toBeCloseTo((det.pointsAgainst / pace) * 100, 6);
  });

  test('a team with no sourced pace falls back to league pace and says so', () => {
    const okc = derived.teams.OKC;
    expect(PACE_PER_48.OKC).toBeUndefined();
    expect(okc.ratings.pace).toBe(LEAGUE_PACE);
    expect(okc.paceEstimated).toBe(true);

    const bos = derived.teams.BOS;
    expect(bos.ratings.pace).toBe(PACE_PER_48.BOS);
    expect(bos.paceEstimated).toBe(false);
  });

  test('net rating survives an estimated pace', () => {
    // Assuming league pace scales both ratings together, so the difference —
    // which is what drives the projected margin — is preserved.
    const okc = derived.teams.OKC;
    const netFromRatings = okc.ratings.off - okc.ratings.def;
    const netFromPoints = ((okc.pointsFor - okc.pointsAgainst) / LEAGUE_PACE) * 100;
    expect(netFromRatings).toBeCloseTo(netFromPoints, 6);
  });

  test('the league average comes from the same data as the ratings', () => {
    const offs = Object.values(derived.teams).map((t) => t.pointsFor);
    const mean = offs.reduce((a, b) => a + b, 0) / offs.length;
    expect(derived.league.pointsFor).toBeCloseTo(mean, 6);
    expect(derived.league.rating).toBeCloseTo((mean / LEAGUE_PACE) * 100, 6);
  });

  test('the derived figures agree with independently sourced net ratings', () => {
    // Cross-check against the 2025-26 figures gathered by hand before this feed
    // was wired up. The band is 0.15 rather than exact: those figures were
    // published rounded to a tenth, and the per-game averages here carry more
    // precision than the rounded difference does.
    const net = (t) => derived.teams[t].pointsFor - derived.teams[t].pointsAgainst;
    const agrees = (team, expected) =>
      expect(Math.abs(net(team) - expected)).toBeLessThan(0.15);
    agrees('OKC', 11.1);
    agrees('NY', 6.4);
    agrees('DET', 8.2);
    agrees('PHI', -0.2);
    agrees('BOS', 7.7);
  });

  test('roster priors overlay the derived ratings', () => {
    expect(derived.teams.BOS.rosterAdj).toEqual(ROSTER_PRIORS.BOS.rosterAdj);
    expect(derived.teams.BOS.turnover).toBe('high');
    // A team nobody has assessed is marked unknown, not silently treated as
    // unchanged — the dampener charges for that.
    expect(derived.teams.TOR.turnover).toBe('unknown');
    expect(derived.teams.TOR.rosterAdj).toEqual({ off: 0, def: 0 });
  });

  test('malformed or empty standings yield nothing rather than throwing', () => {
    expect(ratingsFromStandings(null).count).toBe(0);
    expect(ratingsFromStandings({}).league).toBeNull();
    const noStats = { children: [{ standings: { entries: [{ team: { abbreviation: 'X' } }] } }] };
    expect(ratingsFromStandings(noStats).count).toBe(0);
  });
});

describe('fetchTeamRatings', () => {
  test('requests the season it is given', async () => {
    const client = { get: jest.fn().mockResolvedValue({ data: standings }) };
    const result = await fetchTeamRatings({ season: 2026, client });
    expect(client.get.mock.calls[0][0]).toMatch(/season=2026/);
    expect(result.count).toBe(30);
  });

  test('propagates failure so the caller can fall back', async () => {
    const client = { get: jest.fn().mockRejectedValue(new Error('nope')) };
    await expect(fetchTeamRatings({ client })).rejects.toThrow('nope');
  });
});
