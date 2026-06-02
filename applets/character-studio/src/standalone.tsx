/**
 * standalone.tsx — Dev entry for the Character Studio applet.
 *
 * Mounts CharacterStudioCore against #root for `npm run dev` / `vite build` of
 * the applet in isolation. In Everywear OS the shell imports the library entry
 * (src/index.ts) instead and provides its own window chrome + ThemeProvider.
 *
 * Responsibilities formerly handled by the fork's Main.jsx + index.html:
 *   - i18n bootstrap (must be imported so translations bundle)
 *   - EWDS skin propagation (postMessage / Tauri bridge) via initSkinSync
 *   - EWDS canonical global CSS
 *   - ThemeProvider wrap (EWDS) for skin/accent/mode
 *
 * The #editor-scene canvas and ktx2 libktx.js are injected at runtime by
 * CharacterStudioCore, so this entry no longer needs them in index.html.
 */
import './lib/localization/i18n';
import { initSkinSync } from './lib/skinSync';
import '@everywear/ewds/css/global.css';
import './character-studio.css';

import React from 'react';
import { createRoot } from 'react-dom/client';
import { ThemeProvider } from '@everywear/ewds';
import CharacterStudioCore from './CharacterStudioCore';

// EWDS skin sync — must run before React mount so data-skin is set on <html>.
initSkinSync();

const root = document.getElementById('root');

if (root) {
  createRoot(root).render(
    <React.StrictMode>
      <ThemeProvider>
        <CharacterStudioCore />
      </ThemeProvider>
    </React.StrictMode>,
  );
}
