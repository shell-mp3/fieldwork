/**
 * fieldwork CLI.
 *
 * Hand-rolled argument parsing: the flag set is generated from the parameter
 * schema, so a library would not save much, and the tool stays dependency-free.
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, extname } from 'node:path';
import { generate, isAlgo, algos, schemaFor, sizeFor, type Algo } from '../core/generate';
import { renderSvg } from '../core/render/svg';
import { rasterize } from '../core/render/raster';
import { encodePng } from '../core/render/png';
import { countPaths, countPoints } from '../core/types';
import { palettes, paletteNames } from '../core/palette';

const VERSION = '0.1.0';

interface Args {
  command: string;
  flags: Map<string, string | boolean>;
}

function parseArgs(argv: string[]): Args {
  const flags = new Map<string, string | boolean>();
  let command = '';
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]!;
    if (!token.startsWith('--')) {
      if (!command) command = token;
      continue;
    }
    const body = token.slice(2);
    const eq = body.indexOf('=');
    if (eq !== -1) {
      flags.set(body.slice(0, eq), body.slice(eq + 1));
      continue;
    }
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith('--')) {
      flags.set(body, next);
      i++;
    } else {
      flags.set(body, true);
    }
  }
  return { command: command || 'render', flags };
}

function numberFlag(flags: Map<string, string | boolean>, key: string): number | undefined {
  const raw = flags.get(key);
  if (raw === undefined || typeof raw === 'boolean') return undefined;
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    fail(`--${key} expects a number, got "${raw}"`);
  }
  return value;
}

function stringFlag(flags: Map<string, string | boolean>, key: string): string | undefined {
  const raw = flags.get(key);
  return typeof raw === 'string' ? raw : undefined;
}

function fail(message: string): never {
  console.error(`fieldwork: ${message}`);
  process.exit(1);
}

/** A readable, pronounceable fallback seed, printed so the piece is repeatable. */
function randomSeed(): string {
  const words = [
    'amber', 'basalt', 'cinder', 'drift', 'ember', 'fathom', 'glacier', 'harbour',
    'indigo', 'juniper', 'kelp', 'lichen', 'marrow', 'nimbus', 'ochre', 'pollen',
    'quarry', 'rill', 'sable', 'tundra', 'umber', 'vellum', 'wick', 'yarrow',
  ];
  const pick = (): string => words[Math.floor(Math.random() * words.length)]!;
  return `${pick()}-${pick()}-${Math.floor(Math.random() * 9000 + 1000)}`;
}

function helpText(): string {
  const paramLines = algos
    .map((algo) => {
      const rows = schemaFor(algo)
        .map(
          (s) =>
            `      --${s.key.padEnd(12)} ${String(s.default).padEnd(8)} ` +
            `(${s.min} … ${s.max})  ${s.label}`,
        )
        .join('\n');
      const size = sizeFor(algo);
      return `  ${algo}  [default canvas ${size.width}x${size.height}]\n${rows}`;
    })
    .join('\n\n');

  return `fieldwork ${VERSION} — deterministic generative art

USAGE
  fieldwork render --algo <flow|reaction> [--seed <string>] --out <file.svg|file.png>
  fieldwork palettes
  fieldwork params [flow|reaction]

COMMON FLAGS
  --algo <name>        flow | reaction            (default: flow)
  --seed <string>      any string; omit for a random one (it will be printed)
  --out <path>         output file; .svg or .png decides the format
  --palette <name>     ${paletteNames.join(' | ')}
  --width, --height    canvas size in pixels
  --scale <n>          PNG supersample factor (default 1)
  --precision <n>      SVG decimal places (default 2)
  --no-simplify        keep every point in the SVG (much larger files)

ALGORITHM PARAMETERS
${paramLines}

EXAMPLES
  fieldwork render --algo flow --seed harbour-drift --palette kelp --out art.svg
  fieldwork render --algo reaction --seed 1842 --feed 0.0545 --kill 0.062 --out rd.png
  fieldwork render --algo flow --seed x --particles 4000 --scale 2 --out big.png
`;
}

