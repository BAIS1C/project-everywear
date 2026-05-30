import React, { createContext, useContext } from 'react';

export type Gener8LockedModel = 'song' | 'pro';
export type Gener8AudioMode = 'song' | 'reference' | 'cover';

export interface Gener8LaunchManifest {
  id: string;
  lockedModel?: Gener8LockedModel | null;
  allowedAudioModes?: Gener8AudioMode[] | null;
  stepCeiling?: number | null;
  vaultScope?: 'full' | null;
  vidTarget?: 'vid' | null;
}

const LaunchManifestContext = createContext<Gener8LaunchManifest | null>(null);

export function LaunchManifestProvider({
  manifest,
  children,
}: {
  manifest?: Gener8LaunchManifest | null;
  children: React.ReactNode;
}) {
  return (
    <LaunchManifestContext.Provider value={manifest ?? null}>
      {children}
    </LaunchManifestContext.Provider>
  );
}

export function useLaunchManifest() {
  return useContext(LaunchManifestContext);
}
