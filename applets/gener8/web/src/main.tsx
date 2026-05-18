/**
 * Gener8 applet entry point.
 *
 * Renders: ThemeProvider (EWDS) → AuthProvider (Tauri invoke) → App
 * No shell chrome here (Taskbar, Window, LockScreen stripped).
 * WindowFrame is provided by the Everywear OS shell around this webview.
 */
import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';

// EWDS: single CSS import pulls fonts, tokens, components, icons, global glue
import '@everywear/ewds/css/global.css';
import './styles/app.css';

import { ThemeProvider } from '@everywear/ewds';
import { AuthProvider } from './context/AuthContext';
import { SongStoreProvider } from './context/SongStoreContext';
import { VaultProvider } from './context/VaultProvider';
import { App } from './App';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeProvider>
      <AuthProvider>
        <SongStoreProvider>
          <VaultProvider>
            <BrowserRouter>
              <App />
            </BrowserRouter>
          </VaultProvider>
        </SongStoreProvider>
      </AuthProvider>
    </ThemeProvider>
  </React.StrictMode>,
);
