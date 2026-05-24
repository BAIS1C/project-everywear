// @ts-nocheck
/**
 * EWDS-styled loading spinner for Suspense boundaries.
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
