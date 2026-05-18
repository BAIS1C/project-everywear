import React from 'react';
import ReactDOM from 'react-dom/client';
import { KasaiApp } from './shell/KasaiApp';
import '@everywear/ewds/css/tokens.css';
import '@everywear/ewds/css/components.css';
import '@everywear/ewds/css/fonts.css';
import '@everywear/ewds/css/window-frame.css';
import './styles/kasai.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <KasaiApp />
  </React.StrictMode>,
);
