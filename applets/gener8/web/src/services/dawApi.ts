const LOCAL_ENGINE = 'http://localhost:3001';

function dawUrl(path: string): string {
  return `${LOCAL_ENGINE}/api/daw${path}`;
}

async function dawFetch<T>(endpoint: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(dawUrl(endpoint), {
    headers: { 'Content-Type': 'application/json' },
    credentials: 'omit',
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
    body: body === undefined ? undefined : JSON.stringify(body),
  });
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

export interface DawProject {
  version: number;
  name: string;
  tempo_bpm: number;
  time_signature: [number, number];
  sample_rate: number;
  tracks: DawTrack[];
  loop_range: { start_ms: number; end_ms: number; enabled: boolean } | null;
}

export interface DawPosition {
  position_ms: number;
  bar: number;
  beat: number;
  tick: number;
  mode: 'stopped' | 'playing' | 'paused';
}

export interface StemUrlEntry {
  track_name: string;
  audio_url: string;
  duration_ms: number;
}

export const dawApi = {
  init: () => dawPost<{ status?: string }>('/init'),
  destroy: () => dawPost<{ status?: string }>('/destroy'),
  getProject: () => dawFetch<DawProject>('/project'),
  play: () => dawPost<DawPosition>('/play'),
  pause: () => dawPost<DawPosition>('/pause'),
  stop: () => dawPost<{ status?: string }>('/stop'),
  seek: (positionMs: number) => dawPost('/seek', { position_ms: positionMs }),
  setTempo: (bpm: number) => dawPost('/set-tempo', { bpm }),
  setLoop: (startMs: number, endMs: number, enabled: boolean) =>
    dawPost('/set-loop', { start_ms: startMs, end_ms: endMs, enabled }),
  setMetronome: (enabled: boolean) => dawPost('/set-metronome', { enabled }),
  getPosition: () => dawFetch<DawPosition>('/position'),
  addTrack: (name: string, color: string) =>
    dawPost<{ track_id: string }>('/add-track', { name, color }),
  removeTrack: (trackId: string) => dawPost('/remove-track', { track_id: trackId }),
  setTrackVolume: (trackId: string, db: number) =>
    dawPost('/set-track-volume', { track_id: trackId, db }),
  setTrackPan: (trackId: string, pan: number) =>
    dawPost('/set-track-pan', { track_id: trackId, pan }),
  setTrackMute: (trackId: string, muted: boolean) =>
    dawPost('/set-track-mute', { track_id: trackId, muted }),
  setTrackSolo: (trackId: string, solo: boolean) =>
    dawPost('/set-track-solo', { track_id: trackId, solo }),
  addRegion: (trackId: string, audioPath: string, positionMs: number) =>
    dawPost<{ region_id: string }>('/add-region', {
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
    dawPost('/resize-region', { region_id: regionId, start_ms: startMs, end_ms: endMs }),
  splitRegion: (regionId: string, positionMs: number) =>
    dawPost<{ left_id: string; right_id: string }>('/split-region', {
      region_id: regionId,
      position_ms: positionMs,
    }),
  deleteRegion: (regionId: string) => dawPost('/delete-region', { region_id: regionId }),
  setFade: (regionId: string, fadeInMs: number, fadeOutMs: number, curve = 'linear') =>
    dawPost('/set-fade', {
      region_id: regionId,
      fade_in_ms: fadeInMs,
      fade_out_ms: fadeOutMs,
      curve,
    }),
  getWaveformPeaks: (audioPath: string, widthPx: number, startMs: number, endMs: number) =>
    dawFetch<{ peaks: [number, number][] }>(
      `/waveform-peaks?audio_path=${encodeURIComponent(audioPath)}&width_px=${widthPx}&start_ms=${startMs}&end_ms=${endMs}`,
    ),
  importStemUrls: (stems: StemUrlEntry[], projectName?: string, tempoBpm?: number) =>
    dawPost<{ track_ids: string[] }>('/import-stem-urls', {
      stems,
      project_name: projectName,
      tempo_bpm: tempoBpm,
    }),
  importStems: (sourcePath: string) =>
    dawPost<{ track_ids: string[] }>('/import-stems', { source_path: sourcePath }),
  undo: () => dawPost('/undo'),
  redo: () => dawPost('/redo'),
};
