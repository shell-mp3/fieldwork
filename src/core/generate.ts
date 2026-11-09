/**
 * The one entry point every front end uses: CLI, gallery script and the web
 * playground all come through here, so none of them can drift from another.
 *
 * The parameter schema lives here too. It drives CLI `--flags`, CLI help text,
 * the playground's sliders and range validation from a single declaration.
 */

import type { Scene } from './types';
import { generateFlow, flowDefaults } from './flow';
import { generateReaction, reactionDefaults, type ReactionProgress } from './reaction';

export type { ReactionProgress };

export const algos = ['flow', 'reaction'] as const;
export type Algo = (typeof algos)[number];

export function isAlgo(value: string): value is Algo {
  return (algos as readonly string[]).includes(value);
}

export interface ParamSpec {
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
  default: number;
  /** Plain-language note on what moving this slider does to the picture. */
  help: string;
}

export const flowSchema: ParamSpec[] = [
  { key: 'particles', label: 'Particles', min: 100, max: 6000, step: 50, default: flowDefaults.particles,
    help: 'How many lines are drawn. More fills the canvas; fewer leaves space.' },
  { key: 'steps', label: 'Max steps', min: 20, max: 1200, step: 10, default: flowDefaults.steps,
    help: 'How far each line may travel before it stops.' },
  { key: 'stepLength', label: 'Step length', min: 0.5, max: 8, step: 0.1, default: flowDefaults.stepLength,
    help: 'Distance per step. Large values cut corners and look angular.' },
  { key: 'noiseScale', label: 'Field scale', min: 0.0002, max: 0.008, step: 0.0001, default: flowDefaults.noiseScale,
    help: 'The big one. Small values give long lazy channels, large values tight turbulence.' },
  { key: 'octaves', label: 'Octaves', min: 1, max: 6, step: 1, default: flowDefaults.octaves,
    help: 'Layers of detail in the field. More means finer wrinkles inside the big shapes.' },
  { key: 'colorScale', label: 'Colour scale', min: 0.0001, max: 0.004, step: 0.0001, default: flowDefaults.colorScale,
    help: 'Size of the colour regions. Small values give broad bands of one colour.' },
  { key: 'lineWidth', label: 'Line width', min: 0.2, max: 6, step: 0.1, default: flowDefaults.lineWidth,
    help: 'Stroke weight. Thick strokes with few particles read as printed ink.' },
  { key: 'opacity', label: 'Opacity', min: 0.05, max: 1, step: 0.05, default: flowDefaults.opacity,
    help: 'How solid each stroke is.' },
  { key: 'minLength', label: 'Min path length', min: 0, max: 200, step: 2, default: flowDefaults.minLength,
    help: 'Discards lines shorter than this. Raise it to keep only the long sweeping ones.' },
];

export const reactionSchema: ParamSpec[] = [
  { key: 'gridSize', label: 'Grid size', min: 48, max: 320, step: 8, default: reactionDefaults.gridSize,
    help: 'Simulation resolution. Higher is finer, and costs time squared.' },
  { key: 'iterations', label: 'Iterations', min: 200, max: 24000, step: 200, default: reactionDefaults.iterations,
    help: 'How long the chemistry runs. Too few and the pattern has not filled the canvas yet.' },
  { key: 'feed', label: 'Feed rate', min: 0.01, max: 0.08, step: 0.0001, default: reactionDefaults.feed,
    help: 'With kill rate, decides the whole character: spots, stripes, mazes or dividing cells. Small changes matter a lot.' },
  { key: 'kill', label: 'Kill rate', min: 0.04, max: 0.075, step: 0.0001, default: reactionDefaults.kill,
    help: 'Partner to feed rate. Most pairs give nothing; the interesting band is narrow, so start from a preset.' },
  { key: 'diffusionA', label: 'Diffusion A', min: 0.2, max: 1.4, step: 0.05, default: reactionDefaults.diffusionA,
    help: 'How fast the first chemical spreads.' },
  { key: 'diffusionB', label: 'Diffusion B', min: 0.1, max: 0.8, step: 0.05, default: reactionDefaults.diffusionB,
    help: 'How fast the second spreads. The gap between the two is what makes patterns form at all.' },
  { key: 'seedSpots', label: 'Seed spots', min: 1, max: 60, step: 1, default: reactionDefaults.seedSpots,
    help: 'How many places the reaction starts from.' },
  { key: 'contours', label: 'Contours', min: 1, max: 12, step: 1, default: reactionDefaults.contours,
    help: 'Lines drawn across the pattern, like a topographic map. More gives a layered look.' },
  { key: 'lineWidth', label: 'Line width', min: 0.2, max: 6, step: 0.1, default: reactionDefaults.lineWidth,
    help: 'Stroke weight.' },
  { key: 'opacity', label: 'Opacity', min: 0.05, max: 1, step: 0.05, default: reactionDefaults.opacity,
    help: 'How solid each stroke is.' },
];

export function schemaFor(algo: Algo): ParamSpec[] {
  return algo === 'flow' ? flowSchema : reactionSchema;
}

/** Default canvas size per algorithm: flow reads better tall, reaction square. */
export function sizeFor(algo: Algo): { width: number; height: number } {
  return algo === 'flow'
    ? { width: flowDefaults.width, height: flowDefaults.height }
    : { width: reactionDefaults.width, height: reactionDefaults.height };
}

export interface GenerateRequest {
  algo: Algo;
  seed: string;
  palette?: string;
  width?: number;
  height?: number;
  params?: Record<string, number>;
}

/** Clamp each supplied param to its declared range; ignore unknown keys. */
export function sanitizeParams(algo: Algo, params: Record<string, number> = {}): Record<string, number> {
  const out: Record<string, number> = {};
  for (const spec of schemaFor(algo)) {
    const value = params[spec.key];
    if (value === undefined || !Number.isFinite(value)) continue;
    out[spec.key] = Math.min(spec.max, Math.max(spec.min, value));
  }
  return out;
}

/**
 * `onProgress` is only honoured by reaction-diffusion, the one algorithm slow
 * enough to need it. Flow fields finish in well under a second.
 */
export function generate(
  request: GenerateRequest,
  onProgress?: (progress: ReactionProgress) => void,
): Scene {
  const { algo, seed } = request;
  const size = sizeFor(algo);
  const common = {
    seed,
    width: request.width ?? size.width,
    height: request.height ?? size.height,
    ...sanitizeParams(algo, request.params),
  };
  const palette = request.palette;

  if (algo === 'flow') {
    return generateFlow(palette ? { ...common, palette } : common);
  }
  return generateReaction(palette ? { ...common, palette } : common, onProgress);
}
