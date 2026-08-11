import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: process.env.API_URL ?? 'http://localhost:4000', changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    rollupOptions: {
      output: {
        // The two readers are heavy and mutually exclusive; splitting them keeps
        // the library view fast to load.
        manualChunks: {
          epub: ['epubjs'],
          pdf: ['pdfjs-dist'],
        },
      },
    },
  },
  // epub.js reaches for `global` at import time.
  define: { global: 'globalThis' },
});
