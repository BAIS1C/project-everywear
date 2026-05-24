// @ts-nocheck
import React, { useState, useRef, useCallback, useEffect, createContext, useContext } from 'react';
import type { Song } from '@/types';

/**
 * ShellAudioPlayer — Lifted audio player that lives at the Everywear shell level.
 * Provides a single <audio> element and Player UI bar for all applets to share.
 * Exposes playback controls via ShellAudioContext.
 */

// ── Context ────────────────────────────────────────────────────────
export interface ShellAudioAPI {
  currentSong: Song | null;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  isShuffle: boolean;
  repeatMode: 'none' | 'all' | 'one';
  playSong: (song: Song, queue?: Song[]) => void;
  togglePlay: () => void;
  setVolume: (v: number) => void;
  toggleShuffle: () => void;
  toggleRepeat: () => void;
  seek: (time: number) => void;
  /** Hard-stop: pauses playback and clears current-song state. Used when a
   *  window/applet closes and the session should leave no ambient audio. */
  stopAll: () => void;
}

const ShellAudioContext = createContext<ShellAudioAPI | null>(null);

export function useShellAudio(): ShellAudioAPI {
  const ctx = useContext(ShellAudioContext);
  if (!ctx) throw new Error('useShellAudio must be used within ShellAudioProvider');
  return ctx;
}

