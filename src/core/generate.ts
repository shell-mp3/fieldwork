/**
 * The one entry point every front end uses: CLI, gallery script and the web
 * playground all come through here, so none of them can drift from another.
 *
 * The parameter schema lives here too. It drives CLI `--flags`, CLI help text,
 * the playground's sliders and range validation from a single declaration.
 */

import type { Scene } from './types';
import { generateFlow, flowDefaults } from './flow';
import { generateReaction, reactionDefaults } from './reaction';

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
}

export const flowSchema: ParamSpec[] = [
  { key: 'particles', label: 'Particles', min: 100, max: 6000, step: 50, default: flowDefaults.particles },
  { key: 'steps', label: 'Max steps', min: 20, max: 1200, step: 10, default: flowDefaults.steps },
  { key: 'stepLength', label: 'Step length', min: 0.5, max: 8, step: 0.1, default: flowDefaults.stepLength },
  { key: 'noiseScale', label: 'Field scale', min: 0.0002, max: 0.008, step: 0.0001, default: flowDefaults.noiseScale },
  { key: 'octaves', label: 'Octaves', min: 1, max: 6, step: 1, default: flowDefaults.octaves },
  { key: 'colorScale', label: 'Colour scale', min: 0.0001, max: 0.004, step: 0.0001, default: flowDefaults.colorScale },
  { key: 'lineWidth', label: 'Line width', min: 0.2, max: 6, step: 0.1, default: flowDefaults.lineWidth },
  { key: 'opacity', label: 'Opacity', min: 0.05, max: 1, step: 0.05, default: flowDefaults.opacity },
  { key: 'minLength', label: 'Min path length', min: 0, max: 200, step: 2, default: flowDefaults.minLength },
];

export const reactionSchema: ParamSpec[] = [
  { key: 'gridSize', label: 'Grid size', min: 48, max: 320, step: 8, default: reactionDefaults.gridSize },
  { key: 'iterations', label: 'Iterations', min: 200, max: 24000, step: 200, default: reactionDefaults.iterations },
  { key: 'feed', label: 'Feed rate', min: 0.01, max: 0.08, step: 0.0001, default: reactionDefaults.feed },
  { key: 'kill', label: 'Kill rate', min: 0.04, max: 0.075, step: 0.0001, default: reactionDefaults.kill },
  { key: 'diffusionA', label: 'Diffusion A', min: 0.2, max: 1.4, step: 0.05, default: reactionDefaults.diffusionA },
  { key: 'diffusionB', label: 'Diffusion B', min: 0.1, max: 0.8, step: 0.05, default: reactionDefaults.diffusionB },
  { key: 'seedSpots', label: 'Seed spots', min: 1, max: 60, step: 1, default: reactionDefaults.seedSpots },
  { key: 'contours', label: 'Contours', min: 1, max: 12, step: 1, default: reactionDefaults.contours },
  { key: 'lineWidth', label: 'Line width', min: 0.2, max: 6, step: 0.1, default: reactionDefaults.lineWidth },
  { key: 'opacity', label: 'Opacity', min: 0.05, max: 1, step: 0.05, default: reactionDefaults.opacity },
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

export function generate(request: GenerateRequest): Scene {
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
  return generateReaction(palette ? { ...common, palette } : common);
}
