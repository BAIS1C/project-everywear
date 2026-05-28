import React from 'react';
import { createRoot } from 'react-dom/client';
import ThreevizenCore from './ThreevizenCore';
import './threevizen.css';

createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <ThreevizenCore />
  </React.StrictMode>,
);
