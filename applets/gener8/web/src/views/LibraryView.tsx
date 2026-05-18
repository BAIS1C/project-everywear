/**
 * LibraryView — Everywear Vault unified media library.
 *
 * Consumes real Tauri vault commands via VaultProvider.
 * Features: media filter tabs, sort dropdown, pagination, stats bar,
 * thumbnail display, and item detail navigation.
 */
import React, { useState, useCallback } from 'react';
import { Music, Image, Film, FileAudio, Star, Search, RefreshCw, ChevronLeft, ChevronRight, ChevronDown, Trash2 } from 'lucide-react';
import { useVault, type VaultMediaFilter, type VaultSortBy } from '../context/VaultProvider';
import type { VaultItem } from '@everywear/transport';
import { VaultDetailPanel } from '../components/VaultDetailPanel';

// ── Tab / Sort definitions ──────────────────────────────────────────

interface TabDef {
  id: VaultMediaFilter;
  label: string;
  icon: React.ReactNode;
}

const TABS: TabDef[] = [
  { id: 'all',       label: 'All',       icon: null },
  { id: 'image',     label: 'Images',    icon: <Image size={13} /> },
  { id: 'audio',     label: 'Audio',     icon: <Music size={13} /> },
  { id: 'video',     label: 'Videos',    icon: <Film size={13} /> },
  { id: 'stem',      label: 'Stems',     icon: <FileAudio size={13} /> },
  { id: 'favorites', label: 'Favorites', icon: <Star size={13} /> },
];

const SORT_OPTIONS: { value: VaultSortBy; label: string }[] = [
  { value: 'newest',   label: 'Newest' },
  { value: 'oldest',   label: 'Oldest' },
  { value: 'title',    label: 'Title' },
  { value: 'size',     label: 'Size' },
  { value: 'duration', label: 'Duration' },
];

const SKIP_DELETE_CONFIRM_KEY = 's3studio:skip_delete_confirm';

// ── Helpers ─────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function formatDate(ts: number): string {
  return new Date(ts * 1000).toLocaleDateString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric',
  });
}

function formatDuration(secs?: number): string {
  if (!secs) return '';
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function mediaIcon(type: string): React.ReactNode {
  switch (type) {
    case 'image': return <Image size={14} />;
    case 'audio': return <Music size={14} />;
    case 'video': return <Film size={14} />;
    default: return <FileAudio size={14} />;
  }
}

// ── Item Row ────────────────────────────────────────────────────────

function VaultItemRow({
  item,
  onClick,
  onDelete,
  getThumbnailUrl,
}: {
  item: VaultItem;
  onClick: () => void;
  onDelete: () => void;
  getThumbnailUrl: (id: string) => string;
}) {
  const [thumbError, setThumbError] = useState(false);
  const showThumb = item.media_type === 'image' || item.media_type === 'video';

  return (
    <div
      className="flex items-center gap-3 px-3 py-2 rounded-md hover:bg-white/5 cursor-pointer transition-colors group"
      onClick={onClick}
    >
      {/* Thumbnail / Icon */}
      <div className="w-10 h-10 rounded overflow-hidden flex-shrink-0 bg-white/5 flex items-center justify-center relative">
        {showThumb && !thumbError ? (
          <>
            <img
              src={getThumbnailUrl(item.id)}
              alt=""
              className="w-full h-full object-cover"
              onError={() => setThumbError(true)}
            />
            {item.media_type === 'video' && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/30">
                <span className="text-xs" style={{ color: 'var(--ew-text)' }}>▶</span>
              </div>
            )}
          </>
        ) : (
          <span className="text-s3-text-muted opacity-40">
            {mediaIcon(item.media_type)}
          </span>
        )}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-s3-text-primary truncate flex items-center gap-1.5">
          {item.favorite && <Star size={10} className="text-amber-400 fill-amber-400 flex-shrink-0" />}
          {item.title}
        </div>
        <div className="text-xs text-s3-text-muted truncate flex items-center gap-2">
          <span className="flex items-center gap-1">{mediaIcon(item.media_type)} {item.media_type}</span>
          {item.applet_id && <span>{item.applet_id}</span>}
        </div>
      </div>

      {/* Tags */}
      <div className="hidden md:flex gap-1">
        {item.tags.slice(0, 2).map((tag) => (
          <span
            key={tag}
            className="text-[9px] uppercase tracking-wider px-2 py-0.5 rounded bg-white/5 text-s3-text-muted"
          >
            {tag}
          </span>
        ))}
      </div>

      {/* Duration (audio/video) */}
      {item.duration_seconds != null && (
        <span className="text-xs text-s3-text-muted tabular-nums w-12 text-right">
          {formatDuration(item.duration_seconds)}
        </span>
      )}

      {/* Size */}
      <span className="text-xs text-s3-text-muted tabular-nums w-16 text-right hidden lg:block">
        {formatBytes(item.file_size_bytes)}
      </span>

      {/* Date */}
      <span className="text-xs text-s3-text-muted w-20 text-right hidden lg:block">
        {formatDate(item.created_at)}
      </span>

      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onDelete();
        }}
        className="p-1.5 rounded opacity-0 group-hover:opacity-100 focus:opacity-100 hover:bg-white/5 transition"
        title="Delete item"
        aria-label={`Delete ${item.title}`}
        style={{ color: 'var(--ew-status-red)' }}
      >
        <Trash2 size={14} />
      </button>
    </div>
  );
}

