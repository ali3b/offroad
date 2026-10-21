import { defineConfig } from 'vite';

export default defineConfig({
  server: { port: 5199, host: '0.0.0.0', strictPort: true },
  preview: { port: 5199, host: '0.0.0.0', strictPort: true },
  // Relative base so the build works from the gh-pages sub-path (ali3b.github.io/offroad).
  base: './',
  build: { chunkSizeWarningLimit: 6000, target: 'es2022' },
});
