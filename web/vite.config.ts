import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The FastAPI backend serves web/dist at "/" and the API under "/v1" on the same origin.
// In development the Vite server proxies /v1 to the local API.
const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
const API = env.SHRUTI_API ?? 'http://127.0.0.1:8000';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/v1': { target: API, changeOrigin: true } },
  },
  preview: {
    proxy: { '/v1': { target: API, changeOrigin: true } },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          wavesurfer: ['wavesurfer.js'],
          katex: ['katex'],
        },
      },
    },
  },
});
