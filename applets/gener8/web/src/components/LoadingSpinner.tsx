/**
 * EWDS-styled loading spinner for Suspense boundaries.
 *
 * Migrated out of @ts-nocheck on 2026-05-27 (seed file for Track C
 * Gener8 web type-bridge migration). This component has no typed
 * surface; the pragma was a blanket port artefact, not a real shield.
 */
import React from 'react';

export function LoadingSpinner() {
  return (
    <div className="flex items-center justify-center w-full h-full min-h-[200px]">
      <div className="ew-progress w-48">
        <div className="ew-progress-bar ew-progress--indeterminate" style={{ width: '40%' }} />
      </div>
    </div>
  );
}
