/**
 * Shared type definitions for Gener8 web frontend.
 * Ported from s3studio-web/src/types.ts — canonical Song interface
 * used by Gener8 core, library, and Vid Studio.
 */

export interface Song {
  id: string;
  title: string;
  lyrics: string;
  style: string;
  coverUrl?: string;
  cover_url?: string;
  duration?: string | number;
  createdAt?: Date | string;
  created_at?: string;
  isGenerating?: boolean;
  queuePosition?: number;
  /** Set when generation has succeeded and waveform analysis is in flight. */
  isAnalysing?: boolean;
  /** Time (ms since epoch) when the current generation job started. */
  generationStartedAt?: number;
  /** Normalised peak amplitudes 0..1, produced by analyseWaveform. */
  peaks?: number[];
  /** Deterministic placeholder waveform, seeded from the song id. */
  fauxPeaks?: number[];
  /** True once real peaks are attached and ready to render. */
  peaksReady?: boolean;
  /** True once a peaks fetch has been attempted (prevents retry storms). */
  peaksAttempted?: boolean;
  tags: string[];
  audioUrl?: string;
  audio_url?: string;
  audio_key?: string;
  cover_key?: string;
  isPublic?: boolean;
  is_public?: boolean;
  likeCount?: number;
  like_count?: number;
  viewCount?: number;
  view_count?: number;
  userId?: string;
  user_id?: string;
  creator?: string;
  creator_avatar?: string;
  caption?: string;
  bpm?: number;
  key_scale?: string;
  time_signature?: string;
  seed?: number;
  addedAt?: string;
  generation_params?: string | Record<string, unknown>;
  lrc_data?: string | null;
}

export interface GenerationParams {
  prompt: string;
  lyrics: string;
  style: string;
  title: string;
  rawStyle?: string;
  instrumental: boolean;
  vocalLanguage: string;
  bpm: number;
  keyScale: string;
  timeSignature: string;
  duration: number;
  synth_model?: string;
  inferenceSteps: number;
  guidanceScale: number;
  batchSize: number;
  randomSeed: boolean;
  seed: number;
  thinking: boolean;
  audioFormat: 'mp3' | 'flac';
  inferMethod: 'ode' | 'sde';
  shift: number;
  lmTemperature: number;
  lmCfgScale: number;
  lmTopK: number;
  lmTopP: number;
  lmNegativePrompt: string;
  referenceAudioUrl?: string;
  sourceAudioUrl?: string;
  audioCodes?: string;
  repaintingStart?: number;
  repaintingEnd?: number;
  instruction?: string;
  audioCoverStrength?: number;
  taskType?: string;
  useAdg?: boolean;
  cfgIntervalStart?: number;
  cfgIntervalEnd?: number;
  customTimesteps?: string;
  useCotMetas?: boolean;
  useCotCaption?: boolean;
  useCotLanguage?: boolean;
  autogen?: boolean;
  constrainedDecodingDebug?: boolean;
  allowLmBatch?: boolean;
  getScores?: boolean;
  getLrc?: boolean;
  scoreScale?: number;
  lmBatchChunkSize?: number;
  trackName?: string;
  completeTrackClasses?: string[];
}

export interface PlayerState {
  currentSong: Song | null;
  isPlaying: boolean;
  progress: number;
  volume: number;
}

export type View = 'create' | 'library' | 'vid' | 'settings';