function commandPalettes(): void {
  for (const name of paletteNames) {
    const p = palettes[name]!;
    console.log(`${name}`);
    console.log(`  ${p.inspiration}`);
    console.log(`  background ${p.background}  colours ${p.colors.join(' ')}`);
    console.log('');
  }
}

function commandParams(which: string | undefined): void {
  const list = which && isAlgo(which) ? [which as Algo] : [...algos];
  for (const algo of list) {
    console.log(algo);
    for (const spec of schemaFor(algo)) {
      console.log(
        `  --${spec.key.padEnd(12)} default ${String(spec.default).padEnd(8)} ` +
          `range ${spec.min} … ${spec.max}`,
      );
    }
    console.log('');
  }
}

function commandRender(flags: Map<string, string | boolean>): void {
  const algoRaw = stringFlag(flags, 'algo') ?? 'flow';
  if (!isAlgo(algoRaw)) {
    fail(`unknown algo "${algoRaw}". Choose one of: ${algos.join(', ')}`);
  }
  const algo: Algo = algoRaw;

  const seedFlag = stringFlag(flags, 'seed');
  const seed = seedFlag ?? randomSeed();
  if (!seedFlag) console.log(`seed: ${seed}  (no --seed given; reuse it to reproduce this piece)`);

  const out = stringFlag(flags, 'out');
  if (!out) fail('--out is required (e.g. --out art.svg or --out art.png)');

  const ext = extname(out).toLowerCase();
  if (ext !== '.svg' && ext !== '.png') {
    fail(`--out must end in .svg or .png, got "${ext || out}"`);
  }

  const params: Record<string, number> = {};
  for (const spec of schemaFor(algo)) {
    const value = numberFlag(flags, spec.key);
    if (value !== undefined) params[spec.key] = value;
  }

  const palette = stringFlag(flags, 'palette');
  const started = Date.now();

  let scene;
  try {
    scene = generate({
      algo,
      seed,
      ...(palette ? { palette } : {}),
      ...(numberFlag(flags, 'width') !== undefined ? { width: numberFlag(flags, 'width')! } : {}),
      ...(numberFlag(flags, 'height') !== undefined ? { height: numberFlag(flags, 'height')! } : {}),
      params,
    });
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }

  const generatedMs = Date.now() - started;
  mkdirSync(dirname(out) || '.', { recursive: true });

  let bytes: number;
  if (ext === '.svg') {
    const svg = renderSvg(scene, {
      precision: numberFlag(flags, 'precision') ?? 2,
      simplifyTolerance: flags.get('no-simplify') ? 0 : 0.35,
    });
    writeFileSync(out, svg, 'utf8');
    bytes = Buffer.byteLength(svg, 'utf8');
  } else {
    const scale = numberFlag(flags, 'scale') ?? 1;
    const png = encodePng(rasterize(scene, scale), {
      Software: `fieldwork ${VERSION}`,
      Comment: JSON.stringify(scene.meta),
    });
    writeFileSync(out, png);
    bytes = png.length;
  }

  const kb = (bytes / 1024).toFixed(0);
  console.log(
    `${out}  ${scene.width}x${scene.height}  ${countPaths(scene)} paths  ` +
      `${countPoints(scene)} points  ${kb} KB  ` +
      `(generate ${generatedMs}ms, total ${Date.now() - started}ms)`,
  );
}

function main(): void {
  const { command, flags } = parseArgs(process.argv.slice(2));

  if (flags.get('help') || flags.get('h') || command === 'help') {
    console.log(helpText());
    return;
  }
  if (flags.get('version') || command === 'version') {
    console.log(VERSION);
    return;
  }

  switch (command) {
    case 'palettes':
      commandPalettes();
      return;
    case 'params':
      commandParams(process.argv[3]);
      return;
    case 'render':
      commandRender(flags);
      return;
    default:
      fail(`unknown command "${command}". Try: fieldwork --help`);
  }
}

main();
