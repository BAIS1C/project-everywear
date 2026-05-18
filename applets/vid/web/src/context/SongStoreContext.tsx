/**
 * Song Store for Vid Studio (standalone applet).
 *
 * Vid doesn't generate music; it visualises existing songs. Songs can come from:
 *   1. Gener8's library API (if Gener8 backend is running on port 3001)
 *   2. Local file import (drag-and-drop or file picker)
 *
 * Falls back gracefully to an empty library if Gener8 isn't running.
 */
import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import type { Song } from '../types';

// -- API helpers (try Gener8 backend, fail gracefully) -----------------------

const GENER8_BASE = 'http://localhost:3001';

function getAudioUrl(audioUrl?: string): string | undefined {
  if (!audioUrl) return undefined;
  if (audioUrl.startsWith('http') || audioUrl.startsWith('blob:')) return audioUrl;
  return `${GENER8_BASE}/api/audio/${audioUrl}`;
}

async function fetchFromGener8(): Promise<any[]> {
  try {
    const res = await fetch(`${GENER8_BASE}/api/songs/my`, {
      signal: AbortSignal.timeout(2000), // fast timeout: don't block if Gener8 isn't up
    });
    if (!res.ok) return [];
    const raw = await res.json();
    return raw?.songs ?? raw?.data?.songs ?? [];
  } catch {
    return []; // Gener8 not running: empty library, user can import files
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

function mapWireSong(s: any): Song {
  return {
    id: s.id,
    title: s.title,
    lyrics: s.lyrics,
    style: s.style,
    coverUrl: `https://picsum.photos/seed/${s.id}/400/400`,
    duration:
      s.duration && s.duration > 0
        ? `${Math.floor(s.duration / 60)}:${String(Math.floor(s.duration % 60)).padStart(2, '0')}`
        : '0:00',
    createdAt: new Date(s.created_at || s.createdAt),
    tags: s.tags || [],
    audioUrl: getAudioUrl(s.audio_url),
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

export function SongStoreProvider({ children }: { children: React.ReactNode }) {
  const [songs, _setSongs] = useState<Song[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [currentlyPlaying, setCurrentlyPlaying] = useState<Song | null>(null);
  const [likedSongIds, setLikedSongIds] = useState<Set<string>>(new Set());
  const [dislikedSongIds, setDislikedSongIds] = useState<Set<string>>(new Set());

  const fetchInFlight = useRef(false);

  const refetch = useCallback(async () => {
    if (fetchInFlight.current) return;
    fetchInFlight.current = true;
    setIsLoading(true);
    try {
      const wireSongs = await fetchFromGener8();
      const mapped = wireSongs.map(mapWireSong);
      _setSongs(prev => {
        const local = prev.filter(s => s.audioUrl?.startsWith('blob:'));
        const byId = new Map(mapped.map(s => [s.id, s]));
        return [...local, ...Array.from(byId.values())];
      });
    } catch (error) {
      console.error('Failed to load songs:', error);
    } finally {
      setIsLoading(false);
      setHasLoaded(true);
      fetchInFlight.current = false;
    }
  }, []);

  // Fire once on mount
  useEffect(() => {
    void refetch();
  }, [refetch]);

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
    _setSongs(prev => prev.map(s => (s.id === id ? { ...s, ...updates } : s)));
  }, []);

  const removeSong = useCallback((id: string) => {
    _setSongs(prev => prev.filter(s => s.id !== id));
  }, []);

  const removeSongs = useCallback((ids: string[]) => {
    const idSet = new Set(ids);
    _setSongs(prev => prev.filter(s => !idSet.has(s.id)));
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
    <SongStoreContext.Provider
      value={{
        songs,
        isLoading,
        hasLoaded,
        refetch,
        addSong,
        addSongs,
        setSongs,
        updateSong,
        removeSong,
        removeSongs,
        playSong,
        currentlyPlaying,
        likedSongIds,
        dislikedSongIds,
        toggleLike,
        toggleDislike,
      }}
    >
      {children}
    </SongStoreContext.Provider>
  );
}

export function useSongStore() {
  return useContext(SongStoreContext);
}

export function readHasSongsHint(): boolean {
  return false; // Vid doesn't cache this; Gener8 does
}
