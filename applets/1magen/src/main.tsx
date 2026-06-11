import React from 'react';
import ReactDOM from 'react-dom/client';
import { ImagenApp } from './shell/ImagenApp';
import { WindowFrame, isTauriContext } from './components/WindowFrame';
import '@everywear/ewds/css/global.css';
import '@everywear/ewds/css/window-frame.css';
import '@everywear/ewds/css/window-frame-component.css';
import './styles/imagen.css';

// Brand contract: Everywear chrome is Mac-style on every OS. Stamp
// before React mounts so window-frame.css resolves darwin tokens on
// first paint (WindowFrame re-stamps after mount).
document.documentElement.setAttribute(
  'data-platform',
  isTauriContext() ? 'darwin' : 'web',
);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <WindowFrame title="1magen">
      <ImagenApp />
    </WindowFrame>
  </React.StrictMode>,
);
