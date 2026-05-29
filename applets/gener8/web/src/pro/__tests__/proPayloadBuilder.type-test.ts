import {
  buildCoverPayload,
  buildReferencePayload,
  buildSongPayload,
  type BaseCreateFields,
  type CoverCreatePayload,
  type ReferenceCreatePayload,
  type SongCreatePayload,
} from '../proPayloadBuilder';

const baseFields: BaseCreateFields = {
  prompt: 'prompt',
  lyrics: 'lyrics',
  style: 'style',
  title: 'title',
  instrumental: false,
  vocalLanguage: 'en',
  bpm: 0,
  keyScale: '',
  timeSignature: '',
  duration: -1,
  inferenceSteps: 8,
  guidanceScale: 1,
  batchSize: 1,
  randomSeed: true,
  seed: -1,
  thinking: false,
  audioFormat: 'mp3',
  inferMethod: 'ode',
  shift: 3,
  lmTemperature: 0.85,
  lmCfgScale: 2,
  lmTopK: 0,
  lmTopP: 0.9,
  lmNegativePrompt: 'NO USER INPUT',
};

const songPayload: SongCreatePayload = buildSongPayload(baseFields);
const referencePayload: ReferenceCreatePayload = buildReferencePayload(baseFields, '/audio/reference.wav');
const coverPayload: CoverCreatePayload = buildCoverPayload(baseFields, '/audio/source.wav');

void songPayload;
void referencePayload;
void coverPayload;

// @ts-expect-error Song mode must not carry a reference slot.
const songWithReference: SongCreatePayload = { ...songPayload, referenceAudioUrl: '/audio/reference.wav' };

// @ts-expect-error Song mode must not carry a source slot.
const songWithSource: SongCreatePayload = { ...songPayload, sourceAudioUrl: '/audio/source.wav' };

// @ts-expect-error Reference and Cover slots are mutually exclusive.
const referenceWithSource: ReferenceCreatePayload = { ...referencePayload, sourceAudioUrl: '/audio/source.wav' };

// @ts-expect-error Cover and Reference slots are mutually exclusive.
const coverWithReference: CoverCreatePayload = { ...coverPayload, referenceAudioUrl: '/audio/reference.wav' };

void songWithReference;
void songWithSource;
void referenceWithSource;
void coverWithReference;
