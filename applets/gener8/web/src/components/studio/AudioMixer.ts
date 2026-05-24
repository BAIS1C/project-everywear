// @ts-nocheck
/**
 * AudioMixer — Web Audio API mixing engine for S³ DAW
 *
 * Manages per-stem audio graphs:
 *   AudioBufferSourceNode → GainNode → destination
 *
 * Supports mute, solo, volume, and time-based synchronization across 12 stems.
 * All stems play in sync when `play()` is called; seek/pause/stop control playback.
 */

import { TrackName, TRACK_NAMES } from '../../services/api';

interface StemBuffer {
  buffer: AudioBuffer;
  originalVolume: number;
  muted: boolean;
}

interface StemNodes {
  source: AudioBufferSourceNode | null;
  gain: GainNode;
  pan: StereoPannerNode;
}

export class AudioMixer {
  private audioContext: AudioContext;
  private stemBuffers: Map<TrackName, StemBuffer> = new Map();
  private stemNodes: Map<TrackName, StemNodes> = new Map();
  private soloedTracks: Set<TrackName> = new Set();
  private startTime: number = 0; // audioContext.currentTime when play() is called
  private pausedTime: number = 0; // position in seconds when paused
  private playingState: boolean = false;
  private disposed: boolean = false;

  private timeUpdateCallback: ((time: number) => void) | null = null;
  private rafId: number | null = null;

  constructor() {
    // Create single shared AudioContext
    this.audioContext =
      new (window.AudioContext || (window as any).webkitAudioContext)();

    // Initialize all stem gain + pan nodes connected to destination
    for (const trackName of TRACK_NAMES) {
      const gainNode = this.audioContext.createGain();
      gainNode.gain.value = 0.8; // Default volume

      const panNode = this.audioContext.createStereoPanner();
      panNode.pan.value = 0; // Center

      // Signal chain: source → gain → pan → destination
      gainNode.connect(panNode);
      panNode.connect(this.audioContext.destination);

      this.stemNodes.set(trackName, {
        source: null,
        gain: gainNode,
        pan: panNode,
      });

      this.stemBuffers.set(trackName, {
        buffer: null as any,
        originalVolume: 0.8,
        muted: false,
      });
    }
  }

  /**
   * Load and decode audio for a stem
   */
  async loadStem(trackName: TrackName, audioUrl: string): Promise<void> {
    if (this.disposed) {
      throw new Error('AudioMixer has been disposed');
    }

    try {
      const response = await fetch(audioUrl);
      if (!response.ok) {
        throw new Error(`Failed to fetch audio: ${response.status}`);
      }

      const arrayBuffer = await response.arrayBuffer();
      const audioBuffer = await this.audioContext.decodeAudioData(
        arrayBuffer
      );

      const stemBuffer = this.stemBuffers.get(trackName);
      if (stemBuffer) {
        stemBuffer.buffer = audioBuffer;
      }
    } catch (error) {
      console.error(`[AudioMixer] Failed to load stem ${trackName}:`, error);
      throw error;
    }
  }

  /**
   * Start playback of all loaded stems from offset
   */
  play(offsetSeconds: number = 0): void {
    if (this.disposed) {
      console.warn('AudioMixer has been disposed');
      return;
    }

    // Resume context if suspended
    if (this.audioContext.state === 'suspended') {
      this.audioContext.resume();
    }

    // If already playing, stop first
    if (this.playingState) {
      this.stop();
    }

    // Mark start time and position
    this.startTime = this.audioContext.currentTime - offsetSeconds;
    this.pausedTime = 0;
    this.playingState = true;

    // Create new source for each stem and start playing
    for (const trackName of TRACK_NAMES) {
      const stemBuffer = this.stemBuffers.get(trackName);
      const stemNodes = this.stemNodes.get(trackName);

      if (!stemBuffer || !stemNodes) continue;
      if (!stemBuffer.buffer) continue; // Skip if not loaded

      // Stop any existing source
      if (stemNodes.source) {
        try {
          stemNodes.source.stop();
        } catch (e) {
          // Already stopped, ignore
        }
      }

      // Create new source and connect
      const source = this.audioContext.createBufferSource();
      source.buffer = stemBuffer.buffer;
      source.connect(stemNodes.gain);

      stemNodes.source = source;

      // Start playback from offset
      try {
        source.start(0, offsetSeconds);
      } catch (e) {
        console.warn(
          `[AudioMixer] Failed to start source for ${trackName}:`,
          e
        );
      }
    }

    // Start time update loop
    this._startTimeUpdateLoop();
  }

  /**
   * Pause playback (preserve position)
   */
  pause(): void {
    if (this.disposed) {
      console.warn('AudioMixer has been disposed');
      return;
    }

    if (!this.playingState) return;

    // Save current position
    this.pausedTime = this.getMasterTime();
    this.playingState = false;

    // Stop all sources but keep context running
    for (const stemNodes of this.stemNodes.values()) {
      if (stemNodes.source) {
        try {
          stemNodes.source.stop();
        } catch (e) {
          // Already stopped
        }
        stemNodes.source = null;
      }
    }

    this._stopTimeUpdateLoop();
  }

  /**
   * Stop playback and reset to position 0
   */
  stop(): void {
    if (this.disposed) {
      console.warn('AudioMixer has been disposed');
      return;
    }

    this.playingState = false;
    this.pausedTime = 0;
    this.startTime = 0;

    // Stop all sources
    for (const stemNodes of this.stemNodes.values()) {
      if (stemNodes.source) {
        try {
          stemNodes.source.stop();
        } catch (e) {
          // Already stopped
        }
        stemNodes.source = null;
      }
    }

    this._stopTimeUpdateLoop();
  }

