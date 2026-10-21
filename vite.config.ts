import { defineConfig } from 'vite';
import fs from 'node:fs';

export default defineConfig({
  server: { port: 5199, host: '0.0.0.0', strictPort: true },
  preview: { port: 5199, host: '0.0.0.0', strictPort: true },
  // Relative base so the build works from the gh-pages sub-path (ali3b.github.io/offroad).
  base: './',
  // Truck GLBs exist only after `npm run assets` (ssg model apply); restart the dev server after building them.
  define: { __HAS_MODELS__: JSON.stringify(fs.existsSync('public/models/models.json')) },
  build: { chunkSizeWarningLimit: 6000, target: 'es2022' },
});
