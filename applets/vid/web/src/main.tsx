import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { SongStoreProvider } from './context/SongStoreContext';
import App from './App';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AuthProvider>
      <SongStoreProvider>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </SongStoreProvider>
    </AuthProvider>
  </React.StrictMode>,
);
