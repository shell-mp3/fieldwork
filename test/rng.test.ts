import { describe, it, expect } from 'vitest';
import { makeRng, hashSeed, rngInt, rngRange, rngPick, shuffle, rngGauss } from '../src/core/rng';

const take = (n: number, rng: () => number): number[] =>
  Array.from({ length: n }, () => rng());

describe('hashSeed', () => {
  it('is stable for a given string', () => {
    expect(hashSeed('harbour-drift')).toBe(hashSeed('harbour-drift'));
  });

  it('separates seeds that differ by one character', () => {
    expect(hashSeed('seed-a')).not.toBe(hashSeed('seed-b'));
    expect(hashSeed('a')).not.toBe(hashSeed('A'));
  });

  it('returns an unsigned 32-bit integer', () => {
    for (const seed of ['', 'x', 'a much longer seed string', '0']) {
      const h = hashSeed(seed);
      expect(Number.isInteger(h)).toBe(true);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(2 ** 32);
    }
  });
});

describe('makeRng', () => {
  it('produces the same stream for the same seed', () => {
    expect(take(100, makeRng('kelp'))).toEqual(take(100, makeRng('kelp')));
  });

  it('produces different streams for different seeds', () => {
    expect(take(50, makeRng('kelp'))).not.toEqual(take(50, makeRng('kelpp')));
  });

  it('stays within [0, 1)', () => {
    const values = take(20000, makeRng('range-check'));
    expect(Math.min(...values)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...values)).toBeLessThan(1);
  });

  it('does not degenerate on a zero numeric seed', () => {
    const values = take(20, makeRng(0));
    expect(new Set(values).size).toBe(20);
  });

  it('is roughly uniform across ten buckets', () => {
    const buckets = new Array(10).fill(0);
    const n = 100000;
    const rng = makeRng('uniformity');
    for (let i = 0; i < n; i++) buckets[Math.floor(rng() * 10)]++;
    for (const count of buckets) {
      // Each bucket should hold ~10%; allow a generous ±1.5 points.
      expect(Math.abs(count / n - 0.1)).toBeLessThan(0.015);
    }
  });
});

describe('helpers', () => {
  it('rngInt covers [min, max) and never exceeds it', () => {
    const rng = makeRng('ints');
    const seen = new Set<number>();
    for (let i = 0; i < 5000; i++) {
      const v = rngInt(rng, 3, 7);
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(3);
      expect(v).toBeLessThan(7);
      seen.add(v);
    }
    expect([...seen].sort()).toEqual([3, 4, 5, 6]);
  });

  it('rngRange stays inside its bounds', () => {
    const rng = makeRng('ranges');
    for (let i = 0; i < 1000; i++) {
      const v = rngRange(rng, -2.5, 4);
      expect(v).toBeGreaterThanOrEqual(-2.5);
      expect(v).toBeLessThan(4);
    }
  });

  it('rngPick throws on an empty array', () => {
    expect(() => rngPick(makeRng('x'), [])).toThrow(/empty/);
  });

  it('shuffle permutes without mutating the input', () => {
    const input = Array.from({ length: 64 }, (_, i) => i);
    const frozen = input.slice();
    const out = shuffle(makeRng('shuffle'), input);
    expect(input).toEqual(frozen);
    expect(out).not.toEqual(frozen);
    expect(out.slice().sort((a, b) => a - b)).toEqual(frozen);
  });

  it('shuffle is deterministic', () => {
    const input = Array.from({ length: 32 }, (_, i) => i);
    expect(shuffle(makeRng('s'), input)).toEqual(shuffle(makeRng('s'), input));
  });

  it('rngGauss lands near the requested mean and spread', () => {
    const rng = makeRng('gauss');
    const samples = Array.from({ length: 20000 }, () => rngGauss(rng, 5, 2));
    const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
    const variance =
      samples.reduce((a, b) => a + (b - mean) ** 2, 0) / samples.length;
    expect(mean).toBeCloseTo(5, 1);
    expect(Math.sqrt(variance)).toBeCloseTo(2, 1);
  });
});
