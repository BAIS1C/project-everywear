import React from 'react';
import ReactDOM from 'react-dom/client';
import { ImagenApp } from './shell/ImagenApp';
import '@everywear/ewds/css/tokens.css';
import '@everywear/ewds/css/components.css';
import '@everywear/ewds/css/fonts.css';
import './styles/imagen.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ImagenApp />
  </React.StrictMode>,
);
