/**
 * Seeded 2D simplex noise, fractal sums of it, and the curl operator that
 * turns a noise field into the divergence-free flow field the particles ride.
 */

import type { Rng } from './rng';
import type { Point } from './types';
import { shuffle } from './rng';

const F2 = 0.5 * (Math.sqrt(3) - 1);
const G2 = (3 - Math.sqrt(3)) / 6;

/** The 12 edge-midpoint gradients of a cube, used 2D-style (z ignored). */
const GRAD3: readonly number[] = [
  1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1, 0,
  1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, -1,
  0, 1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1,
];

export class Noise2D {
  private readonly perm = new Uint8Array(512);
  private readonly permMod12 = new Uint8Array(512);

  /** The permutation table is shuffled from the caller's stream, so the whole
   *  noise field is a function of the seed. */
  constructor(rng: Rng) {
    const base = shuffle(
      rng,
      Array.from({ length: 256 }, (_, i) => i),
    );
    for (let i = 0; i < 512; i++) {
      const v = base[i & 255]!;
      this.perm[i] = v;
      this.permMod12[i] = v % 12;
    }
  }

  /** Classic 2D simplex noise, output in roughly [-1, 1]. */
  noise(xin: number, yin: number): number {
    const s = (xin + yin) * F2;
    const i = Math.floor(xin + s);
    const j = Math.floor(yin + s);
    const t = (i + j) * G2;
    const x0 = xin - (i - t);
    const y0 = yin - (j - t);

    // Which of the two triangles in this cell are we in?
    const i1 = x0 > y0 ? 1 : 0;
    const j1 = x0 > y0 ? 0 : 1;

    const x1 = x0 - i1 + G2;
    const y1 = y0 - j1 + G2;
    const x2 = x0 - 1 + 2 * G2;
    const y2 = y0 - 1 + 2 * G2;

    const ii = i & 255;
    const jj = j & 255;
    const gi0 = this.permMod12[ii + this.perm[jj]!]! * 3;
    const gi1 = this.permMod12[ii + i1 + this.perm[jj + j1]!]! * 3;
    const gi2 = this.permMod12[ii + 1 + this.perm[jj + 1]!]! * 3;

    let n0 = 0;
    let n1 = 0;
    let n2 = 0;

    let t0 = 0.5 - x0 * x0 - y0 * y0;
    if (t0 >= 0) {
      t0 *= t0;
      n0 = t0 * t0 * (GRAD3[gi0]! * x0 + GRAD3[gi0 + 1]! * y0);
    }
    let t1 = 0.5 - x1 * x1 - y1 * y1;
    if (t1 >= 0) {
      t1 *= t1;
      n1 = t1 * t1 * (GRAD3[gi1]! * x1 + GRAD3[gi1 + 1]! * y1);
    }
    let t2 = 0.5 - x2 * x2 - y2 * y2;
    if (t2 >= 0) {
      t2 *= t2;
      n2 = t2 * t2 * (GRAD3[gi2]! * x2 + GRAD3[gi2 + 1]! * y2);
    }

    return 70 * (n0 + n1 + n2);
  }

  /**
   * Fractal Brownian motion: octaves of noise at doubling frequency and
   * halving amplitude. Normalised by total amplitude so the range stays
   * comparable to a single octave no matter how many you ask for.
   */
  fbm(x: number, y: number, octaves = 1, lacunarity = 2, gain = 0.5): number {
    let freq = 1;
    let amp = 1;
    let sum = 0;
    let norm = 0;
    for (let o = 0; o < octaves; o++) {
      sum += amp * this.noise(x * freq, y * freq);
      norm += amp;
      freq *= lacunarity;
      amp *= gain;
    }
    return norm === 0 ? 0 : sum / norm;
  }
}

export interface CurlOptions {
  octaves?: number;
  epsilon?: number;
}

/**
 * Curl of the scalar noise field treated as a stream function:
 * `v = (dP/dy, -dP/dx)`.
 *
 * Taking the curl rather than using the noise value as an angle directly is
 * what gives the long braided channels: the field is divergence-free, so
 * particle paths crowd and split but never pile into sinks.
 *
 * Returns a unit vector (zero vector where the field is flat).
 */
export function curl(noise: Noise2D, x: number, y: number, opts: CurlOptions = {}): Point {
  const eps = opts.epsilon ?? 1e-4;
  const octaves = opts.octaves ?? 1;
  const dpdy = (noise.fbm(x, y + eps, octaves) - noise.fbm(x, y - eps, octaves)) / (2 * eps);
  const dpdx = (noise.fbm(x + eps, y, octaves) - noise.fbm(x - eps, y, octaves)) / (2 * eps);
  const vx = dpdy;
  const vy = -dpdx;
  const len = Math.hypot(vx, vy);
  if (len < 1e-12) return { x: 0, y: 0 };
  return { x: vx / len, y: vy / len };
}
