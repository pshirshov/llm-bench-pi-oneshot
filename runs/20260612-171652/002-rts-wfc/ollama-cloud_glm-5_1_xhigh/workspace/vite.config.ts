import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@sim': path.resolve(__dirname, 'src/sim'),
      '@render': path.resolve(__dirname, 'src/render'),
      '@ui': path.resolve(__dirname, 'src/ui'),
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});