import React from 'react';
import { ThemeProvider } from '@everywear/ewds';
import { AuthProvider } from './context/AuthContext';
import { SongStoreProvider } from './context/SongStoreContext';
import { VaultProvider } from './context/VaultProvider';
import { ResponsiveProvider } from './context/ResponsiveContext';
import { WorkspaceProvider } from './context/WorkspaceContext';
import { LaunchManifestProvider, type Gener8LaunchManifest } from './context/LaunchManifestContext';
import { ShellAudioProvider } from './shell/ShellAudioPlayer';
import { App } from './App';

export function Gener8ShellApp({
  appletId,
  launchManifest,
}: {
  appletId?: string;
  launchManifest?: Gener8LaunchManifest | null;
}) {
  const manifest = launchManifest ?? (
    appletId === 'gener8-4ever' || appletId === 'gener8-pro'
      ? { id: appletId, allowedAudioModes: [] }
      : null
  );

  return (
    <ThemeProvider>
      <AuthProvider>
        <ResponsiveProvider>
          <WorkspaceProvider>
            <LaunchManifestProvider manifest={manifest}>
              <SongStoreProvider>
                <ShellAudioProvider>
                  <VaultProvider>
                    <App />
                  </VaultProvider>
                </ShellAudioProvider>
              </SongStoreProvider>
            </LaunchManifestProvider>
          </WorkspaceProvider>
        </ResponsiveProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}
