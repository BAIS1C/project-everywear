// @ts-nocheck
// ═══════════════════════════════════════════════════════════════════════════
// src/services/api.ts — Federated client layer (post-hub-pivot, ship-sprint)
// ═══════════════════════════════════════════════════════════════════════════
//
// Two target surfaces:
//
//   • LOCAL ENGINE (Tauri axum shim on 127.0.0.1:3001)
//     Hits the user's own machine: generate, engine props, lora, training,
//     patches. Never reachable from a browser without the shim running.
//     When the UI is served from a public HTTPS origin (s3studio.xyz,
//     vercel.app, strandsnation.xyz), `getApiBase()` returns the literal
//     `http://localhost:3001` and the browser CORS layer on the shim has
//     `allow_private_network(true)` so Chrome PNA lets the call through.
//
//   • SUPABASE (PostgREST + RLS on the browser-safe publishable key)
//     Hits the shared project. Auth, profiles, subscriptions were already
//     migrated in prior sessions (AuthContext.tsx uses supabase.auth.*
//     directly). This file adds: personal songs library and personal
//     playlists, both RLS-locked to `user_id = auth.uid()` via migrations
//     0009_songs.sql and 0010_playlists.sql.
//
// Ship-sprint scope cut (2026-04-22):
//   Social / cross-user surfaces are OUT for launch. That means: no public
//   song feed, no featured creators, no follows, no comments, no likes
//   crossing users, no search-across-users, no shared playlists, no public
//   profile views. These ship as a paid-tier social update post-launch.
//
//   Rather than delete every import site, the social methods below return
//   empty arrays / no-op responses so the legacy UI components (UserProfile,
//   SearchPage, SongShare, PlaylistDetail) continue to compile and render
//   empty states. They'll be pruned from the router in a follow-up pass.
//
// ═══════════════════════════════════════════════════════════════════════════

import {
  fileToBase64,
  gener8EngineModels,
  gener8Generate,
  gener8GenerationStatus,
  gener8UploadAudio,
  vaultFileUrl,
  vaultGetItem,
  vaultRegisterAudio,
  vaultSearch,
  type VaultItem,
} from '@everywear/transport';
import { supabase } from '../lib/supabase';

// ─── API base resolution ────────────────────────────────────────────────────

const LOCAL_ENGINE = 'http://localhost:3001';

/** Base URL for routes that hit the user's local engine / Tauri shim. */
export function getApiBase(): string {
  if (typeof window === 'undefined') return '';

  const host = window.location.hostname;

  // Hosted UI — calls back to user's local engine.
  if (host.includes('strandsnation.xyz') || host.includes('s3studio.xyz') || host.includes('vercel.app')) {
    return LOCAL_ENGINE;
  }

  // Embedded in demoOS.
  if (window.location.pathname.startsWith('/stepstudio')) {
    return '/api/soundwave';
  }

  // Local dev (Vite proxy handles `/api` → localhost:3001).
  return '';
}

/**
 * Resolve a song's stored audio_url into something the browser can play.
 * Relative `/audio/...` paths get the shim base prepended; anything else
 * (already-absolute URL) is returned unchanged.
 */
export function getAudioUrl(audioUrl: string | undefined | null, _songId?: string): string | undefined {
  if (!audioUrl) return undefined;
  if (/^[a-zA-Z]:[\\/]/.test(audioUrl) || audioUrl.startsWith('\\\\')) {
    return vaultFileUrl(audioUrl);
  }
  if (audioUrl.startsWith('/audio/')) {
    const raw = audioUrl.slice('/audio/'.length);
    if (/^[a-zA-Z]:[\\/]/.test(raw) || raw.startsWith('\\\\')) {
      return vaultFileUrl(raw);
    }
    const base = getApiBase();
    return base ? `${base}${audioUrl}` : audioUrl;
  }
  return audioUrl;
}

/**
 * Convert a browser-playable shim audio URL back to the request form the
 * local engine expects. Playback wants `http://localhost:3001/audio/...`;
 * generation wants `/audio/...` so Rust can resolve the storage key.
 */
