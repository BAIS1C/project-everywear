/**
 * AppletLoadingSkeleton — Suspense fallback for lazy-loaded applet views.
 *
 * Displays a pulsing skeleton that matches the applet workbench layout,
 * giving visual continuity while the applet chunk downloads and mounts.
 * Uses EWDS tokens only; zero hardcoded colors.
 */

import React from 'react';

export interface AppletLoadingSkeletonProps {
  appletName?: string;
}

export function AppletLoadingSkeleton({ appletName }: AppletLoadingSkeletonProps) {
  return (
    <div className="als-root">
      <div className="als-header">
        <div className="als-header__icon als-pulse" />
        <div className="als-header__text">
          <div className="als-bar als-bar--title als-pulse" />
          <div className="als-bar als-bar--sub als-pulse" />
        </div>
      </div>

      <div className="als-body">
        {/* Sidebar skeleton */}
        <div className="als-sidebar">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="als-sidebar__item als-pulse" />
          ))}
        </div>

        {/* Main content skeleton */}
        <div className="als-main">
          <div className="als-block als-block--lg als-pulse" />
          <div className="als-block als-block--md als-pulse" />
          <div className="als-block als-block--sm als-pulse" />
        </div>
      </div>

      {appletName && (
        <div className="als-label">Loading {appletName}...</div>
      )}
    </div>
  );
}
