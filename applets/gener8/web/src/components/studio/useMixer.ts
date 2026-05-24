// @ts-nocheck
/**
 * useMixer — React hook wrapping AudioMixer lifecycle.
 *
 * Creates a single AudioMixer instance, loads stems when URLs change,
 * and exposes play/pause/stop/seek/volume/pan/mute/solo controls.
 * Provides current playback time via RAF callback.
 *
 * Usage:
 *   const mixer = useMixer(stems);
 *   mixer.play();
 *   mixer.setVolume('vocals', 0.5);
 *   mixer.setPan('drums', -0.3);
 */

import { useRef, useEffect, useState, useCallback } from 'react';
import { AudioMixer } from './AudioMixer';
import type { TrackName } from '../../services/api';
import { TRACK_NAMES } from '../../services/api';

export interface MixerControls {
  /** Start playback from current position (or optional offset) */
  play: (offset?: number) => void;
  /** Pause playback (preserves position) */
  pause: () => void;
  /** Stop playback and reset to 0 */
  stop: () => void;
  /** Seek to a position in seconds */
  seek: (seconds: number) => void;
  /** Set volume for a track (0-1) */
  setVolume: (track: TrackName, volume: number) => void;
  /** Set stereo pan for a track (-1 left, 0 center, 1 right) */
  setPan: (track: TrackName, pan: number) => void;
  /** Mute/unmute a track */
  setMuted: (track: TrackName, muted: boolean) => void;
  /** Solo/unsolo a track */
  setSolo: (track: TrackName, solo: boolean) => void;
  /** Current playback time in seconds */
  currentTime: number;
  /** Whether mixer is currently playing */
  isPlaying: boolean;
  /** Total duration of the longest loaded stem */
  duration: number;
  /** Which stems have been loaded successfully */
  loadedStems: Set<TrackName>;
  /** Whether any stems are still loading */
  isLoading: boolean;
}

export function useMixer(
  stems: Record<TrackName, string | null> | null
): MixerControls {
  const mixerRef = useRef<AudioMixer | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [loadedStems, setLoadedStems] = useState<Set<TrackName>>(new Set());
  const [isLoading, setIsLoading] = useState(false);

  // Create mixer on mount, dispose on unmount
  useEffect(() => {
    const mixer = new AudioMixer();
    mixerRef.current = mixer;

    mixer.onTimeUpdate((time) => {
      setCurrentTime(time);
      // Auto-stop at end
      const dur = mixer.getDuration();
      if (dur > 0 && time >= dur) {
        mixer.stop();
        setIsPlaying(false);
        setCurrentTime(0);
      }
    });

    return () => {
      mixer.dispose();
      mixerRef.current = null;
    };
  }, []);

  // Load stems when URLs change
  useEffect(() => {
    const mixer = mixerRef.current;
    if (!mixer || !stems) return;

    let cancelled = false;
    setIsLoading(true);

    const loadAll = async () => {
      const newLoaded = new Set<TrackName>();

      const promises = TRACK_NAMES.map(async (trackName) => {
        const url = stems[trackName];
        if (!url || url === 'simulated') return;

        try {
          await mixer.loadStem(trackName, url);
          if (!cancelled) {
            newLoaded.add(trackName);
          }
        } catch (err) {
          console.warn(`[useMixer] Failed to load ${trackName}:`, err);
        }
      });

      await Promise.allSettled(promises);

      if (!cancelled) {
        setLoadedStems(newLoaded);
        setDuration(mixer.getDuration());
        setIsLoading(false);
      }
    };

    loadAll();

    return () => {
      cancelled = true;
    };
  }, [stems]);

  const play = useCallback((offset?: number) => {
    const mixer = mixerRef.current;
    if (!mixer) return;
    mixer.play(offset ?? currentTime);
    setIsPlaying(true);
  }, [currentTime]);

  const pause = useCallback(() => {
    const mixer = mixerRef.current;
    if (!mixer) return;
    mixer.pause();
    setIsPlaying(false);
    setCurrentTime(mixer.getMasterTime());
  }, []);

  const stop = useCallback(() => {
    const mixer = mixerRef.current;
    if (!mixer) return;
    mixer.stop();
    setIsPlaying(false);
    setCurrentTime(0);
  }, []);

  const seek = useCallback((seconds: number) => {
    const mixer = mixerRef.current;
    if (!mixer) return;
    mixer.seek(seconds);
    setCurrentTime(seconds);
  }, []);

  const setVolume = useCallback((track: TrackName, volume: number) => {
    mixerRef.current?.setVolume(track, volume);
  }, []);

  const setPan = useCallback((track: TrackName, pan: number) => {
    mixerRef.current?.setPan(track, pan);
  }, []);

  const setMuted = useCallback((track: TrackName, muted: boolean) => {
    mixerRef.current?.setMuted(track, muted);
  }, []);

  const setSolo = useCallback((track: TrackName, solo: boolean) => {
    mixerRef.current?.setSolo(track, solo);
  }, []);

  return {
    play,
    pause,
    stop,
    seek,
    setVolume,
    setPan,
    setMuted,
    setSolo,
    currentTime,
    isPlaying,
    duration,
    loadedStems,
    isLoading,
  };
}
