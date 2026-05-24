import React from 'react';
import ReactDOM from 'react-dom/client';
import { ThemeProvider } from './shell/ThemeContext';
import { AuthProvider } from './shell/AuthContext';
import { AuthGate } from './shell/AuthGate';
import { ShellLayout } from './shell/ShellLayout';
import { initLogger, getLogger } from '@everywear/shared';
import '@everywear/ewds/css/global.css';
import '@everywear/ewds/css/window-frame.css';
import '@applets/gener8/web/src/styles/app.css';
import './styles/shell.css';

// ── Logger bootstrap ────────────────────────────────────────────────
// Resolves backend session ID, starts periodic flush on all loggers.
// Falls back to a client-generated UUID if the backend is not ready.

(async () => {
  try {
    const { invoke } = await import('@tauri-apps/api/core');

    // CODEX_NEEDED: Backend command "get_current_session_id"
    // Args: {}
    // Returns: string (UUID for the current shell session)
    // Creates a new session log file if one does not exist.
    const sessionId = await invoke<string>('get_current_session_id');
    await initLogger(sessionId);
  } catch {
    // Backend not ready: init with a client-generated fallback UUID
    await initLogger(`client-${crypto.randomUUID().slice(0, 8)}`);
  }

  const log = getLogger('shell');
  log.info('system', 'Shell started', {
    app_version: '0.1.0',
    user_agent: navigator.userAgent,
  });
})();

// ── Render ──────────────────────────────────────────────────────────

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeProvider>
      <AuthProvider>
        <AuthGate>
          <ShellLayout />
        </AuthGate>
      </AuthProvider>
    </ThemeProvider>
  </React.StrictMode>
);
