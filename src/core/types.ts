/** Geometry and scene types shared by every algorithm and every renderer. */

export interface Point {
  x: number;
  y: number;
}

/** An open or closed polyline in scene coordinates. */
export type Path = Point[];

/**
 * A group of paths that share stroke settings. Grouping by appearance rather
 * than by generation order is what lets the SVG renderer emit one <g> per
 * colour instead of per-path attributes.
 */
export interface Layer {
  color: string;
  width: number;
  opacity: number;
  paths: Path[];
}

export interface SceneMeta {
  algo: string;
  seed: string;
  palette: string;
  params: Record<string, number | string | boolean>;
}

/**
 * The single hand-off between generation and rendering. Both algorithms reduce
 * to polylines, so SVG, raster/PNG and canvas each need exactly one
 * implementation rather than one per algorithm.
 */
export interface Scene {
  width: number;
  height: number;
  background: string;
  layers: Layer[];
  meta: SceneMeta;
}

export function pathLength(path: Path): number {
  let total = 0;
  for (let i = 1; i < path.length; i++) {
    total += Math.hypot(path[i]!.x - path[i - 1]!.x, path[i]!.y - path[i - 1]!.y);
  }
  return total;
}

export function countPaths(scene: Scene): number {
  return scene.layers.reduce((n, l) => n + l.paths.length, 0);
}

export function countPoints(scene: Scene): number {
  return scene.layers.reduce((n, l) => n + l.paths.reduce((m, p) => m + p.length, 0), 0);
}
