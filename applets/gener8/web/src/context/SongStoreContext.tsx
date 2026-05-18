/**
 * Shared Song Store -- single source of truth for the user's song library.
 * Ported from s3studio-web/src/shell/SongStoreContext.tsx.
 *
 * Adapted for Everywear:
 *   - No Supabase auth; uses local Gener8 backend shim on localhost:3001
 *   - Auth context from Everywear's AuthContext (Tauri invoke)
 *   - No social layer (like/dislike stubs retained for UI compat)
 *
 * Consumers: Gener8 CreateView, LibraryView, VidView.
 */
import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import type { Song } from '../types';
import { useAuth } from './AuthContext';

// -- API helpers (inline; extracted from s3studio services/api) ----------------

const BACKEND_BASE = 'http://localhost:3001';

function apiUrl(path: string): string {
  return `${BACKEND_BASE}${path}`;
}

function getAudioUrl(audioUrl?: string, songId?: string): string | undefined {
  if (!audioUrl) return undefined;
  if (audioUrl.startsWith('http')) return audioUrl;
  // Local shim serves audio at /api/audio/:key
  return apiUrl(`/api/audio/${audioUrl}`);
}

async function fetchMySongs(token: string): Promise<any[]> {
  try {
    const res = await fetch(apiUrl('/api/songs/my'), {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) return [];
    const raw = await res.json();
    return raw?.songs ?? raw?.data?.songs ?? [];
  } catch {
    return [];
  }
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
  return {
    id: s.id,
    title: s.title,
    lyrics: s.lyrics,
    style: s.style,
    coverUrl: `https://picsum.photos/seed/${s.id}/400/400`,
    duration: s.duration && s.duration > 0
      ? `${Math.floor(s.duration / 60)}:${String(Math.floor(s.duration % 60)).padStart(2, '0')}`
      : '0:00',
    createdAt: new Date(s.created_at || s.createdAt),
    tags: s.tags || [],
    audioUrl: getAudioUrl(s.audio_url, s.id),
    isPublic: s.is_public,
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
      // Fetch from local Gener8 backend shim
      const wireSongs = await fetchMySongs('');
      const mapped = wireSongs.map(mapWireSong);
      _setSongs(prev => {
        const generating = prev.filter(s => s.isGenerating);
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
