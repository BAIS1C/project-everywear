import React from 'react';
import ReactDOM from 'react-dom/client';
import { ImagenApp } from './shell/ImagenApp';
import './styles/everywear/tokens.css';
import './styles/imagen.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ImagenApp />
  </React.StrictMode>,
);
