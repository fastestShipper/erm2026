import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'node:path';

// En desarrollo, data/ y api/ se piden al sitio publicado (datos reales) o, con
// ERM_DATA_ORIGIN=http://localhost:5100, al servidor local con datos de prueba.
const origin = process.env.ERM_DATA_ORIGIN || 'https://peruvian.dev';
const prefix = '/dataonpe';
const apiOrigin = process.env.ERM_API_ORIGIN || origin;   // p. ej. el servicio de público corriendo en local

export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss()],
  build: {
    outDir: '../web',
    emptyOutDir: true,
    chunkSizeWarningLimit: 1600,
    rollupOptions: {
      input: { main: resolve(import.meta.dirname, 'index.html'), live: resolve(import.meta.dirname, 'live.html') },
    },
  },
  server: {
    proxy: {
      '/data': { target: origin, changeOrigin: true, rewrite: (p) => prefix + p },
      '/api': { target: apiOrigin, changeOrigin: true, rewrite: (p) => prefix + p },
    },
  },
});
