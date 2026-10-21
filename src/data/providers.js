// src/data/providers.js
//
// A source registry, so where the data comes from is configuration rather than
// something welded into the model.
//
// Today only ESPN's public scoreboard host is reachable, and it cannot supply
// everything the model wants: no team pace, no player prop lines, one
// sportsbook rather than several, and no closing lines once a game is final.
// Those gaps are not permanent, and other outlets have the data — so each
// capability is resolved through a list of providers in priority order rather
// than by calling one adapter directly. Adding a source is then a `register`
// call and a fetch function, not surgery on the model.
//
// The part that actually matters for correctness: every resolved value carries
// its PROVENANCE. A pace figure from an official feed and a pace figure
// inferred from a published rank are not the same input, and the confidence
// dampener is entitled to charge differently for them. Without provenance,
// swapping in a worse source silently makes the model look just as confident.

export const CAPABILITIES = [
  'slate', // today's games
  'odds', // moneyline, spread, total
  'props', // player prop lines and prices
  'ratings', // team off/def efficiency
  'pace', // team possessions per 48
  'injuries', // availability report
  'playerRates', // per-minute player production
];

// `quality` is what the dampener reads: 1.0 is a first-class source for that
// capability, lower means the value is a weaker substitute and should be
// charged for. It is not a measure of how much we like the outlet.
const registry = new Map();

export function register({ name, capability, priority = 100, quality = 1, fetch, available }) {
  if (!CAPABILITIES.includes(capability)) {
    throw new Error(`Unknown capability "${capability}"`);
  }
  if (typeof fetch !== 'function') {
    throw new Error(`Provider "${name}" needs a fetch function`);
  }
  const list = registry.get(capability) ?? [];
  list.push({ name, capability, priority, quality, fetch, available });
  // Lower priority number wins, so a better source can be slotted in front
  // without renumbering the rest.
  list.sort((a, b) => a.priority - b.priority);
  registry.set(capability, list);
  return list.length;
}

export function providersFor(capability) {
  return [...(registry.get(capability) ?? [])];
}

export function clearProviders(capability) {
  if (capability) registry.delete(capability);
  else registry.clear();
}

// Try each provider in order. A provider that throws, or returns nothing, is
// skipped and the next one gets a turn; the attempt is recorded either way so
// a silent downgrade is visible in the result rather than invisible.
export async function resolve(capability, options = {}) {
  const providers = providersFor(capability);
  if (providers.length === 0) {
    return { data: null, source: null, quality: 0, attempts: [], unavailable: true };
  }

  const attempts = [];
  for (const [index, provider] of providers.entries()) {
    if (typeof provider.available === 'function' && !provider.available(options)) {
      attempts.push({ name: provider.name, skipped: 'not configured' });
      continue;
    }
    try {
      const data = await provider.fetch(options);
      if (data == null || (Array.isArray(data) && data.length === 0)) {
        attempts.push({ name: provider.name, skipped: 'returned nothing' });
        continue;
      }
      return {
        data,
        source: provider.name,
        quality: provider.quality,
        // True whenever something ahead of this provider was tried and failed,
        // which is the signal that the input is worse than the best available.
        fallback: index > 0,
        attempts,
      };
    } catch (err) {
      attempts.push({ name: provider.name, error: err?.message ?? String(err) });
    }
  }

  return { data: null, source: null, quality: 0, attempts, exhausted: true };
}

// Penalty in probability points for a capability served below first class.
// A capability with no provider at all is the caller's problem to handle, not
// something to paper over with a penalty.
export function provenancePenalty(resolution, capability) {
  if (!resolution || resolution.data == null) return null;
  if (resolution.quality >= 1) return null;
  const shortfall = 1 - resolution.quality;
  return {
    amount: Math.min(0.05 * shortfall, 0.05),
    reason:
      `${capability} served by ${resolution.source}` +
      `${resolution.fallback ? ' after a better source failed' : ''}` +
      ` (quality ${resolution.quality.toFixed(2)})`,
  };
}
