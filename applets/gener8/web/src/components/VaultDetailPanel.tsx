// @ts-nocheck
/**
 * VaultDetailPanel — detail view for a single vault item.
 *
 * Features:
 *   - Image/video/audio preview via convertFileSrc
 *   - Favorite toggle (star icon)
 *   - Delete with confirmation modal
 *   - Editable tags (remove + add)
 *   - Generation info per media type
 *   - Download / Open Folder actions
 *
 * CODEX_NEEDED: Vault file path in asset protocol scope
 * Same as vault.ts — convertFileSrc needs vault dirs in Tauri scope
 */
import React, { useState, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { ArrowLeft, Star, Trash2, X, Plus, Download, FolderOpen, Music, Film, Image } from 'lucide-react';
import { useVault } from '../context/VaultProvider';
import type { VaultItem } from '@everywear/transport';

// ── Confirmation Modal ──────────────────────────────────────────────

function ConfirmDeleteModal({
  itemTitle,
  onConfirm,
  onCancel,
}: {
  itemTitle: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div
        className="rounded-lg p-6 max-w-sm w-full mx-4"
        style={{
          background: 'var(--ew-surface, var(--ew-bg))',
          border: '1px solid var(--ew-border)',
        }}
      >
        <h3
          className="text-base font-semibold mb-2"
          style={{ color: 'var(--ew-text)' }}
        >
          Delete permanently?
        </h3>
        <p
          className="text-sm mb-6"
          style={{ color: 'var(--ew-text-muted)' }}
        >
          "{itemTitle}" will be removed from the vault and deleted from disk. This cannot be undone.
        </p>
        <div className="flex gap-3 justify-end">
          <button
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
            onClick={onConfirm}
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

// ── Tag Editor ──────────────────────────────────────────────────────

function TagEditor({
  tags,
  onUpdate,
}: {
  tags: string[];
  onUpdate: (tags: string[]) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [newTag, setNewTag] = useState('');

  const handleRemove = (tag: string) => {
    onUpdate(tags.filter((t) => t !== tag));
  };

  const handleAdd = () => {
    const trimmed = newTag.trim().toLowerCase();
    if (trimmed && !tags.includes(trimmed)) {
      onUpdate([...tags, trimmed]);
    }
    setNewTag('');
    setAdding(false);
  };

  return (
    <div className="flex flex-wrap gap-1.5 items-center">
      {tags.map((tag) => (
        <span
          key={tag}
          className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider px-2 py-0.5 rounded"
          style={{
            background: 'color-mix(in oklab, var(--ew-text) 5%, transparent)',
            color: 'var(--ew-text-muted)',
          }}
        >
          {tag}
          <button
            onClick={() => handleRemove(tag)}
            className="opacity-60 hover:opacity-100"
            style={{ color: 'var(--ew-text-muted)' }}
          >
            <X size={8} />
          </button>
        </span>
      ))}
      {adding ? (
        <input
          type="text"
          className="text-[10px] px-2 py-0.5 rounded w-20 outline-none"
          style={{
            background: 'color-mix(in oklab, var(--ew-text) 5%, transparent)',
            color: 'var(--ew-text)',
            border: '1px solid var(--ew-border)',
          }}
          value={newTag}
          onChange={(e) => setNewTag(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleAdd();
            if (e.key === 'Escape') { setAdding(false); setNewTag(''); }
          }}
          onBlur={handleAdd}
          autoFocus
        />
      ) : (
        <button
          onClick={() => setAdding(true)}
          className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded opacity-60 hover:opacity-100 transition-opacity"
          style={{ color: 'var(--ew-primary)' }}
        >
          <Plus size={10} /> Add
        </button>
      )}
    </div>
  );
}

// ── Info Row ────────────────────────────────────────────────────────

function InfoRow({ label, value }: { label: string; value?: string | number | null }) {
  if (value == null || value === '') return null;
  return (
    <div className="flex justify-between py-1">
      <span className="text-xs" style={{ color: 'var(--ew-text-muted)' }}>{label}</span>
      <span className="text-xs font-medium" style={{ color: 'var(--ew-text)' }}>{value}</span>
    </div>
  );
}

// ── Helpers ─────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function formatDate(ts: number): string {
  return new Date(ts * 1000).toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function formatDuration(secs?: number): string | null {
  if (!secs) return null;
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
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

// ── Main Component ──────────────────────────────────────────────────

export function VaultDetailPanel({ item, onBack }: { item: VaultItem; onBack: () => void }) {
  const vault = useVault();
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [thumbError, setThumbError] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const fileUrl = vault.getFileUrl(item.file_path);
  const thumbnailUrl = vault.getThumbnailUrl(item.id);
  const title = displayItemTitle(item);

  const handleFavorite = useCallback(async () => {
    try {
      await vault.toggleFavorite(item.id, item.favorite);
    } catch {
      // Silently handle
    }
  }, [vault, item.id, item.favorite]);

  const handleDelete = useCallback(async () => {
    try {
      await vault.removeItem(item.id);
      setShowDeleteConfirm(false);
      onBack();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Delete failed');
      setShowDeleteConfirm(false);
    }
  }, [vault, item.id, onBack]);

  const handleDownload = useCallback(async () => {
    setActionError(null);
    try {
      await invoke('vault_open_item_file', { id: item.id });
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err || 'Download failed'));
    }
  }, [item.id]);

  const handleOpenFolder = useCallback(async () => {
    setActionError(null);
    try {
      await invoke('vault_open_item_folder', { id: item.id });
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err || 'Open folder failed'));
    }
  }, [item.id]);

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      {/* Header */}
      <div
        className="flex items-center justify-between px-6 py-3 border-b flex-shrink-0"
        style={{ borderColor: 'var(--ew-border)' }}
      >
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 text-xs font-medium transition-colors"
          style={{ color: 'var(--ew-text-muted)' }}
        >
          <ArrowLeft size={14} />
          Back to Library
        </button>
        <div className="flex items-center gap-2">
          <button
            onClick={handleFavorite}
            className="p-1.5 rounded transition-colors hover:bg-white/5"
            title={item.favorite ? 'Remove from favorites' : 'Add to favorites'}
          >
            <Star
              size={16}
              className={item.favorite ? 'fill-current' : ''}
              style={{ color: item.favorite ? 'var(--ew-status-amber)' : 'var(--ew-text-muted)' }}
            />
          </button>
          <button
            onClick={() => setShowDeleteConfirm(true)}
            className="p-1.5 rounded transition-colors hover:bg-white/5"
            title="Delete item"
            style={{ color: 'var(--ew-status-red)' }}
          >
            <Trash2 size={16} />
          </button>
        </div>
      </div>

      {/* Preview */}
      <div
        className="flex items-center justify-center p-6 min-h-[240px] flex-shrink-0"
        style={{ background: 'color-mix(in oklab, var(--ew-text) 2%, var(--ew-bg))' }}
      >
        {item.media_type === 'image' && (
          !thumbError ? (
            <img
              src={fileUrl}
              alt={title}
              className="max-w-full max-h-[400px] rounded"
              style={{ objectFit: 'contain' }}
              onError={() => setThumbError(true)}
            />
          ) : (
            <div className="flex flex-col items-center gap-2" style={{ color: 'var(--ew-text-muted)' }}>
              <Image size={48} className="opacity-30" />
              <span className="text-xs">Preview unavailable</span>
            </div>
          )
        )}

        {item.media_type === 'video' && (
          <video
            src={fileUrl}
            controls
            className="max-w-full max-h-[400px] rounded"
            style={{ background: 'black' }}
          >
            <div className="flex flex-col items-center gap-2" style={{ color: 'var(--ew-text-muted)' }}>
              <Film size={48} className="opacity-30" />
              <span className="text-xs">Video preview unavailable</span>
            </div>
          </video>
        )}

        {item.media_type === 'audio' && (
          <div className="flex flex-col items-center gap-4 w-full max-w-xl" style={{ color: 'var(--ew-text-muted)' }}>
            <Music size={48} className="opacity-30" />
            <audio src={fileUrl} controls preload="metadata" className="w-full" />
          </div>
        )}
      </div>

      {/* Info */}
      <div className="flex-1 px-6 py-4">
        <h2
          className="text-lg font-semibold mb-1"
          style={{ color: 'var(--ew-text)' }}
        >
          {title}
        </h2>

        {/* Meta */}
        <div className="mb-4">
          <InfoRow label="Applet" value={item.applet_id} />
          <InfoRow label="Section" value={itemKindLabel(item)} />
          <InfoRow label="Created" value={formatDate(item.created_at)} />
          <InfoRow label="Size" value={formatBytes(item.file_size_bytes)} />
          <InfoRow label="Type" value={item.mime_type} />
        </div>

        {/* Generation Info */}
        {(item.prompt || item.model_id || item.generation_mode || item.width || item.duration_seconds) && (
          <div className="mb-4">
            <div
              className="text-[9px] font-bold uppercase tracking-wider mb-2"
              style={{ color: 'var(--ew-text-faint)' }}
            >
              Generation Info
            </div>
            <InfoRow label="Prompt" value={item.prompt} />
            <InfoRow label="Model" value={item.model_id} />
            <InfoRow label="Mode" value={item.generation_mode} />
            {item.width && item.height && (
              <InfoRow label="Resolution" value={`${item.width} x ${item.height}`} />
            )}
            <InfoRow label="Duration" value={formatDuration(item.duration_seconds)} />
            <InfoRow label="Frame Rate" value={item.frame_rate ? `${item.frame_rate} fps` : null} />
            <InfoRow label="Sample Rate" value={item.sample_rate ? `${item.sample_rate} Hz` : null} />
            <InfoRow label="BPM" value={item.bpm} />
            <InfoRow label="Genre" value={item.genre} />
            {item.is_stem && <InfoRow label="Stem Type" value={item.stem_type} />}
          </div>
        )}

        {/* Tags */}
        <div className="mb-4">
          <div
            className="text-[9px] font-bold uppercase tracking-wider mb-2"
            style={{ color: 'var(--ew-text-faint)' }}
          >
            Tags
          </div>
          <TagEditor
            tags={item.tags}
            onUpdate={(tags) => void vault.updateTags(item.id, tags)}
          />
        </div>

        {/* Actions */}
        <div className="flex gap-3 mt-6">
          <button
            onClick={handleDownload}
            className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded transition-colors"
            style={{
              background: 'var(--ew-primary)',
              color: 'var(--ew-bg)',
            }}
          >
            <Download size={14} />
            Download
          </button>
          <button
            onClick={handleOpenFolder}
            className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded transition-colors"
            style={{
              background: 'transparent',
              border: '1px solid var(--ew-border)',
              color: 'var(--ew-text-muted)',
            }}
          >
            <FolderOpen size={14} />
            Open Folder
          </button>
        </div>

        {actionError && (
          <div
            className="mt-3 text-xs p-2 rounded"
            style={{
              background: 'color-mix(in oklab, var(--ew-status-red) 10%, transparent)',
              color: 'var(--ew-status-red)',
            }}
          >
            {actionError}
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

      {/* Delete confirmation modal */}
      {showDeleteConfirm && (
        <ConfirmDeleteModal
          itemTitle={title}
          onConfirm={handleDelete}
          onCancel={() => setShowDeleteConfirm(false)}
        />
      )}
    </div>
  );
}
