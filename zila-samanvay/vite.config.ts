import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Server-backed build: the React app talks to the Express + SQLite API at /api.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: { __STANDALONE__: 'false' },
  server: {
    port: 5173,
    proxy: { '/api': `http://127.0.0.1:${process.env.API_PORT ?? 4000}` },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    chunkSizeWarningLimit: 900,
  },
});
