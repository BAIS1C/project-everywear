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
      external: [
        'react',
        'react-dom',
        '@everywear/shared',
        '@everywear/transport',
        '@tauri-apps/plugin-dialog',
      ],
    },
  },
  server: {
    host: '127.0.0.1',
    port: 3004,
    strictPort: true,
  },
  resolve: {
    alias: {
      '@everywear/shared': path.resolve(__dirname, '../../packages/shared/src/index.ts'),
      '@everywear/transport': path.resolve(__dirname, '../../packages/transport/src/index.ts'),
    },
  },
});
