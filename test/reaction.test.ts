import { describe, it, expect } from 'vitest';
import {
  generateReaction,
  simulate,
  laplacian,
  reactionDefaults,
  type ReactionParams,
} from '../src/core/reaction';
import { makeRng, rngInt } from '../src/core/rng';

/** Small and fast; the visual defaults are far too slow for a test suite. */
const small: Partial<ReactionParams> = {
  gridSize: 48,
  iterations: 120,
  seedSpots: 5,
  width: 300,
  height: 300,
};

describe('simulate', () => {
  it('is a pure function of its inputs', () => {
    const a = simulate({ ...reactionDefaults, ...small, seed: 'rd' } as ReactionParams);
    const b = simulate({ ...reactionDefaults, ...small, seed: 'rd' } as ReactionParams);
    expect(Array.from(a.data)).toEqual(Array.from(b.data));
  });

  it('keeps concentrations inside [0, 1]', () => {
    const f = simulate({ ...reactionDefaults, ...small, seed: 'clamp' } as ReactionParams);
    for (const v of f.data) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
      expect(Number.isNaN(v)).toBe(false);
    }
  });

  it('actually evolves a pattern rather than decaying to nothing', () => {
    const f = simulate({ ...reactionDefaults, ...small, seed: 'alive' } as ReactionParams);
    const max = Math.max(...f.data);
    const nonZero = Array.from(f.data).filter((v) => v > 0.01).length;
    expect(max).toBeGreaterThan(0.1);
    expect(nonZero).toBeGreaterThan(10);
  });

  it("the hot loop's inlined Laplacian matches the reference implementation", () => {
    // simulate() does not call laplacian(); it inlines it with precomputed
    // wrap tables for speed. This reproduces one step the slow, obvious way
    // and demands bit-identical results.
    const p: ReactionParams = {
      ...reactionDefaults,
      ...small,
      iterations: 1,
      seed: 'reference',
    } as ReactionParams;

    const n = p.gridSize;
    const a = new Float32Array(n * n).fill(1);
    const b = new Float32Array(n * n);

    // Seed exactly as simulate() does.
    const rng = makeRng(p.seed);
    for (let s = 0; s < p.seedSpots; s++) {
      const cx = rngInt(rng, 0, n);
      const cy = rngInt(rng, 0, n);
      for (let dy = -p.spotRadius; dy <= p.spotRadius; dy++) {
        for (let dx = -p.spotRadius; dx <= p.spotRadius; dx++) {
          b[((cy + dy + n) % n) * n + ((cx + dx + n) % n)] = 1;
        }
      }
    }

    const expected = new Float32Array(n * n);
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const i = y * n + x;
        const av = a[i]!;
        const bv = b[i]!;
        const reaction = av * bv * bv;
        const nb =
          bv +
          (p.diffusionB * laplacian(b, n, x, y) + reaction - (p.kill + p.feed) * bv) *
            p.timeStep;
        expected[i] = nb < 0 ? 0 : nb > 1 ? 1 : nb;
      }
    }

    expect(Array.from(simulate(p).data)).toEqual(Array.from(expected));
  });
});

describe('laplacian', () => {
  it('is zero on a constant field', () => {
    const n = 8;
    const grid = new Float32Array(n * n).fill(0.37);
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) expect(laplacian(grid, n, x, y)).toBeCloseTo(0, 6);
    }
  });

  it('wraps around the edges rather than clamping', () => {
    const n = 5;
    const grid = new Float32Array(n * n);
    grid[0] = 1; // corner
    // The cell diagonally opposite on the torus is a diagonal neighbour of (0,0).
    expect(laplacian(grid, n, n - 1, n - 1)).toBeCloseTo(0.05, 6);
  });

  it('is positive in a dip and negative on a peak', () => {
    const n = 7;
    const peak = new Float32Array(n * n);
    peak[3 * n + 3] = 1;
    expect(laplacian(peak, n, 3, 3)).toBeLessThan(0);
    expect(laplacian(peak, n, 3, 2)).toBeGreaterThan(0);
  });
});

