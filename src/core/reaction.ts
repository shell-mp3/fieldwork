/**
 * Gray-Scott reaction-diffusion, contoured into vector line work.
 *
 * Two chemicals diffuse at different rates; B consumes A autocatalytically.
 * Depending on feed and kill rates the system settles into spots, stripes,
 * mitosis-like division or sustained chaos.
 */

import type { Scene, Layer } from './types';
import type { Field } from './marching';
import { contour, fieldRange } from './marching';
import { makeRng, rngInt } from './rng';
import { getPalette } from './palette';

export interface ReactionParams {
  width: number;
  height: number;
  seed: string;
  palette: string;
  /** Simulation grid resolution (gridSize x gridSize). */
  gridSize: number;
  iterations: number;
  /** Feed rate: how fast A is replenished. */
  feed: number;
  /** Kill rate: how fast B is removed. */
  kill: number;
  diffusionA: number;
  diffusionB: number;
  timeStep: number;
  /** Number of initial B blobs. */
  seedSpots: number;
  /** Half-width of each initial blob, in cells. */
  spotRadius: number;
  /** How many iso-contours to draw across the settled field. */
  contours: number;
  lineWidth: number;
  opacity: number;
  /** Blank border around the art, in pixels. */
  margin: number;
}

export const reactionDefaults: Omit<ReactionParams, 'seed'> = {
  width: 1200,
  height: 1200,
  palette: 'oxide',
  gridSize: 160,
  iterations: 9000,
  feed: 0.0367,
  kill: 0.0649,
  diffusionA: 1.0,
  diffusionB: 0.5,
  timeStep: 1.0,
  seedSpots: 18,
  spotRadius: 3,
  contours: 5,
  lineWidth: 1.2,
  opacity: 0.9,
  margin: 60,
};

/**
 * 9-point Laplacian with wraparound edges — the reference implementation.
 *
 * The torus matters aesthetically as much as numerically: clamped edges grow a
 * hard rectangular scar where the pattern cannot diffuse outward.
 *
 * `simulate` does NOT call this. Its inner loop runs gridSize² × iterations
 * times — around 230 million cells at the defaults — and a per-cell call with
 * four modulo operations dominated the whole render (20s in a browser).
 * The loop below inlines this with precomputed wrap tables instead, in the
 * same arithmetic order, so the two agree bit for bit. A test asserts that.
 */
export function laplacian(grid: Float32Array, n: number, x: number, y: number): number {
  const w = (v: number) => (v + n) % n;
  const xm = w(x - 1);
  const xp = w(x + 1);
  const ym = w(y - 1);
  const yp = w(y + 1);
  const c = grid[y * n + x]!;
  const ortho =
    grid[ym * n + x]! + grid[yp * n + x]! + grid[y * n + xm]! + grid[y * n + xp]!;
  const diag =
    grid[ym * n + xm]! + grid[ym * n + xp]! + grid[yp * n + xm]! + grid[yp * n + xp]!;
  return 0.2 * ortho + 0.05 * diag - c;
}

export interface SimulateHooks {
  /** Call `onStep` every this many iterations. */
  every: number;
  /**
   * Receives the live B field mid-run. The array is the simulation's own
   * working buffer and is reused, so read it or copy it — do not keep it.
   */
  onStep: (iteration: number, field: Field) => void;
}

/**
 * Runs the simulation and returns the final concentration field of B.
 *
 * `hooks` only observes. It never feeds anything back into the state, so a
 * run with hooks and a run without produce identical output — there is a test
 * for exactly that, because a progress callback that perturbed the result
 * would quietly break every seed.
 */
