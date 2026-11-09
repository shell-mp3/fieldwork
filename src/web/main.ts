/**
 * Playground UI.
 *
 * The controls are generated from the same parameter schema the CLI uses, so
 * adding a parameter in one place adds a slider here and a flag there. All
 * state lives in the URL hash, which makes every piece a shareable link.
 */

import {
  algos,
  isAlgo,
  schemaFor,
  sizeFor,
  type Algo,
  type ParamSpec,
} from '../core/generate';
import { presets, getPreset, type Preset } from '../core/presets';
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
  presets: $<HTMLDivElement>('presets'),
  presetBlurb: $<HTMLParagraphElement>('presetBlurb'),
  algo: $<HTMLSelectElement>('algo'),
  seed: $<HTMLInputElement>('seed'),
  palette: $<HTMLSelectElement>('palette'),
  inspiration: $<HTMLParagraphElement>('inspiration'),
  params: $<HTMLDivElement>('params'),
  paramsBox: $<HTMLDetailsElement>('paramsBox'),
  reset: $<HTMLButtonElement>('reset'),
  render: $<HTMLButtonElement>('render'),
  randomize: $<HTMLButtonElement>('randomize'),
  scale: $<HTMLSelectElement>('scale'),
  png: $<HTMLButtonElement>('png'),
  svg: $<HTMLButtonElement>('svg'),
  copy: $<HTMLButtonElement>('copy'),
  status: $<HTMLParagraphElement>('status'),
  bar: $<HTMLDivElement>('bar'),
  barFill: $<HTMLDivElement>('barFill'),
  canvas: $<HTMLCanvasElement>('canvas'),
};

