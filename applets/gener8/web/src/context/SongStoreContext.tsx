/**
 * Shared Song Store -- single source of truth for the user's song library.
 * Ported from s3studio-web/src/shell/SongStoreContext.tsx.
 *
 * Adapted for Everywear:
 *   - No Supabase auth; reads Everywear Vault through shell IPC
 *   - Auth context from Everywear's AuthContext (Tauri invoke)
 *   - No social layer (like/dislike stubs retained for UI compat)
 *
 * Consumers: Gener8 CreatePanel, LibraryView, VidApp.
 */
import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import type { Song } from '../types';
import { useAuth } from './AuthContext';
import {
  vaultFileUrl,
  vaultSearch,
  type VaultItem,
} from '@everywear/transport';

function getAudioUrl(audioUrl?: string, songId?: string): string | undefined {
  if (!audioUrl) return undefined;
  if (audioUrl.startsWith('http')) return audioUrl;
  return vaultFileUrl(audioUrl);
}

async function fetchMySongs(): Promise<VaultItem[]> {
  try {
    const response = await vaultSearch('', 'gener8_song', 'newest', 500, 0);
    const items = response.items.filter((item) => item.media_type === 'audio' && item.asset_kind === 'gener8_song');
    return dedupeVaultSongs(items);
  } catch {
    return [];
  }
}

// 2026-06-12 SGT: one generation was producing TWO vault rows — the
// engine-side registration in gener8_engine.rs (synthetic title
// "Gener8 output", genre "Gener8", no generation params) plus the web
// persist via songsApi.createSong with full metadata. Same audio file,
// two records; the list rendered both, the bare one showing "Gener8" as
// its style (Sean smoke test 06-11, B-series A.1). Collapse by audio
// file path and prefer the metadata-rich record. Non-destructive: hides
// duplicates at read time, deletes nothing.
function vaultSongMetadataScore(item: VaultItem): number {
  const x = item as unknown as Record<string, unknown>;
  let score = 0;
  if (x.generation_params) score += 4;
  if (x.lyrics || x.lyrics_text) score += 2;
  if (x.style || (typeof x.genre === 'string' && x.genre !== 'Gener8')) score += 1;
  if (!looksSyntheticTitle(item.title)) score += 1;
  return score;
}

function dedupeVaultSongs(items: VaultItem[]): VaultItem[] {
  const byPath = new Map<string, VaultItem>();
  for (const item of items) {
    const key = (item.file_path || item.id || '').replace(/\\/g, '/').toLowerCase();
    const prev = byPath.get(key);
    if (!prev) {
      byPath.set(key, item);
    } else if (vaultSongMetadataScore(item) > vaultSongMetadataScore(prev)) {
      byPath.set(key, item);
    }
  }
  return Array.from(byPath.values());
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

function vaultDisplayTitle(item: VaultItem): string {
  if (!looksSyntheticTitle(item.title)) return item.title;
  return fileStem(item.file_path) || item.title || 'Untitled';
}

function durationSecondsFromValue(value: unknown): number | undefined {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value > 0 ? value : undefined;
  }
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const clock = trimmed.match(/^(\d+):([0-5]?\d)$/);
  if (clock) return Number(clock[1]) * 60 + Number(clock[2]);
  const numeric = Number(trimmed);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : undefined;
}

function generationDurationSeconds(params: unknown): number | undefined {
  if (!params || typeof params !== 'object' || Array.isArray(params)) return undefined;
  return durationSecondsFromValue((params as Record<string, unknown>).duration);
}

// -- Faux peaks (deterministic placeholder waveform) --------------------------

function seededFauxPeaks(id: string, opts: { bins: number }): number[] {
  let h = 0;
  for (let i = 0; i < id.length; i++) {
    h = ((h << 5) - h + id.charCodeAt(i)) | 0;
  }
  const peaks: number[] = [];
  for (let i = 0; i < opts.bins; i++) {
    h = ((h << 5) - h + i) | 0;
    peaks.push(0.15 + Math.abs(Math.sin(h * 0.001)) * 0.7);
  }
  return peaks;
}

// -- Wire mapping -------------------------------------------------------------

