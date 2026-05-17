/**
 * LibraryView — generated music library.
 *
 * Ported from S3 Studio's SongList + RightSidebar pattern.
 * Phase 3.3: structural stub. Full library CRUD wires in Phase 4.
 */
import React from 'react';
import { Music, Search } from 'lucide-react';

export default function LibraryView() {
  return (
    <div className="flex flex-col h-full p-6 gap-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl tracking-wide text-s3-text-primary">
          Library
        </h1>
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-s3-text-muted" />
          <input
            type="text"
            className="ew-input pl-8 text-sm"
            placeholder="Search generations..."
          />
        </div>
      </div>

      {/* Empty state */}
      <div className="ew-empty">
        <Music size={48} className="text-s3-text-muted opacity-40" />
        <h2 className="ew-empty__title">No generations yet</h2>
        <p className="ew-empty__body">
          Create your first track and it will appear here.
        </p>
        <div className="ew-empty__actions">
          <a href="/" className="ew-btn ew-btn--primary ew-btn--sm">
            Start Creating
          </a>
        </div>
      </div>
    </div>
  );
}
