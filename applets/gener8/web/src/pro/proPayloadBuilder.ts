export type CreateMode = 'song' | 'reference' | 'cover';

export interface BaseCreateFields {
  synth_model?: string;
  prompt: string;
  lyrics: string;
  style: string;
  rawStyle?: string;
  title: string;
  instrumental: boolean;
  vocalLanguage: string;
  bpm: number;
  keyScale: string;
  timeSignature: string;
  duration: number;
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
  audioCodes?: string;
  repaintingStart?: number;
  repaintingEnd?: number;
  instruction?: string;
  audioCoverStrength?: number;
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

export type SongCreatePayload = BaseCreateFields & {
  mode: 'song';
  taskType: 'text2music';
  referenceAudioUrl?: never;
  sourceAudioUrl?: never;
};

export type ReferenceCreatePayload = BaseCreateFields & {
  mode: 'reference';
  taskType: 'text2music';
  referenceAudioUrl: string;
  sourceAudioUrl?: never;
};

export type CoverCreatePayload = BaseCreateFields & {
  mode: 'cover';
  taskType: 'cover';
  sourceAudioUrl: string;
  referenceAudioUrl?: never;
};

export type CreatePayload =
  | SongCreatePayload
  | ReferenceCreatePayload
  | CoverCreatePayload;

export function buildSongPayload(fields: BaseCreateFields): SongCreatePayload {
  const {
    referenceAudioUrl: _referenceAudioUrl,
    sourceAudioUrl: _sourceAudioUrl,
    ...clean
  } = fields as BaseCreateFields & {
    referenceAudioUrl?: string;
    sourceAudioUrl?: string;
  };
  return {
    ...clean,
    mode: 'song',
    taskType: 'text2music',
  };
}

export function buildReferencePayload(
  fields: BaseCreateFields,
  referenceAudioUrl: string,
): ReferenceCreatePayload {
  const trimmed = referenceAudioUrl.trim();
  if (!trimmed) {
    throw new Error('Reference mode requires referenceAudioUrl.');
  }
  return {
    ...fields,
    mode: 'reference',
    taskType: 'text2music',
    referenceAudioUrl: trimmed,
  };
}

export function buildCoverPayload(
  fields: BaseCreateFields,
  sourceAudioUrl: string,
): CoverCreatePayload {
  const trimmed = sourceAudioUrl.trim();
  if (!trimmed) {
    throw new Error('Cover mode requires sourceAudioUrl.');
  }
  return {
    ...fields,
    mode: 'cover',
    taskType: 'cover',
    sourceAudioUrl: trimmed,
    audioCoverStrength: fields.audioCoverStrength ?? 1.0,
  };
}
