import { describe, it, expect } from 'vitest';
import { generateFlow, flowDefaults } from '../src/core/flow';
import { countPaths, countPoints } from '../src/core/types';
import { getPalette } from '../src/core/palette';

const small = { particles: 160, steps: 90, width: 400, height: 500 };

describe('generateFlow', () => {
  it('is a pure function of its inputs', () => {
    const a = generateFlow({ seed: 'repeat-me', ...small });
    const b = generateFlow({ seed: 'repeat-me', ...small });
    expect(a).toEqual(b);
  });

  it('gives a different piece for a different seed', () => {
    const a = generateFlow({ seed: 'seed-a', ...small });
    const b = generateFlow({ seed: 'seed-b', ...small });
    expect(a).not.toEqual(b);
  });

  it('keeps every point inside the canvas plus its margin', () => {
    const scene = generateFlow({ seed: 'bounds', ...small });
    const m = flowDefaults.margin;
    for (const layer of scene.layers) {
      for (const path of layer.paths) {
        for (const p of path) {
          expect(p.x).toBeGreaterThanOrEqual(-m);
          expect(p.y).toBeGreaterThanOrEqual(-m);
          expect(p.x).toBeLessThanOrEqual(scene.width + m);
          expect(p.y).toBeLessThanOrEqual(scene.height + m);
          expect(Number.isFinite(p.x)).toBe(true);
          expect(Number.isFinite(p.y)).toBe(true);
        }
      }
    }
  });

  it('never emits a path too short to see', () => {
    const scene = generateFlow({ seed: 'short', ...small });
    for (const layer of scene.layers) {
      for (const path of layer.paths) {
        expect(path.length).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it('produces more paths when asked for more particles', () => {
    const few = generateFlow({ seed: 'density', ...small, particles: 80 });
    const many = generateFlow({ seed: 'density', ...small, particles: 400 });
    expect(countPaths(many)).toBeGreaterThan(countPaths(few));
  });

  it('produces longer paths when allowed more steps', () => {
    const shortRun = generateFlow({ seed: 'steps', ...small, steps: 30 });
    const longRun = generateFlow({ seed: 'steps', ...small, steps: 200 });
    expect(countPoints(longRun)).toBeGreaterThan(countPoints(shortRun));
  });

  it('only uses colours from the chosen palette', () => {
    const scene = generateFlow({ seed: 'colours', ...small, palette: 'riso' });
    const allowed = new Set(getPalette('riso').colors);
    expect(scene.background).toBe(getPalette('riso').background);
    for (const layer of scene.layers) expect(allowed.has(layer.color)).toBe(true);
  });

  it('records enough metadata to reproduce the piece', () => {
    const scene = generateFlow({ seed: 'meta', ...small, palette: 'oxide' });
    expect(scene.meta.algo).toBe('flow');
    expect(scene.meta.seed).toBe('meta');
    expect(scene.meta.palette).toBe('oxide');
    expect(scene.meta.params['particles']).toBe(small.particles);
  });

  it('never emits an empty layer', () => {
    const scene = generateFlow({ seed: 'layers', ...small });
    for (const layer of scene.layers) expect(layer.paths.length).toBeGreaterThan(0);
  });

  it('rejects nonsense parameters', () => {
    expect(() => generateFlow({ seed: 'x', particles: 0 })).toThrow(/particles/);
    expect(() => generateFlow({ seed: 'x', steps: -1 })).toThrow(/steps/);
  });

  it('names the available palettes when given an unknown one', () => {
    expect(() => generateFlow({ seed: 'x', palette: 'nope', ...small })).toThrow(
      /Unknown palette "nope".*kelp/s,
    );
  });
});
