/**
 * Seeded pseudo-randomness.
 *
 * Every random choice in this project flows through here, which is what makes
 * a seed + params fully reproduce a piece. `Math.random` is never used.
 */

export type Rng = () => number;

/** xmur3: string -> well-mixed 32-bit integer, used to seed the generator. */
export function hashSeed(seed: string): number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^= h >>> 16) >>> 0;
}

/**
 * mulberry32. Chosen over a crypto generator on purpose: it is tiny, has no
 * platform-specific behaviour, and uses only Math.imul and 32-bit shifts, so
 * Node and every browser produce an identical stream for a given seed.
 */
export function makeRng(seed: string | number): Rng {
  let a = (typeof seed === 'number' ? seed : hashSeed(seed)) >>> 0;
  if (a === 0) a = 0x9e3779b9;
  return function next(): number {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function rngRange(rng: Rng, min: number, max: number): number {
  return min + rng() * (max - min);
}

/** Integer in [min, max). */
export function rngInt(rng: Rng, min: number, max: number): number {
  return Math.floor(min + rng() * (max - min));
}

export function rngPick<T>(rng: Rng, items: readonly T[]): T {
  if (items.length === 0) throw new Error('rngPick: empty array');
  return items[rngInt(rng, 0, items.length)]!;
}

/** Fisher-Yates on a copy, so callers keep their input. */
export function shuffle<T>(rng: Rng, items: readonly T[]): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = rngInt(rng, 0, i + 1);
    const tmp = out[i]!;
    out[i] = out[j]!;
    out[j] = tmp;
  }
  return out;
}

/** Gaussian via Box-Muller, drawn from the same stream. */
export function rngGauss(rng: Rng, mean = 0, stdDev = 1): number {
  let u = 0;
  while (u === 0) u = rng();
  const v = rng();
  return mean + stdDev * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
