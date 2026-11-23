// The build of the model editor alone (model.html). The spike's own page (index.html) needs files that are fetched,
// not committed, so it is built separately, by vite.config.js.
import { fileURLToPath } from 'node:url';
import { defineConfig, mergeConfig } from 'vite';
import base from './vite.config.js';

export default mergeConfig(base, defineConfig({
  // Relative addresses, so the build works in whatever folder it is published.
  base: './',
  publicDir: false,
  // The terminal panel's ligatures addon needs Node; see src/no-ligatures.js.
  resolve: { alias: [{ find: '@xterm/addon-ligatures', replacement: fileURLToPath(new URL('./src/no-ligatures.js', import.meta.url)) }] },
  // Minified: what a visitor fetches and the browser reads is half the size. The spike's page (vite.config.js) is
  // left as written, for reading in the debugger.
  build: { outDir: 'dist-model', emptyOutDir: true, minify: 'esbuild', rollupOptions: { input: 'model.html' } },
}));
