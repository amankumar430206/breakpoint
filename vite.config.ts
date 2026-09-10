import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath, URL } from 'node:url';

// GitHub Pages serves from /<repo>/ — override with BASE_PATH env when deploying.
const base = process.env.BASE_PATH ?? '/';

export default defineConfig({
  base,
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    rollupOptions: {
      input: {
        // `/` serves the landing page; the tool lives at `/sandbox/`.
        landing: fileURLToPath(new URL('./index.html', import.meta.url)),
        sandbox: fileURLToPath(new URL('./sandbox/index.html', import.meta.url)),
        embed: fileURLToPath(new URL('./embed.html', import.meta.url)),
        // `/wiki/` — the System Design Wiki reference.
        wiki: fileURLToPath(new URL('./wiki/index.html', import.meta.url)),
      },
    },
  },
  worker: {
    format: 'es',
  },
});
