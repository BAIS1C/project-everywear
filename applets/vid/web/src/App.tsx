import { Suspense, lazy } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';

const VidView = lazy(() => import('./views/VidView'));

export default function App() {
  return (
    <div className="s3-family-root s3-family-vid h-screen w-screen bg-s3 text-[color:var(--ew-text)] overflow-hidden">
      <Suspense
        fallback={
          <div className="flex items-center justify-center h-full">
            <p className="text-[color:var(--ew-text-muted)] animate-pulse">Loading Vid Studio...</p>
          </div>
        }
      >
        <Routes>
          <Route path="/" element={<VidView />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </div>
  );
}
