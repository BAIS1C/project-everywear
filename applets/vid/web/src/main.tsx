import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { ThemeProvider } from '@everywear/ewds';
import { AuthProvider } from './context/AuthContext';
import { SongStoreProvider } from './context/SongStoreContext';
import App from './App';
import '@everywear/ewds/css/global.css';
import './styles/app.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeProvider>
      <AuthProvider>
        <SongStoreProvider>
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </SongStoreProvider>
      </AuthProvider>
    </ThemeProvider>
  </React.StrictMode>,
);
