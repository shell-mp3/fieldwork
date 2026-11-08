/**
 * Marching squares: scalar field -> iso-contours as stitched polylines.
 *
 * This is what lets the reaction-diffusion simulation share a renderer with
 * the flow fields. The alternative — emitting one <rect> per cell — would mean
 * a second renderer, a 30k-element SVG, and no vector output worth the name.
 */

import type { Path, Point } from './types';

export interface Field {
  width: number;
  height: number;
  /** Row-major, length width * height. */
  data: Float32Array;
}

export function fieldAt(field: Field, x: number, y: number): number {
  return field.data[y * field.width + x]!;
}

export function fieldRange(field: Field): { min: number; max: number } {
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < field.data.length; i++) {
    const v = field.data[i]!;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return { min, max };
}

type Segment = [Point, Point];

/**
 * Linear interpolation along a cell edge.
 *
 * Both cells that share an edge call this with the same two corner values in
 * the same order, so the crossing point comes out bit-identical from either
 * side. That exactness is what makes stitching by coordinate key safe.
 */
function lerpEdge(
  ax: number,
  ay: number,
  av: number,
  bx: number,
  by: number,
  bv: number,
  threshold: number,
): Point {
  const denom = bv - av;
  const t = denom === 0 ? 0.5 : (threshold - av) / denom;
  return { x: ax + t * (bx - ax), y: ay + t * (by - ay) };
}

function marchSegments(field: Field, threshold: number): Segment[] {
  const { width: w, height: h } = field;
  const segments: Segment[] = [];

  /**
   * Drop zero-length segments.
   *
   * When a sample sits exactly on the threshold — common with integer-valued
   * fields, and with any circle through a 6-8-10 lattice point — two edges of
   * the same cell interpolate to that same vertex. The degenerate segment that
   * results is not geometry; it is a point that appears in the stitch map as a
   * spurious extra end, which splits one clean loop into fragments.
   */
  const add = (a: Point, b: Point): void => {
    if (a.x === b.x && a.y === b.y) return;
    segments.push([a, b]);
  };

  for (let y = 0; y < h - 1; y++) {
    for (let x = 0; x < w - 1; x++) {
      const va = fieldAt(field, x, y);
      const vb = fieldAt(field, x + 1, y);
      const vc = fieldAt(field, x + 1, y + 1);
      const vd = fieldAt(field, x, y + 1);

      let idx = 0;
      if (va > threshold) idx |= 1;
      if (vb > threshold) idx |= 2;
      if (vc > threshold) idx |= 4;
      if (vd > threshold) idx |= 8;

      if (idx === 0 || idx === 15) continue;

      // Edges are always interpolated in a canonical direction:
      // horizontals left-to-right, verticals top-to-bottom.
      const top = () => lerpEdge(x, y, va, x + 1, y, vb, threshold);
      const bottom = () => lerpEdge(x, y + 1, vd, x + 1, y + 1, vc, threshold);
      const left = () => lerpEdge(x, y, va, x, y + 1, vd, threshold);
      const right = () => lerpEdge(x + 1, y, vb, x + 1, y + 1, vc, threshold);

      switch (idx) {
        case 1:
        case 14:
          add(left(), top());
          break;
        case 2:
        case 13:
          add(top(), right());
          break;
        case 3:
        case 12:
          add(left(), right());
          break;
        case 4:
        case 11:
          add(right(), bottom());
          break;
        case 6:
        case 9:
          add(top(), bottom());
          break;
        case 7:
        case 8:
          add(left(), bottom());
          break;
        // Ambiguous saddles: the cell centre decides which way the two
        // crossings connect. Without this, contours cross themselves.
        case 5: {
          const centre = (va + vb + vc + vd) / 4;
          if (centre > threshold) {
            add(left(), top());
            add(right(), bottom());
          } else {
            add(left(), bottom());
            add(top(), right());
          }
          break;
        }
        case 10: {
          const centre = (va + vb + vc + vd) / 4;
          if (centre > threshold) {
            add(top(), right());
            add(left(), bottom());
          } else {
            add(left(), top());
            add(right(), bottom());
          }
          break;
        }
      }
    }
  }
  return segments;
}

const key = (p: Point): string => `${p.x},${p.y}`;

/**
 * Join loose segments into the longest polylines possible, walking forward
 * from one end and then backward from the other.
 */
function stitch(segments: Segment[]): Path[] {
  const ends = new Map<string, number[]>();
  segments.forEach((seg, i) => {
    for (const p of seg) {
      const k = key(p);
      const list = ends.get(k);
      if (list) list.push(i);
      else ends.set(k, [i]);
    }
  });

  const used = new Uint8Array(segments.length);
  const paths: Path[] = [];

  const nextFrom = (point: Point): { seg: number; other: Point } | undefined => {
    for (const i of ends.get(key(point)) ?? []) {
      if (used[i]) continue;
      const [a, b] = segments[i]!;
      if (key(a) === key(point)) return { seg: i, other: b };
      if (key(b) === key(point)) return { seg: i, other: a };
    }
    return undefined;
  };

  for (let i = 0; i < segments.length; i++) {
    if (used[i]) continue;
    used[i] = 1;
    const [a, b] = segments[i]!;
    const path: Path = [a, b];

    for (;;) {
      const step = nextFrom(path[path.length - 1]!);
      if (!step) break;
      used[step.seg] = 1;
      path.push(step.other);
      if (key(step.other) === key(path[0]!)) break; // closed loop
    }
    for (;;) {
      const step = nextFrom(path[0]!);
      if (!step) break;
      used[step.seg] = 1;
      path.unshift(step.other);
    }
    if (path.length >= 2) paths.push(path);
  }
  return paths;
}

/** Iso-contours of `field` at `threshold`, in field coordinates. */
export function contour(field: Field, threshold: number): Path[] {
  return stitch(marchSegments(field, threshold));
}
