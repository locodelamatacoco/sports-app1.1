import {
  ratingsFromStandings,
  standingsEntries,
  fetchTeamRatings,
  blendSeasons,
  blendWeight,
  PACE_PER_48,
  LEAGUE_PACE,
  CURRENT_SEASON_K,
  MIN_GAMES_FOR_BLEND,
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

describe('blending this season into last season', () => {
  const prior = ratingsFromStandings(standings);

  // A current-season table built from the prior one, so the only differences
  // are the ones each test introduces.
  const currentWith = (games, shift = 0) => {
    const teams = {};
    for (const [code, entry] of Object.entries(prior.teams)) {
      teams[code] = {
        ...entry,
        gamesPlayed: games,
        record: `${games}-0`,
        pointsFor: entry.pointsFor + shift,
        pointsAgainst: entry.pointsAgainst - shift,
      };
    }
    return { ...prior, teams };
  };

  test('weight is zero below the measured gate and rises after it', () => {
    expect(blendWeight(0)).toBe(0);
    expect(blendWeight(MIN_GAMES_FOR_BLEND - 1)).toBe(0);
    expect(blendWeight(MIN_GAMES_FOR_BLEND)).toBeCloseTo(
      MIN_GAMES_FOR_BLEND / (MIN_GAMES_FOR_BLEND + CURRENT_SEASON_K),
      10
    );
    // Monotone, and never reaching 1: last season always keeps a say.
    expect(blendWeight(40)).toBeGreaterThan(blendWeight(20));
    expect(blendWeight(10000)).toBeLessThan(1);
  });

  test('a null or missing gamesPlayed earns no weight', () => {
    expect(blendWeight(null)).toBe(0);
    expect(blendWeight(undefined)).toBe(0);
    expect(blendWeight(NaN)).toBe(0);
  });

  test('below the gate the ratings are untouched', () => {
    const blended = blendSeasons(prior, currentWith(4, 12));
    expect(blended.blended).toBe(false);
    for (const code of Object.keys(prior.teams)) {
      expect(blended.teams[code].ratings.off).toBeCloseTo(prior.teams[code].ratings.off, 10);
      expect(blended.teams[code].blendWeight).toBe(0);
      // The gate is about weight, not about knowing nothing: the games played
      // are still reported so a caller can see why the weight is zero.
      expect(blended.teams[code].currentSeasonGames).toBe(4);
    }
  });

  test('above the gate the blend moves ratings toward this season', () => {
    const games = 20;
    const shift = 10;
    const blended = blendSeasons(prior, currentWith(games, shift));
    const w = games / (games + CURRENT_SEASON_K);
    expect(blended.blended).toBe(true);
    expect(blended.blendedCount).toBe(30);

    const code = Object.keys(prior.teams)[0];
    const p = prior.teams[code];
    expect(blended.teams[code].pointsFor).toBeCloseTo(
      p.pointsFor * (1 - w) + (p.pointsFor + shift) * w,
      8
    );
    expect(blended.teams[code].blendWeight).toBeCloseTo(w, 10);
    // Scoring more and conceding less has to raise offence and lower defence.
    expect(blended.teams[code].ratings.off).toBeGreaterThan(p.ratings.off);
    expect(blended.teams[code].ratings.def).toBeLessThan(p.ratings.def);
  });

  test('the league scale moves with the ratings', () => {
    const blended = blendSeasons(prior, currentWith(20, 10));
    // Every team scoring 10 more must raise the league average the matchup
    // adjustment divides by, or the adjustment silently inflates everyone.
    expect(blended.league.rating).toBeGreaterThan(prior.league.rating);
    expect(blended.league.pointsFor).toBeGreaterThan(prior.league.pointsFor);
  });

  test('no current-season table leaves the prior season intact', () => {
    const blended = blendSeasons(prior, null);
    expect(blended.blended).toBe(false);
    for (const code of Object.keys(prior.teams)) {
      expect(blended.teams[code].ratings).toEqual(prior.teams[code].ratings);
      expect(blended.teams[code].blendWeight).toBe(0);
    }
  });

  test('a team missing from this season keeps its prior rating', () => {
    const current = currentWith(20, 10);
    const dropped = Object.keys(prior.teams)[0];
    delete current.teams[dropped];
    const blended = blendSeasons(prior, current);
    expect(blended.teams[dropped].blendWeight).toBe(0);
    expect(blended.teams[dropped].ratings.off).toBeCloseTo(prior.teams[dropped].ratings.off, 10);
    expect(blended.blendedCount).toBe(29);
  });
});
