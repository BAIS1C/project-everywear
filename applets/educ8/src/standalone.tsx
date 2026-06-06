import React from 'react';
import { createRoot } from 'react-dom/client';
import { Educ8Core } from './Educ8Core';
import './educ8.css';

const root = document.getElementById('root');

if (root) {
  createRoot(root).render(
    <React.StrictMode>
      <Educ8Core />
    </React.StrictMode>,
  );
}
