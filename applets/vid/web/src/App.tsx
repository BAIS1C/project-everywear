import { Suspense, lazy } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';

const VidView = lazy(() => import('./views/VidView'));

export default function App() {
  return (
    <div className="h-screen w-screen bg-black text-white overflow-hidden">
      <Suspense
        fallback={
          <div className="flex items-center justify-center h-full">
            <p className="text-zinc-500 animate-pulse">Loading Vid Studio...</p>
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
