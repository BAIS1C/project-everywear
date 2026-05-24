// @ts-nocheck
import { gener8Generate, gener8GenerationStatus } from '@everywear/transport';

async function api<T>(endpoint: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
  if (endpoint.startsWith('/api/generate/status/')) {
    const jobId = decodeURIComponent(endpoint.slice('/api/generate/status/'.length));
    return gener8GenerationStatus(jobId) as Promise<T>;
  }
  if (endpoint === '/api/v1/generate' || endpoint === '/api/generate') {
    return gener8Generate((options.body ?? {}) as Record<string, unknown>) as Promise<T>;
  }
  if (endpoint === '/api/generate/history') {
    return { jobs: [] } as T;
  }
  throw new Error(`Gener8 IPC endpoint is not wired yet: ${endpoint}`);
}

function getAudioRequestPath(audioUrl: string | undefined): string | undefined {
  if (!audioUrl) return undefined;
  const marker = '/audio/';
  const markerIndex = audioUrl.indexOf(marker);
  if (markerIndex >= 0) return audioUrl.slice(markerIndex).split(/[?#]/, 1)[0];
  if (audioUrl.startsWith('audio/')) return `/${audioUrl}`.split(/[?#]/, 1)[0];
  return audioUrl.split(/[?#]/, 1)[0];
}

export const TRACK_NAMES = [
  'vocals',
  'backing_vocals',
  'drums',
  'bass',
  'guitar',
  'keyboard',
  'percussion',
  'strings',
  'synth',
  'fx',
  'brass',
  'woodwinds',
] as const;

export type TrackName = (typeof TRACK_NAMES)[number];

export interface GenerationParams {
  title?: string;
  lyrics?: string;
  style?: string;
  duration?: number;
  bpm?: number;
  keyScale?: string;
  timeSignature?: string;
  instrumental?: boolean;
  inferenceSteps?: number;
  guidanceScale?: number;
  shift?: number;
  inferMethod?: 'ode' | 'sde';
  audioFormat?: 'mp3' | 'flac';
  sourceAudioUrl?: string;
  referenceAudioUrl?: string;
  repaintingStart?: number;
  repaintingEnd?: number;
  taskType?: string;
  trackName?: string;
  completeTrackClasses?: string[];
  sourceSongTitle?: string;
  instruction?: string;
}

export interface GenerationJob {
  id?: string;
  jobId?: string;
  status: 'pending' | 'queued' | 'running' | 'loading' | 'completed' | 'succeeded' | 'failed';
  progress?: number;
  audio_url?: string;
  result?: {
    audioUrls?: string[];
    audioKey?: string;
    bpm?: number;
    duration?: number;
    keyScale?: string;
    timeSignature?: string;
    warnings?: string[];
  };
  error?: string;
}

export interface RepaintParams {
  sourceAudioUrl: string;
  start: number;
  end: number;
  mode?: 'conservative' | 'balanced' | 'aggressive';
  strength?: number;
  trackName?: TrackName;
  style?: string;
  lyrics?: string;
}

export interface AddLayerParams {
  sourceAudioUrl: string;
  trackName: TrackName;
  style?: string;
  lyrics?: string;
  duration?: number;
}

export interface CompleteParams {
  sourceAudioUrl: string;
  trackClasses: TrackName[];
  style?: string;
  lyrics?: string;
  duration?: number;
}

function normalizeGenerationParams(params: GenerationParams): GenerationParams {
  return {
    ...params,
    referenceAudioUrl: getAudioRequestPath(params.referenceAudioUrl),
    sourceAudioUrl: getAudioRequestPath(params.sourceAudioUrl),
  };
}

export const generateApi = {
  startGeneration: (params: GenerationParams): Promise<GenerationJob> =>
    api('/api/v1/generate', { method: 'POST', body: normalizeGenerationParams(params) }),
  getStatus: (jobId: string): Promise<GenerationJob> =>
    api(`/api/generate/status/${encodeURIComponent(jobId)}`),
  getHistory: (): Promise<{ jobs: GenerationJob[] }> => api('/api/generate/history'),
};

export const studioApi = {
  extractStem: (sourceAudioUrl: string, trackName: TrackName, sourceSongTitle?: string) =>
    generateApi.startGeneration({
      lyrics: '',
      style: '',
      title: `Extract ${trackName}`,
      instrumental: true,
      taskType: 'extract',
      trackName,
      sourceAudioUrl,
      sourceSongTitle,
      instruction: `Extract the ${trackName} track from the audio:`,
      inferenceSteps: 50,
      guidanceScale: 1.0,
      shift: 1.0,
      inferMethod: 'ode',
      audioFormat: 'flac',
    }),

  addLayer: (params: AddLayerParams) =>
    generateApi.startGeneration({
      lyrics: params.lyrics || '',
      style: params.style || '',
      title: `Add ${params.trackName} layer`,
      instrumental: !params.lyrics,
      taskType: 'lego',
      trackName: params.trackName,
      sourceAudioUrl: params.sourceAudioUrl,
      instruction: `Generate the ${params.trackName} track based on the audio context:`,
      duration: params.duration,
      inferenceSteps: 50,
      guidanceScale: 1.0,
      shift: 1.0,
      inferMethod: 'ode',
      audioFormat: 'flac',
    }),

  repaint: (params: RepaintParams) =>
    generateApi.startGeneration({
      lyrics: params.lyrics || '',
      style: params.style || '',
      title: 'Repaint',
      instrumental: !params.lyrics,
      taskType: 'repaint',
      sourceAudioUrl: params.sourceAudioUrl,
      repaintingStart: params.start,
      repaintingEnd: params.end,
      trackName: params.trackName,
      instruction: 'Repaint the mask area based on the given conditions:',
      inferenceSteps: 50,
      guidanceScale: 1.0,
      shift: 1.0,
      inferMethod: 'ode',
      audioFormat: 'flac',
    }),

  complete: (params: CompleteParams) =>
    generateApi.startGeneration({
      lyrics: params.lyrics || '',
      style: params.style || '',
      title: 'Complete',
      instrumental: !params.lyrics,
      taskType: 'complete',
      sourceAudioUrl: params.sourceAudioUrl,
      trackName: params.trackClasses.join(' | '),
      completeTrackClasses: params.trackClasses,
      instruction: `Complete the input track with ${params.trackClasses.join(', ')}:`,
      duration: params.duration,
      inferenceSteps: 50,
      guidanceScale: 1.0,
      shift: 1.0,
      inferMethod: 'ode',
      audioFormat: 'flac',
    }),

  pollJob: async (
    jobId: string,
    onProgress?: (job: GenerationJob) => void,
    intervalMs = 2000,
    timeoutMs = 600000,
  ): Promise<GenerationJob> => {
    const start = Date.now();
    let failures = 0;
    return new Promise((resolve, reject) => {
      const poll = window.setInterval(async () => {
        try {
          const status = await generateApi.getStatus(jobId);
          failures = 0;
          onProgress?.(status);
          if (status.status === 'succeeded' || status.status === 'completed' || status.status === 'failed') {
            window.clearInterval(poll);
            resolve(status);
          } else if (Date.now() - start > timeoutMs) {
            window.clearInterval(poll);
            reject(new Error('pollJob: timed out'));
          }
        } catch (err) {
          failures += 1;
          if (failures >= 5) {
            window.clearInterval(poll);
            reject(err);
          }
        }
      }, intervalMs);
    });
  },
};
