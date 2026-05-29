import type { CreatePayload } from './pro/proPayloadBuilder';

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

export type GenerationParams = CreatePayload;

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

// Simplified views for Gener8 UI
export type View = 'create' | 'library' | 'videos' | 'profile' | 'song' | 'playlist' | 'search' | 'video-studio' | 'style-forge' | 'daw';
