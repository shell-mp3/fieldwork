import { describe, it, expect } from 'vitest';
import { Noise2D, curl } from '../src/core/noise';
import { makeRng } from '../src/core/rng';

const field = (seed: string): Noise2D => new Noise2D(makeRng(seed));

describe('Noise2D', () => {
  it('is a pure function of the seed', () => {
    const a = field('drift');
    const b = field('drift');
    for (let i = 0; i < 200; i++) {
      const x = i * 0.37;
      const y = i * -0.21;
      expect(a.noise(x, y)).toBe(b.noise(x, y));
    }
  });

  it('gives a different field for a different seed', () => {
    const a = field('drift');
    const b = field('drift2');
    const differences = Array.from({ length: 100 }, (_, i) =>
      Math.abs(a.noise(i * 0.3, i * 0.7) - b.noise(i * 0.3, i * 0.7)),
    );
    expect(Math.max(...differences)).toBeGreaterThan(0.1);
  });

  it('stays within [-1, 1] and uses most of that range', () => {
    const n = field('range');
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < 20000; i++) {
      const v = n.noise((i % 140) * 0.31, Math.floor(i / 140) * 0.29);
      min = Math.min(min, v);
      max = Math.max(max, v);
    }
    expect(min).toBeGreaterThanOrEqual(-1);
    expect(max).toBeLessThanOrEqual(1);
    expect(max).toBeGreaterThan(0.5);
    expect(min).toBeLessThan(-0.5);
  });

  it('is continuous: a tiny step cannot jump', () => {
    const n = field('continuity');
    for (let i = 0; i < 500; i++) {
      const x = i * 0.13;
      const y = i * 0.29;
      expect(Math.abs(n.noise(x + 1e-4, y) - n.noise(x, y))).toBeLessThan(0.01);
    }
  });

  it('fbm with one octave is the raw noise', () => {
    const n = field('fbm');
    for (let i = 0; i < 50; i++) {
      expect(n.fbm(i * 0.2, i * 0.4, 1)).toBe(n.noise(i * 0.2, i * 0.4));
    }
  });

  it('fbm stays bounded as octaves increase', () => {
    const n = field('fbm-octaves');
    for (let octaves = 1; octaves <= 6; octaves++) {
      for (let i = 0; i < 200; i++) {
        const v = n.fbm(i * 0.17, i * 0.11, octaves);
        expect(Math.abs(v)).toBeLessThanOrEqual(1);
      }
    }
  });

  it('fbm with zero octaves is zero rather than NaN', () => {
    expect(field('zero').fbm(1, 2, 0)).toBe(0);
  });
});

describe('curl', () => {
  it('returns unit vectors', () => {
    const n = field('curl');
    for (let i = 0; i < 300; i++) {
      const v = curl(n, i * 0.21, i * 0.13, { octaves: 2 });
      expect(Math.hypot(v.x, v.y)).toBeCloseTo(1, 6);
    }
  });

  it('is perpendicular to the gradient of the potential', () => {
    // v = (dP/dy, -dP/dx) is orthogonal to grad P = (dP/dx, dP/dy) by
    // construction. If that fails, the finite differences are wrong.
    const n = field('perp');
    const eps = 1e-4;
    for (let i = 0; i < 200; i++) {
      const x = 10 + i * 0.23;
      const y = 5 - i * 0.17;
      const v = curl(n, x, y, { octaves: 1, epsilon: eps });
      const gx = (n.fbm(x + eps, y, 1) - n.fbm(x - eps, y, 1)) / (2 * eps);
      const gy = (n.fbm(x, y + eps, 1) - n.fbm(x, y - eps, 1)) / (2 * eps);
      const gradLength = Math.hypot(gx, gy);
      if (gradLength < 1e-6) continue;
      const dot = (v.x * gx + v.y * gy) / gradLength;
      expect(Math.abs(dot)).toBeLessThan(1e-6);
    }
  });

  it('returns the zero vector on a perfectly flat field', () => {
    const flat = {
      noise: () => 0.5,
      fbm: () => 0.5,
    } as unknown as Noise2D;
    expect(curl(flat, 1, 2)).toEqual({ x: 0, y: 0 });
  });
});
