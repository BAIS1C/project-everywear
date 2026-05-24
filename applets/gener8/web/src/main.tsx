/**
 * Gener8 applet entry point.
 *
 * Renders: BrowserRouter -> Gener8ShellApp provider stack
 * No shell chrome here (Taskbar, Window, LockScreen stripped).
 * WindowFrame is provided by the Everywear OS shell around this webview.
 */
import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';

// EWDS: single CSS import pulls fonts, tokens, components, icons, global glue
import '@everywear/ewds/css/global.css';
import './styles/app.css';

import { Gener8ShellApp } from './ShellApp';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Gener8ShellApp />
    </BrowserRouter>
  </React.StrictMode>,
);
