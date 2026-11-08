import { describe, it, expect } from 'vitest';
import { contour, fieldRange, type Field } from '../src/core/marching';

function makeField(
  size: number,
  fn: (x: number, y: number) => number,
): Field {
  const data = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) data[y * size + x] = fn(x, y);
  }
  return { width: size, height: size, data };
}

describe('fieldRange', () => {
  it('reports the true extremes', () => {
    const f = makeField(10, (x, y) => x - y);
    expect(fieldRange(f)).toEqual({ min: -9, max: 9 });
  });
});

describe('contour', () => {
  it('finds nothing in a constant field', () => {
    expect(contour(makeField(16, () => 0.5), 0.25)).toEqual([]);
    expect(contour(makeField(16, () => 0.5), 0.75)).toEqual([]);
  });

  it('places a single crossing correctly in one cell', () => {
    // 2x2 cell, only the top-left corner above the threshold. The contour
    // must cut the left and top edges at the interpolated positions.
    const data = new Float32Array([1, 0, 0, 0]);
    const paths = contour({ width: 2, height: 2, data }, 0.5);
    expect(paths).toHaveLength(1);
    const points = paths[0]!;
    expect(points).toHaveLength(2);
    const sorted = points.slice().sort((a, b) => a.x - b.x || a.y - b.y);
    // left edge: between (0,0)=1 and (0,1)=0, crossing 0.5 at y = 0.5
    expect(sorted[0]!).toEqual({ x: 0, y: 0.5 });
    // top edge: between (0,0)=1 and (1,0)=0, crossing 0.5 at x = 0.5
    expect(sorted[1]!).toEqual({ x: 0.5, y: 0 });
  });

  it('traces a circle as one closed loop at the right radius', () => {
    const size = 81;
    const c = (size - 1) / 2;
    const radius = 24;
    // Negative inside, positive outside; the zero level set is the circle.
    const f = makeField(size, (x, y) => radius - Math.hypot(x - c, y - c));

    const paths = contour(f, 0);
    expect(paths).toHaveLength(1);

    const loop = paths[0]!;
    const first = loop[0]!;
    const last = loop[loop.length - 1]!;
    expect(first.x).toBe(last.x);
    expect(first.y).toBe(last.y);

    // Every vertex should sit on the circle to within a fraction of a cell.
    for (const p of loop) {
      expect(Math.abs(Math.hypot(p.x - c, p.y - c) - radius)).toBeLessThan(0.05);
    }

    // And it should be a full circle, not an arc.
    expect(loop.length).toBeGreaterThan(100);
  });

  it('traces two separate blobs as two separate paths', () => {
    const size = 64;
    const f = makeField(size, (x, y) => {
      const d1 = Math.hypot(x - 16, y - 16);
      const d2 = Math.hypot(x - 48, y - 48);
      return Math.max(10 - d1, 10 - d2);
    });
    expect(contour(f, 0)).toHaveLength(2);
  });

  it('cuts a linear ramp into one open path across the field', () => {
    const size = 32;
    const f = makeField(size, (x) => x);
    const paths = contour(f, 15.5);
    expect(paths).toHaveLength(1);
    const path = paths[0]!;
    // Vertical line at x = 15.5, spanning the full height.
    for (const p of path) expect(p.x).toBeCloseTo(15.5, 10);
    const ys = path.map((p) => p.y);
    expect(Math.min(...ys)).toBe(0);
    expect(Math.max(...ys)).toBe(size - 1);
  });

  it('shares endpoints exactly between neighbouring cells', () => {
    // If edge interpolation were not canonical, stitching would fail and the
    // ring would come back as dozens of two-point fragments.
    const size = 40;
    const c = 19.5;
    const f = makeField(size, (x, y) => 12 - Math.hypot(x - c, y - c));
    const paths = contour(f, 0);
    expect(paths).toHaveLength(1);
    expect(paths[0]!.length).toBeGreaterThan(60);
  });

  it('resolves saddle cells without crossing itself', () => {
    // Opposite corners high, the other two low: the ambiguous case.
    const data = new Float32Array([1, 0, 0, 1]);
    const paths = contour({ width: 2, height: 2, data }, 0.5);
    expect(paths).toHaveLength(2);
    for (const p of paths) expect(p).toHaveLength(2);
  });

  it('is deterministic', () => {
    const f = makeField(50, (x, y) => Math.sin(x / 4) + Math.cos(y / 3));
    expect(contour(f, 0.3)).toEqual(contour(f, 0.3));
  });
});
