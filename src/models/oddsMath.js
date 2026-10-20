// src/models/oddsMath.js
//
// Odds conversion, RNG, and sampling helpers shared by the betting models
// (ufcSimulator, nbaSimulator). Keeping them in one place means every model
// prices a market the same way and draws from the same reproducible RNG.

export const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

// ---------------------------------------------------------------------------
// RNG + sampling
// ---------------------------------------------------------------------------

// Deterministic PRNG so simulation runs are reproducible per seed.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Knuth Poisson sampler; lambdas in these models stay small (< ~40).
export function poissonSample(lambda, rand) {
  if (lambda <= 0) return 0;
  const L = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  do {
    k += 1;
    p *= rand();
  } while (p > L);
  return k - 1;
}

export function gaussianSample(rand, mean = 0, sd = 1) {
  const u1 = Math.max(rand(), 1e-12);
  const u2 = rand();
  return mean + sd * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

// Marsaglia-Tsang gamma sampler. Used to mix Poisson rates (overdispersed
// counting stats) and to draw right-skewed continuous stats like points.
export function gammaSample(rand, shape, scale = 1) {
  if (shape <= 0) return 0;
  if (shape < 1) {
    // Boost trick: Gamma(a) === Gamma(a + 1) * U^(1/a)
    const u = Math.max(rand(), 1e-12);
    return gammaSample(rand, shape + 1, scale) * Math.pow(u, 1 / shape);
  }
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x;
    let v;
    do {
      x = gaussianSample(rand, 0, 1);
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = Math.max(rand(), 1e-12);
    const x2 = x * x;
    if (u < 1 - 0.0331 * x2 * x2) return d * v * scale;
    if (Math.log(u) < 0.5 * x2 + d * (1 - v + Math.log(v))) return d * v * scale;
  }
}

// ---------------------------------------------------------------------------
// Odds math
// ---------------------------------------------------------------------------

export function americanToProb(odds) {
  return odds > 0 ? 100 / (odds + 100) : -odds / (-odds + 100);
}

export function probToAmerican(prob) {
  const p = clamp(prob, 0.001, 0.999);
  return p >= 0.5
    ? Math.round((-100 * p) / (1 - p))
    : Math.round((100 * (1 - p)) / p);
}

export function formatAmerican(odds) {
  return odds > 0 ? `+${odds}` : `${odds}`;
}

// Remove the vig from a set of mutually exclusive market prices.
export function removeVig(probs) {
  const total = probs.reduce((a, b) => a + b, 0);
  return probs.map((p) => p / total);
}

// The book's hold on a two-way market: how much the two prices overround 100%.
export function marketHold(priceA, priceB) {
  return americanToProb(priceA) + americanToProb(priceB) - 1;
}
