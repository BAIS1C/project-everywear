import React, { Suspense, lazy } from 'react';
import { Routes, Route } from 'react-router-dom';
import { LoadingSpinner } from './components/LoadingSpinner';
import Gener8Core from './shell/applets/Gener8Core';

const DawCore = lazy(() => import('./shell/applets/DawCore'));
const VidApp = lazy(() => import('./shell/VidApp'));
const AIDirectorView = lazy(() => import('./views/AIDirectorView'));
const SettingsView = lazy(() => import('./views/SettingsView'));

export function App() {
  return (
    <div className="w-full h-full bg-s3 text-s3-text-primary overflow-hidden">
      <Suspense fallback={<LoadingSpinner />}>
        <Routes>
          <Route path="/" element={<Gener8Core />} />
          <Route path="/daw" element={<DawCore />} />
          <Route path="/library" element={<Gener8Core />} />
          <Route path="/vid" element={<VidApp />} />
          <Route path="/director" element={<AIDirectorView />} />
          <Route path="/settings" element={<SettingsView />} />
        </Routes>
      </Suspense>
    </div>
  );
}
