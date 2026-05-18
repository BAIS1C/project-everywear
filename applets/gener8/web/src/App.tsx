/**
 * Gener8 App Shell
 *
 * Stripped version of S3 Studio's App.tsx:
 *   - NO Taskbar, Window, LockScreen (provided by Everywear OS shell)
 *   - NO WindowFrame (provided by shell's Tauri WindowFrame.tsx)
 *   - Auth from Tauri invoke, not Supabase directly
 *   - EWDS via @everywear/ewds, not local copies
 *
 * Layout: Sidebar + Main area (CreatePanel / Library / Settings)
 */
import React, { useState, lazy, Suspense } from 'react';
import { Routes, Route } from 'react-router-dom';
import { useTheme } from '@everywear/ewds';
import { Sidebar } from './components/Sidebar';
import { LoadingSpinner } from './components/LoadingSpinner';
import { DawTransportBar } from './components/DawTransportBar';

// Lazy-load heavy views
const CreateView = lazy(() => import('./views/CreateView'));
const LibraryView = lazy(() => import('./views/LibraryView'));
const SettingsView = lazy(() => import('./views/SettingsView'));

export function App() {
  const { skin } = useTheme();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  return (
    <div className="flex w-full h-full bg-s3 text-s3-text-primary">
      {/* Sidebar: navigation between Create / Library / Settings */}
      <Sidebar
        collapsed={sidebarCollapsed}
        onToggle={() => setSidebarCollapsed((c) => !c)}
      />

      {/* Main content area + transport */}
      <div className="flex-1 flex flex-col min-w-0">
        <main className="flex-1 overflow-y-auto overflow-x-hidden">
          <Suspense fallback={<LoadingSpinner />}>
            <Routes>
              <Route path="/" element={<CreateView />} />
              <Route path="/library" element={<LibraryView />} />
              <Route path="/settings" element={<SettingsView />} />
            </Routes>
          </Suspense>
        </main>
        <DawTransportBar />
      </div>
    </div>
  );
}
