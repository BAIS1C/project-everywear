import React from 'react';
import { createRoot } from 'react-dom/client';
import { LoomCore } from './LoomCore';
import './loom.css';

const root = document.getElementById('root');

if (root) {
  createRoot(root).render(
    <React.StrictMode>
      <LoomCore />
    </React.StrictMode>,
  );
}
