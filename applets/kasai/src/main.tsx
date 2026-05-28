import React from 'react';
import ReactDOM from 'react-dom/client';
import { KasaiApp } from './shell/KasaiApp';
import '@everywear/ewds/css/global.css';
import '@everywear/ewds/css/window-frame.css';
import './styles/agent-hub.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <KasaiApp />
  </React.StrictMode>,
);