function DeleteConfirmDialog({
  itemTitle,
  onCancel,
  onConfirm,
}: {
  itemTitle: string;
  onCancel: () => void;
  onConfirm: (skipFutureConfirm: boolean) => void;
}) {
  const [skipFutureConfirm, setSkipFutureConfirm] = useState(false);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
      <div
        className="w-full max-w-sm rounded-lg p-5"
        style={{
          background: 'var(--ew-surface, var(--ew-bg))',
          border: '1px solid var(--ew-border)',
        }}
      >
        <h3 className="text-base font-semibold mb-2" style={{ color: 'var(--ew-text)' }}>
          Delete item?
        </h3>
        <p className="text-sm mb-4" style={{ color: 'var(--ew-text-muted)' }}>
          "{itemTitle}" will be removed from the vault. This cannot be undone.
        </p>
        <label className="flex items-center gap-2 text-xs mb-5" style={{ color: 'var(--ew-text-muted)' }}>
          <input
            type="checkbox"
            checked={skipFutureConfirm}
            onChange={(event) => setSkipFutureConfirm(event.target.checked)}
          />
          Do not ask again
        </label>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 text-xs font-semibold rounded"
            style={{
              background: 'transparent',
              border: '1px solid var(--ew-border)',
              color: 'var(--ew-text-muted)',
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onConfirm(skipFutureConfirm)}
            className="px-4 py-2 text-xs font-semibold rounded"
            style={{
              background: 'var(--ew-status-red)',
              color: 'var(--ew-bg)',
              border: 'none',
            }}
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Stats Bar ───────────────────────────────────────────────────────

function StatsBar() {
  const { stats } = useVault();
  if (!stats) return null;

  return (
    <div className="flex items-center gap-3 text-[10px] text-s3-text-muted px-6 py-2 border-b border-white/5">
      <span>{stats.total_items} items</span>
      <span className="opacity-40">|</span>
      <span>{stats.images} images</span>
      <span className="opacity-40">|</span>
      <span>{stats.audio} audio</span>
      <span className="opacity-40">|</span>
      <span>{stats.videos} videos</span>
      {stats.stems > 0 && (
        <>
          <span className="opacity-40">|</span>
          <span>{stats.stems} stems</span>
        </>
      )}
      <span className="opacity-40">|</span>
      <span>{formatBytes(stats.total_size_bytes)}</span>
    </div>
  );
}

// ── Sort Dropdown ───────────────────────────────────────────────────

function SortDropdown({ value, onChange }: { value: VaultSortBy; onChange: (v: VaultSortBy) => void }) {
  const [open, setOpen] = useState(false);
  const current = SORT_OPTIONS.find((o) => o.value === value);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1 text-xs text-s3-text-muted hover:text-s3-text-primary px-2 py-1.5 rounded hover:bg-white/5 transition-colors"
      >
        {current?.label || 'Sort'}
        <ChevronDown size={12} />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-20 rounded-md border border-white/10 bg-black/90 py-1 min-w-[120px]">
          {SORT_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => { onChange(opt.value); setOpen(false); }}
              className={`w-full text-left px-3 py-1.5 text-xs transition-colors ${
                opt.value === value ? 'text-s3-text-primary bg-white/5' : 'text-s3-text-muted hover:bg-white/5'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main Component ──────────────────────────────────────────────────

export default function LibraryView() {
  const vault = useVault();
  const [deleteTarget, setDeleteTarget] = useState<VaultItem | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const totalPages = Math.max(1, Math.ceil(vault.total / vault.pageSize));
  const showingFrom = vault.total > 0 ? vault.page * vault.pageSize + 1 : 0;
  const showingTo = Math.min((vault.page + 1) * vault.pageSize, vault.total);

  const handleItemClick = useCallback((item: VaultItem) => {
    vault.setSelectedItem(item);
  }, [vault]);

  const deleteItem = useCallback(async (item: VaultItem) => {
    try {
      await vault.removeItem(item.id);
      setDeleteError(null);
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Delete failed');
    }
  }, [vault]);

  const requestDeleteItem = useCallback((item: VaultItem) => {
    try {
      if (localStorage.getItem(SKIP_DELETE_CONFIRM_KEY) === '1') {
        void deleteItem(item);
        return;
      }
    } catch {}
    setDeleteTarget(item);
  }, [deleteItem]);

  const confirmDeleteItem = useCallback((skipFutureConfirm: boolean) => {
    if (!deleteTarget) return;
    if (skipFutureConfirm) {
      try { localStorage.setItem(SKIP_DELETE_CONFIRM_KEY, '1'); } catch {}
    }
    const item = deleteTarget;
    setDeleteTarget(null);
    void deleteItem(item);
  }, [deleteItem, deleteTarget]);

  // Detail panel takes over when an item is selected
  if (vault.selectedItem) {
    return (
      <VaultDetailPanel
        item={vault.selectedItem}
        onBack={() => vault.setSelectedItem(null)}
      />
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Stats bar */}
      <StatsBar />

      {/* Toolbar */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-white/5">
        <div className="flex items-center gap-3">
          <h1 className="font-display text-xl tracking-wide text-s3-text-primary">
            Everywear Vault
          </h1>
          <button
            onClick={() => void vault.refetch()}
            className="p-1.5 rounded hover:bg-white/5 transition-colors text-s3-text-muted"
            title="Refresh vault"
          >
            <RefreshCw size={14} className={vault.isLoading ? 'animate-spin' : ''} />
          </button>
        </div>

        <div className="flex items-center gap-3">
          {/* Search */}
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-s3-text-muted" />
            <input
              type="text"
              className="ew-input pl-8 text-sm w-48"
              placeholder="Search vault..."
              value={vault.searchQuery}
              onChange={(e) => vault.setSearchQuery(e.target.value)}
            />
          </div>
          {/* Sort */}
          <SortDropdown value={vault.sortBy} onChange={vault.setSortBy} />
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 px-6 pt-3 pb-1">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => vault.setFilter(tab.id)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-colors ${
              vault.filter === tab.id
                ? 'bg-white/10 text-s3-text-primary'
                : 'text-s3-text-muted hover:text-s3-text-primary hover:bg-white/5'
            }`}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        {vault.isLoading && !vault.hasLoaded ? (
          /* Initial load skeleton */
          <div className="flex flex-col gap-2 animate-pulse">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 px-3 py-2">
                <div className="w-10 h-10 rounded bg-white/5" />
                <div className="flex-1">
                  <div className="h-3 w-32 bg-white/5 rounded mb-1.5" />
                  <div className="h-2 w-20 bg-white/5 rounded" />
                </div>
                <div className="h-3 w-10 bg-white/5 rounded" />
              </div>
            ))}
          </div>
        ) : vault.items.length === 0 ? (
          /* Empty state */
          <div className="flex flex-col items-center justify-center h-full gap-4 text-center">
            <Music size={48} className="text-s3-text-muted opacity-30" />
            <div>
              <h2 className="text-lg font-semibold text-s3-text-primary mb-1">
                {vault.searchQuery ? 'No results' : 'Your vault is empty'}
              </h2>
              <p className="text-sm text-s3-text-muted max-w-xs">
                {vault.searchQuery
                  ? `No items match "${vault.searchQuery}". Try a different search.`
                  : 'Generate content in any Everywear applet and save it to the vault. Images, audio, and videos will all appear here.'}
              </p>
            </div>
          </div>
        ) : (
          <div className="flex flex-col">
            {vault.items.map((item) => (
              <VaultItemRow
                key={item.id}
                item={item}
                onClick={() => handleItemClick(item)}
                onDelete={() => requestDeleteItem(item)}
                getThumbnailUrl={vault.getThumbnailUrl}
              />
            ))}
          </div>
        )}
        {deleteError && (
          <div
            className="mt-3 text-xs p-2 rounded"
            style={{
              background: 'color-mix(in oklab, var(--ew-status-red) 10%, transparent)',
              color: 'var(--ew-status-red)',
            }}
          >
            {deleteError}
          </div>
        )}
      </div>

      {/* Pagination footer */}
      {vault.total > vault.pageSize && (
        <div className="flex items-center justify-between px-6 py-3 border-t border-white/5">
          <span className="text-xs text-s3-text-muted">
            Showing {showingFrom}-{showingTo} of {vault.total}
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => vault.setPage(vault.page - 1)}
              disabled={vault.page === 0}
              className="p-1.5 rounded hover:bg-white/5 text-s3-text-muted disabled:opacity-30 transition-colors"
            >
              <ChevronLeft size={14} />
            </button>
            <span className="text-xs text-s3-text-muted tabular-nums px-2">
              {vault.page + 1} / {totalPages}
            </span>
            <button
              onClick={() => vault.setPage(vault.page + 1)}
              disabled={vault.page >= totalPages - 1}
              className="p-1.5 rounded hover:bg-white/5 text-s3-text-muted disabled:opacity-30 transition-colors"
            >
              <ChevronRight size={14} />
            </button>
          </div>
        </div>
      )}

      {deleteTarget && (
        <DeleteConfirmDialog
          itemTitle={deleteTarget.title}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={confirmDeleteItem}
        />
      )}
    </div>
  );
}