export function simulate(p: ReactionParams, hooks?: SimulateHooks): Field {
  const n = p.gridSize;
  const size = n * n;
  let a = new Float32Array(size).fill(1);
  let b = new Float32Array(size);
  let nextA = new Float32Array(size);
  let nextB = new Float32Array(size);

  const rng = makeRng(p.seed);
  for (let s = 0; s < p.seedSpots; s++) {
    const cx = rngInt(rng, 0, n);
    const cy = rngInt(rng, 0, n);
    for (let dy = -p.spotRadius; dy <= p.spotRadius; dy++) {
      for (let dx = -p.spotRadius; dx <= p.spotRadius; dx++) {
        const x = (cx + dx + n) % n;
        const y = (cy + dy + n) % n;
        b[y * n + x] = 1;
      }
    }
  }

  // Wrap tables: the hot loop must not compute a modulo 1.8 billion times.
  const prevIdx = new Int32Array(n);
  const nextIdx = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    prevIdx[i] = (i - 1 + n) % n;
    nextIdx[i] = (i + 1) % n;
  }

  // Hoisted out of the loop so the arithmetic matches the reference exactly.
  const { diffusionA, diffusionB, feed, kill, timeStep } = p;
  const killPlusFeed = kill + feed;

  for (let iter = 0; iter < p.iterations; iter++) {
    for (let y = 0; y < n; y++) {
      const row = y * n;
      const rowUp = prevIdx[y]! * n;
      const rowDown = nextIdx[y]! * n;

      /**
       * One cell, written out with explicit neighbour columns. Used only for
       * the two columns that wrap; the interior runs the sliding window below.
       * Every term is in the same order as laplacian(), so the two agree to
       * the bit.
       */
      const edgeCell = (x: number, xl: number, xr: number): void => {
        const i = row + x;
        const av = a[i]!;
        const bv = b[i]!;
        const lapA =
          0.2 * (a[rowUp + x]! + a[rowDown + x]! + a[row + xl]! + a[row + xr]!) +
          0.05 *
            (a[rowUp + xl]! + a[rowUp + xr]! + a[rowDown + xl]! + a[rowDown + xr]!) -
          av;
        const lapB =
          0.2 * (b[rowUp + x]! + b[rowDown + x]! + b[row + xl]! + b[row + xr]!) +
          0.05 *
            (b[rowUp + xl]! + b[rowUp + xr]! + b[rowDown + xl]! + b[rowDown + xr]!) -
          bv;
        const reaction = av * bv * bv;
        const na = av + (diffusionA * lapA - reaction + feed * (1 - av)) * timeStep;
        const nb = bv + (diffusionB * lapB + reaction - killPlusFeed * bv) * timeStep;
        nextA[i] = na < 0 ? 0 : na > 1 ? 1 : na;
        nextB[i] = nb < 0 ? 0 : nb > 1 ? 1 : nb;
      };

      edgeCell(0, n - 1, 1);

      /**
       * Interior columns, as a sliding 3x3 window.
       *
       * The naive loop re-reads all nine neighbours per cell per field: 18
       * loads to produce two values. Moving one column right, the old centre
       * column becomes the left and the old right becomes the centre, so only
       * three cells per field are genuinely new. Same values, same order, same
       * bits — just six loads instead of eighteen.
       */
      let aUpL = a[rowUp]!;
      let aMidL = a[row]!;
      let aDownL = a[rowDown]!;
      let bUpL = b[rowUp]!;
      let bMidL = b[row]!;
      let bDownL = b[rowDown]!;

      let aUpC = a[rowUp + 1]!;
      let aMidC = a[row + 1]!;
      let aDownC = a[rowDown + 1]!;
      let bUpC = b[rowUp + 1]!;
      let bMidC = b[row + 1]!;
      let bDownC = b[rowDown + 1]!;

      for (let x = 1; x < n - 1; x++) {
        const right = x + 1;
        const aUpR = a[rowUp + right]!;
        const aMidR = a[row + right]!;
        const aDownR = a[rowDown + right]!;
        const bUpR = b[rowUp + right]!;
        const bMidR = b[row + right]!;
        const bDownR = b[rowDown + right]!;

        const lapA =
          0.2 * (aUpC + aDownC + aMidL + aMidR) +
          0.05 * (aUpL + aUpR + aDownL + aDownR) -
          aMidC;
        const lapB =
          0.2 * (bUpC + bDownC + bMidL + bMidR) +
          0.05 * (bUpL + bUpR + bDownL + bDownR) -
          bMidC;

        const reaction = aMidC * bMidC * bMidC;
        const na = aMidC + (diffusionA * lapA - reaction + feed * (1 - aMidC)) * timeStep;
        const nb = bMidC + (diffusionB * lapB + reaction - killPlusFeed * bMidC) * timeStep;
        const i = row + x;
        nextA[i] = na < 0 ? 0 : na > 1 ? 1 : na;
        nextB[i] = nb < 0 ? 0 : nb > 1 ? 1 : nb;

        aUpL = aUpC;
        aMidL = aMidC;
        aDownL = aDownC;
        bUpL = bUpC;
        bMidL = bMidC;
        bDownL = bDownC;
        aUpC = aUpR;
        aMidC = aMidR;
        aDownC = aDownR;
        bUpC = bUpR;
        bMidC = bMidR;
        bDownC = bDownR;
      }

      edgeCell(n - 1, n - 2, 0);
    }
    // Swap rather than copy: thousands of iterations of allocation is not free.
    const ta = a;
    const tb = b;
    a = nextA;
    b = nextB;
    nextA = ta;
    nextB = tb;

    if (hooks && (iter + 1) % hooks.every === 0 && iter + 1 < p.iterations) {
      hooks.onStep(iter + 1, { width: n, height: n, data: b });
    }
  }

  return { width: n, height: n, data: b };
}