// ── Provider + Player ──────────────────────────────────────────────
export function ShellAudioProvider({ children }: { children: React.ReactNode }) {
  const [currentSong, setCurrentSong] = useState<Song | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(0.8);
  const [isShuffle, setIsShuffle] = useState(false);
  const [repeatMode, setRepeatMode] = useState<'none' | 'all' | 'one'>('all');

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const pendingSeekRef = useRef<number | null>(null);
  const playQueueRef = useRef<Song[]>([]);
  const queueIndexRef = useRef(-1);
  const playNextRef = useRef<() => void>(() => {});

  // ── Audio element setup ───────────────────────────────────────
  useEffect(() => {
    audioRef.current = new Audio();
    audioRef.current.crossOrigin = 'anonymous';
    const audio = audioRef.current;
    audio.volume = volume;

    const onTimeUpdate = () => setCurrentTime(audio.currentTime);
    const applyPendingSeek = () => {
      if (pendingSeekRef.current === null) return;
      if (audio.seekable.length === 0) return;
      const target = pendingSeekRef.current;
      const safeTarget = Number.isFinite(audio.duration)
        ? Math.min(Math.max(target, 0), audio.duration)
        : Math.max(target, 0);
      audio.currentTime = safeTarget;
      setCurrentTime(safeTarget);
      pendingSeekRef.current = null;
    };

    const onLoadedMetadata = () => { setDuration(audio.duration); applyPendingSeek(); };
    const onCanPlay = () => applyPendingSeek();
    const onProgress = () => applyPendingSeek();
    const onEnded = () => playNextRef.current();
    const onError = () => setIsPlaying(false);

    audio.addEventListener('timeupdate', onTimeUpdate);
    audio.addEventListener('loadedmetadata', onLoadedMetadata);
    audio.addEventListener('canplay', onCanPlay);
    audio.addEventListener('progress', onProgress);
    audio.addEventListener('ended', onEnded);
    audio.addEventListener('error', onError);

    return () => {
      audio.pause();
      audio.removeEventListener('timeupdate', onTimeUpdate);
      audio.removeEventListener('loadedmetadata', onLoadedMetadata);
      audio.removeEventListener('canplay', onCanPlay);
      audio.removeEventListener('progress', onProgress);
      audio.removeEventListener('ended', onEnded);
      audio.removeEventListener('error', onError);
    };
  }, []);

  // ── Playback state handler ────────────────────────────────────
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !currentSong?.audioUrl) return;

    const playAudio = async () => {
      try { await audio.play(); }
      catch (err) {
        if (err instanceof Error && err.name !== 'AbortError') setIsPlaying(false);
      }
    };

    if (audio.src !== currentSong.audioUrl) {
      audio.src = currentSong.audioUrl;
      audio.load();
      if (isPlaying) playAudio();
    } else {
      if (isPlaying) playAudio();
      else audio.pause();
    }
  }, [currentSong, isPlaying]);

  // ── Volume sync ───────────────────────────────────────────────
  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = volume;
  }, [volume]);

  // ── Play next / previous ──────────────────────────────────────
  const playNext = useCallback(() => {
    if (!currentSong) return;
    const queue = playQueueRef.current;
    if (queue.length === 0) return;
    const idx = queueIndexRef.current;

    if (repeatMode === 'one') {
      if (audioRef.current) { audioRef.current.currentTime = 0; audioRef.current.play(); }
      return;
    }

    let nextIdx: number;
    if (isShuffle) {
      do { nextIdx = Math.floor(Math.random() * queue.length); }
      while (queue.length > 1 && nextIdx === idx);
    } else {
      nextIdx = (idx + 1) % queue.length;
    }

    queueIndexRef.current = nextIdx;
    setCurrentSong(queue[nextIdx]);
    setIsPlaying(true);
  }, [currentSong, isShuffle, repeatMode]);

  const playPrevious = useCallback(() => {
    if (!currentSong) return;
    const queue = playQueueRef.current;
    if (queue.length === 0) return;

    if (currentTime > 3) {
      if (audioRef.current) audioRef.current.currentTime = 0;
      return;
    }

    let prevIdx = (queueIndexRef.current - 1 + queue.length) % queue.length;
    if (isShuffle) prevIdx = Math.floor(Math.random() * queue.length);

    queueIndexRef.current = prevIdx;
    setCurrentSong(queue[prevIdx]);
    setIsPlaying(true);
  }, [currentSong, currentTime, isShuffle]);

  useEffect(() => { playNextRef.current = playNext; }, [playNext]);

  // ── Public API ────────────────────────────────────────────────
  const playSong = useCallback((song: Song, queue?: Song[]) => {
    if (queue && queue.length > 0) {
      playQueueRef.current = queue;
      queueIndexRef.current = queue.findIndex(s => s.id === song.id);
    } else if (!playQueueRef.current.some(s => s.id === song.id)) {
      playQueueRef.current = [song];
      queueIndexRef.current = 0;
    } else {
      queueIndexRef.current = playQueueRef.current.findIndex(s => s.id === song.id);
    }

    if (currentSong?.id !== song.id) {
      setCurrentSong(song);
      setIsPlaying(true);
    } else {
      setIsPlaying(prev => !prev);
    }
  }, [currentSong]);

  const togglePlay = useCallback(() => {
    if (!currentSong) return;
    setIsPlaying(prev => !prev);
  }, [currentSong]);

  const seek = useCallback((time: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    if (Number.isNaN(audio.duration) || audio.readyState < 1 || audio.seekable.length === 0) {
      pendingSeekRef.current = time;
      return;
    }
    audio.currentTime = time;
    setCurrentTime(time);
  }, []);

  const toggleShuffle = useCallback(() => setIsShuffle(prev => !prev), []);
  const toggleRepeat = useCallback(() => {
    setRepeatMode(prev => prev === 'none' ? 'all' : prev === 'all' ? 'one' : 'none');
  }, []);

  const stopAll = useCallback(() => {
    const audio = audioRef.current;
    if (audio) {
      try { audio.pause(); } catch { /* ignore */ }
      audio.currentTime = 0;
    }
    setIsPlaying(false);
    setCurrentSong(null);
    setCurrentTime(0);
  }, []);

  const api: ShellAudioAPI = {
    currentSong, isPlaying, currentTime, duration, volume,
    isShuffle, repeatMode,
    playSong, togglePlay, setVolume, toggleShuffle, toggleRepeat, seek,
    stopAll,
  };

  return (
    <ShellAudioContext.Provider value={api}>
      {children}
      {/* Global player bar removed — each applet (Library, DAW) owns its own transport. */}
      {/* ShellAudioContext still provides shared playback state for Gener8 song cards. */}
    </ShellAudioContext.Provider>
  );
}
