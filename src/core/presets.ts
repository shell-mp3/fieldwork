/**
 * Named starting points.
 *
 * Ten sliders with no guidance is not a tool, it is a puzzle. Presets give
 * someone a piece they like in one click, and a sane place to start tweaking.
 *
 * This is also the single source of truth for the gallery: `npm run gallery`
 * renders these same definitions, so a preset in the playground and the image
 * in the README can never drift apart.
 */

import presetsJson from '../presets.json';
import { isAlgo, type Algo } from './generate';

export interface Preset {
  id: string;
  title: string;
  /** One line on what makes this one worth looking at. */
  blurb: string;
  algo: Algo;
  seed: string;
  palette: string;
  params: Record<string, number>;
}

/**
 * Validated at load rather than cast.
 *
 * presets.json is hand-edited data that reaches both the playground and the
 * gallery renderer. A typo in `algo` should fail loudly here, not surface as
 * a blank canvas or a confusing render three layers down.
 */
function parsePresets(raw: unknown): Preset[] {
  if (!Array.isArray(raw)) throw new Error('presets.json must be an array');

  return raw.map((entry, index) => {
    const e = entry as Record<string, unknown>;
    const where = `presets.json[${index}]`;

    for (const field of ['id', 'title', 'blurb', 'seed', 'palette'] as const) {
      if (typeof e[field] !== 'string' || e[field] === '') {
        throw new Error(`${where}: "${field}" must be a non-empty string`);
      }
    }
    if (typeof e['algo'] !== 'string' || !isAlgo(e['algo'])) {
      throw new Error(`${where}: "algo" is "${String(e['algo'])}", which is not an algorithm`);
    }

    const params: Record<string, number> = {};
    for (const [key, value] of Object.entries((e['params'] ?? {}) as Record<string, unknown>)) {
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new Error(`${where}: param "${key}" must be a finite number`);
      }
      params[key] = value;
    }

    return {
      id: e['id'] as string,
      title: e['title'] as string,
      blurb: e['blurb'] as string,
      algo: e['algo'],
      seed: e['seed'] as string,
      palette: e['palette'] as string,
      params,
    };
  });
}

export const presets: Preset[] = parsePresets(presetsJson);

export function getPreset(id: string): Preset {
  const found = presets.find((p) => p.id === id);
  if (!found) {
    throw new Error(
      `Unknown preset "${id}". Available: ${presets.map((p) => p.id).join(', ')}`,
    );
  }
  return found;
}

export function presetsFor(algo: Algo): Preset[] {
  return presets.filter((p) => p.algo === algo);
}
