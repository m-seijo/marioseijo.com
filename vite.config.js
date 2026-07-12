import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// Two static routes: home (/) and /privacy. Vite emits privacy/index.html so a
// hard refresh of https://marioseijo.com/privacy resolves 200.
// Static output only — no framework, three.js is bundled from npm (no CDN).
export default defineConfig({
  root: '.',
  publicDir: 'public',
  build: {
    outDir: 'dist',
    target: 'es2020',
    assetsInlineLimit: 0, // keep fonts/QR as real cacheable files, never inlined
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        privacy: resolve(import.meta.dirname, 'privacy/index.html'),
      },
    },
  },
});
