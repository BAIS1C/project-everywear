import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

/**
 * Raw-import GLSL/shader files as default-exported strings. The vendored
 * Character Studio library imports .glsl/.vert/.frag chunks directly.
 */
function glslRawPlugin(): Plugin {
  return {
    name: 'character-studio-glsl-raw',
    transform(code, id) {
      if (!/\.(glsl|vert|frag|wgsl)$/.test(id)) {
        return null;
      }
      return {
        code: `export default ${JSON.stringify(code)};`,
        map: null,
      };
    },
  };
}

export default defineConfig({
  plugins: [react(), glslRawPlugin()],
  clearScreen: false,
  build: {
    lib: {
      entry: path.resolve(__dirname, 'src/index.ts'),
      formats: ['es'],
      fileName: 'index',
    },
    rollupOptions: {
      external: ['react', 'react-dom', 'three', '@pixiv/three-vrm', '@everywear/ewds'],
    },
  },
  server: {
    host: '127.0.0.1',
    port: 3007,
    strictPort: true,
  },
  resolve: {
    alias: {
      '@everywear/ewds': path.resolve(__dirname, '../../packages/ewds/src/index.ts'),
    },
  },
});
