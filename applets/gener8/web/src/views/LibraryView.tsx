/**
 * LibraryView — Everywear Vault unified media library.
 *
 * Consumes real Tauri vault commands via VaultProvider.
 * Features: media filter tabs, sort dropdown, pagination, stats bar,
 * thumbnail display, and item detail navigation.
 */
import React, { useState, useCallback, useMemo } from 'react';
import { Music, Image, Film, FileAudio, Star, Search, RefreshCw, ChevronLeft, ChevronRight, ChevronDown, Trash2 } from 'lucide-react';
import { useVault, type VaultMediaFilter, type VaultSortBy } from '../context/VaultProvider';
import { vaultFileUrl, type VaultItem } from '@everywear/transport';
import { VaultDetailPanel } from '../components/VaultDetailPanel';
import { useShellAudio } from '../shell/ShellAudioPlayer';
import type { Song } from '../types';

// ── Tab / Sort definitions ──────────────────────────────────────────

interface TabDef {
  id: VaultMediaFilter;
  label: string;
  icon: React.ReactNode;
}

const TABS: TabDef[] = [
  { id: 'all',          label: 'All',           icon: null },
  { id: 'gener8_song',  label: 'Gener8 Songs',  icon: <Music size={13} /> },
  { id: 'stem',         label: 'Stems',         icon: <FileAudio size={13} /> },
  { id: 'riff',         label: 'Riffs',         icon: <FileAudio size={13} /> },
  { id: 'sample',       label: 'Samples',       icon: <FileAudio size={13} /> },
  { id: 'reference',    label: 'References',    icon: <FileAudio size={13} /> },
  { id: 'cover_source', label: 'Cover Sources', icon: <FileAudio size={13} /> },
  { id: 'local_audio',  label: 'Local Audio',   icon: <FileAudio size={13} /> },
  { id: 'image',        label: 'Images',        icon: <Image size={13} /> },
  { id: 'video',        label: 'Videos',        icon: <Film size={13} /> },
  { id: 'favorites',    label: 'Favorites',     icon: <Star size={13} /> },
];

const SORT_OPTIONS: { value: VaultSortBy; label: string }[] = [
  { value: 'newest',   label: 'Newest' },
  { value: 'oldest',   label: 'Oldest' },
  { value: 'title',    label: 'Title' },
  { value: 'size',     label: 'Size' },
  { value: 'duration', label: 'Duration' },
];

const SKIP_DELETE_CONFIRM_KEY = 's3studio:skip_delete_confirm';

const subtlePanel = 'color-mix(in oklab, var(--ew-text) 4%, var(--ew-surface, var(--ew-bg)))';
const subtlePanelHover = 'color-mix(in oklab, var(--ew-text) 7%, var(--ew-surface, var(--ew-bg)))';
const selectedPanel = 'color-mix(in oklab, var(--ew-primary) 14%, var(--ew-surface, var(--ew-bg)))';
const subtleBorder = 'color-mix(in oklab, var(--ew-text) 10%, transparent)';

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

function itemKindLabel(item: VaultItem): string {
  switch (item.asset_kind) {
    case 'gener8_song': return 'Gener8 song';
    case 'stem': return item.stem_type ? `Stem: ${item.stem_type}` : 'Stem';
    case 'riff': return 'Riff';
    case 'sample': return 'Sample';
    case 'reference': return 'Reference';
    case 'cover_source': return 'Cover source';
    case 'cover_output': return 'Cover output';
    case 'local_audio': return 'Local audio';
    default: return item.media_type;
  }
}

function fileStem(filePath?: string): string | undefined {
  const name = (filePath || '').replace(/\\/g, '/').split('/').pop();
  if (!name) return undefined;
  return name.replace(/\.[^.]+$/, '');
}

function looksSyntheticTitle(title?: string): boolean {
  const value = (title || '').trim();
  if (!value) return true;
  return /^(untitled|gener8 output|legacy gener8 audio)$/i.test(value)
    || /^track_\d+$/i.test(value)
    || /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(value);
}

function displayItemTitle(item: VaultItem): string {
  if (!looksSyntheticTitle(item.title)) return item.title;
  return fileStem(item.file_path) || item.title || 'Untitled';
}

