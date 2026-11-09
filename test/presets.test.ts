import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { presets, getPreset, presetsFor } from '../src/core/presets';
import { schemaFor, isAlgo, generate } from '../src/core/generate';
import { paletteNames } from '../src/core/palette';

describe('presets', () => {
  it('ships a useful number of them', () => {
    expect(presets.length).toBeGreaterThanOrEqual(8);
  });

  it('has unique ids', () => {
    const ids = presets.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('covers both algorithms', () => {
    expect(presetsFor('flow').length).toBeGreaterThan(0);
    expect(presetsFor('reaction').length).toBeGreaterThan(0);
  });

  it('names a real algorithm and a real palette', () => {
    for (const p of presets) {
      expect(isAlgo(p.algo)).toBe(true);
      expect(paletteNames).toContain(p.palette);
    }
  });

  it('has a title and a blurb worth showing', () => {
    for (const p of presets) {
      expect(p.title.length).toBeGreaterThan(2);
      expect(p.blurb.length).toBeGreaterThan(15);
      expect(p.blurb).toMatch(/\.$/);
    }
  });

  it('only sets parameters the algorithm actually has', () => {
    for (const p of presets) {
      const keys = new Set(schemaFor(p.algo).map((s) => s.key));
      for (const key of Object.keys(p.params)) {
        expect(keys, `preset "${p.id}" sets unknown param "${key}"`).toContain(key);
      }
    }
  });

  it('keeps every parameter inside its declared range', () => {
    // Out-of-range values get silently clamped at generate time, so a preset
    // would render as something other than what it says it is.
    for (const p of presets) {
      for (const spec of schemaFor(p.algo)) {
        const value = p.params[spec.key];
        if (value === undefined) continue;
        expect(value, `preset "${p.id}" param "${spec.key}"`).toBeGreaterThanOrEqual(spec.min);
        expect(value, `preset "${p.id}" param "${spec.key}"`).toBeLessThanOrEqual(spec.max);
      }
    }
  });

  it('explains itself when asked for one that does not exist', () => {
    expect(() => getPreset('nope')).toThrow(/Unknown preset "nope"/);
  });

  it('every preset actually renders', () => {
    // Cheap settings: this checks the definitions are valid, not the visuals.
    for (const p of presets) {
      const scene = generate({
        algo: p.algo,
        seed: p.seed,
        palette: p.palette,
        params:
          p.algo === 'flow'
            ? { ...p.params, particles: 60, steps: 40 }
            : { ...p.params, gridSize: 48, iterations: 80 },
      });
      expect(scene.width).toBeGreaterThan(0);
      expect(scene.meta.seed).toBe(p.seed);
    }
  });
});

describe('gallery manifest', () => {
  const manifest = JSON.parse(readFileSync('gallery/manifest.json', 'utf8')) as {
    pieces: Array<{ file: string; preset: string }>;
  };

  it('references only presets that exist', () => {
    for (const piece of manifest.pieces) {
      expect(() => getPreset(piece.preset)).not.toThrow();
    }
  });

  it('has a unique output filename per piece', () => {
    const files = manifest.pieces.map((p) => p.file);
    expect(new Set(files).size).toBe(files.length);
  });
});
