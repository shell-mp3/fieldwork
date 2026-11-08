/**
 * Playground UI.
 *
 * The controls are generated from the same parameter schema the CLI uses, so
 * adding a parameter in one place adds a slider here and a flag there.
 * All state lives in the URL hash, which makes every piece a shareable link.
 */

import {
  algos,
  isAlgo,
  schemaFor,
  sizeFor,
  type Algo,
  type ParamSpec,
} from '../core/generate';
import { paletteNames, getPalette } from '../core/palette';
import type { Scene } from '../core/types';
import { countPaths, countPoints } from '../core/types';
import { drawScene } from '../core/render/canvas';
import { renderSvg } from '../core/render/svg';
import type { WorkerRequest, WorkerResponse } from './worker';

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id}`);
  return el as T;
};

const els = {
  algo: $<HTMLSelectElement>('algo'),
  seed: $<HTMLInputElement>('seed'),
  palette: $<HTMLSelectElement>('palette'),
  inspiration: $<HTMLParagraphElement>('inspiration'),
  params: $<HTMLDivElement>('params'),
  reset: $<HTMLButtonElement>('reset'),
  render: $<HTMLButtonElement>('render'),
  randomize: $<HTMLButtonElement>('randomize'),
  png: $<HTMLButtonElement>('png'),
  svg: $<HTMLButtonElement>('svg'),
  status: $<HTMLParagraphElement>('status'),
  canvas: $<HTMLCanvasElement>('canvas'),
};

interface State {
  algo: Algo;
  seed: string;
  palette: string;
  params: Record<string, number>;
}

const WORDS = [
  'amber', 'basalt', 'cinder', 'drift', 'ember', 'fathom', 'glacier', 'harbour',
  'indigo', 'juniper', 'kelp', 'lichen', 'marrow', 'nimbus', 'ochre', 'pollen',
  'quarry', 'rill', 'sable', 'tundra', 'umber', 'vellum', 'wick', 'yarrow',
];

function randomSeed(): string {
  const pick = (): string => WORDS[Math.floor(Math.random() * WORDS.length)]!;
  return `${pick()}-${pick()}-${Math.floor(Math.random() * 9000 + 1000)}`;
}

function defaultParams(algo: Algo): Record<string, number> {
  return Object.fromEntries(schemaFor(algo).map((s) => [s.key, s.default]));
}

function readHash(): State {
  const q = new URLSearchParams(location.hash.replace(/^#/, ''));
  const algoRaw = q.get('algo') ?? 'flow';
  const algo: Algo = isAlgo(algoRaw) ? algoRaw : 'flow';
  const palette = q.get('palette');
  const params = defaultParams(algo);
  for (const spec of schemaFor(algo)) {
    const raw = q.get(spec.key);
    if (raw === null) continue;
    const value = Number(raw);
    if (Number.isFinite(value)) params[spec.key] = value;
  }
  return {
    algo,
    seed: q.get('seed') ?? randomSeed(),
    palette: palette && paletteNames.includes(palette) ? palette : 'kelp',
    params,
  };
}

function writeHash(state: State): void {
  const q = new URLSearchParams();
  q.set('algo', state.algo);
  q.set('seed', state.seed);
  q.set('palette', state.palette);
  for (const spec of schemaFor(state.algo)) {
    const value = state.params[spec.key];
    if (value !== undefined && value !== spec.default) q.set(spec.key, String(value));
  }
  // replaceState so dragging a slider does not fill the back button with noise.
  history.replaceState(null, '', `#${q.toString()}`);
}

let state = readHash();
let scene: Scene | undefined;
let requestId = 0;
let busy = false;

const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });

function setStatus(text: string, isBusy = false): void {
  els.status.textContent = text;
  els.status.dataset['busy'] = String(isBusy);
}

function formatValue(spec: ParamSpec, value: number): string {
  const decimals = spec.step < 0.001 ? 4 : spec.step < 1 ? 2 : 0;
  return value.toFixed(decimals);
}

