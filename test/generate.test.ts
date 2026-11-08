import { describe, it, expect } from 'vitest';
import {
  generate,
  isAlgo,
  algos,
  schemaFor,
  sizeFor,
  sanitizeParams,
} from '../src/core/generate';
import { paletteNames, getPalette, palettes } from '../src/core/palette';

describe('algo guards', () => {
  it('accepts exactly the known algorithms', () => {
    for (const algo of algos) expect(isAlgo(algo)).toBe(true);
    expect(isAlgo('spirograph')).toBe(false);
    expect(isAlgo('')).toBe(false);
  });
});

describe('parameter schema', () => {
  it('declares a sane range around every default', () => {
    for (const algo of algos) {
      for (const spec of schemaFor(algo)) {
        expect(spec.min).toBeLessThan(spec.max);
        expect(spec.step).toBeGreaterThan(0);
        expect(spec.default).toBeGreaterThanOrEqual(spec.min);
        expect(spec.default).toBeLessThanOrEqual(spec.max);
        expect(spec.label.length).toBeGreaterThan(0);
      }
    }
  });

  it('has no duplicate keys within an algorithm', () => {
    for (const algo of algos) {
      const keys = schemaFor(algo).map((s) => s.key);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });

  it('gives every algorithm a positive default canvas', () => {
    for (const algo of algos) {
      const { width, height } = sizeFor(algo);
      expect(width).toBeGreaterThan(0);
      expect(height).toBeGreaterThan(0);
    }
  });
});

describe('sanitizeParams', () => {
  it('clamps out-of-range values instead of failing', () => {
    const out = sanitizeParams('flow', { particles: 10_000_000, opacity: -4 });
    const particles = schemaFor('flow').find((s) => s.key === 'particles')!;
    const opacity = schemaFor('flow').find((s) => s.key === 'opacity')!;
    expect(out['particles']).toBe(particles.max);
    expect(out['opacity']).toBe(opacity.min);
  });

  it('drops unknown and non-finite values', () => {
    const out = sanitizeParams('flow', {
      nonsense: 5,
      particles: Number.NaN,
      steps: Infinity,
    });
    expect(out).toEqual({});
  });

  it('passes valid values through untouched', () => {
    expect(sanitizeParams('flow', { particles: 500 })['particles']).toBe(500);
  });
});

describe('generate', () => {
  it('dispatches to the right algorithm', () => {
    expect(generate({ algo: 'flow', seed: 's', params: { particles: 60, steps: 40 } }).meta.algo).toBe(
      'flow',
    );
    expect(
      generate({
        algo: 'reaction',
        seed: 's',
        params: { gridSize: 48, iterations: 100 },
      }).meta.algo,
    ).toBe('reaction');
  });

  it('honours an explicit canvas size', () => {
    const scene = generate({
      algo: 'flow',
      seed: 's',
      width: 321,
      height: 123,
      params: { particles: 40, steps: 30 },
    });
    expect(scene.width).toBe(321);
    expect(scene.height).toBe(123);
  });

  it('works with every palette', () => {
    for (const name of paletteNames) {
      const scene = generate({
        algo: 'flow',
        seed: 'palette-sweep',
        palette: name,
        params: { particles: 40, steps: 30 },
      });
      expect(scene.background).toBe(getPalette(name).background);
    }
  });
});

describe('palettes', () => {
  it('ships at least four, each fully specified', () => {
    expect(paletteNames.length).toBeGreaterThanOrEqual(4);
    for (const name of paletteNames) {
      const p = palettes[name]!;
      expect(p.name).toBe(name);
      expect(p.inspiration.length).toBeGreaterThan(10);
      expect(p.colors.length).toBeGreaterThanOrEqual(3);
      for (const c of [p.background, ...p.colors]) {
        expect(c).toMatch(/^#[0-9a-f]{6}$/i);
      }
    }
  });

  it('explains itself when asked for a palette that does not exist', () => {
    expect(() => getPalette('chartreuse')).toThrow(/Unknown palette/);
  });
});