  /**
   * Seek to a new position (in seconds)
   */
  seek(seconds: number): void {
    if (this.disposed) {
      console.warn('AudioMixer has been disposed');
      return;
    }

    const wasPlaying = this.playingState;

    if (wasPlaying) {
      this.stop();
      this.play(seconds);
    } else {
      // Just update paused position
      this.pausedTime = Math.max(0, seconds);
    }
  }

  /**
   * Set volume for a stem (0-1)
   */
  setVolume(trackName: TrackName, volume: number): void {
    if (this.disposed) {
      console.warn('AudioMixer has been disposed');
      return;
    }

    const stemBuffer = this.stemBuffers.get(trackName);
    const stemNodes = this.stemNodes.get(trackName);

    if (!stemBuffer || !stemNodes) return;

    // Clamp volume
    const clampedVolume = Math.max(0, Math.min(1, volume));

    // Store original volume for mute/unmute
    stemBuffer.originalVolume = clampedVolume;

    // Apply gain, accounting for mute and solo state
    this._updateGainForTrack(trackName);
  }

  /**
   * Mute/unmute a stem
   */
  setMuted(trackName: TrackName, muted: boolean): void {
    if (this.disposed) {
      console.warn('AudioMixer has been disposed');
      return;
    }

    const stemBuffer = this.stemBuffers.get(trackName);
    if (!stemBuffer) return;

    stemBuffer.muted = muted;
    this._updateGainForTrack(trackName);
  }

  /**
   * Solo a track (or multi-select if called multiple times)
   * If ANY track is soloed, only soloed tracks play
   */
  setSolo(trackName: TrackName, solo: boolean): void {
    if (this.disposed) {
      console.warn('AudioMixer has been disposed');
      return;
    }

    if (solo) {
      this.soloedTracks.add(trackName);
    } else {
      this.soloedTracks.delete(trackName);
    }

    // Update gains for all tracks
    for (const track of TRACK_NAMES) {
      this._updateGainForTrack(track);
    }
  }

  /**
   * Set stereo pan for a stem (-1 = full left, 0 = center, 1 = full right)
   */
  setPan(trackName: TrackName, pan: number): void {
    if (this.disposed) {
      console.warn('AudioMixer has been disposed');
      return;
    }

    const stemNodes = this.stemNodes.get(trackName);
    if (!stemNodes) return;

    const clampedPan = Math.max(-1, Math.min(1, pan));
    stemNodes.pan.pan.setTargetAtTime(
      clampedPan,
      this.audioContext.currentTime,
      0.02 // 20ms smoothing
    );
  }

  /**
   * Get current playback position in seconds
   */
  getMasterTime(): number {
    if (!this.playingState) {
      return this.pausedTime;
    }

    const elapsed = this.audioContext.currentTime - this.startTime;
    return Math.max(0, elapsed);
  }

  /**
   * Get the longest stem duration (overall track length)
   */
  getDuration(): number {
    let maxDuration = 0;
    for (const stemBuffer of this.stemBuffers.values()) {
      if (stemBuffer.buffer && stemBuffer.buffer.duration > maxDuration) {
        maxDuration = stemBuffer.buffer.duration;
      }
    }
    return maxDuration;
  }

  /**
   * Check if currently playing
   */
  get playing(): boolean {
    return this.playingState;
  }

  /**
   * Register callback for time updates
   * Called via requestAnimationFrame during playback
   */
  onTimeUpdate(callback: (time: number) => void): void {
    this.timeUpdateCallback = callback;
  }

  /**
   * Clean up: stop sources, disconnect nodes, close context
   */
  dispose(): void {
    if (this.disposed) return;

    this.stop();
    this._stopTimeUpdateLoop();

    // Disconnect all gain + pan nodes
    for (const stemNodes of this.stemNodes.values()) {
      stemNodes.gain.disconnect();
      stemNodes.pan.disconnect();
    }

    this.stemNodes.clear();
    this.stemBuffers.clear();
    this.soloedTracks.clear();
    this.timeUpdateCallback = null;

    this.disposed = true;
  }

  // ── Private helpers ──

  /**
   * Update gain for a track based on mute/solo state
   */
  private _updateGainForTrack(trackName: TrackName): void {
    const stemBuffer = this.stemBuffers.get(trackName);
    const stemNodes = this.stemNodes.get(trackName);

    if (!stemBuffer || !stemNodes) return;

    let gain = stemBuffer.originalVolume;

    // Apply mute
    if (stemBuffer.muted) {
      gain = 0;
    }

    // Apply solo logic: if any tracks are soloed, mute non-soloed tracks
    if (this.soloedTracks.size > 0 && !this.soloedTracks.has(trackName)) {
      gain = 0;
    }

    // Set the gain with smooth transition
    stemNodes.gain.gain.setTargetAtTime(
      gain,
      this.audioContext.currentTime,
      0.02 // 20ms smoothing
    );
  }

  /**
   * Start RAF-based time update loop
   */
  private _startTimeUpdateLoop(): void {
    if (this.rafId !== null) return;

    const loop = () => {
      if (!this.playingState) return;

      const time = this.getMasterTime();
      if (this.timeUpdateCallback) {
        this.timeUpdateCallback(time);
      }

      this.rafId = requestAnimationFrame(loop);
    };

    this.rafId = requestAnimationFrame(loop);
  }

  /**
   * Stop RAF-based time update loop
   */
  private _stopTimeUpdateLoop(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }
}
