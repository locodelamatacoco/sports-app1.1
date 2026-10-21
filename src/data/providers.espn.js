// src/data/providers.espn.js
//
// Registers the ESPN-backed providers. Importing this module is what wires
// them in; nothing in the model reaches for ESPN by name.
//
// Registration is an explicit call rather than an import side effect, so it
// can be repeated in tests and the order is never a surprise.
//
// ADDING ANOTHER OUTLET
// ---------------------
// Only `site.api.espn.com` is reachable from this environment, so these are
// the only providers that can run here today. Adding one is small:
//
//   1. Allow the host under the environment's network settings.
//   2. Write a module exporting a fetch function for the capability.
//   3. `register({ name, capability, priority, quality, fetch })` with a
//      priority below the ESPN entry so it is tried first.
//
// The capabilities worth another source, and what each would fix:
//
//   pace         ESPN publishes none on a reachable host, so 20 of 30 teams
//                run on a rank-derived estimate. That estimate is why the
//                total projections are the model's weakest output.
//   props        ESPN carries no player prop lines at all, which is why whole
//                slates price with no props on the board.
//   odds         ESPN returns one book, so cross-book disagreement is mostly
//                undetectable and has to be noted by hand.

import { register } from './providers';
import { fetchNbaSlate } from './espnNba';
import { fetchTeamRatings, PACE_PER_48, LEAGUE_PACE } from './espnRatings';
import { fetchPreseasonRates } from './espnPreseason';
import { mapSummary, ESPN_NBA_SUMMARY } from './espnNba';
import axios from 'axios';

export function registerEspnProviders() {
  register({
    name: 'espn:scoreboard',
    capability: 'slate',
    priority: 100,
    quality: 1,
    fetch: (options) => fetchNbaSlate(options),
  });
  
  register({
    name: 'espn:scoreboard',
    capability: 'odds',
    priority: 100,
    // One sportsbook. Enough to price against, not enough to see the market
    // disagree with itself.
    quality: 0.7,
    fetch: async (options) => {
      const slate = await fetchNbaSlate(options);
      return slate.games.map((g) => ({ gameId: g.id, odds: g.odds, book: g.book }));
    },
  });
  
  register({
    name: 'espn:standings',
    capability: 'ratings',
    priority: 100,
    quality: 1,
    fetch: (options) => fetchTeamRatings(options),
  });
  
  register({
    name: 'espn:preseason',
    capability: 'playerRates',
    priority: 100,
    // Two to six games, with preseason minutes that do not transfer.
    quality: 0.5,
    fetch: (options) => fetchPreseasonRates(options),
  });
  
  register({
    name: 'espn:summary',
    capability: 'injuries',
    priority: 100,
    quality: 1,
    fetch: async ({ espnId, client = axios, signal } = {}) => {
      if (!espnId) return null;
      const { data } = await client.get(`${ESPN_NBA_SUMMARY}?event=${espnId}`, { signal });
      const mapped = mapSummary(data);
      return mapped?.injuries?.length ? mapped.injuries : null;
    },
  });
  
  // Pace has no feed behind it at all: these are published ranks mapped onto a
  // league-average scale, which is a substitute for data rather than data.
  register({
    name: 'curated:pace-ranks',
    capability: 'pace',
    priority: 900,
    quality: 0.4,
    fetch: async () => ({ perTeam: PACE_PER_48, leagueAverage: LEAGUE_PACE }),
  });
}
