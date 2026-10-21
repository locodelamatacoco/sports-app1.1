import {
  register,
  providersFor,
  clearProviders,
  resolve,
  provenancePenalty,
  CAPABILITIES,
} from './providers';
import { registerEspnProviders } from './providers.espn';

afterEach(() => clearProviders());

describe('registration', () => {
  test('rejects an unknown capability and a missing fetch', () => {
    expect(() => register({ name: 'x', capability: 'nonsense', fetch: () => {} })).toThrow(
      /Unknown capability/
    );
    expect(() => register({ name: 'x', capability: 'pace' })).toThrow(/fetch function/);
  });

  test('orders by priority so a better source slots in front', () => {
    register({ name: 'fallback', capability: 'pace', priority: 900, fetch: async () => 1 });
    register({ name: 'official', capability: 'pace', priority: 10, fetch: async () => 2 });
    expect(providersFor('pace').map((p) => p.name)).toEqual(['official', 'fallback']);
  });

  test('providersFor returns a copy, so callers cannot mutate the registry', () => {
    register({ name: 'a', capability: 'pace', fetch: async () => 1 });
    providersFor('pace').push({ name: 'injected' });
    expect(providersFor('pace')).toHaveLength(1);
  });
});

describe('resolution order and fallback', () => {
  test('the highest-priority working provider wins and is named', () => {
    register({ name: 'official', capability: 'pace', priority: 10, quality: 1, fetch: async () => ({ v: 1 }) });
    register({ name: 'ranks', capability: 'pace', priority: 900, quality: 0.4, fetch: async () => ({ v: 2 }) });
    return resolve('pace').then((r) => {
      expect(r.source).toBe('official');
      expect(r.data).toEqual({ v: 1 });
      expect(r.fallback).toBe(false);
      expect(r.quality).toBe(1);
    });
  });

  test('a throwing provider is skipped and the failure is recorded', async () => {
    register({
      name: 'official',
      capability: 'pace',
      priority: 10,
      fetch: async () => {
        throw new Error('host blocked');
      },
    });
    register({ name: 'ranks', capability: 'pace', priority: 900, quality: 0.4, fetch: async () => ({ v: 2 }) });

    const r = await resolve('pace');
    expect(r.source).toBe('ranks');
    // The downgrade has to be visible, not silent.
    expect(r.fallback).toBe(true);
    expect(r.attempts).toEqual([{ name: 'official', error: 'host blocked' }]);
  });

  test('a provider returning nothing is treated as a miss, not as data', async () => {
    register({ name: 'empty', capability: 'props', priority: 10, fetch: async () => null });
    register({ name: 'alsoEmpty', capability: 'props', priority: 20, fetch: async () => [] });
    register({ name: 'real', capability: 'props', priority: 30, quality: 0.8, fetch: async () => [{ line: 1 }] });

    const r = await resolve('props');
    expect(r.source).toBe('real');
    expect(r.attempts.map((a) => a.skipped)).toEqual(['returned nothing', 'returned nothing']);
  });

  test('a provider that is not configured is skipped without being called', async () => {
    const fetch = jest.fn(async () => ({ v: 1 }));
    register({ name: 'needsKey', capability: 'props', priority: 10, fetch, available: () => false });
    const r = await resolve('props');
    expect(fetch).not.toHaveBeenCalled();
    expect(r.attempts[0]).toEqual({ name: 'needsKey', skipped: 'not configured' });
  });

  test('no provider at all is reported as unavailable, not as empty data', async () => {
    const r = await resolve('props');
    expect(r.unavailable).toBe(true);
    expect(r.data).toBeNull();
  });

  test('every provider failing is reported as exhausted', async () => {
    register({
      name: 'a',
      capability: 'pace',
      fetch: async () => {
        throw new Error('down');
      },
    });
    const r = await resolve('pace');
    expect(r.exhausted).toBe(true);
    expect(r.data).toBeNull();
    expect(r.attempts).toHaveLength(1);
  });
});

describe('provenance penalties', () => {
  test('a first-class source costs nothing', () => {
    expect(provenancePenalty({ data: {}, quality: 1, source: 'official' }, 'pace')).toBeNull();
  });

  test('a weaker source costs more the weaker it is', () => {
    const ranks = provenancePenalty({ data: {}, quality: 0.4, source: 'ranks' }, 'pace');
    const preseason = provenancePenalty({ data: {}, quality: 0.8, source: 'pre' }, 'playerRates');
    expect(ranks.amount).toBeGreaterThan(preseason.amount);
    expect(ranks.reason).toMatch(/pace served by ranks/);
    expect(ranks.amount).toBeLessThanOrEqual(0.05);
  });

  test('a fallback says so, since that is the thing worth noticing', () => {
    const p = provenancePenalty({ data: {}, quality: 0.4, source: 'ranks', fallback: true }, 'pace');
    expect(p.reason).toMatch(/after a better source failed/);
  });

  test('no data means no penalty — that is the caller\'s problem to handle', () => {
    expect(provenancePenalty({ data: null, quality: 0 }, 'props')).toBeNull();
    expect(provenancePenalty(null, 'props')).toBeNull();
  });
});

describe('the ESPN registration set', () => {
  beforeEach(() => {
    clearProviders();
    registerEspnProviders();
  });

  test('registers one provider per capability ESPN can actually serve', () => {
    const served = CAPABILITIES.filter((c) => providersFor(c).length > 0);
    expect(served).toEqual(
      expect.arrayContaining(['slate', 'odds', 'ratings', 'pace', 'injuries', 'playerRates'])
    );
    // The gap that matters: ESPN publishes no player prop lines.
    expect(providersFor('props')).toHaveLength(0);
  });

  test('registering again replaces rather than stacks duplicates', () => {
    const before = providersFor('ratings').length;
    clearProviders();
    registerEspnProviders();
    expect(providersFor('ratings')).toHaveLength(before);
  });

  test('the substitute inputs are marked below first class', () => {
    const quality = (c) => providersFor(c)[0].quality;
    expect(quality('ratings')).toBe(1);
    expect(quality('odds')).toBeLessThan(1); // one book only
    expect(quality('pace')).toBeLessThan(0.5); // rank-derived, not measured
    expect(quality('playerRates')).toBeLessThan(1); // preseason
  });
});
