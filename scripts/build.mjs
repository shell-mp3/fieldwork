import { build } from 'esbuild';

const common = {
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  loader: { '.json': 'json' },
  logLevel: 'info',
};

await Promise.all([
  build({ ...common, entryPoints: ['src/cli/index.ts'], outfile: 'dist/cli.js', banner: { js: '#!/usr/bin/env node' } }),
  build({ ...common, entryPoints: ['src/scripts/gallery.ts'], outfile: 'dist/gallery.js' }),
]);
