/**
 * Scene -> SVG document string.
 *
 * One <g> per layer carries the stroke attributes, so individual <path>
 * elements hold nothing but geometry. On a 2000-path piece that alone saves
 * well over a megabyte of repeated attributes.
 */

import type { Scene, Path } from '../types';
import { simplifyPath } from '../simplify';

export interface SvgOptions {
  /** Decimal places kept per coordinate. 2 is visually lossless at print size. */
  precision?: number;
  /** RDP tolerance in pixels. 0 disables simplification. */
  simplifyTolerance?: number;
  /** Embed seed and params as a <desc> block. */
  includeMetadata?: boolean;
}

const defaults: Required<SvgOptions> = {
  precision: 2,
  simplifyTolerance: 0.35,
  includeMetadata: true,
};

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function num(value: number, precision: number): string {
  // Number() strips trailing zeros, so 12.00 becomes 12 rather than "12.00".
  const rounded = Number(value.toFixed(precision));
  return String(Object.is(rounded, -0) ? 0 : rounded);
}

function pathData(path: Path, precision: number): string {
  const parts: string[] = [];
  const first = path[0]!;
  const last = path[path.length - 1]!;
  // A contour that returns to its start is closed with Z; repeating the point
  // would leave a visible notch at the join.
  const closed = path.length > 3 && first.x === last.x && first.y === last.y;
  const end = closed ? path.length - 1 : path.length;

  for (let i = 0; i < end; i++) {
    const p = path[i]!;
    parts.push(`${i === 0 ? 'M' : 'L'}${num(p.x, precision)} ${num(p.y, precision)}`);
  }
  if (closed) parts.push('Z');
  return parts.join('');
}

export function renderSvg(scene: Scene, options: SvgOptions = {}): string {
  const opts = { ...defaults, ...options };
  const { precision, simplifyTolerance } = opts;

  const lines: string[] = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${scene.width}" height="${scene.height}" ` +
      `viewBox="0 0 ${scene.width} ${scene.height}">`,
  );

  if (opts.includeMetadata) {
    const meta = {
      generator: 'fieldwork',
      algo: scene.meta.algo,
      seed: scene.meta.seed,
      palette: scene.meta.palette,
      params: scene.meta.params,
    };
    lines.push(`  <desc>${escapeXml(JSON.stringify(meta))}</desc>`);
  }

  lines.push(
    `  <rect width="${scene.width}" height="${scene.height}" fill="${escapeXml(scene.background)}"/>`,
  );

  for (const layer of scene.layers) {
    lines.push(
      `  <g fill="none" stroke="${escapeXml(layer.color)}" stroke-width="${layer.width}" ` +
        `stroke-opacity="${layer.opacity}" stroke-linecap="round" stroke-linejoin="round">`,
    );
    for (const raw of layer.paths) {
      const path = simplifyPath(raw, simplifyTolerance);
      if (path.length < 2) continue;
      lines.push(`    <path d="${pathData(path, precision)}"/>`);
    }
    lines.push('  </g>');
  }

  lines.push('</svg>');
  return lines.join('\n') + '\n';
}