/** Contours a settled (or part-settled) field into a drawable scene. */
function fieldToScene(field: Field, p: ReactionParams): Scene {
  const palette = getPalette(p.palette);
  const { min, max } = fieldRange(field);
  const span = max - min;

  // Fit the square simulation into the canvas, centred, inside the margin.
  // Scaled by the field's own width rather than p.gridSize, so a decimated
  // preview field lands in the same place as the full-resolution one.
  const usable = Math.min(p.width, p.height) - 2 * p.margin;
  const scale = usable / (field.width - 1);
  const offsetX = (p.width - usable) / 2;
  const offsetY = (p.height - usable) / 2;

  const layers: Layer[] = [];
  for (let c = 0; c < p.contours; c++) {
    // Thresholds spread across the observed range, so a faint pattern still
    // yields visible contours instead of an empty canvas.
    const t = min + span * ((c + 1) / (p.contours + 1));
    const paths = contour(field, t).map((path) =>
      path.map((pt) => ({ x: offsetX + pt.x * scale, y: offsetY + pt.y * scale })),
    );
    if (paths.length === 0) continue;
    layers.push({
      color: palette.colors[c % palette.colors.length]!,
      width: p.lineWidth,
      opacity: p.opacity,
      paths,
    });
  }

  return {
    width: p.width,
    height: p.height,
    background: palette.background,
    layers,
    meta: {
      algo: 'reaction',
      seed: p.seed,
      palette: p.palette,
      params: {
        gridSize: p.gridSize,
        iterations: p.iterations,
        feed: p.feed,
        kill: p.kill,
        diffusionA: p.diffusionA,
        diffusionB: p.diffusionB,
        seedSpots: p.seedSpots,
        contours: p.contours,
        lineWidth: p.lineWidth,
        opacity: p.opacity,
      },
    },
  };
}

/**
 * Every `factor`-th sample, for preview frames only.
 *
 * Point sampling rather than averaging: a preview is replaced a fraction of a
 * second later, and contouring a quarter as many cells is the whole point.
 */
function decimate(field: Field, factor: number): Field {
  if (factor <= 1) return field;
  const width = Math.floor((field.width - 1) / factor) + 1;
  const height = Math.floor((field.height - 1) / factor) + 1;
  const data = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    const src = y * factor * field.width;
    const dst = y * width;
    for (let x = 0; x < width; x++) data[dst + x] = field.data[src + x * factor]!;
  }
  return { width, height, data };
}

export interface ReactionProgress {
  /** 0 to 1. */
  fraction: number;
  /** The pattern as it stands, drawable with any renderer. */
  scene: Scene;
}

/**
 * `onProgress`, when given, is called with a few intermediate scenes as the
 * pattern develops. The simulation is several seconds of work and a spinner
 * tells you nothing; watching the pattern grow tells you whether the feed and
 * kill rates were worth waiting for.
 */
export function generateReaction(
  params: Partial<ReactionParams> & { seed: string },
  onProgress?: (progress: ReactionProgress) => void,
): Scene {
  const p: ReactionParams = { ...reactionDefaults, ...params };
  if (p.gridSize < 8) throw new Error('gridSize must be >= 8');
  if (p.contours < 1) throw new Error('contours must be >= 1');

  if (!onProgress) return fieldToScene(simulate(p), p);

  // Around a dozen updates: frequent enough to read as growth, rare enough
  // that contouring does not dominate.
  const every = Math.max(1, Math.floor(p.iterations / 12));

  // Preview frames are cheaper than the finished piece in two ways: fewer
  // contour levels, and a decimated field. Drawing them at full detail
  // measured at 24% of total runtime — a quarter of the wait spent on frames
  // that are replaced a moment later.
  const previewParams: ReactionParams = { ...p, contours: Math.min(2, p.contours) };
  const previewFactor = p.gridSize >= 120 ? 2 : 1;

  const field = simulate(p, {
    every,
    onStep: (iteration, live) => {
      onProgress({
        fraction: iteration / p.iterations,
        scene: fieldToScene(decimate(live, previewFactor), previewParams),
      });
    },
  });
  return fieldToScene(field, p);
}