function buildParamControls(): void {
  els.params.replaceChildren();
  for (const spec of schemaFor(state.algo)) {
    const label = document.createElement('label');

    const row = document.createElement('div');
    row.className = 'label-row';
    const name = document.createElement('span');
    name.textContent = spec.label;
    const value = document.createElement('span');
    value.className = 'value';
    value.textContent = formatValue(spec, state.params[spec.key] ?? spec.default);
    row.append(name, value);

    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(spec.min);
    input.max = String(spec.max);
    input.step = String(spec.step);
    input.value = String(state.params[spec.key] ?? spec.default);
    input.addEventListener('input', () => {
      const next = Number(input.value);
      state.params[spec.key] = next;
      value.textContent = formatValue(spec, next);
      writeHash(state);
    });

    label.append(row, input);
    els.params.append(label);
  }
}

function syncInspiration(): void {
  els.inspiration.textContent = getPalette(state.palette).inspiration;
}

function fitCanvas(target: Scene): void {
  // Draw at the scene's own resolution and let CSS scale it down; the browser
  // downsample is better than redrawing thin strokes at preview size.
  els.canvas.width = target.width;
  els.canvas.height = target.height;
}

function paint(target: Scene): void {
  fitCanvas(target);
  const ctx = els.canvas.getContext('2d');
  if (!ctx) {
    setStatus('Canvas 2D is unavailable in this browser.');
    return;
  }
  drawScene(ctx, target);
}

function render(): void {
  if (busy) return;
  busy = true;
  els.render.disabled = true;
  const size = sizeFor(state.algo);
  setStatus(`Generating ${state.algo} at ${size.width}x${size.height}…`, true);

  const message: WorkerRequest = {
    id: ++requestId,
    algo: state.algo,
    seed: state.seed,
    palette: state.palette,
    params: state.params,
  };
  worker.postMessage(message);
}

worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
  const data = event.data;
  // Ignore anything but the newest request.
  if (data.id !== requestId) return;
  busy = false;
  els.render.disabled = false;

  if (!data.ok) {
    setStatus(`Error: ${data.error}`);
    return;
  }
  scene = data.scene;
  paint(scene);
  setStatus(
    `${scene.width}x${scene.height} · ${countPaths(scene)} paths · ` +
      `${countPoints(scene).toLocaleString()} points · ${data.elapsedMs} ms`,
  );
};

worker.onerror = (event) => {
  busy = false;
  els.render.disabled = false;
  setStatus(`Worker failed: ${event.message}`);
};

function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function baseFilename(): string {
  const safeSeed = state.seed.replace(/[^a-z0-9-]+/gi, '-').toLowerCase();
  return `fieldwork-${state.algo}-${safeSeed}`;
}

els.algo.addEventListener('change', () => {
  const next = els.algo.value;
  if (!isAlgo(next)) return;
  state = { ...state, algo: next, params: defaultParams(next) };
  buildParamControls();
  writeHash(state);
  render();
});

els.seed.addEventListener('change', () => {
  state.seed = els.seed.value.trim() || randomSeed();
  els.seed.value = state.seed;
  writeHash(state);
  render();
});

els.palette.addEventListener('change', () => {
  state.palette = els.palette.value;
  syncInspiration();
  writeHash(state);
  render();
});

els.reset.addEventListener('click', () => {
  state.params = defaultParams(state.algo);
  buildParamControls();
  writeHash(state);
  render();
});

els.randomize.addEventListener('click', () => {
  state.seed = randomSeed();
  els.seed.value = state.seed;
  writeHash(state);
  render();
});

els.render.addEventListener('click', render);

els.png.addEventListener('click', () => {
  if (!scene) return;
  // The canvas already holds the piece at full scene resolution.
  els.canvas.toBlob((blob) => {
    if (blob) download(blob, `${baseFilename()}.png`);
  }, 'image/png');
});

els.svg.addEventListener('click', () => {
  if (!scene) return;
  const svg = renderSvg(scene);
  download(new Blob([svg], { type: 'image/svg+xml' }), `${baseFilename()}.svg`);
});

function init(): void {
  for (const algo of algos) {
    // The markup already lists both; keep the select in sync with the enum.
    if (!Array.from(els.algo.options).some((o) => o.value === algo)) {
      els.algo.add(new Option(algo, algo));
    }
  }
  els.palette.replaceChildren(
    ...paletteNames.map((name) => new Option(name, name)),
  );

  els.algo.value = state.algo;
  els.seed.value = state.seed;
  els.palette.value = state.palette;
  syncInspiration();
  buildParamControls();
  writeHash(state);
  render();
}

init();
