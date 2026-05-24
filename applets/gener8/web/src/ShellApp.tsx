import React from 'react';
import { ThemeProvider } from '@everywear/ewds';
import { AuthProvider } from './context/AuthContext';
import { SongStoreProvider } from './context/SongStoreContext';
import { VaultProvider } from './context/VaultProvider';
import { ResponsiveProvider } from './context/ResponsiveContext';
import { WorkspaceProvider } from './context/WorkspaceContext';
import { ShellAudioProvider } from './shell/ShellAudioPlayer';
import { App } from './App';

export function Gener8ShellApp() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <ResponsiveProvider>
          <WorkspaceProvider>
            <SongStoreProvider>
              <ShellAudioProvider>
                <VaultProvider>
                  <App />
                </VaultProvider>
              </ShellAudioProvider>
            </SongStoreProvider>
          </WorkspaceProvider>
        </ResponsiveProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}
