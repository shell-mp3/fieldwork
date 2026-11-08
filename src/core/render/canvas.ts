/**
 * Scene -> HTML canvas. Browser-only; deliberately free of any Node import so
 * it can be bundled for the playground.
 */

import type { Scene } from '../types';
import { simplifyPath } from '../simplify';

export interface CanvasOptions {
  /** Multiplies scene coordinates, e.g. devicePixelRatio. */
  scale?: number;
  /** RDP tolerance in scene pixels; raise it for a faster live preview. */
  simplifyTolerance?: number;
}

export function drawScene(
  ctx: CanvasRenderingContext2D,
  scene: Scene,
  options: CanvasOptions = {},
): void {
  const scale = options.scale ?? 1;
  const tolerance = options.simplifyTolerance ?? 0;

  ctx.save();
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.fillStyle = scene.background;
  ctx.fillRect(0, 0, scene.width, scene.height);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  for (const layer of scene.layers) {
    ctx.strokeStyle = layer.color;
    ctx.lineWidth = layer.width;
    ctx.globalAlpha = layer.opacity;
    // One path object for the whole layer: thousands of individual stroke()
    // calls is the difference between a snappy preview and a stuttering one.
    const batch = new Path2D();
    for (const raw of layer.paths) {
      const path = tolerance > 0 ? simplifyPath(raw, tolerance) : raw;
      if (path.length < 2) continue;
      batch.moveTo(path[0]!.x, path[0]!.y);
      for (let i = 1; i < path.length; i++) {
        batch.lineTo(path[i]!.x, path[i]!.y);
      }
    }
    ctx.stroke(batch);
  }

  ctx.globalAlpha = 1;
  ctx.restore();
}
