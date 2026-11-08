/**
 * Ramer-Douglas-Peucker path simplification.
 *
 * Advected particle paths are sampled at a fixed step length, so long gentle
 * curves carry far more points than they need. Dropping points that sit within
 * a fraction of a pixel of the chord cuts SVG size by roughly 5-10x with no
 * visible change.
 */

import type { Path, Point } from './types';

function perpendicularDistance(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  // Distance from p to the infinite line ab, via the cross product.
  return Math.abs(dy * (p.x - a.x) - dx * (p.y - a.y)) / Math.sqrt(lenSq);
}

/** Simplify one path. A tolerance of 0 returns the path unchanged. */
export function simplifyPath(path: Path, tolerance: number): Path {
  if (tolerance <= 0 || path.length < 3) return path;

  const keep = new Uint8Array(path.length);
  keep[0] = 1;
  keep[path.length - 1] = 1;

  // Explicit stack rather than recursion: paths can run to thousands of points.
  const stack: Array<[number, number]> = [[0, path.length - 1]];
  while (stack.length > 0) {
    const [start, end] = stack.pop()!;
    let maxDist = -1;
    let maxIndex = -1;
    for (let i = start + 1; i < end; i++) {
      const d = perpendicularDistance(path[i]!, path[start]!, path[end]!);
      if (d > maxDist) {
        maxDist = d;
        maxIndex = i;
      }
    }
    if (maxIndex !== -1 && maxDist > tolerance) {
      keep[maxIndex] = 1;
      stack.push([start, maxIndex], [maxIndex, end]);
    }
  }

  const out: Path = [];
  for (let i = 0; i < path.length; i++) {
    if (keep[i]) out.push(path[i]!);
  }
  return out;
}