function safeNumber(value: unknown, fallback = 0): number {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : fallback;
}

function normalizeVaultItem(item: VaultItem): VaultItem {
  const mediaType = item.media_type === 'image' || item.media_type === 'video' || item.media_type === 'audio'
    ? item.media_type
    : 'audio';
  const filePath = typeof item.file_path === 'string' ? item.file_path : '';
  const fallbackTitle = fileStem(filePath) || 'Untitled';
  const title = typeof item.title === 'string' && item.title.trim() ? item.title : fallbackTitle;
  const generationParams = item.generation_params && typeof item.generation_params === 'object' && !Array.isArray(item.generation_params)
    ? item.generation_params
    : {};

  return {
    ...item,
    media_type: mediaType,
    id: typeof item.id === 'string' && item.id.trim() ? item.id : `${mediaType}:${filePath || title}`,
    applet_id: typeof item.applet_id === 'string' ? item.applet_id : '',
    title,
    tags: Array.isArray(item.tags) ? item.tags.filter((tag) => typeof tag === 'string') : [],
    created_at: safeNumber(item.created_at),
    updated_at: safeNumber(item.updated_at),
    file_path: filePath,
    file_size_bytes: safeNumber(item.file_size_bytes),
    mime_type: typeof item.mime_type === 'string' ? item.mime_type : '',
    favorite: Boolean(item.favorite),
    asset_kind: item.asset_kind,
    duration_seconds: safeNumber(item.duration_seconds),
    generation_params: generationParams,
  };
}

function normalizedPathValue(value?: string): string {
  return (value || '').replace(/\\/g, '/').toLowerCase();
}

function dedupeVaultItemKey(item: VaultItem): string {
  const sha = item.sha256?.trim();
  if (sha) return `sha:${sha}`;
  return [
    'fallback',
    item.media_type,
    item.asset_kind || '',
    displayItemTitle(item).trim().toLowerCase(),
    String(item.file_size_bytes || 0),
  ].join(':');
}

function vaultPathScore(item: VaultItem): number {
  const pathValue = `${normalizedPathValue(item.file_path)} ${normalizedPathValue(item.vault_path)}`;
  const idPrefix = item.id.slice(0, 8).toLowerCase();
  let score = 0;

  if (idPrefix && pathValue.includes(idPrefix)) score += 100;
  if (item.vault_path && item.file_path === item.vault_path) score += 10;
  if (item.storage_mode === 'vault_copy' || item.storage_mode === 'vault_move') score += 8;
  if (item.lyrics_text) score += 6;
  if (item.genre && item.genre !== 'Gener8') score += 3;
  score += Math.min(pathValue.length / 80, 8);

  return score;
}

function preferVaultItem(current: VaultItem, candidate: VaultItem): VaultItem {
  const currentScore = vaultPathScore(current);
  const candidateScore = vaultPathScore(candidate);
  if (candidateScore !== currentScore) return candidateScore > currentScore ? candidate : current;
  return candidate.updated_at > current.updated_at ? candidate : current;
}

function dedupeVaultItems(items: VaultItem[]): VaultItem[] {
  const bestByKey = new Map<string, VaultItem>();
  const order: string[] = [];

  items.forEach((item) => {
    const key = dedupeVaultItemKey(item);
    const current = bestByKey.get(key);
    if (!current) {
      bestByKey.set(key, item);
      order.push(key);
      return;
    }
    bestByKey.set(key, preferVaultItem(current, item));
  });

  return order.map((key) => bestByKey.get(key)).filter((item): item is VaultItem => Boolean(item));
}

function isPlayableAudioItem(item: VaultItem): boolean {
  return item.media_type === 'audio' && Boolean(item.file_path);
}

