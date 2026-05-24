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

export interface Playlist {
  id: string;
  name: string;
  description?: string;
  coverUrl?: string;
  cover_url?: string;
  songIds?: string[];
  isPublic?: boolean;
  is_public?: boolean;
  user_id?: string;
  creator?: string;
  created_at?: string;
  song_count?: number;
  songs?: any[];
}

export interface Comment {
  id: string;
  songId?: string;
  song_id?: string;
  userId?: string;
  user_id?: string;
  username: string;
  content: string;
  createdAt?: Date | string;
  created_at?: string;
}

export interface GenerationParams {
  // 2026-05-04 SGT (#36): Simple/Custom mode toggle killed. Custom is the
  // only mode now; tier-gating governs panel surface (see CreatePanel
  // header comment for spec). `customMode` and `songDescription` removed
  // from the contract; legacy library entries with these fields are
  // ignored by consumers.
  prompt: string;
  lyrics: string;
  style: string;
  title: string;
  /** When Style Assist enhanced the style, this holds the raw user-authored
   *  style text. `style` contains the AI-enhanced version that was actually
   *  used for generation. Stored on Song.caption for the sidebar Copy button. */
  rawStyle?: string;

  // Common
  instrumental: boolean;
  vocalLanguage: string;

  // Music Parameters
  bpm: number;
  keyScale: string;
  timeSignature: string;
  duration: number;

  // 2026-05-04 SGT (engine-detected model swap): synth_model selects
  // which DiT GGUF ace-server should use for this request. Empty/omitted
  // = keep current; otherwise ace-server lazy-loads + swaps via
  // ServerFields.synth_model parsing in tools/ace-server.cpp:443.
  // Full filename per shim engine_models output, e.g.
  // "acestep-v15-xl-turbo-Q8_0.gguf".
  synth_model?: string;

  // Generation Settings
  inferenceSteps: number;
  guidanceScale: number;
  batchSize: number;
  randomSeed: boolean;
  seed: number;
  thinking: boolean;
  audioFormat: 'mp3' | 'flac';
  inferMethod: 'ode' | 'sde';
  shift: number;

  // LM Parameters
  lmTemperature: number;
  lmCfgScale: number;
  lmTopK: number;
  lmTopP: number;
  lmNegativePrompt: string;

  // Expert Parameters
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

export interface User {
  id: string;
  username: string;
  createdAt: Date;
  followerCount?: number;
  followingCount?: number;
  isFollowing?: boolean;
  isAdmin?: boolean;
  avatar_url?: string;
  banner_url?: string;
}

export interface UserProfile {
  user: User;
  publicSongs: Song[];
  publicPlaylists: Playlist[];
  stats: {
    totalSongs: number;
    totalLikes: number;
  };
}

// Simplified views for ACE-Step UI
export type View = 'create' | 'library' | 'videos' | 'profile' | 'song' | 'playlist' | 'search' | 'video-studio' | 'style-forge' | 'daw';