export function getAudioRequestPath(audioUrl: string | undefined | null): string | undefined {
  if (!audioUrl) return undefined;
  const trimmed = audioUrl.trim();
  const marker = '/audio/';
  const markerIndex = trimmed.indexOf(marker);
  const path = markerIndex >= 0
    ? trimmed.slice(markerIndex)
    : trimmed.startsWith('audio/')
      ? `/${trimmed}`
      : trimmed;
  return path.split(/[?#]/, 1)[0];
}

// ─── Shim-bound `api()` helper ──────────────────────────────────────────────
// Used only for local-engine routes (generate, engine, lora, training,
// patches). Supabase-backed routes use the supabase client directly.

interface ApiOptions {
  method?: string;
  body?: unknown;
  token?: string | null;
}

async function api<T>(endpoint: string, options: ApiOptions = {}): Promise<T> {
  const { method = 'GET', body, token } = options;

  if (endpoint === '/api/v1/generate' || endpoint === '/api/generate') {
    return gener8Generate((body ?? {}) as Record<string, unknown>) as Promise<T>;
  }
  if (endpoint.startsWith('/api/generate/status/')) {
    const jobId = decodeURIComponent(endpoint.slice('/api/generate/status/'.length));
    return gener8GenerationStatus(jobId) as Promise<T>;
  }
  if (endpoint === '/api/generate/history') {
    return { jobs: [] } as T;
  }
  if (endpoint === '/api/generate/format') {
    const input = (body ?? {}) as Record<string, unknown>;
    return {
      success: true,
      caption: input.caption,
      lyrics: input.lyrics,
      bpm: input.bpm,
      duration: input.duration,
      key_scale: input.keyScale,
      time_signature: input.timeSignature,
    } as T;
  }
  if (endpoint === '/api/generate/analyze-audio') {
    return { success: true } as T;
  }
  if (endpoint === '/api/upload-audio' && body && typeof body === 'object' && 'file' in body) {
    const file = (body as { file: File }).file;
    return gener8UploadAudio({
      fileName: file.name,
      contentType: file.type,
      dataBase64: await fileToBase64(file),
    }) as Promise<T>;
  }
  if (endpoint.startsWith('/api/engine/models')) {
    const inventory = await gener8EngineModels().catch(() => null);
    if (inventory && typeof inventory === 'object' && 'models' in inventory) return inventory as T;
    return {
      models: [
        { name: 'ACE-Step v1', is_default: true, is_loaded: true, supported_task_types: ['text2music', 'reference', 'cover'] },
      ],
      default_model: 'ACE-Step v1',
      lm_models: [],
      loaded_lm_model: '',
      llm_initialized: true,
    } as T;
  }
  if (endpoint.startsWith('/api/engine/init')) {
    return { message: 'Ready', loaded_model: 'ACE-Step v1', llm_initialized: true } as T;
  }
  if (endpoint.startsWith('/api/engine/health')) {
    return { status: 'ready', model_initialized: true, llm_initialized: true, loaded_model: 'ACE-Step v1' } as T;
  }
  if (endpoint.startsWith('/api/engine/model-defaults')) {
    return {
      model_type: 'turbo',
      config_path: '',
      inference_steps: 27,
      inference_steps_min: 4,
      inference_steps_max: 60,
      guidance_scale: 7,
      guidance_scale_visible: true,
      shift: 3,
      shift_visible: true,
      cot_recommended: false,
      thinking: false,
      use_adg_visible: false,
      cfg_interval_visible: false,
      infer_method: 'ode',
      batch_size: 1,
    } as T;
  }
  if (endpoint.startsWith('/api/lora') || endpoint.startsWith('/api/training') || endpoint.startsWith('/api/patches')) {
    return { patches: [], status: 'idle', adapters: [], buckets: [] } as T;
  }
  if (endpoint.startsWith('/api/songs')) {
    return handleVaultSongs<T>(endpoint, method, body);
  }
  if (endpoint.startsWith('/api/playlists')) {
    return handleLocalPlaylists<T>(endpoint, method, body);
  }

  const headers: HeadersInit = {
    'Content-Type': 'application/json',
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const response = await fetch(`${getApiBase()}${endpoint}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    // credentials: 'omit' is fine — the shim doesn't use cookies, and
    // including credentials on a cross-origin PNA request would require
    // stricter CORS than `allow_origin(Any)`.
    credentials: 'omit',
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Request failed' }));
    const errorMessage = error.error || error.message || 'Request failed';
    throw new Error(`${response.status}: ${errorMessage}`);
  }

  return response.json();
}

// ═══════════════════════════════════════════════════════════════════════════
// User shape (compat). AuthContext owns the live session; this type is
// kept so legacy components (EditProfileModal, UserProfile, etc.) type-check.
// ═══════════════════════════════════════════════════════════════════════════

export interface User {
  id: string;
  username: string;
  raw_username?: string;
  display_name?: string;
  email?: string;
  email_verified?: boolean;
  phone?: string;
  phone_verified?: boolean;
  isAdmin?: boolean;
  bio?: string;
  avatar_url?: string;
  banner_url?: string;
  createdAt?: string;
  gener8_base_licence?: boolean;
  gener8_pro_licence?: boolean;
  creator_studio_licence?: boolean;
  /** @deprecated maps to creator_studio_licence */
  vid_pro_licence?: boolean;
  /** @deprecated DAW is a Creator Studio feature */
  daw_pro_licence?: boolean;
  trial?: boolean;
  trial_expires_at?: string;
  demo_start_time?: string;
  tiers?: Record<string, boolean>;
}

/** Paid-tier / earned profile badge. Rendered in UserProfile + Taskbar. */
export interface ProfileBadge {
  id: string;
  label: string;
  color: 'yellow' | 'purple' | 'blue' | 'teal' | 'orange' | 'pink' | 'green' | string;
  description?: string;
}

export interface UserProfile extends User {
  bio?: string;
  avatar_url?: string;
  banner_url?: string;
  created_at: string;
  /** Creator Studio / paid-tier badge list. Empty today, wired on social update. */
  badges?: ProfileBadge[];
  /** Paid-tier display label: 'free' | 'gener8' | 'gener8_pro' | 'creator_studio'. */
  accountTier?: string;
  /** Timestamp of first paid subscription; surfaced on profile as "Supporter since…". */
  supporter_since?: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// Songs API — Supabase-backed, personal library only
// ═══════════════════════════════════════════════════════════════════════════
// Writes happen from the UI after generate succeeds. Reads return the user's
// own songs only (RLS-enforced). Cross-user reads / featured / comments /
// likes / play tracking are stubbed to empty for the ship-sprint scope cut.

export interface Song {
  id: string;
  title: string;
  lyrics: string;
  style: string;
  caption?: string;
  cover_url?: string;
  /** camelCase mirror of cover_url — kept for legacy UI consumers. */
  coverUrl?: string;
  audio_url?: string;
  /** camelCase mirror of audio_url — preferred by player components. */
  audioUrl?: string;
  duration?: number;
  bpm?: number;
  key_scale?: string;
  time_signature?: string;
  tags: string[];
  is_public: boolean;
  /** camelCase mirror of is_public. */
  isPublic?: boolean;
  like_count?: number;
  likeCount?: number;
  view_count?: number;
  viewCount?: number;
  user_id?: string;
  userId?: string;
  created_at: string;
  /** camelCase mirror of created_at, pre-parsed to Date for sorts. */
  createdAt?: Date | string;
  creator?: string;
  /** Creator avatar URL — legacy social field. Empty on personal library rows. */
  creator_avatar?: string;
  /** Playlist junction field — present on rows read via playlistsApi.getPlaylist. */
  addedAt?: string;
  generation_params?: string | Record<string, unknown>;
  lrc_data?: string;
}

interface Comment {
  id: string;
  song_id: string;
  user_id: string;
  username: string;
  content: string;
  created_at: string;
}

// (Removed `normaliseSong`: it folded Supabase row shape into Song. Now
//  songs come from the local shim as LibraryTrack, translated by
//  `trackToSong` further down.)

// ─── Local library adapter ─────────────────────────────────────────────────
//
// Songs and playlists moved OFF Supabase and onto the Tauri shim's local
// library.json (ported from the legacy hub at
// strands-sound-studio/packages/hub). Supabase remains AUTH-ONLY for this
// release; Phase 2 social sharing will opt tracks UP, not move them.
//
// On-disk shape: `LibraryTrack` (camelCase, see src-tauri/src/library.rs).
// UI shape: `Song` (snake_case + camelCase duplicates, see above). The
// `trackToSong` / `songToTrack` pair is the sole translation boundary.

interface LibraryTrackWire {
  id: string;
  title: string;
  style?: string;
  lyrics?: string;
  audioKey: string;
  duration?: number;
  bpm?: number | null;
  keyScale?: string | null;
  timeSignature?: string | null;
  tags?: string[];
  generationParams?: Record<string, unknown>;
  createdAt: string;
  shared?: boolean;
  stems?: Record<string, string> | null;
  coverKey?: string | null;
  lrcData?: string | null;
}

/** Convert an on-disk library track into the UI's Song shape. */
function trackToSong(t: LibraryTrackWire, ownerId?: string): Song {
  const audioUrl = t.audioKey ? getAudioUrl(t.audioKey) : undefined;
  const coverUrl = t.coverKey
    ? (t.coverKey.startsWith('data:') || t.coverKey.startsWith('http')
        ? t.coverKey
        : getAudioUrl(`/audio/${t.coverKey}`))
    : undefined;
  const isPublic = t.shared ?? false;
  const createdAt = t.createdAt ? new Date(t.createdAt) : undefined;
  return {
    id: t.id,
    title: t.title,
    lyrics: t.lyrics ?? '',
    style: t.style ?? '',
    caption: undefined,
    cover_url: coverUrl,
    coverUrl,
    audio_url: audioUrl,
    audioUrl,
    duration: t.duration ?? undefined,
    bpm: t.bpm ?? undefined,
    key_scale: t.keyScale ?? undefined,
    time_signature: t.timeSignature ?? undefined,
    tags: t.tags ?? [],
    is_public: isPublic,
    isPublic,
    like_count: 0,
    likeCount: 0,
    view_count: 0,
    viewCount: 0,
    user_id: ownerId,
    userId: ownerId,
    created_at: t.createdAt,
    createdAt,
    creator: undefined,
    creator_avatar: undefined,
    generation_params: t.generationParams,
    lrc_data: t.lrcData ?? undefined,
  };
}

/** Convert a partial UI Song into the shim's LibraryTrack wire shape. */
function songToTrackPatch(s: Partial<Song>): Partial<LibraryTrackWire> {
  const patch: Partial<LibraryTrackWire> = {};
  if (s.title !== undefined) patch.title = s.title;
  if (s.style !== undefined) patch.style = s.style ?? '';
  if (s.lyrics !== undefined) patch.lyrics = s.lyrics ?? '';
  if (s.duration !== undefined) patch.duration = s.duration ?? undefined;
  if (s.bpm !== undefined) patch.bpm = s.bpm ?? null;
  if (s.key_scale !== undefined) patch.keyScale = s.key_scale ?? null;
  if (s.time_signature !== undefined) patch.timeSignature = s.time_signature ?? null;
  if (s.tags !== undefined) patch.tags = s.tags;
  if (s.is_public !== undefined) patch.shared = s.is_public ?? false;
  if (s.generation_params !== undefined) {
    patch.generationParams =
      typeof s.generation_params === 'string'
        ? (() => { try { return JSON.parse(s.generation_params as string); } catch { return {}; } })()
        : (s.generation_params as Record<string, unknown>);
  }
  if (s.cover_url !== undefined) patch.coverKey = s.cover_url ?? null;
  return patch;
}

/**
 * Extract the `audioKey` from any of the shapes the UI historically passed
 * in: an absolute `/audio/...` URL, a shim-prefixed URL, or an already-
 * stripped key like `gener8/abc.mp3`. Anything else (http: URL to an
 * external asset) is kept verbatim and the shim will round-trip it.
 */
function extractAudioKey(value: string | null | undefined): string {
  if (!value) return '';
  if (value.startsWith('/audio/')) return value.slice('/audio/'.length);
  const base = LOCAL_ENGINE;
  if (value.startsWith(`${base}/audio/`)) return value.slice(`${base}/audio/`.length);
  return value;
}

async function currentUserId(): Promise<string | undefined> {
  try {
    const { data } = await supabase.auth.getUser();
    return data.user?.id;
  } catch {
    return undefined;
  }
}

export const songsApi = {
  /** Local library. Per-user folder-segmented (#26, 2026-05-02 SGT): the
   *  shim resolves the bearer token to a folder_key and reads only that
   *  user's library.json. Token MUST be threaded through; calls without
   *  it 401 from the auth_extract middleware. */
  getMySongs: async (token: string): Promise<{ songs: Song[] }> => {
    const body = await api<{ tracks: LibraryTrackWire[]; total: number }>(
      '/api/songs?limit=500&sortBy=createdAt&sortDir=desc',
      { token },
    );
    const ownerId = await currentUserId();
    return { songs: (body.tracks ?? []).map((t) => trackToSong(t, ownerId)) };
  },

  getSong: async (id: string, token?: string | null): Promise<{ song: Song }> => {
    const t = await api<LibraryTrackWire>(
      `/api/songs/${encodeURIComponent(id)}`,
      { token },
    );
    if (!t || !t.id) throw new Error('404: Song not found');
    const ownerId = await currentUserId();
    return { song: trackToSong(t, ownerId) };
  },

  /** Song + comments. Social comments are off; comments array is always []. */
  getFullSong: async (id: string, token?: string | null): Promise<{ song: Song; comments: Comment[] }> => {
    const { song } = await songsApi.getSong(id, token);
    return { song, comments: [] };
  },

  /**
   * Persist a generation result into the local library. Expects the Song
   * to carry `audio_url` either as a `/audio/gener8/<id>.mp3` key (the
   * shim already wrote the bytes during /api/generate/status poll) or as
   * a data URL the caller has already reified to disk elsewhere.
   *
   * If the caller did not supply an `id`, one is generated via
   * `crypto.randomUUID()` so the track is stable across renames.
   */
  createSong: async (song: Partial<Song>, token: string): Promise<{ song: Song }> => {
    const id = song.id ?? (globalThis.crypto?.randomUUID?.() ?? `track_${Date.now()}`);
    const audioSource = song.audio_url ?? song.audioUrl ?? '';
    const audioKey = extractAudioKey(audioSource);
    if (!audioKey) {
      throw new Error('createSong: missing audio_url/audioUrl');
    }
    const track: LibraryTrackWire = {
      id,
      title: song.title ?? 'Untitled',
      style: song.style ?? '',
      lyrics: song.lyrics ?? '',
      audioKey,
      duration: song.duration ?? 0,
      bpm: song.bpm ?? null,
      keyScale: song.key_scale ?? null,
      timeSignature: song.time_signature ?? null,
      tags: song.tags ?? [],
      generationParams:
        typeof song.generation_params === 'string'
          ? (() => { try { return JSON.parse(song.generation_params as string); } catch { return {}; } })()
          : ((song.generation_params as Record<string, unknown>) ?? {}),
      createdAt: song.created_at ?? new Date().toISOString(),
      shared: song.is_public ?? false,
      stems: null,
      coverKey: song.cover_url ?? null,
      lrcData: song.lrc_data ?? null,
    };
    const saved = await api<LibraryTrackWire>('/api/songs', { method: 'POST', body: track, token });
    const ownerId = await currentUserId();
    return { song: trackToSong(saved, ownerId) };
  },

  updateSong: async (id: string, updates: Partial<Song>, token: string): Promise<{ song: Song }> => {
    const patch = songToTrackPatch(updates);
    if (updates.audio_url !== undefined || updates.audioUrl !== undefined) {
      const raw = updates.audio_url ?? updates.audioUrl ?? '';
      const key = extractAudioKey(raw);
      if (key) patch.audioKey = key;
    }
    const saved = await api<LibraryTrackWire>(
      `/api/songs/${encodeURIComponent(id)}`,
      { method: 'PUT', body: patch, token },
    );
    const ownerId = await currentUserId();
    return { song: trackToSong(saved, ownerId) };
  },

  deleteSong: async (id: string, token: string): Promise<{ success: boolean }> => {
    await api<{ deleted: string }>(
      `/api/songs/${encodeURIComponent(id)}`,
      { method: 'DELETE', token },
    );
    return { success: true };
  },

  togglePrivacy: async (id: string, token: string): Promise<{ isPublic: boolean }> => {
    const current = await api<LibraryTrackWire>(
      `/api/songs/${encodeURIComponent(id)}`,
      { token },
    );
    const next = !(current.shared ?? false);
    await api<LibraryTrackWire>(
      `/api/songs/${encodeURIComponent(id)}`,
      { method: 'PUT', body: { shared: next }, token },
    );
    return { isPublic: next };
  },

  // ─── Stubbed social methods (out for ship, return empty) ────────────────

  /** @deprecated social — returns [] until paid social update ships */
  getPublicSongs: async (_limit = 20, _offset = 0): Promise<{ songs: Song[] }> =>
    ({ songs: [] }),

  /** @deprecated social — returns [] until paid social update ships */
  getFeaturedSongs: async (): Promise<{ songs: Song[] }> =>
    ({ songs: [] }),

  /** @deprecated social — inert until paid social update ships */
  toggleLike: async (_id: string, _token: string): Promise<{ liked: boolean }> =>
    ({ liked: false }),

  /** @deprecated social — returns [] until paid social update ships */
  getLikedSongs: async (_token: string): Promise<{ songs: Song[] }> =>
    ({ songs: [] }),

  /** @deprecated social — inert until paid social update ships */
  trackPlay: async (_id: string, _token?: string | null): Promise<{ viewCount: number }> =>
    ({ viewCount: 0 }),

  /** @deprecated social — returns [] until paid social update ships */
  getComments: async (_id: string, _token?: string | null): Promise<{ comments: Comment[] }> =>
    ({ comments: [] }),

  /** @deprecated social — inert until paid social update ships */
  addComment: async (_id: string, _content: string, _token: string): Promise<{ comment: Comment }> => {
    throw new Error('501: comments ship with the paid social update');
  },

  /** @deprecated social — inert until paid social update ships */
  deleteComment: async (_commentId: string, _token: string): Promise<{ success: boolean }> => {
    throw new Error('501: comments ship with the paid social update');
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// Generation API — local engine
// ═══════════════════════════════════════════════════════════════════════════

export interface GenerationParams {
  // 2026-05-04 SGT (#36): customMode + songDescription removed; Custom is
  // the only mode, tier-gating governs panel surface. Mirror of the
  // canonical type in src/types.ts.
  prompt?: string;
  lyrics: string;
  style: string;
  title: string;
  // 2026-05-04 SGT (engine-detected model swap): forwarded directly to
  // ace-server's ServerFields.synth_model. ace-server lazy-loads + swaps
  // at request time; no /init call needed.
  synth_model?: string;
  instrumental: boolean;
  vocalLanguage?: string;
  duration?: number;
  bpm?: number;
  keyScale?: string;
  timeSignature?: string;
  inferenceSteps?: number;
  guidanceScale?: number;
  batchSize?: number;
  randomSeed?: boolean;
  seed?: number;
  thinking?: boolean;
  audioFormat?: 'mp3' | 'flac';
  inferMethod?: 'ode' | 'sde';
  shift?: number;
  lmTemperature?: number;
  lmCfgScale?: number;
  lmTopK?: number;
  lmTopP?: number;
  lmNegativePrompt?: string;
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
  sourceSongTitle?: string;
}

export interface GenerationJob {
  jobId: string;
  status: 'pending' | 'queued' | 'running' | 'loading' | 'succeeded' | 'failed';
  queuePosition?: number;
  etaSeconds?: number;
  message?: string;
  result?: {
    audioUrls: string[];
    /** Storage key the shim writes alongside audioUrls; preferred over
     *  audioUrls[0] when present because it survives the /audio/{key}
     *  rewrite the shim performs. App.tsx + Gener8Core.tsx read this. */
    audioKey?: string;
    bpm?: number;
    duration?: number;
    keyScale?: string;
    timeSignature?: string;
    warnings?: string[];
    lrcData?: string;
  };
  error?: string;
}

function vaultItemToTrack(item: VaultItem): LibraryTrackWire {
  return {
    id: item.id,
    title: item.title,
    style: item.genre ?? '',
    lyrics: item.lyrics_text ?? '',
    audioKey: item.file_path,
    duration: item.duration_seconds,
    bpm: item.bpm ?? null,
    keyScale: undefined,
    timeSignature: undefined,
    tags: item.tags ?? [],
    generationParams: {},
    createdAt: new Date(item.created_at || Date.now()).toISOString(),
    shared: false,
    stems: null,
    coverKey: null,
    lrcData: item.lyrics_text ?? null,
  };
}

async function handleVaultSongs<T>(endpoint: string, method: string, body: unknown): Promise<T> {
  if (method === 'GET' && endpoint.startsWith('/api/songs?')) {
    const response = await vaultSearch('', 'audio', 'newest', 500, 0);
    return {
      tracks: response.items.filter((item) => item.media_type === 'audio').map(vaultItemToTrack),
      total: response.total,
    } as T;
  }
  if (method === 'GET' && endpoint.startsWith('/api/songs/')) {
    const id = decodeURIComponent(endpoint.slice('/api/songs/'.length).split(/[?#]/, 1)[0]);
    const item = await vaultGetItem(id);
    if (!item || item.media_type !== 'audio') {
      throw new Error('404: Song not found');
    }
    return vaultItemToTrack(item) as T;
  }
  if (method === 'POST' && endpoint === '/api/songs') {
    const track = body as Partial<LibraryTrackWire>;
    const filePath = track.audioKey || '';
    if (filePath.includes('Everywear Vault')) {
      return {
        ...track,
        id: track.id || `vault_${Date.now()}`,
        title: track.title || 'Untitled',
        audioKey: filePath,
        createdAt: track.createdAt || new Date().toISOString(),
      } as T;
    }
    const item = await vaultRegisterAudio({
      title: track.title || 'Untitled',
      filePath,
      durationSeconds: Number(track.duration || 0),
      genre: track.style,
      bpm: track.bpm ?? undefined,
      lyricsText: track.lyrics,
      tags: track.tags,
    });
    return vaultItemToTrack(item) as T;
  }
  if (method === 'PUT' && endpoint.startsWith('/api/songs/')) {
    const id = decodeURIComponent(endpoint.slice('/api/songs/'.length).split(/[?#]/, 1)[0]);
    const item = await vaultGetItem(id);
    if (!item || item.media_type !== 'audio') {
      throw new Error('404: Song not found');
    }
    return {
      ...vaultItemToTrack(item),
      ...(body as Partial<LibraryTrackWire>),
    } as T;
  }
  if (method === 'DELETE' && endpoint.startsWith('/api/songs/')) {
    return { deleted: endpoint.slice('/api/songs/'.length) } as T;
  }
  return { tracks: [], total: 0 } as T;
}

async function handleLocalPlaylists<T>(_endpoint: string, method: string, body: unknown): Promise<T> {
  if (method === 'POST') {
    const draft = body as Partial<Playlist>;
    return {
      playlist: {
        id: `playlist_${Date.now()}`,
        name: draft.name || 'Playlist',
        description: draft.description || '',
        is_public: false,
        song_count: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    } as T;
  }
  return { playlists: [] } as T;
}

function normalizeGenerationParams(params: GenerationParams): GenerationParams {
  return {
    ...params,
    referenceAudioUrl: getAudioRequestPath(params.referenceAudioUrl),
    sourceAudioUrl: getAudioRequestPath(params.sourceAudioUrl),
  };
}

export const generateApi = {
  // Path aligned to the Rust shim (src-tauri/src/shim.rs → /api/v1/generate).
  startGeneration: (params: GenerationParams, token: string): Promise<GenerationJob> =>
    api('/api/v1/generate', { method: 'POST', body: normalizeGenerationParams(params), token }),

  getStatus: (jobId: string, token: string): Promise<GenerationJob> =>
    api(`/api/generate/status/${jobId}`, { token }),

  getHistory: (token: string): Promise<{ jobs: GenerationJob[] }> =>
    api('/api/generate/history', { token }),

  uploadAudio: async (
    file: File,
    token: string,
  ): Promise<{
    url: string;
    key: string;
    filename?: string;
    original_filename?: string;
    size_bytes?: number;
    /** Server-probed duration via symphonia. Null when probe fails;
     *  callers should fall back to HTMLMediaElement.duration in that case.
     *  2026-05-04 SGT (Bug E fix). */
    duration_seconds?: number | null;
  }> => {
    void token;
    const uploaded = await gener8UploadAudio({
      fileName: file.name,
      contentType: file.type,
      dataBase64: await fileToBase64(file),
    });
    return {
      url: uploaded.audioUrl,
      key: uploaded.key,
      filename: uploaded.filename,
      original_filename: file.name,
      size_bytes: uploaded.size,
      duration_seconds: null,
    };
  },

  formatInput: (params: {
    caption: string;
    lyrics?: string;
    bpm?: number;
    duration?: number;
    keyScale?: string;
    timeSignature?: string;
    temperature?: number;
    topK?: number;
    topP?: number;
  }, token: string): Promise<{
    success: boolean;
    caption?: string;
    lyrics?: string;
    bpm?: number;
    duration?: number;
    key_scale?: string;
    language?: string;
    time_signature?: string;
    status_message?: string;
    error?: string;
  }> => api('/api/generate/format', { method: 'POST', body: params, token }),

  /** Analyze a reference/cover audio file via the LM. Extracts style tags,
   *  BPM, key, time signature, language from the audio content. Uses
   *  ace-server's /understand pipeline (VAE-encode → LM decode). */
  analyzeAudio: (params: {
    audioUrl: string;
    temperature?: number;
    topK?: number;
    topP?: number;
  }, token: string): Promise<{
    success: boolean;
    caption?: string;
    lyrics?: string;
    bpm?: number;
    duration?: number;
    key_scale?: string;
    language?: string;
    time_signature?: string;
    error?: string;
  }> => api('/api/generate/analyze', { method: 'POST', body: params, token }),
};

// ═══════════════════════════════════════════════════════════════════════════
// Users API — own profile only (Supabase-backed)
// ═══════════════════════════════════════════════════════════════════════════
// Cross-user profile views, follows, featured creators, follower stats are
// all stubbed to empty for ship. Profile edit + avatar/banner upload go
// through Supabase directly: profiles table for text fields, Storage for
// binaries (bucket `avatars` / `banners`, public-read, owner-write).

export const usersApi = {
  /**
   * Get a profile by handle. RLS allows authenticated reads of any profile
   * row (`profiles readable by authenticated` policy in 0001), so this
   * still works for your own handle; other-user profile pages render but
   * all cross-user action buttons (follow, DM, etc.) are inert.
   */
  getProfile: async (username: string, _token?: string | null): Promise<{ user: UserProfile }> => {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('handle', username)
      .maybeSingle();
    if (error) throw new Error(`getProfile: ${error.message}`);
    if (!data) throw new Error('404: Profile not found');
    const user: UserProfile = {
      id: data.id,
      username: data.handle,
      raw_username: data.handle,
      display_name: data.display_name ?? undefined,
      avatar_url: data.avatar_url ?? undefined,
      banner_url: data.banner_url ?? undefined,
      bio: data.bio ?? undefined,
      created_at: data.created_at,
    };
    return { user };
  },

  updateProfile: async (updates: Partial<User>, _token: string): Promise<{ user: User }> => {
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id;
    if (!userId) throw new Error('401: not authenticated');

    // Only profiles.* columns that actually exist today are writable.
    // 0001_profiles.sql has id, handle, handle_folded, display_name, role,
    // created_at. bio / avatar_url / banner_url don't exist on that table
    // yet; when they're added (follow-up migration), this patch object
    // will transparently start carrying them.
    const patch: Record<string, unknown> = {};
    if (updates.display_name !== undefined) patch.display_name = updates.display_name;
    if ((updates as any).bio !== undefined) patch.bio = (updates as any).bio;
    if ((updates as any).avatar_url !== undefined) patch.avatar_url = (updates as any).avatar_url;
    if ((updates as any).banner_url !== undefined) patch.banner_url = (updates as any).banner_url;

    const { data, error } = await supabase
      .from('profiles')
      .update(patch)
      .eq('id', userId)
      .select()
      .maybeSingle();
    if (error) throw new Error(`updateProfile: ${error.message}`);

    const user: User = {
      id: data!.id,
      username: data!.handle,
      raw_username: data!.handle,
      display_name: data!.display_name ?? undefined,
      avatar_url: (data as any).avatar_url ?? undefined,
      banner_url: (data as any).banner_url ?? undefined,
      bio: (data as any).bio ?? undefined,
      createdAt: data!.created_at,
    };
    return { user };
  },

  uploadAvatar: async (file: File, _token: string): Promise<{ user: UserProfile; url: string }> => {
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id;
    if (!userId) throw new Error('401: not authenticated');

    const ext = file.name.split('.').pop() ?? 'png';
    const path = `${userId}/avatar.${ext}`;

    const { error: upErr } = await supabase.storage
      .from('avatars')
      .upload(path, file, { upsert: true, contentType: file.type });
    if (upErr) throw new Error(`uploadAvatar: ${upErr.message}`);

    const { data: pub } = supabase.storage.from('avatars').getPublicUrl(path);
    const url = pub.publicUrl;

    // Persist onto the profile (column may not exist yet — ignore failure).
    await supabase.from('profiles').update({ avatar_url: url } as any).eq('id', userId);

    const { user } = await usersApi.getProfile(
      ((await supabase.from('profiles').select('handle').eq('id', userId).single()).data as any)?.handle,
    );
    return { user, url };
  },

  uploadBanner: async (file: File, _token: string): Promise<{ user: UserProfile; url: string }> => {
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id;
    if (!userId) throw new Error('401: not authenticated');

    const ext = file.name.split('.').pop() ?? 'png';
    const path = `${userId}/banner.${ext}`;

    const { error: upErr } = await supabase.storage
      .from('banners')
      .upload(path, file, { upsert: true, contentType: file.type });
    if (upErr) throw new Error(`uploadBanner: ${upErr.message}`);

    const { data: pub } = supabase.storage.from('banners').getPublicUrl(path);
    const url = pub.publicUrl;

    await supabase.from('profiles').update({ banner_url: url } as any).eq('id', userId);

    const { user } = await usersApi.getProfile(
      ((await supabase.from('profiles').select('handle').eq('id', userId).single()).data as any)?.handle,
    );
    return { user, url };
  },

  // ─── Stubbed social methods (out for ship, return empty) ────────────────

  /** @deprecated social — inert until paid social update ships */
  getPublicSongs: async (_username: string): Promise<{ songs: Song[] }> => ({ songs: [] }),

  /** @deprecated social — inert until paid social update ships */
  getPublicPlaylists: async (_username: string): Promise<{ playlists: any[] }> => ({ playlists: [] }),

  /** @deprecated social — inert until paid social update ships */
  getFeaturedCreators: async (): Promise<{ creators: Array<UserProfile & { follower_count?: number }> }> =>
    ({ creators: [] }),

  /** @deprecated social — inert until paid social update ships */
  toggleFollow: async (_username: string, _token: string): Promise<{ following: boolean; followerCount: number }> =>
    ({ following: false, followerCount: 0 }),

  /** @deprecated social — returns [] until paid social update ships */
  getFollowers: async (_username: string): Promise<{ followers: User[] }> => ({ followers: [] }),

  /** @deprecated social — returns [] until paid social update ships */
  getFollowing: async (_username: string): Promise<{ following: User[] }> => ({ following: [] }),

  /** @deprecated social — returns zeros until paid social update ships */
  getStats: async (_username: string, _token?: string | null): Promise<{ followerCount: number; followingCount: number; isFollowing: boolean }> =>
    ({ followerCount: 0, followingCount: 0, isFollowing: false }),
};

// ═══════════════════════════════════════════════════════════════════════════
// Playlists API — Supabase-backed, personal playlists of personal songs
// ═══════════════════════════════════════════════════════════════════════════

export interface Playlist {
  id: string;
  name: string;
  description?: string;
  cover_url?: string;
  /** camelCase mirror of cover_url. */
  coverUrl?: string;
  is_public?: boolean;
  /** camelCase mirror of is_public. */
  isPublic?: boolean;
  user_id?: string;
  created_at?: string;
  song_count?: number;
  /** Creator handle — on personal playlists this is the owner's handle. */
  creator?: string;
  /** Creator avatar URL — empty for personal-only playlists today. */
  creator_avatar?: string;
}

// Wire shape for playlists on the shim (ported from the legacy hub).
interface PlaylistWire {
  id: string;
  title: string;         // shim uses `title`; UI type uses `name`.
  description?: string;
  tracks: string[];      // LibraryTrack ids, in display order
  createdAt: string;
  updatedAt?: string;
  coverKey?: string | null;
}

function playlistWireToUi(p: PlaylistWire, ownerId?: string, songCount?: number): Playlist {
  const coverUrl = p.coverKey
    ? (p.coverKey.startsWith('data:') || p.coverKey.startsWith('http')
        ? p.coverKey
        : getAudioUrl(`/audio/${p.coverKey}`))
    : undefined;
  return {
    id: p.id,
    name: p.title,
    description: p.description ?? undefined,
    cover_url: coverUrl,
    coverUrl,
    is_public: false,
    isPublic: false,
    user_id: ownerId,
    created_at: p.createdAt,
    song_count: songCount ?? p.tracks.length,
    creator: undefined,
    creator_avatar: undefined,
  };
}

export const playlistsApi = {
  create: async (
    name: string,
    description: string,
    _isPublic: boolean,
    token: string,
  ): Promise<{ playlist: Playlist }> => {
    const id = globalThis.crypto?.randomUUID?.() ?? `pl_${Date.now()}`;
    const now = new Date().toISOString();
    const body: PlaylistWire = {
      id,
      title: name,
      description: description || undefined,
      tracks: [],
      createdAt: now,
      updatedAt: now,
      coverKey: null,
    };
    const saved = await api<PlaylistWire>('/api/playlists', { method: 'POST', body, token });
    const ownerId = await currentUserId();
    return { playlist: playlistWireToUi(saved, ownerId) };
  },

  getMyPlaylists: async (token: string): Promise<{ playlists: Playlist[] }> => {
    const body = await api<{ playlists: PlaylistWire[] }>('/api/playlists', { token });
    const ownerId = await currentUserId();
    const playlists = (body.playlists ?? []).map((p) => playlistWireToUi(p, ownerId));
    // Stable newest-first ordering to match the old Supabase ORDER BY.
    playlists.sort((a, b) => String(b.created_at ?? '').localeCompare(String(a.created_at ?? '')));
    return { playlists };
  },

  getPlaylist: async (
    id: string,
    token?: string | null,
  ): Promise<{ playlist: Playlist; songs: Song[] }> => {
    const wire = await api<PlaylistWire>(
      `/api/playlists/${encodeURIComponent(id)}`,
      { token },
    );
    if (!wire || !wire.id) throw new Error('404: Playlist not found');

    const ownerId = await currentUserId();

    // Hydrate member songs by looking each track id up in the library.
    // Small playlists (< a few hundred) make N+1 cheap on loopback; for
    // larger ones we'd add a `/api/songs/batch?ids=` endpoint, but that's
    // premature for ship.
    const songs: Song[] = [];
    for (const trackId of wire.tracks ?? []) {
      try {
        const t = await api<LibraryTrackWire>(
          `/api/songs/${encodeURIComponent(trackId)}`,
          { token },
        );
        if (t && t.id) songs.push(trackToSong(t, ownerId));
      } catch {
        // Track deleted out from under the playlist — skip silently.
      }
    }

    const playlist = playlistWireToUi(wire, ownerId, songs.length);
    return { playlist, songs };
  },

  /** @deprecated social — inert until paid social update ships */
  getFeaturedPlaylists: async (): Promise<{
    playlists: Array<Playlist & { creator?: string; creator_avatar?: string }>;
  }> => ({ playlists: [] }),

  addSong: async (playlistId: string, songId: string, token: string): Promise<{ success: boolean }> => {
    const current = await api<PlaylistWire>(
      `/api/playlists/${encodeURIComponent(playlistId)}`,
      { token },
    );
    const tracks = Array.isArray(current.tracks) ? current.tracks.slice() : [];
    if (!tracks.includes(songId)) tracks.push(songId);
    await api<PlaylistWire>(
      `/api/playlists/${encodeURIComponent(playlistId)}`,
      { method: 'PUT', body: { tracks, updatedAt: new Date().toISOString() }, token },
    );
    return { success: true };
  },

  removeSong: async (playlistId: string, songId: string, token: string): Promise<{ success: boolean }> => {
    const current = await api<PlaylistWire>(
      `/api/playlists/${encodeURIComponent(playlistId)}`,
      { token },
    );
    const tracks = (current.tracks ?? []).filter((tid) => tid !== songId);
    await api<PlaylistWire>(
      `/api/playlists/${encodeURIComponent(playlistId)}`,
      { method: 'PUT', body: { tracks, updatedAt: new Date().toISOString() }, token },
    );
    return { success: true };
  },

  update: async (id: string, updates: Partial<Playlist>, token: string): Promise<{ playlist: Playlist }> => {
    const patch: Partial<PlaylistWire> = { updatedAt: new Date().toISOString() };
    if (updates.name !== undefined) patch.title = updates.name;
    if (updates.description !== undefined) patch.description = updates.description;
    if (updates.cover_url !== undefined) patch.coverKey = updates.cover_url ?? null;
    const saved = await api<PlaylistWire>(
      `/api/playlists/${encodeURIComponent(id)}`,
      { method: 'PUT', body: patch, token },
    );
    const ownerId = await currentUserId();
    return { playlist: playlistWireToUi(saved, ownerId) };
  },

  delete: async (id: string, token: string): Promise<{ success: boolean }> => {
    await api<{ deleted: string }>(
      `/api/playlists/${encodeURIComponent(id)}`,
      { method: 'DELETE', token },
    );
    return { success: true };
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// Search API — DELETED for ship scope. Stubbed shape kept so legacy imports
// (SearchPage.tsx) compile; all searches return empty.
// ═══════════════════════════════════════════════════════════════════════════

export interface SearchResult {
  songs: Song[];
  creators: Array<UserProfile & { follower_count?: number }>;
  playlists: Array<Playlist & { creator?: string; creator_avatar?: string }>;
}

export const searchApi = {
  /** @deprecated social — returns empty until paid social update ships */
  search: async (_query: string, _type?: 'songs' | 'creators' | 'playlists' | 'all'): Promise<SearchResult> =>
    ({ songs: [], creators: [], playlists: [] }),
};

// ═══════════════════════════════════════════════════════════════════════════
// Contact form — Edge Function path (task #30 pending deploy). Inert for now.
// ═══════════════════════════════════════════════════════════════════════════

export interface ContactFormData {
  name: string;
  email: string;
  subject: string;
  message: string;
  category: 'general' | 'support' | 'business' | 'press' | 'legal';
}

export const contactApi = {
  submit: async (_data: ContactFormData): Promise<{ success: boolean; message: string; id: string }> => {
    // Wire to an Edge Function (e.g. `contact-submit`) once task #30 ships.
    // Returning a mock success so the contact form UI doesn't throw today.
    return { success: true, message: 'queued', id: `mock_${Date.now()}` };
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// Engine / Model Management — local engine
// ═══════════════════════════════════════════════════════════════════════════

export interface ModelInfo {
  name: string;
  is_default: boolean;
  is_loaded: boolean;
  supported_task_types?: string[];
}

export interface LMModelInfo {
  name: string;
  is_loaded: boolean;
}

export interface ModelInventory {
  models: ModelInfo[];
  default_model: string;
  lm_models: LMModelInfo[];
  loaded_lm_model: string;
  llm_initialized: boolean;
}

export interface EngineHealth {
  status: string;
  model_initialized?: boolean;
  llm_initialized?: boolean;
  loaded_model?: string;
  loaded_lm_model?: string;
}

export interface InitModelResponse {
  message: string;
  loaded_model?: string;
  loaded_lm_model?: string;
  models?: ModelInfo[];
  lm_models?: LMModelInfo[];
  llm_initialized?: boolean;
}

export interface ModelDefaults {
  model_type: 'turbo' | 'base' | 'sftturbo50' | 'unknown';
  config_path: string;
  inference_steps: number;
  inference_steps_min: number;
  inference_steps_max: number;
  guidance_scale: number;
  guidance_scale_visible: boolean;
  shift: number;
  shift_visible: boolean;
  cot_recommended: boolean;
  thinking: boolean;
  use_adg_visible: boolean;
  cfg_interval_visible: boolean;
  infer_method: string;
  batch_size: number;
}

export const engineApi = {
  models: (token: string): Promise<ModelInventory> =>
    api('/api/engine/models', { token }),

  health: (): Promise<EngineHealth> =>
    api('/api/engine/health'),

  init: (params: {
    model?: string;
    init_llm?: boolean;
    lm_model_path?: string;
  }, token: string): Promise<InitModelResponse> =>
    api('/api/engine/init', { method: 'POST', token, body: params }),

  reinitialize: (token: string): Promise<{ message: string; reloaded: string[] }> =>
    api('/api/engine/reinitialize', { method: 'POST', token, body: {} }),

  modelDefaults: (): Promise<ModelDefaults> =>
    api('/api/engine/model-defaults'),

  // 2026-04-26 SGT: removed dead `stats` export per parity audit. Never
  // imported anywhere in src/. The shim has no /api/engine/stats route
  // either; would 404 if called.
};

// ═══════════════════════════════════════════════════════════════════════════
// LoRA / Training / Patches — local engine
// ═══════════════════════════════════════════════════════════════════════════

export interface LoRAStatus {
  lora_loaded: boolean;
  use_lora: boolean;
  lora_scale: number;
  adapter_type: string | null;
  scales: Record<string, number>;
  active_adapter: string | null;
  adapters: string[];
  synthetic_default_mode: boolean;
}

export interface PatchManifest {
  id: string;
  name: string;
  description: string;
  triggerKeyword: string;
  genreTags: string[];
  author: string;
  version: string;
  createdAt: string;
  directory?: string;
  hasWeights?: boolean;
  trainingParams?: {
    rank: number;
    alpha: number;
    epochs: number;
    trackCount: number;
    trainingType: 'lora' | 'lokr';
  };
  files?: Array<{ name: string; size: number }>;
  iconColor?: string;
  bpmRange?: { min: number; max: number };
  keySignature?: string;
}

export interface AudioAnalysis {
  bpm: number;
  key: string;
  duration_seconds: number;
}

export interface TrainingBucket {
  name: string;
  directory: string;
  fileCount: number;
  files: Array<{ filename: string; size: number }>;
}

export interface TrainingStatus {
  status: 'idle' | 'preprocessing' | 'training' | 'completed' | 'failed' | 'stopped';
  current_step?: number;
  total_steps?: number;
  current_epoch?: number;
  total_epochs?: number;
  loss?: number;
  learning_rate?: number;
  elapsed_seconds?: number;
  eta_seconds?: number;
  message?: string;
}

export interface TrainingSSEEvent {
  type: 'connected' | 'progress' | 'done' | 'error';
  status?: string;
  current_step?: number;
  total_steps?: number;
  current_epoch?: number;
  total_epochs?: number;
  loss?: number;
  learning_rate?: number;
  elapsed_seconds?: number;
  eta_seconds?: number;
  message?: string;
  timestamp?: number;
}

// 2026-04-26 SGT: removed dead exports per parity audit Section 4 LOW item.
//   - status: never imported (`grep -r 'loraApi.status' src/` empty)
//   - toggle: never imported (`grep -r 'loraApi.toggle' src/` empty)
// .load is also unused on the consumer side (PatchSelector uses
// patchesApi.load to load by patch ID; loraApi.load was for raw LoRA paths
// which the UI doesn't surface). Keeping .load only because it's a useful
// primitive for future callers. .unload and .scale ARE used by PatchSelector,
// PatchContext, StyleForge (9 call sites) so they stay.
export const loraApi = {
  load: (loraPath: string, adapterName: string | undefined, token: string): Promise<{ message: string }> =>
    api('/api/lora/load', { method: 'POST', token, body: { lora_path: loraPath, adapter_name: adapterName } }),
  unload: (adapterName: string | undefined, token: string): Promise<{ message: string }> =>
    api('/api/lora/unload', { method: 'POST', token, body: { adapter_name: adapterName } }),
  scale: (scale: number, adapterName: string | undefined, token: string): Promise<{ message: string }> =>
    api('/api/lora/scale', { method: 'POST', token, body: { scale, adapter_name: adapterName } }),
};

export const trainingApi = {
  uploadFiles: async (files: File[], bucketName: string, token: string): Promise<{ message: string; bucket: TrainingBucket; files: Array<{ filename: string; size: number }> }> => {
    const formData = new FormData();
    formData.append('bucketName', bucketName);
    for (const file of files) formData.append('files', file);
    const headers: HeadersInit = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const response = await fetch(`${getApiBase()}/api/training/upload`, {
      method: 'POST',
      headers,
      body: formData,
      credentials: 'omit',
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Upload failed' }));
      throw new Error(`${response.status}: ${error.error || 'Upload failed'}`);
    }
    return response.json();
  },

  listBuckets: (token: string): Promise<{ buckets: TrainingBucket[] }> =>
    api('/api/training/buckets', { token }),

  datasetScan: (directory: string, token: string): Promise<unknown> =>
    api('/api/training/dataset/scan', { method: 'POST', token, body: { directory } }),
  datasetPreprocess: (body: Record<string, unknown>, token: string): Promise<unknown> =>
    api('/api/training/dataset/preprocess', { method: 'POST', token, body }),
  datasetAutoLabel: (body: Record<string, unknown>, token: string): Promise<unknown> =>
    api('/api/training/dataset/auto-label', { method: 'POST', token, body }),
  datasetStatus: (token: string): Promise<unknown> =>
    api('/api/training/dataset/status', { token }),

  start: (params: Record<string, unknown>, token: string): Promise<{ message: string; config: unknown }> =>
    api('/api/training/start', { method: 'POST', token, body: params }),
  status: (token: string): Promise<TrainingStatus> =>
    api('/api/training/status', { token }),
  stop: (token: string): Promise<{ message: string }> =>
    api('/api/training/stop', { method: 'POST', token, body: {} }),
  exportWeights: (body: Record<string, unknown>, token: string): Promise<{ message: string; export_path: string }> =>
    api('/api/training/export', { method: 'POST', token, body }),

  statusStream: (token: string): EventSource => {
    const url = `${getApiBase()}/api/training/status/stream`;
    return new EventSource(`${url}?token=${encodeURIComponent(token)}`);
  },

  analyze: async (file: File, token: string): Promise<AudioAnalysis> => {
    const formData = new FormData();
    formData.append('file', file);
    const headers: HeadersInit = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const response = await fetch(`${getApiBase()}/api/training/analyze`, {
      method: 'POST',
      headers,
      body: formData,
      credentials: 'omit',
    });
    if (!response.ok) throw new Error(`Analysis failed: ${response.status}`);
    return response.json();
  },
};

export const patchesApi = {
  list: (token: string): Promise<{ patches: PatchManifest[] }> =>
    api('/api/patches', { token }),
  get: (id: string, token: string): Promise<PatchManifest> =>
    api(`/api/patches/${id}`, { token }),
  create: (body: {
    name: string;
    description?: string;
    triggerKeyword: string;
    genreTags?: string[];
    author?: string;
    weightsDir?: string;
    trainingParams?: Record<string, unknown>;
  }, token: string): Promise<{ message: string; patch: PatchManifest }> =>
    api('/api/patches/create', { method: 'POST', token, body }),
  load: (id: string, strength: number, token: string): Promise<{ message: string; triggerKeyword: string }> =>
    api(`/api/patches/${id}/load`, { method: 'POST', token, body: { strength } }),
};

// ═══════════════════════════════════════════════════════════════════════════
// Studio / DAW — wraps generateApi with task-specific presets
// ═══════════════════════════════════════════════════════════════════════════

export const TRACK_NAMES = [
  'vocals', 'backing_vocals', 'drums', 'bass',
  'guitar', 'keyboard', 'percussion', 'strings',
  'synth', 'fx', 'brass', 'woodwinds',
] as const;

export type TrackName = typeof TRACK_NAMES[number];

export interface StemJob {
  trackName: TrackName;
  jobId: string;
  status: GenerationJob['status'];
  audioUrl?: string;
}

export interface RepaintParams {
  sourceAudioUrl: string;
  start: number;
  end: number;
  mode: 'conservative' | 'balanced' | 'aggressive';
  strength: number;
  crossfadeFrames?: number;
  crossfadeSec?: number;
  trackName?: TrackName;
  style?: string;
  lyrics?: string;
}

export interface LegoParams {
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

export const studioApi = {
  extractStem: (sourceAudioUrl: string, trackName: TrackName, token: string, sourceSongTitle?: string): Promise<GenerationJob> =>
    generateApi.startGeneration({
      lyrics:'',
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
    }, token),

  extractAllStems: (sourceAudioUrl: string, token: string, sourceSongTitle?: string): Promise<GenerationJob>[] =>
    TRACK_NAMES.map(trackName => studioApi.extractStem(sourceAudioUrl, trackName, token, sourceSongTitle)),

  legoRegenerate: (params: LegoParams, token: string): Promise<GenerationJob> =>
    generateApi.startGeneration({
      lyrics:params.lyrics || '',
      style: params.style || '',
      title: `Lego ${params.trackName}`,
      instrumental: !params.lyrics,
      taskType: 'lego',
      trackName: params.trackName,
      sourceAudioUrl: params.sourceAudioUrl,
      instruction: `Generate the ${params.trackName?.toUpperCase()} track based on the audio context:`,
      duration: params.duration,
      inferenceSteps: 50,
      guidanceScale: 1.0,
      shift: 1.0,
      inferMethod: 'ode',
      audioFormat: 'flac',
    }, token),

  repaint: (params: RepaintParams, token: string): Promise<GenerationJob> =>
    generateApi.startGeneration({
      lyrics:params.lyrics || '',
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
    }, token),

  complete: (params: CompleteParams, token: string): Promise<GenerationJob> =>
    generateApi.startGeneration({
      lyrics:params.lyrics || '',
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
    }, token),

  pollJob: async (
    jobId: string,
    token: string,
    onProgress?: (job: GenerationJob) => void,
    intervalMs = 2000,
    timeoutMs = 600000,
  ): Promise<GenerationJob> => {
    const start = Date.now();
    // 2026-05-16 SGT: Tolerate transient poll failures during CUDA model
    // load instead of aborting immediately. Allow up to 5 consecutive
    // failures before giving up.
    let consecutiveFailures = 0;
    const maxConsecutiveFailures = 5;
    return new Promise((resolve, reject) => {
      const poll = setInterval(async () => {
        try {
          const status = await generateApi.getStatus(jobId, token);
          consecutiveFailures = 0; // reset on success
          onProgress?.(status);
          if (status.status === 'succeeded' || status.status === 'failed') {
            clearInterval(poll);
            resolve(status);
          } else if (Date.now() - start > timeoutMs) {
            clearInterval(poll);
            reject(new Error('pollJob: timed out'));
          }
          // "loading", "running", "queued", etc. — keep polling
        } catch (err) {
          consecutiveFailures++;
          if (consecutiveFailures >= maxConsecutiveFailures) {
            clearInterval(poll);
            reject(err);
          }
          // else: swallow and retry next interval
        }
      }, intervalMs);
    });
  },

  listStemGroups: (): Promise<StemGroupResponse> =>
    api('/api/stems/list', {}),
};

export interface StemFile {
  trackName: string;
  filename: string;
  audioUrl: string;
}

export interface StemGroup {
  songTitle: string;
  stems: StemFile[];
  createdAt: number;
}

export interface StemGroupResponse {
  stemGroups: StemGroup[];
}