function mapWireSong(s: any): Song {
  const durationSeconds =
    durationSecondsFromValue(s.duration_seconds)
    ?? durationSecondsFromValue(s.duration)
    ?? generationDurationSeconds(s.generation_params);
  const createdAtRaw = s.created_at ?? s.createdAt ?? s.created_at_ms ?? Date.now();
  const createdAtMs = typeof createdAtRaw === 'number' && createdAtRaw < 10_000_000_000
    ? createdAtRaw * 1000
    : createdAtRaw;

  return {
    id: s.id,
    title: 'file_path' in s ? vaultDisplayTitle(s as VaultItem) : (s.title || 'Untitled'),
    lyrics: s.lyrics ?? s.lyrics_text ?? '',
    // 2026-06-12 SGT: never surface the engine's hardcoded "Gener8" genre
    // as if it were the user's style prompt.
    style: s.style ?? (s.genre && s.genre !== 'Gener8' ? s.genre : '') ?? '',
    coverUrl: `https://picsum.photos/seed/${s.id}/400/400`,
    duration: durationSeconds
      ? `${Math.floor(durationSeconds / 60)}:${String(Math.floor(durationSeconds % 60)).padStart(2, '0')}`
      : undefined,
    createdAt: new Date(createdAtMs),
    tags: s.tags || [],
    audioUrl: getAudioUrl(s.audio_url || s.file_path, s.id),
    isPublic: Boolean(s.is_public),
    likeCount: s.like_count || 0,
    viewCount: s.view_count || 0,
    userId: s.user_id,
    creator: s.creator,
    generation_params: s.generation_params,
    fauxPeaks: seededFauxPeaks(s.id, { bins: 400 }),
    lrc_data: s.lrc_data,
  };
}

// -- Context ------------------------------------------------------------------

interface SongStoreContextValue {
  songs: Song[];
  isLoading: boolean;
  hasLoaded: boolean;
  refetch: () => Promise<void>;
  addSong: (song: Song) => void;
  addSongs: (songs: Song[]) => void;
  setSongs: (songs: Song[]) => void;
  updateSong: (id: string, updates: Partial<Song>) => void;
  removeSong: (id: string) => void;
  removeSongs: (ids: string[]) => void;
  playSong: (song: Song) => void;
  currentlyPlaying: Song | null;
  likedSongIds: Set<string>;
  dislikedSongIds: Set<string>;
  toggleLike: (songId: string) => void;
  toggleDislike: (songId: string) => void;
}

const SongStoreContext = createContext<SongStoreContextValue>({
  songs: [],
  isLoading: false,
  hasLoaded: false,
  refetch: async () => {},
  addSong: () => {},
  addSongs: () => {},
  setSongs: () => {},
  updateSong: () => {},
  removeSong: () => {},
  removeSongs: () => {},
  playSong: () => {},
  currentlyPlaying: null,
  likedSongIds: new Set(),
  dislikedSongIds: new Set(),
  toggleLike: () => {},
  toggleDislike: () => {},
});

const HAS_SONGS_CACHE_KEY = 'gener8.has_songs';
const GENERATING_PLACEHOLDER_TTL_MS = 15 * 60 * 1000;

function isLiveGeneratingPlaceholder(song: Song, now = Date.now()): boolean {
  if (!song.isGenerating) return false;
  if (!song.generationStartedAt) return false;
  return now - song.generationStartedAt <= GENERATING_PLACEHOLDER_TTL_MS;
}

