import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// In development the API runs on 8080 and Vite proxies /api and the live WebSocket to it. The Host
// header is kept (changeOrigin false), so the API sees a loopback host and a matching Origin.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': { target: 'http://127.0.0.1:8080', ws: true, changeOrigin: false },
    },
    // Browser test artifacts change while tests run; watching them reloads the page under test.
    watch: { ignored: ['**/e2e/**', '**/dist/**'] },
  },
  // Bundled up front, so the first visit to a page does not re-optimize and reload mid-session.
  optimizeDeps: {
    include: ['@monaco-editor/react', 'monaco-yaml', 'monaco-yaml/yaml.worker.js', 'recharts', 'yaml', 'react-virtuoso', 'cmdk', 'sonner'],
  },
  build: {
    outDir: 'dist',
    target: 'es2023',
    sourcemap: true,
    // Served from the same machine; pages are split per route, and the entry holds React, Base UI
    // and the router (about 190 kB gzipped).
    chunkSizeWarningLimit: 800,
  },
  // Unit tests live next to the code; e2e/ belongs to Playwright.
  test: { include: ['src/**/*.spec.ts'] },
});
