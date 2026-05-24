// @ts-nocheck
/**
 * dawApi — Service layer for the Rust DAW engine running on localhost:3001.
 *
 * Used by DawCore to sync extracted stems into the Rust project,
 * and by StudioTab to read persisted project state.
 *
 * URL resolution matches the pattern in intentBus.ts: hosted origins
 * (s3studio.xyz, strandsnation.xyz, vercel.app) route to localhost:3001;
 * dev proxy mode uses relative paths.
 */

const LOCAL_ENGINE = 'http://localhost:3001';

function dawUrl(path: string): string {
  if (typeof window === 'undefined') return `/api/daw${path}`;
  const host = window.location.hostname;
  if (
    host.includes('strandsnation.xyz') ||
    host.includes('s3studio.xyz') ||
    host.includes('vercel.app')
  ) {
    return `${LOCAL_ENGINE}/api/daw${path}`;
  }
  return `/api/daw${path}`;
}

async function dawFetch<T>(endpoint: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(dawUrl(endpoint), {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || res.statusText);
  }
  return res.json();
}

async function dawPost<T>(endpoint: string, body?: unknown): Promise<T> {
  return dawFetch<T>(endpoint, {
    method: 'POST',
    body: body ? JSON.stringify(body) : undefined,
  });
}

// ─── Types ──────────────────────────────────────────────────────────

export interface DawTrack {
  id: string;
  name: string;
  color: string;
  volume_db: number;
  pan: number;
  mute: boolean;
  solo: boolean;
  regions: DawRegion[];
  automation: unknown[];
}

export interface DawRegion {
  id: string;
  audio_ref: string;
  position_ms: number;
  start_offset_ms: number;
  end_offset_ms: number;
  fade_in_ms: number;
  fade_out_ms: number;
  fade_curve: string;
  generation_dna: string | null;
}

export interface DawProject {
  version: number;
  name: string;
  tempo_bpm: number;
  time_signature: [number, number];
  sample_rate: number;
  tracks: DawTrack[];
  loop_range: { start_ms: number; end_ms: number; enabled: boolean } | null;
}

export interface StemUrlEntry {
  track_name: string;
  audio_url: string;
  duration_ms: number;
}

export interface ImportResult {
  track_ids: string[];
}

export type FxSuiteId =
  | 'clean'
  | 'vocal-polish'
  | 'drum-bus'
  | 'bass-weight'
  | 'wide-synth'
  | 'lofi-tape'
  | 'space-delay';

export interface DawTrackFx {
  bypass: boolean;
  suite: FxSuiteId;
  eq_low_db: number;
  eq_mid_db: number;
  eq_high_db: number;
  compressor: number;
  saturation: number;
  reverb: number;
  delay: number;
}

export interface DawPosition {
  position_ms: number;
  bar: number;
  beat: number;
  tick: number;
  mode: 'stopped' | 'playing' | 'paused';
}

export interface RegionCreated {
  region_id: string;
}

export interface SplitResult {
  left_id: string;
  right_id: string;
}

// ─── API ────────────────────────────────────────────────────────────

export const dawApi = {
  /** Initialise the DAW engine (creates it if not already running). */
  init: () => dawPost<void>('/init'),

  /** Tear down the DAW engine. */
  destroy: () => dawPost<void>('/destroy'),

  /** Get the current project state. */
  getProject: () => dawFetch<DawProject>('/project'),

  /** Import stems from URLs (cloud-extracted). */
  importStemUrls: (
    stems: StemUrlEntry[],
    projectName?: string,
    tempoBpm?: number,
  ) => dawPost<ImportResult>('/import-stem-urls', {
    stems,
    project_name: projectName,
    tempo_bpm: tempoBpm,
  }),

  /** Import stems from a local directory. */
  importStems: (sourcePath: string) =>
    dawPost<ImportResult>('/import-stems', { source_path: sourcePath }),

  /** Transport controls. */
  play: () => dawPost<DawPosition>('/play'),
  pause: () => dawPost<DawPosition>('/pause'),
  stop: () => dawPost('/stop'),
  seek: (positionMs: number) => dawPost('/seek', { position_ms: positionMs }),
  setTempo: (bpm: number) => dawPost('/set-tempo', { bpm }),
  setLoop: (startMs: number, endMs: number, enabled: boolean) =>
    dawPost('/set-loop', { start_ms: startMs, end_ms: endMs, enabled }),
  setMetronome: (enabled: boolean) => dawPost('/set-metronome', { enabled }),
  getPosition: () => dawFetch<DawPosition>('/position'),

  /** Track and region editing. */
  addTrack: (name: string, color: string) =>
    dawPost<{ track_id: string }>('/add-track', { name, color }),
  removeTrack: (trackId: string) =>
    dawPost('/remove-track', { track_id: trackId }),
  addRegion: (trackId: string, audioPath: string, positionMs: number) =>
    dawPost<RegionCreated>('/add-region', {
      track_id: trackId,
      audio_path: audioPath,
      position_ms: positionMs,
    }),
  moveRegion: (regionId: string, trackId: string, positionMs: number) =>
    dawPost('/move-region', {
      region_id: regionId,
      track_id: trackId,
      position_ms: positionMs,
    }),
  resizeRegion: (regionId: string, startMs: number, endMs: number) =>
    dawPost('/resize-region', {
      region_id: regionId,
      start_ms: startMs,
      end_ms: endMs,
    }),
  splitRegion: (regionId: string, positionMs: number) =>
    dawPost<SplitResult>('/split-region', {
      region_id: regionId,
      position_ms: positionMs,
    }),
  deleteRegion: (regionId: string) =>
    dawPost('/delete-region', { region_id: regionId }),
  setFade: (regionId: string, fadeInMs: number, fadeOutMs: number, curve = 'linear') =>
    dawPost('/set-fade', {
      region_id: regionId,
      fade_in_ms: fadeInMs,
      fade_out_ms: fadeOutMs,
      curve,
    }),
  getWaveformPeaks: (
    audioPath: string,
    widthPx: number,
    startMs: number,
    endMs: number,
  ) => dawFetch<{ peaks: [number, number][] }>(
    `/waveform-peaks?audio_path=${encodeURIComponent(audioPath)}&width_px=${widthPx}&start_ms=${startMs}&end_ms=${endMs}`,
  ),

  /** Track controls. */
  setTrackVolume: (trackId: string, db: number) =>
    dawPost('/set-track-volume', { track_id: trackId, db }),
  setTrackPan: (trackId: string, pan: number) =>
    dawPost('/set-track-pan', { track_id: trackId, pan }),
  setTrackMute: (trackId: string, muted: boolean) =>
    dawPost('/set-track-mute', { track_id: trackId, muted }),
  setTrackSolo: (trackId: string, solo: boolean) =>
    dawPost('/set-track-solo', { track_id: trackId, solo }),

  /** Undo/Redo. */
  undo: () => dawPost('/undo'),
  redo: () => dawPost('/redo'),

  /** Save/Load project. */
  saveProject: (path: string) => dawPost('/save-project', { path }),
  loadProject: (path: string) => dawPost<DawProject>('/load-project', { path }),

  /** Check if the engine is reachable. */
  ping: async (): Promise<boolean> => {
    try {
      await dawFetch('/project');
      return true;
    } catch {
      return false;
    }
  },

  /** Initialise engine if needed, return whether it's up. */
  ensureInit: async (): Promise<boolean> => {
    try {
      await dawPost('/init');
      return true;
    } catch {
      return false;
    }
  },
};