function vaultItemToSong(item: VaultItem): Song {
  const durationSeconds = Number(item.duration_seconds ?? 0);
  const audioUrl = vaultFileUrl(item.file_path);
  return {
    id: item.id,
    title: displayItemTitle(item),
    lyrics: item.lyrics_text ?? '',
    style: item.genre ?? '',
    coverUrl: `https://picsum.photos/seed/${item.id}/400/400`,
    duration: durationSeconds > 0
      ? `${Math.floor(durationSeconds / 60)}:${String(Math.floor(durationSeconds % 60)).padStart(2, '0')}`
      : undefined,
    createdAt: new Date(item.created_at * 1000),
    created_at: new Date(item.created_at * 1000).toISOString(),
    tags: item.tags ?? [],
    audioUrl,
    audio_url: audioUrl,
    bpm: item.bpm,
    generation_params: item.generation_params,
    lrc_data: item.lyrics_text ?? null,
  };
}

// ── Item Row ────────────────────────────────────────────────────────

function VaultItemRow({
  item,
  onClick,
  onDelete,
  getThumbnailUrl,
  isActive = false,
  isPlaying = false,
  isPlayable = false,
  variant = 'row',
}: {
  item: VaultItem;
  onClick: () => void;
  onDelete: () => void;
  getThumbnailUrl: (id: string) => string;
  isActive?: boolean;
  isPlaying?: boolean;
  isPlayable?: boolean;
  variant?: 'row' | 'gallery';
}) {
  const [thumbError, setThumbError] = useState(false);
  const showThumb = item.media_type === 'image' || item.media_type === 'video';
  const title = displayItemTitle(item);
  const isGallery = variant === 'gallery';
  const tags = item.tags;
  const rowBackground = isActive ? selectedPanel : subtlePanel;

  return (
    <div
      className={
        isGallery
          ? 'flex flex-col gap-3 rounded-lg border p-3 cursor-pointer transition-colors group'
          : 'flex items-center gap-3 px-3 py-2 rounded-md cursor-pointer transition-colors group'
      }
      style={{
        background: rowBackground,
        borderColor: isGallery ? subtleBorder : 'transparent',
        color: 'var(--ew-text)',
      }}
      onMouseEnter={(event) => {
        if (!isActive) event.currentTarget.style.background = subtlePanelHover;
      }}
      onMouseLeave={(event) => {
        event.currentTarget.style.background = rowBackground;
      }}
      onClick={onClick}
    >
      {/* Thumbnail / Icon */}
      <div
        className={
          isGallery
            ? 'w-full aspect-video rounded-md overflow-hidden flex-shrink-0 flex items-center justify-center relative'
            : 'w-10 h-10 rounded overflow-hidden flex-shrink-0 flex items-center justify-center relative'
        }
        style={{ background: 'color-mix(in oklab, var(--ew-text) 7%, transparent)' }}
      >
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
          <span className="opacity-70" style={{ color: 'var(--ew-text-muted)' }}>
            {isPlayable && isActive && isPlaying
              ? <Music size={14} style={{ color: 'var(--ew-accent, var(--ew-text))' }} />
              : mediaIcon(item.media_type)}
          </span>
        )}
      </div>

      {/* Info */}
      <div className={isGallery ? 'w-full min-w-0' : 'flex-1 min-w-0'}>
        <div className="text-sm font-medium truncate flex items-center gap-1.5" style={{ color: 'var(--ew-text)' }}>
          {item.favorite && <Star size={10} className="text-amber-400 fill-amber-400 flex-shrink-0" />}
          {title}
        </div>
        <div className="text-xs truncate flex items-center gap-2" style={{ color: 'var(--ew-text-muted)' }}>
          <span className="flex items-center gap-1">{mediaIcon(item.media_type)} {itemKindLabel(item)}</span>
          {item.applet_id && <span>{item.applet_id}</span>}
          {isPlayable && isActive && (
            <span style={{ color: 'var(--ew-accent, var(--ew-text))' }}>{isPlaying ? 'Playing' : 'Paused'}</span>
          )}
        </div>
      </div>

      {/* Tags */}
      <div className={isGallery ? 'flex flex-wrap gap-1' : 'hidden md:flex gap-1'}>
        {tags.slice(0, 2).map((tag) => (
          <span
            key={tag}
            className="text-[9px] uppercase tracking-wider px-2 py-0.5 rounded"
            style={{
              background: 'color-mix(in oklab, var(--ew-text) 6%, transparent)',
              color: 'var(--ew-text-muted)',
            }}
          >
            {tag}
          </span>
        ))}
      </div>

      {/* Duration (audio/video) */}
      {item.duration_seconds != null && !isGallery && (
        <span className="text-xs tabular-nums w-12 text-right" style={{ color: 'var(--ew-text-muted)' }}>
          {formatDuration(item.duration_seconds)}
        </span>
      )}

      {/* Size */}
      <span
        className={isGallery ? 'text-xs tabular-nums' : 'text-xs tabular-nums w-16 text-right hidden lg:block'}
        style={{ color: 'var(--ew-text-muted)' }}
      >
        {formatBytes(item.file_size_bytes)}
      </span>

      {/* Date */}
      <span
        className={isGallery ? 'text-xs' : 'text-xs w-20 text-right hidden lg:block'}
        style={{ color: 'var(--ew-text-muted)' }}
      >
        {formatDate(item.created_at)}
      </span>

      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onDelete();
        }}
        className="p-1.5 rounded opacity-0 group-hover:opacity-100 focus:opacity-100 transition"
        title="Delete item"
        aria-label={`Delete ${title}`}
        style={{
          color: 'var(--ew-status-red)',
          background: 'color-mix(in oklab, var(--ew-status-red) 5%, transparent)',
        }}
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
    <div
      className="flex items-center gap-3 text-[10px] px-6 py-2 border-b"
      style={{ color: 'var(--ew-text-muted)', borderColor: 'var(--ew-border)' }}
    >
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
        className="flex items-center gap-1 text-xs px-2 py-1.5 rounded transition-colors"
        style={{ color: 'var(--ew-text-muted)' }}
      >
        {current?.label || 'Sort'}
        <ChevronDown size={12} />
      </button>
      {open && (
        <div
          className="absolute right-0 top-full mt-1 z-20 rounded-md border py-1 min-w-[120px]"
          style={{
            background: 'var(--ew-surface-overlay, var(--ew-surface, var(--ew-bg)))',
            borderColor: 'var(--ew-border)',
          }}
        >
          {SORT_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => { onChange(opt.value); setOpen(false); }}
              className="w-full text-left px-3 py-1.5 text-xs transition-colors"
              style={{
                color: opt.value === value ? 'var(--ew-text)' : 'var(--ew-text-muted)',
                background: opt.value === value ? selectedPanel : 'transparent',
              }}
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
  const audio = useShellAudio();
  const [deleteTarget, setDeleteTarget] = useState<VaultItem | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const items = useMemo(() => dedupeVaultItems(vault.items.map(normalizeVaultItem)), [vault.items]);
  const selectedItem = vault.selectedItem ? normalizeVaultItem(vault.selectedItem) : null;

  const totalPages = Math.max(1, Math.ceil(vault.total / vault.pageSize));
  const showingFrom = vault.total > 0 ? vault.page * vault.pageSize + 1 : 0;
  const showingTo = Math.min((vault.page + 1) * vault.pageSize, vault.total);
  const isVideoGallery = vault.filter === 'video';

  const handleItemClick = useCallback((item: VaultItem) => {
    if (isPlayableAudioItem(item)) {
      const queue = items
        .filter(isPlayableAudioItem)
        .map(vaultItemToSong);
      const song = queue.find((entry) => entry.id === item.id) ?? vaultItemToSong(item);
      audio.playSong(song, queue.length > 0 ? queue : [song]);
      return;
    }
    vault.setSelectedItem(item);
  }, [audio, items, vault]);

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
  if (selectedItem) {
    return (
      <VaultDetailPanel
        item={selectedItem}
        onBack={() => vault.setSelectedItem(null)}
      />
    );
  }

  return (
    <div className="flex flex-col h-full" style={{ background: 'var(--ew-bg)', color: 'var(--ew-text)' }}>
      {/* Stats bar */}
      <StatsBar />

      {/* Toolbar */}
      <div
        className="flex items-center justify-between px-6 py-3 border-b"
        style={{ borderColor: 'var(--ew-border)' }}
      >
        <div className="flex items-center gap-3">
          <h1 className="font-display text-xl tracking-wide" style={{ color: 'var(--ew-text)' }}>
            Everywear Vault
          </h1>
          <button
            onClick={() => void vault.refetch()}
            className="p-1.5 rounded transition-colors"
            title="Refresh vault"
            style={{
              color: 'var(--ew-text-muted)',
              background: 'color-mix(in oklab, var(--ew-text) 4%, transparent)',
            }}
          >
            <RefreshCw size={14} className={vault.isLoading ? 'animate-spin' : ''} />
          </button>
        </div>

        <div className="flex items-center gap-3">
          {/* Search */}
          <div className="relative">
            <Search
              size={14}
              className="absolute left-3 top-1/2 -translate-y-1/2"
              style={{ color: 'var(--ew-text-muted)' }}
            />
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
      <div className="flex flex-wrap gap-1 px-6 pt-3 pb-1">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => vault.setFilter(tab.id)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-colors"
            style={{
              background: vault.filter === tab.id ? selectedPanel : subtlePanel,
              color: vault.filter === tab.id ? 'var(--ew-text)' : 'var(--ew-text-muted)',
            }}
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
                <div className="w-10 h-10 rounded" style={{ background: subtlePanel }} />
                <div className="flex-1">
                  <div className="h-3 w-32 rounded mb-1.5" style={{ background: subtlePanel }} />
                  <div className="h-2 w-20 rounded" style={{ background: subtlePanel }} />
                </div>
                <div className="h-3 w-10 rounded" style={{ background: subtlePanel }} />
              </div>
            ))}
          </div>
        ) : items.length === 0 ? (
          /* Empty state */
          <div className="flex flex-col items-center justify-center h-full gap-4 text-center">
            <Music size={48} className="opacity-30" style={{ color: 'var(--ew-text-muted)' }} />
            <div>
              <h2 className="text-lg font-semibold mb-1" style={{ color: 'var(--ew-text)' }}>
                {vault.searchQuery ? 'No results' : 'Your vault is empty'}
              </h2>
              <p className="text-sm max-w-xs" style={{ color: 'var(--ew-text-muted)' }}>
                {vault.searchQuery
                  ? `No items match "${vault.searchQuery}". Try a different search.`
                  : 'Generate content in any Everywear applet and save it to the vault. Images, audio, and videos will all appear here.'}
              </p>
            </div>
          </div>
        ) : (
          <div className={isVideoGallery ? 'grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4' : 'flex flex-col'}>
            {items.map((item) => (
              <VaultItemRow
                key={item.id}
                item={item}
                variant={isVideoGallery ? 'gallery' : 'row'}
                onClick={() => handleItemClick(item)}
                onDelete={() => requestDeleteItem(item)}
                getThumbnailUrl={vault.getThumbnailUrl}
                isActive={audio.currentSong?.id === item.id}
                isPlaying={audio.currentSong?.id === item.id && audio.isPlaying}
                isPlayable={isPlayableAudioItem(item)}
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
        <div
          className="flex items-center justify-between px-6 py-3 border-t"
          style={{ borderColor: 'var(--ew-border)' }}
        >
          <span className="text-xs" style={{ color: 'var(--ew-text-muted)' }}>
            Showing {showingFrom}-{showingTo} of {vault.total}
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => vault.setPage(vault.page - 1)}
              disabled={vault.page === 0}
              className="p-1.5 rounded disabled:opacity-30 transition-colors"
              style={{ color: 'var(--ew-text-muted)', background: subtlePanel }}
            >
              <ChevronLeft size={14} />
            </button>
            <span className="text-xs tabular-nums px-2" style={{ color: 'var(--ew-text-muted)' }}>
              {vault.page + 1} / {totalPages}
            </span>
            <button
              onClick={() => vault.setPage(vault.page + 1)}
              disabled={vault.page >= totalPages - 1}
              className="p-1.5 rounded disabled:opacity-30 transition-colors"
              style={{ color: 'var(--ew-text-muted)', background: subtlePanel }}
            >
              <ChevronRight size={14} />
            </button>
          </div>
        </div>
      )}

      {deleteTarget && (
        <DeleteConfirmDialog
          itemTitle={displayItemTitle(deleteTarget)}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={confirmDeleteItem}
        />
      )}
    </div>
  );
}
