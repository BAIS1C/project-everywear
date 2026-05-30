import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Music2, Pause, Play, Trash2, X } from 'lucide-react';
import {
  vaultDeleteItem,
  vaultFileUrl,
  vaultSearch,
  type VaultAssetKind,
  type VaultItem,
} from '@everywear/transport';
import type { ProAudioMode } from './useProAudioMode';

export interface ProVaultTrack {
  id: string;
  filename: string;
  storageKey: string;
  audioUrl: string;
  assetKind?: VaultAssetKind;
  duration: number | null;
  fileSizeBytes: number | null;
  deletable: boolean;
}

interface ProVaultPickerProps {
  mode: ProAudioMode;
  open: boolean;
  onClose: () => void;
  onPick: (track: ProVaultTrack) => void;
}

export function expectedAssetKindsForMode(
  mode: ProAudioMode,
): VaultAssetKind[] {
  return mode === 'reference'
    ? ['reference']
    : ['cover_source', 'gener8_song'];
}

export function filterVaultItemsForProMode(
  items: VaultItem[],
  mode: ProAudioMode,
): VaultItem[] {
  const allowed = new Set(expectedAssetKindsForMode(mode));
  return items.filter((item) => (
    item.media_type === 'audio'
    && !item.is_stem
    && !!item.asset_kind
    && allowed.has(item.asset_kind)
  ));
}

function fileNameFromPath(filePath?: string): string {
  const name = (filePath || '').replace(/\\/g, '/').split('/').pop();
  return name || 'Audio';
}

function displayTitle(item: VaultItem): string {
  const title = (item.title || '').trim();
  const synthetic = !title
    || /^(untitled|gener8 output|legacy gener8 audio)$/i.test(title)
    || /^track_\d+$/i.test(title);
  return synthetic ? fileNameFromPath(item.file_path).replace(/\.[^.]+$/, '') : title;
}

function toTrack(item: VaultItem): ProVaultTrack {
  return {
    id: item.id,
    filename: displayTitle(item),
    storageKey: item.file_path,
    audioUrl: vaultFileUrl(item.file_path),
    assetKind: item.asset_kind,
    duration: item.duration_seconds ?? null,
    fileSizeBytes: item.file_size_bytes ?? null,
    deletable: item.asset_kind === 'reference' || item.asset_kind === 'cover_source',
  };
}

function formatTime(time: number | null): string {
  if (!Number.isFinite(time || 0) || !time || time <= 0) return '--:--';
  const minutes = Math.floor(time / 60);
  const seconds = Math.floor(time % 60);
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

async function fetchTracksForMode(mode: ProAudioMode): Promise<ProVaultTrack[]> {
  const responses = await Promise.all(
    expectedAssetKindsForMode(mode).map((kind) => vaultSearch('', kind, 'newest', 250, 0)),
  );
  const byId = new Map<string, VaultItem>();
  for (const response of responses) {
    for (const item of filterVaultItemsForProMode(response.items, mode)) {
      byId.set(item.id, item);
    }
  }
  return Array.from(byId.values())
    .sort((a, b) => Number(b.created_at || 0) - Number(a.created_at || 0))
    .map(toTrack);
}

export function ProVaultPicker({ mode, open, onClose, onPick }: ProVaultPickerProps) {
  const [tracks, setTracks] = useState<ProVaultTrack[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [playingTrackId, setPlayingTrackId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    if (!open) return;
    setIsLoading(true);
    setError(null);
    fetchTracksForMode(mode)
      .then(setTracks)
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not load Vault audio.'))
      .finally(() => setIsLoading(false));
  }, [mode, open]);

  const title = mode === 'reference' ? 'Reference' : 'Cover Source';
  const emptyCopy = mode === 'reference'
    ? 'Upload reference clips to use them here.'
    : 'Cover can use cover sources or existing Gener8 songs.';

  const tagsById = useMemo(
    () => new Map(tracks.map((track) => [track.id, track.assetKind || 'audio'])),
    [tracks],
  );

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-[92%] max-w-lg rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-white/10 shadow-2xl overflow-hidden">
        <div className="p-5 pb-4 flex items-start justify-between">
          <div>
            <h3 className="text-xl font-semibold text-zinc-900 dark:text-white">{title}</h3>
            <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
              {mode === 'reference'
                ? 'Pick a reference clip for vibe, genre, and energy.'
                : 'Pick an existing track to restyle as a cover.'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-zinc-100 dark:hover:bg-white/10 text-zinc-400 hover:text-zinc-900 dark:hover:text-white transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        <div className="border-t border-zinc-100 dark:border-white/5 max-h-[360px] overflow-y-auto">
          {isLoading ? (
            <div className="px-5 py-8 text-center text-xs text-zinc-400">Loading tracks...</div>
          ) : error ? (
            <div className="px-5 py-8 text-center text-xs text-rose-500">{error}</div>
          ) : tracks.length === 0 ? (
            <div className="px-5 py-8 text-center">
              <Music2 size={24} className="mx-auto text-zinc-300 dark:text-zinc-600" />
              <p className="text-sm text-zinc-400 mt-2">No tracks yet</p>
              <p className="text-xs text-zinc-400 mt-1">{emptyCopy}</p>
            </div>
          ) : (
            <div className="divide-y divide-zinc-100 dark:divide-white/5">
              {tracks.map((track) => (
                <div key={track.id} className="px-5 py-3 flex items-center gap-3 hover:bg-zinc-50 dark:hover:bg-white/[0.02] transition-colors group">
                  <button
                    type="button"
                    onClick={() => {
                      if (playingTrackId === track.id) {
                        audioRef.current?.pause();
                        setPlayingTrackId(null);
                        return;
                      }
                      setPlayingTrackId(track.id);
                      if (audioRef.current) {
                        audioRef.current.src = track.audioUrl;
                        audioRef.current.play().catch(() => undefined);
                      }
                    }}
                    className="flex-shrink-0 w-9 h-9 rounded-full bg-zinc-100 dark:bg-white/10 text-zinc-600 dark:text-zinc-300 flex items-center justify-center hover:bg-zinc-200 dark:hover:bg-white/20 transition-colors"
                  >
                    {playingTrackId === track.id ? <Pause size={14} fill="currentColor" /> : <Play size={14} fill="currentColor" />}
                  </button>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-zinc-800 dark:text-zinc-200 truncate">
                        {track.filename.replace(/\.[^/.]+$/, '')}
                      </span>
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-zinc-200 dark:bg-white/10 text-zinc-600 dark:text-zinc-400">
                        {tagsById.get(track.id)}
                      </span>
                    </div>
                    <div className="text-xs text-zinc-400 mt-0.5">{formatTime(track.duration)}</div>
                  </div>
                  <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      type="button"
                      onClick={() => {
                        onPick(track);
                        onClose();
                        setPlayingTrackId(null);
                      }}
                      className="px-3 py-1.5 rounded-lg bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 text-xs font-semibold hover:bg-zinc-800 dark:hover:bg-zinc-100 transition-colors"
                    >
                      Use
                    </button>
                    {track.deletable && (
                      <button
                        type="button"
                        onClick={() => {
                          vaultDeleteItem(track.id)
                            .then(() => setTracks((prev) => prev.filter((item) => item.id !== track.id)))
                            .catch(() => undefined);
                        }}
                        className="p-1.5 rounded-lg hover:bg-zinc-200 dark:hover:bg-white/10 text-zinc-400 hover:text-rose-500 transition-colors"
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        <audio ref={audioRef} onEnded={() => setPlayingTrackId(null)} />
      </div>
    </div>
  );
}
