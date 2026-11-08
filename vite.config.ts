import { defineConfig } from 'vite';

// The playground is a standalone static site; `base: './'` keeps it working
// both at a user/org Pages root and under a project subpath.
export default defineConfig({
  root: 'src/web',
  base: './',
  build: {
    outDir: '../../dist-web',
    emptyOutDir: true,
    target: 'es2022',
  },
});
