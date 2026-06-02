import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import path from 'path';

const characterStudioPublicRoot = path.resolve(__dirname, '../../applets/character-studio/public');
const contentTypes: Record<string, string> = {
  '.fbx': 'application/octet-stream',
  '.hdr': 'image/vnd.radiance',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
};

export default defineConfig({
  plugins: [
    {
      name: 'everywear-character-studio-assets',
      configureServer(server) {
        server.middlewares.use('/cs-assets', (req, res, next) => {
          const rawPath = (req.url || '/').split('?')[0];
          const relativePath = decodeURIComponent(rawPath)
            .replace(/^\/cs-assets\/?/, '')
            .replace(/^\/+/, '');
          const filePath = path.resolve(characterStudioPublicRoot, path.normalize(relativePath));

          if (filePath !== characterStudioPublicRoot && !filePath.startsWith(`${characterStudioPublicRoot}${path.sep}`)) {
            res.statusCode = 403;
            res.end('Forbidden');
            return;
          }

          fs.stat(filePath, (statError, stat) => {
            if (statError || !stat.isFile()) {
              next();
              return;
            }

            const contentType = contentTypes[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
            res.setHeader('Content-Type', contentType);
            fs.createReadStream(filePath)
              .on('error', next)
              .pipe(res);
          });
        });
      },
    },
    react(),
  ],
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/__gener8_ace_props': {
        target: 'http://127.0.0.1:8080',
        changeOrigin: true,
        rewrite: () => '/props',
      },
    },
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
      '@': path.resolve(__dirname, '../../applets/gener8/web/src'),
    },
  },
  build: {
    target: 'esnext',
    minify: !process.env.TAURI_DEBUG ? 'esbuild' : false,
    sourcemap: !!process.env.TAURI_DEBUG,
  },
});
