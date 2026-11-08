/**
 * Flow fields: thousands of particles advected through the curl of a seeded
 * noise field, each leaving a polyline behind it.
 */

import type { Point, Scene, Layer, Path } from './types';
import { pathLength } from './types';
import { makeRng, rngRange } from './rng';
import { Noise2D, curl } from './noise';
import { getPalette } from './palette';

export interface FlowParams {
  width: number;
  height: number;
  seed: string;
  palette: string;
  /** How many particles to release. */
  particles: number;
  /** Maximum advection steps per particle. */
  steps: number;
  /** Distance covered per step, in pixels. */
  stepLength: number;
  /** Spatial frequency of the flow field. Smaller = longer, lazier channels. */
  noiseScale: number;
  /** Octaves in the potential field. More = more fine structure. */
  octaves: number;
  /** Spatial frequency of the independent field that assigns colour. */
  colorScale: number;
  /** Particles are killed this far outside the canvas. */
  margin: number;
  lineWidth: number;
  opacity: number;
  /** Paths shorter than this (in px) are discarded as visual noise. */
  minLength: number;
}

export const flowDefaults: Omit<FlowParams, 'seed'> = {
  width: 1200,
  height: 1600,
  palette: 'kelp',
  particles: 2200,
  steps: 420,
  stepLength: 2.2,
  noiseScale: 0.0016,
  octaves: 3,
  colorScale: 0.0007,
  margin: 36,
  lineWidth: 1.4,
  opacity: 0.85,
  minLength: 24,
};

/**
 * Spawn points on a jittered grid rather than uniformly at random.
 *
 * Pure random spawning clumps badly at a few thousand particles and leaves
 * visible bald patches; stratifying first and jittering within each cell keeps
 * coverage even while staying fully seeded.
 */
function spawnPoints(
  rng: () => number,
  count: number,
  width: number,
  height: number,
): Point[] {
  const cols = Math.max(1, Math.round(Math.sqrt((count * width) / height)));
  const rows = Math.max(1, Math.ceil(count / cols));
  const cellW = width / cols;
  const cellH = height / rows;
  const points: Point[] = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      if (points.length >= count) return points;
      points.push({
        x: col * cellW + rngRange(rng, 0, cellW),
        y: row * cellH + rngRange(rng, 0, cellH),
      });
    }
  }
  return points;
}

/** Advect one particle until it leaves the canvas or runs out of steps. */
function trace(
  noise: Noise2D,
  start: Point,
  p: FlowParams,
): Path {
  const path: Path = [start];
  let x = start.x;
  let y = start.y;
  for (let step = 0; step < p.steps; step++) {
    const v = curl(noise, x * p.noiseScale, y * p.noiseScale, {
      octaves: p.octaves,
      // The epsilon lives in noise space, so it has to scale with the field.
      epsilon: p.noiseScale * 0.5,
    });
    if (v.x === 0 && v.y === 0) break;
    x += v.x * p.stepLength;
    y += v.y * p.stepLength;
    if (
      x < -p.margin ||
      y < -p.margin ||
      x > p.width + p.margin ||
      y > p.height + p.margin
    ) {
      break;
    }
    path.push({ x, y });
  }
  return path;
}

export function generateFlow(params: Partial<FlowParams> & { seed: string }): Scene {
  const p: FlowParams = { ...flowDefaults, ...params };
  if (p.particles <= 0) throw new Error('particles must be > 0');
  if (p.steps <= 0) throw new Error('steps must be > 0');

  const palette = getPalette(p.palette);
  const rng = makeRng(p.seed);

  // Two independent fields from one stream: shape, then colour.
  const flowNoise = new Noise2D(rng);
  const colorNoise = new Noise2D(rng);

  const buckets: Path[][] = palette.colors.map(() => []);

  for (const start of spawnPoints(rng, p.particles, p.width, p.height)) {
    const path = trace(flowNoise, start, p);
    if (path.length < 3 || pathLength(path) < p.minLength) continue;

    // Colour from a slow independent field, so hues form coherent regions
    // instead of salt-and-pepper.
    const t = (colorNoise.fbm(start.x * p.colorScale, start.y * p.colorScale, 2) + 1) / 2;
    const idx = Math.min(palette.colors.length - 1, Math.floor(t * palette.colors.length));
    buckets[idx]!.push(path);
  }

  const layers: Layer[] = palette.colors
    .map((color, i) => ({
      color,
      width: p.lineWidth,
      opacity: p.opacity,
      paths: buckets[i]!,
    }))
    .filter((l) => l.paths.length > 0);

  return {
    width: p.width,
    height: p.height,
    background: palette.background,
    layers,
    meta: {
      algo: 'flow',
      seed: p.seed,
      palette: p.palette,
      params: {
        particles: p.particles,
        steps: p.steps,
        stepLength: p.stepLength,
        noiseScale: p.noiseScale,
        octaves: p.octaves,
        colorScale: p.colorScale,
        lineWidth: p.lineWidth,
        opacity: p.opacity,
        minLength: p.minLength,
      },
    },
  };
}
