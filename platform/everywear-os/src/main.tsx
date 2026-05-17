import React from 'react';
import ReactDOM from 'react-dom/client';
import { ThemeProvider } from './shell/ThemeContext';
import { AuthProvider } from './shell/AuthContext';
import { AuthGate } from './shell/AuthGate';
import { ShellLayout } from './shell/ShellLayout';
import './styles/everywear/tokens.css';
import './styles/shell.css';

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
