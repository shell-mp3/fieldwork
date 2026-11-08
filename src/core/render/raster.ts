/**
 * Scene -> RGBA pixels. Shared by the PNG encoder and anything else that
 * wants pixels without a browser canvas.
 */

import type { Scene, Path } from '../types';

export interface Raster {
  width: number;
  height: number;
  /** RGBA, row-major, length width * height * 4. */
  data: Uint8ClampedArray;
}

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.trim().replace(/^#/, '');
  const full =
    h.length === 3
      ? h
          .split('')
          .map((c) => c + c)
          .join('')
      : h;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) throw new Error(`Bad hex colour: "${hex}"`);
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}

/**
 * Anti-aliased round brush stamped into a coverage buffer.
 *
 * Coverage accumulates with `max` rather than alpha-compositing per stamp.
 * Compositing each stamp would make a translucent stroke opaque wherever
 * stamps overlap along its own length — and they overlap constantly, since
 * spacing is a fraction of the radius.
 */
function stampDisc(
  coverage: Float32Array,
  width: number,
  height: number,
  cx: number,
  cy: number,
  radius: number,
): void {
  const reach = radius + 1;
  const x0 = Math.max(0, Math.floor(cx - reach));
  const x1 = Math.min(width - 1, Math.ceil(cx + reach));
  const y0 = Math.max(0, Math.floor(cy - reach));
  const y1 = Math.min(height - 1, Math.ceil(cy + reach));
  // Sub-pixel strokes get faded rather than widened.
  const thinScale = radius < 0.5 ? radius / 0.5 : 1;

  for (let py = y0; py <= y1; py++) {
    const dy = py + 0.5 - cy;
    for (let px = x0; px <= x1; px++) {
      const dx = px + 0.5 - cx;
      const d = Math.sqrt(dx * dx + dy * dy);
      let a = radius + 0.5 - d;
      if (a <= 0) continue;
      if (a > 1) a = 1;
      a *= thinScale;
      const i = py * width + px;
      if (a > coverage[i]!) coverage[i] = a;
    }
  }
}

function strokePath(
  coverage: Float32Array,
  width: number,
  height: number,
  path: Path,
  lineWidth: number,
  scale: number,
): void {
  const radius = (lineWidth * scale) / 2;
  const spacing = Math.max(0.3, radius * 0.4);
  if (path.length === 1) {
    stampDisc(coverage, width, height, path[0]!.x * scale, path[0]!.y * scale, radius);
    return;
  }
  for (let i = 1; i < path.length; i++) {
    const ax = path[i - 1]!.x * scale;
    const ay = path[i - 1]!.y * scale;
    const bx = path[i]!.x * scale;
    const by = path[i]!.y * scale;
    const dist = Math.hypot(bx - ax, by - ay);
    const steps = Math.max(1, Math.ceil(dist / spacing));
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      stampDisc(coverage, width, height, ax + (bx - ax) * t, ay + (by - ay) * t, radius);
    }
  }
}

/** Render a scene to pixels. `scale` multiplies the scene's own dimensions. */
export function rasterize(scene: Scene, scale = 1): Raster {
  const width = Math.max(1, Math.round(scene.width * scale));
  const height = Math.max(1, Math.round(scene.height * scale));
  const data = new Uint8ClampedArray(width * height * 4);

  const [br, bg, bb] = hexToRgb(scene.background);
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = br;
    data[i * 4 + 1] = bg;
    data[i * 4 + 2] = bb;
    data[i * 4 + 3] = 255;
  }

  // One buffer reused across layers; layers composite in order.
  const coverage = new Float32Array(width * height);
  for (const layer of scene.layers) {
    coverage.fill(0);
    for (const path of layer.paths) {
      strokePath(coverage, width, height, path, layer.width, scale);
    }
    const [lr, lg, lb] = hexToRgb(layer.color);
    for (let i = 0; i < coverage.length; i++) {
      const a = coverage[i]! * layer.opacity;
      if (a <= 0) continue;
      const o = i * 4;
      data[o] = data[o]! * (1 - a) + lr * a;
      data[o + 1] = data[o + 1]! * (1 - a) + lg * a;
      data[o + 2] = data[o + 2]! * (1 - a) + lb * a;
    }
  }

  return { width, height, data };
}

/**
 * Integer box-filter downsample.
 *
 * Rendering a thumbnail directly at its final size thins every stroke below a
 * pixel, where the brush fades it out and the piece looks washed. Rendering
 * large and averaging down keeps stroke weight and gives cleaner edges than
 * the stamp's own anti-aliasing.
 */
export function downsample(raster: Raster, factor: number): Raster {
  if (!Number.isInteger(factor) || factor < 1) {
    throw new Error(`downsample factor must be a positive integer, got ${factor}`);
  }
  if (factor === 1) return raster;

  const width = Math.floor(raster.width / factor);
  const height = Math.floor(raster.height / factor);
  const data = new Uint8ClampedArray(width * height * 4);
  const samples = factor * factor;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < factor; sy++) {
        const row = (y * factor + sy) * raster.width;
        for (let sx = 0; sx < factor; sx++) {
          const o = (row + x * factor + sx) * 4;
          r += raster.data[o]!;
          g += raster.data[o + 1]!;
          b += raster.data[o + 2]!;
          a += raster.data[o + 3]!;
        }
      }
      const o = (y * width + x) * 4;
      data[o] = r / samples;
      data[o + 1] = g / samples;
      data[o + 2] = b / samples;
      data[o + 3] = a / samples;
    }
  }
  return { width, height, data };
}