export function SongStoreProvider({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuth();

  const [songs, _setSongs] = useState<Song[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [currentlyPlaying, setCurrentlyPlaying] = useState<Song | null>(null);
  const [likedSongIds, setLikedSongIds] = useState<Set<string>>(() => {
    try {
      const stored = localStorage.getItem('gener8:liked');
      return stored ? new Set(JSON.parse(stored)) : new Set();
    } catch { return new Set(); }
  });
  const [dislikedSongIds, setDislikedSongIds] = useState<Set<string>>(() => {
    try {
      const stored = localStorage.getItem('gener8:disliked');
      return stored ? new Set(JSON.parse(stored)) : new Set();
    } catch { return new Set(); }
  });

  useEffect(() => {
    try { localStorage.setItem('gener8:liked', JSON.stringify([...likedSongIds])); } catch {}
  }, [likedSongIds]);
  useEffect(() => {
    try { localStorage.setItem('gener8:disliked', JSON.stringify([...dislikedSongIds])); } catch {}
  }, [dislikedSongIds]);

  const fetchInFlight = useRef(false);

  const refetch = useCallback(async () => {
    if (fetchInFlight.current) return;
    fetchInFlight.current = true;
    setIsLoading(true);
    try {
      const wireSongs = await fetchMySongs();
      const mapped = wireSongs.map(mapWireSong);
      _setSongs(prev => {
        const generating = prev.filter(s => isLiveGeneratingPlaceholder(s));
        const byId = new Map(mapped.map(s => [s.id, s]));
        return [...generating, ...Array.from(byId.values())];
      });
      try {
        if (mapped.length > 0) localStorage.setItem(HAS_SONGS_CACHE_KEY, '1');
        else localStorage.removeItem(HAS_SONGS_CACHE_KEY);
      } catch {}
    } catch (error) {
      console.error('Failed to load songs:', error);
    } finally {
      setIsLoading(false);
      setHasLoaded(true);
      fetchInFlight.current = false;
    }
  }, []);

  // Fire once on mount. Re-fires when auth state changes.
  useEffect(() => {
    if (isAuthenticated) {
      void refetch();
    }
  }, [isAuthenticated, refetch]);

  const addSong = useCallback((song: Song) => {
    _setSongs(prev => {
      if (prev.some(s => s.id === song.id)) return prev;
      return [song, ...prev];
    });
  }, []);

  const addSongs = useCallback((newSongs: Song[]) => {
    _setSongs(prev => {
      const existingIds = new Set(prev.map(s => s.id));
      const fresh = newSongs.filter(s => !existingIds.has(s.id));
      return fresh.length ? [...fresh, ...prev] : prev;
    });
  }, []);

  const setSongs = useCallback((next: Song[]) => _setSongs(next), []);

  const updateSong = useCallback((id: string, updates: Partial<Song>) => {
    _setSongs(prev => prev.map(s => s.id === id ? { ...s, ...updates } : s));
  }, []);

  const removeSong = useCallback((id: string) => {
    _setSongs(prev => prev.filter(s => s.id !== id));
    setLikedSongIds(prev => { const next = new Set(prev); next.delete(id); return next; });
    setDislikedSongIds(prev => { const next = new Set(prev); next.delete(id); return next; });
  }, []);

  const removeSongs = useCallback((ids: string[]) => {
    const idSet = new Set(ids);
    _setSongs(prev => prev.filter(s => !idSet.has(s.id)));
    setLikedSongIds(prev => { const next = new Set(prev); ids.forEach(id => next.delete(id)); return next; });
    setDislikedSongIds(prev => { const next = new Set(prev); ids.forEach(id => next.delete(id)); return next; });
  }, []);

  const playSong = useCallback((song: Song) => setCurrentlyPlaying(song), []);

  const toggleLike = useCallback((songId: string) => {
    setLikedSongIds(prev => {
      const next = new Set(prev);
      if (next.has(songId)) next.delete(songId);
      else next.add(songId);
      return next;
    });
    setDislikedSongIds(prev => {
      if (!prev.has(songId)) return prev;
      const next = new Set(prev);
      next.delete(songId);
      return next;
    });
  }, []);

  const toggleDislike = useCallback((songId: string) => {
    setDislikedSongIds(prev => {
      const next = new Set(prev);
      if (next.has(songId)) next.delete(songId);
      else next.add(songId);
      return next;
    });
    setLikedSongIds(prev => {
      if (!prev.has(songId)) return prev;
      const next = new Set(prev);
      next.delete(songId);
      return next;
    });
  }, []);

  return (
    <SongStoreContext.Provider value={{
      songs, isLoading, hasLoaded, refetch,
      addSong, addSongs, setSongs, updateSong, removeSong, removeSongs,
      playSong, currentlyPlaying,
      likedSongIds, dislikedSongIds, toggleLike, toggleDislike,
    }}>
      {children}
    </SongStoreContext.Provider>
  );
}

export function useSongStore() {
  return useContext(SongStoreContext);
}

export function readHasSongsHint(): boolean {
  try {
    return localStorage.getItem(HAS_SONGS_CACHE_KEY) === '1';
  } catch {
    return false;
  }
}
