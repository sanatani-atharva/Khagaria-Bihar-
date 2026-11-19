import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// Zero-install build: one self-contained HTML file. The same core procedures run in the
// browser on SQLite (sql.js / WebAssembly) and persist to IndexedDB. Open it from disk.
export default defineConfig({
  plugins: [react(), tailwindcss(), viteSingleFile({ removeViteModuleLoader: true })],
  define: { __STANDALONE__: 'true' },
  build: {
    outDir: 'dist-standalone',
    emptyOutDir: true,
    sourcemap: false,
    assetsInlineLimit: 100_000_000,
    chunkSizeWarningLimit: 5000,
  },
});