describe('progress reporting', () => {
  const p = { ...reactionDefaults, ...small, seed: 'progress' } as ReactionParams;

  it('observing the run does not change its result', () => {
    // A progress hook that touched the working buffers would quietly change
    // what every seed produces. Byte-equality is the only acceptable answer.
    const plain = simulate(p);
    const watched = simulate(p, { every: 10, onStep: () => {} });
    expect(Array.from(watched.data)).toEqual(Array.from(plain.data));
  });

  it('reports increasing progress and stops short of the end', () => {
    const seen: number[] = [];
    simulate(p, { every: 25, onStep: (iteration) => seen.push(iteration) });
    expect(seen.length).toBeGreaterThan(1);
    expect(seen).toEqual([...seen].sort((a, b) => a - b));
    expect(Math.max(...seen)).toBeLessThan(p.iterations);
    expect(new Set(seen).size).toBe(seen.length);
  });

  it('hands the hook a field it can contour', () => {
    let got = 0;
    simulate(p, {
      every: 40,
      onStep: (_i, field) => {
        got++;
        expect(field.width).toBe(p.gridSize);
        expect(field.data.length).toBe(p.gridSize * p.gridSize);
      },
    });
    expect(got).toBeGreaterThan(0);
  });

  it('draws preview frames more cheaply than the finished piece', () => {
    // Previews are replaced within a fraction of a second, so they are drawn
    // at fewer contour levels. Contouring them at full detail measured at a
    // quarter of total runtime.
    const previews: number[] = [];
    const final = generateReaction(
      { ...small, seed: 'cheap-previews', contours: 6 },
      (progress) => previews.push(progress.scene.layers.length),
    );
    expect(previews.length).toBeGreaterThan(0);
    for (const layers of previews) expect(layers).toBeLessThanOrEqual(2);
    // The finished piece is unaffected by how the previews were drawn.
    expect(final).toEqual(generateReaction({ ...small, seed: 'cheap-previews', contours: 6 }));
  });

  it('places preview geometry on the same canvas as the finished piece', () => {
    // Previews may be decimated, so the scale must come from the field rather
    // than the configured grid size or they would land in the wrong place.
    const seen: Array<{ x: number; y: number }> = [];
    const final = generateReaction(
      { ...small, seed: 'preview-bounds', gridSize: 160, iterations: 300 },
      (progress) => {
        for (const layer of progress.scene.layers) {
          for (const path of layer.paths) seen.push(...path);
        }
      },
    );
    expect(seen.length).toBeGreaterThan(0);
    for (const point of seen) {
      expect(point.x).toBeGreaterThanOrEqual(0);
      expect(point.y).toBeGreaterThanOrEqual(0);
      expect(point.x).toBeLessThanOrEqual(final.width);
      expect(point.y).toBeLessThanOrEqual(final.height);
    }
  });

  it('generateReaction returns the same scene with and without onProgress', () => {
    const frames: number[] = [];
    const watched = generateReaction({ ...small, seed: 'scene-progress' }, (progress) => {
      frames.push(progress.fraction);
      expect(progress.scene.layers.length).toBeGreaterThanOrEqual(0);
    });
    const plain = generateReaction({ ...small, seed: 'scene-progress' });
    expect(watched).toEqual(plain);
    expect(frames.length).toBeGreaterThan(0);
    for (const f of frames) {
      expect(f).toBeGreaterThan(0);
      expect(f).toBeLessThan(1);
    }
  });
});

describe('generateReaction', () => {
  it('is deterministic', () => {
    expect(generateReaction({ seed: 'scene', ...small })).toEqual(
      generateReaction({ seed: 'scene', ...small }),
    );
  });

  it('keeps all geometry inside the canvas', () => {
    const scene = generateReaction({ seed: 'inside', ...small });
    for (const layer of scene.layers) {
      for (const path of layer.paths) {
        for (const p of path) {
          expect(p.x).toBeGreaterThanOrEqual(0);
          expect(p.y).toBeGreaterThanOrEqual(0);
          expect(p.x).toBeLessThanOrEqual(scene.width);
          expect(p.y).toBeLessThanOrEqual(scene.height);
        }
      }
    }
  });

  it('never emits more layers than contours requested', () => {
    const scene = generateReaction({ seed: 'contours', ...small, contours: 3 });
    expect(scene.layers.length).toBeLessThanOrEqual(3);
  });

  it('rejects nonsense parameters', () => {
    expect(() => generateReaction({ seed: 'x', gridSize: 4 })).toThrow(/gridSize/);
    expect(() => generateReaction({ seed: 'x', ...small, contours: 0 })).toThrow(
      /contours/,
    );
  });
});
