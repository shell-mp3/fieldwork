/**
 * Palettes live in JSON rather than in code so they can be swapped, added to
 * or generated without touching the algorithms.
 */

import palettesJson from '../palettes.json';

export interface Palette {
  name: string;
  /** Where the colours came from. Credit matters; so does remembering. */
  inspiration: string;
  background: string;
  colors: string[];
}

export const palettes: Record<string, Palette> = palettesJson as Record<string, Palette>;

export const paletteNames: string[] = Object.keys(palettes).sort();

export function getPalette(name: string): Palette {
  const found = palettes[name];
  if (!found) {
    throw new Error(`Unknown palette "${name}". Available: ${paletteNames.join(', ')}`);
  }
  return found;
}