interface State {
  algo: Algo;
  seed: string;
  palette: string;
  params: Record<string, number>;
  /** Which preset this came from, if it is still unmodified. */
  presetId: string | undefined;
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

function stateFromPreset(preset: Preset): State {
  return {
    algo: preset.algo,
    seed: preset.seed,
    palette: preset.palette,
    params: { ...defaultParams(preset.algo), ...preset.params },
    presetId: preset.id,
  };
}

function readHash(): State {
  const q = new URLSearchParams(location.hash.replace(/^#/, ''));

  // A bare ?preset= link (used by the gallery) loads that piece exactly.
  const presetId = q.get('preset');
  if (presetId && !q.get('seed')) {
    try {
      return stateFromPreset(getPreset(presetId));
    } catch {
      // Unknown id: fall through to the normal path rather than dying.
    }
  }

  const algoRaw = q.get('algo') ?? '';
  const algo: Algo = isAlgo(algoRaw) ? algoRaw : 'flow';
  const palette = q.get('palette');
  const params = defaultParams(algo);
  for (const spec of schemaFor(algo)) {
    const raw = q.get(spec.key);
    if (raw === null) continue;
    const value = Number(raw);
    if (Number.isFinite(value)) params[spec.key] = value;
  }

  // No usable hash at all? Open on a preset, not a random pile of defaults —
  // a first-time visitor should land on something worth looking at.
  if (!q.get('seed') && !isAlgo(algoRaw)) {
    return stateFromPreset(presets[0]!);
  }

  return {
    algo,
    seed: q.get('seed') ?? randomSeed(),
    palette: palette && paletteNames.includes(palette) ? palette : 'kelp',
    params,
    presetId: presetId ?? undefined,
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

function setProgress(fraction: number | undefined): void {
  if (fraction === undefined) {
    els.bar.hidden = true;
    return;
  }
  els.bar.hidden = false;
  els.barFill.style.width = `${Math.round(fraction * 100)}%`;
}

function formatValue(spec: ParamSpec, value: number): string {
  const decimals = spec.step < 0.001 ? 4 : spec.step < 1 ? 2 : 0;
  return value.toFixed(decimals);
}

/** Any manual change means this is no longer the preset as published. */
function detachFromPreset(): void {
  if (!state.presetId) return;
  state.presetId = undefined;
  syncPresetButtons();
}

function syncPresetButtons(): void {
  for (const button of els.presets.querySelectorAll<HTMLButtonElement>('.preset')) {
    button.setAttribute(
      'aria-pressed',
      String(button.dataset['id'] === state.presetId),
    );
  }
  const preset = state.presetId ? getPreset(state.presetId) : undefined;
  els.presetBlurb.textContent = preset ? preset.blurb : 'Modified — no longer a preset.';
}

function buildPresetButtons(): void {
  els.presets.replaceChildren(
    ...presets.map((preset) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'preset';
      button.dataset['id'] = preset.id;
      button.setAttribute('aria-pressed', 'false');
      button.title = preset.blurb;

      const name = document.createElement('strong');
      name.textContent = preset.title;
      const kind = document.createElement('span');
      kind.textContent = preset.algo === 'flow' ? 'flow' : 'reaction';
      button.append(name, kind);

      button.addEventListener('click', () => {
        state = stateFromPreset(preset);
        syncControls();
        writeHash(state);
        render();
      });
      return button;
    }),
  );
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

    const help = document.createElement('p');
    help.className = 'help';
    help.textContent = spec.help;

    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(spec.min);
    input.max = String(spec.max);
    input.step = String(spec.step);
    input.value = String(state.params[spec.key] ?? spec.default);
    input.setAttribute('aria-label', `${spec.label}. ${spec.help}`);
    input.addEventListener('input', () => {
      const next = Number(input.value);
      state.params[spec.key] = next;
      value.textContent = formatValue(spec, next);
      detachFromPreset();
      writeHash(state);
    });
    // Flow fields are fast enough to re-render the moment you let go.
    input.addEventListener('change', () => {
      if (state.algo === 'flow') render();
    });

    label.append(row, help, input);
    els.params.append(label);
  }
}

function syncControls(): void {
  els.algo.value = state.algo;
  els.seed.value = state.seed;
  els.palette.value = state.palette;
  els.inspiration.textContent = getPalette(state.palette).inspiration;
  buildParamControls();
  syncPresetButtons();
}

function paint(target: Scene): void {
  // Draw at the scene's own resolution and let CSS scale it down; the browser
  // downsample is better than redrawing thin strokes at preview size.
  els.canvas.width = target.width;
  els.canvas.height = target.height;
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
  setStatus(`Generating ${state.algo} at ${size.width}×${size.height}…`, true);
  if (state.algo === 'reaction') setProgress(0);

  const message: WorkerRequest = {
    id: ++requestId,
    algo: state.algo,
    seed: state.seed,
    palette: state.palette,
    params: state.params,
    progressive: state.algo === 'reaction',
  };
  worker.postMessage(message);
}

worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
  const data = event.data;
  // Ignore anything but the newest request.
  if (data.id !== requestId) return;

  if (data.kind === 'progress') {
    paint(data.scene);
    setProgress(data.fraction);
    setStatus(`Growing the pattern… ${Math.round(data.fraction * 100)}%`, true);
    return;
  }

  busy = false;
  els.render.disabled = false;
  setProgress(undefined);

  if (data.kind === 'error') {
    setStatus(`Error: ${data.error}`);
    return;
  }

  scene = data.scene;
  paint(scene);
  setStatus(
    `${scene.width}×${scene.height} · ${countPaths(scene)} paths · ` +
      `${countPoints(scene).toLocaleString()} points · ${data.elapsedMs} ms`,
  );
};

worker.onerror = (event) => {
  busy = false;
  els.render.disabled = false;
  setProgress(undefined);
  setStatus(`Worker failed: ${event.message}`);
};

function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  // Revoking immediately can cancel the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function baseFilename(): string {
  const safeSeed = state.seed.replace(/[^a-z0-9-]+/gi, '-').toLowerCase();
  return `fieldwork-${state.algo}-${safeSeed}`;
}

els.algo.addEventListener('change', () => {
  const next = els.algo.value;
  if (!isAlgo(next)) return;
  state = { ...state, algo: next, params: defaultParams(next), presetId: undefined };
  syncControls();
  writeHash(state);
  render();
});

els.seed.addEventListener('change', () => {
  state.seed = els.seed.value.trim() || randomSeed();
  els.seed.value = state.seed;
  detachFromPreset();
  writeHash(state);
  render();
});

els.palette.addEventListener('change', () => {
  state.palette = els.palette.value;
  els.inspiration.textContent = getPalette(state.palette).inspiration;
  detachFromPreset();
  writeHash(state);
  render();
});

els.reset.addEventListener('click', () => {
  state.params = defaultParams(state.algo);
  syncControls();
  writeHash(state);
  render();
});

els.randomize.addEventListener('click', () => {
  state.seed = randomSeed();
  els.seed.value = state.seed;
  detachFromPreset();
  writeHash(state);
  render();
});

els.render.addEventListener('click', render);

els.png.addEventListener('click', () => {
  if (!scene) return;
  const scale = Number(els.scale.value) || 1;
  // Re-render to an offscreen canvas so the export is a true higher
  // resolution rather than an upscale of the on-screen pixels.
  const out = document.createElement('canvas');
  out.width = Math.round(scene.width * scale);
  out.height = Math.round(scene.height * scale);
  const ctx = out.getContext('2d');
  if (!ctx) return;
  drawScene(ctx, scene, { scale });
  out.toBlob((blob) => {
    if (blob) download(blob, `${baseFilename()}@${scale}x.png`);
  }, 'image/png');
});

els.svg.addEventListener('click', () => {
  if (!scene) return;
  download(
    new Blob([renderSvg(scene)], { type: 'image/svg+xml' }),
    `${baseFilename()}.svg`,
  );
});

els.copy.addEventListener('click', async () => {
  const url = location.href;
  const done = (message: string): void => {
    const previous = els.copy.textContent;
    els.copy.textContent = message;
    setTimeout(() => {
      els.copy.textContent = previous;
    }, 1600);
  };
  try {
    await navigator.clipboard.writeText(url);
    done('Copied');
  } catch {
    // Clipboard access needs a secure context and can be refused outright.
    // Selecting the URL at least lets the person copy it themselves.
    window.prompt('Copy this link:', url);
  }
});

function init(): void {
  for (const algo of algos) {
    if (!Array.from(els.algo.options).some((o) => o.value === algo)) {
      els.algo.add(new Option(algo, algo));
    }
  }
  els.palette.replaceChildren(...paletteNames.map((name) => new Option(name, name)));

  buildPresetButtons();
  syncControls();
  // Someone who arrived on a tweaked link wants to see the controls that
  // were tweaked; someone on a preset does not need them in the way.
  els.paramsBox.open = state.presetId === undefined;
  writeHash(state);
  render();
}

init();
