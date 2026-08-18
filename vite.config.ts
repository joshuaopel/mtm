import { defineConfig } from 'vite';
import { contentPlugin } from './tools/content-plugin';

export default defineConfig({
  base: './',
  plugins: [contentPlugin()],
  server: { host: '127.0.0.1', port: 5173 },
  build: {
    target: 'es2022',
    outDir: 'dist',
    assetsInlineLimit: 0,
  },
});
