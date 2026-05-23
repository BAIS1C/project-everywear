import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  build: {
    lib: {
      entry: path.resolve(__dirname, 'src/index.ts'),
      formats: ['es'],
      fileName: 'index',
    },
    rollupOptions: {
      external: ['react', 'react-dom', '@everywear/ewds'],
    },
  },
  server: {
    host: '127.0.0.1',
    port: 3008,
    strictPort: true,
  },
  resolve: {
    alias: {
      '@everywear/ewds': path.resolve(__dirname, '../../packages/ewds/src/index.ts'),
    },
  },
});
