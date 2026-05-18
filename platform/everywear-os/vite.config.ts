import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
  },
  envPrefix: ['VITE_', 'TAURI_'],
  resolve: {
    alias: {
      '@applets': path.resolve(__dirname, '../../applets'),
      // EWDS: CSS subpath must come before the catch-all so /css/* resolves to the directory
      '@everywear/ewds/css': path.resolve(__dirname, '../../packages/ewds/src/css'),
      '@everywear/ewds': path.resolve(__dirname, '../../packages/ewds/src/index.ts'),
      '@everywear/shared': path.resolve(__dirname, '../../packages/shared/src/index.ts'),
      '@everywear/transport': path.resolve(__dirname, '../../packages/transport/src/index.ts'),
    },
  },
  build: {
    target: 'esnext',
    minify: !process.env.TAURI_DEBUG ? 'esbuild' : false,
    sourcemap: !!process.env.TAURI_DEBUG,
  },
});
