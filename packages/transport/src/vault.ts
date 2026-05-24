/**
 * Vault Transport — typed Tauri invoke wrappers for the Everywear Vault.
 *
 * The vault backend (Rust, Tantivy-indexed) manages all media assets at:
 *   ~/Documents/Everywear Vault/
 *
 * 9 commands:
 *   vault_search, vault_get_item, vault_get_stats,
 *   vault_register_image, vault_register_audio, vault_register_video,
 *   vault_set_favorite, vault_set_tags, vault_delete_item
 *
 * CODEX_NEEDED: Add vault paths to Tauri asset protocol scope in tauri.conf.json
 * Required scopes:
 *   - $HOME/Documents/Everywear Vault/**     (all vault files)
 *   - $HOME/Documents/Everywear Vault/.thumbnails/**  (thumbnails)
 * Without this, convertFileSrc() will return 403 for vault files.
 * Reference: https://tauri.app/security/capability/#fs-scope
 */

import { convertFileSrc, invoke } from '@tauri-apps/api/core';

// ── Types ─────────────────────────────────────────────────────────────

export interface VaultItem {
  media_type: 'image' | 'audio' | 'video';
  id: string;
  applet_id: string;
  title: string;
  tags: string[];
  created_at: number;
  updated_at: number;
  file_path: string;
  file_size_bytes: number;
  mime_type: string;
  favorite: boolean;
  // Image-specific (present when media_type === "image")
  width?: number;
  height?: number;
  model_id?: string;
  prompt?: string;
  generation_params?: Record<string, unknown>;
  // Audio-specific
  duration_seconds?: number;
  sample_rate?: number;
  channels?: number;
  genre?: string;
  bpm?: number;
  is_stem?: boolean;
  stem_type?: string;
  lyrics_text?: string;
  lyrics_aligned?: boolean;
  // Video-specific
  frame_rate?: number;
  generation_mode?: string;
  has_audio?: boolean;
}

export interface VaultSearchResponse {
  items: VaultItem[];
  total: number;
  limit: number;
  offset: number;
}

export interface VaultStats {
  total_items: number;
  images: number;
  audio: number;
  videos: number;
  stems: number;
  favorites: number;
  total_size_bytes: number;
}

export interface MigrationOperation {
  phase: string;
  action: string;
  source: string;
  target: string;
  bytes: number;
  sha256?: string;
  status: string;
}

export interface MigrationReceipt {
  id: string;
  created_at: string;
  legacy_app_data_dir: string;
  target_models_dir: string;
  target_data_dir: string;
  target_vault_audio_dir: string;
  operations: MigrationOperation[];
  warnings: string[];
}

export interface MigrationSummary {
  dry_run: boolean;
  receipt_path?: string;
  receipt: MigrationReceipt;
}

// ── Search / Read ─────────────────────────────────────────────────────

export async function vaultSearch(
  query: string,
  filter?: string,
  sort?: string,
  limit?: number,
  offset?: number,
): Promise<VaultSearchResponse> {
  return invoke('vault_search', {
    query,
    mediaFilter: filter,
    sortBy: sort,
    limit,
    offset,
  });
}

export async function vaultGetItem(id: string): Promise<VaultItem | null> {
  return invoke('vault_get_item', { id });
}

export async function vaultGetStats(): Promise<VaultStats> {
  return invoke('vault_get_stats');
}

export async function runGener8VaultAudioImport(dryRun = true): Promise<MigrationSummary> {
  return invoke('run_gener8_vault_audio_import', { dryRun });
}

// ── Mutations ─────────────────────────────────────────────────────────

export async function vaultSetFavorite(id: string, favorite: boolean): Promise<void> {
  return invoke('vault_set_favorite', { id, favorite });
}

export async function vaultSetTags(id: string, tags: string[]): Promise<void> {
  return invoke('vault_set_tags', { id, tags });
}

export async function vaultDeleteItem(id: string): Promise<void> {
  return invoke('vault_delete_item', { id });
}

// ── Registration ──────────────────────────────────────────────────────

export interface RegisterImageParams {
  title: string;
  filePath: string;
  width: number;
  height: number;
  modelId?: string;
  prompt?: string;
  generationParams?: Record<string, unknown>;
  tags?: string[];
}

export async function vaultRegisterImage(params: RegisterImageParams): Promise<VaultItem> {
  return invoke('vault_register_image', {
    title: params.title,
    filePath: params.filePath,
    width: params.width,
    height: params.height,
    modelId: params.modelId,
    prompt: params.prompt,
    generationParams: params.generationParams,
    tags: params.tags,
  });
}

export interface RegisterAudioParams {
  title: string;
  filePath: string;
  durationSeconds: number;
  sampleRate?: number;
  channels?: number;
  genre?: string;
  bpm?: number;
  isStem?: boolean;
  stemType?: string;
  lyricsText?: string;
  tags?: string[];
}

export async function vaultRegisterAudio(params: RegisterAudioParams): Promise<VaultItem> {
  return invoke('vault_register_audio', {
    title: params.title,
    filePath: params.filePath,
    durationSeconds: params.durationSeconds,
    sampleRate: params.sampleRate,
    channels: params.channels,
    genre: params.genre,
    bpm: params.bpm,
    isStem: params.isStem,
    stemType: params.stemType,
    lyricsText: params.lyricsText,
    tags: params.tags,
  });
}

export interface RegisterVideoParams {
  title: string;
  filePath: string;
  durationSeconds?: number;
  width?: number;
  height?: number;
  frameRate?: number;
  modelId?: string;
  generationMode?: string;
  prompt?: string;
  hasAudio?: boolean;
  tags?: string[];
}

export async function vaultRegisterVideo(params: RegisterVideoParams): Promise<VaultItem> {
  return invoke('vault_register_video', {
    title: params.title,
    filePath: params.filePath,
    durationSeconds: params.durationSeconds,
    width: params.width,
    height: params.height,
    frameRate: params.frameRate,
    modelId: params.modelId,
    generationMode: params.generationMode,
    prompt: params.prompt,
    hasAudio: params.hasAudio,
    tags: params.tags,
  });
}

// ── File URL helpers ──────────────────────────────────────────────────

/**
 * Convert a vault file path to a URL accessible by the webview.
 * Requires the vault directory to be in the Tauri asset protocol scope.
 *
 * CODEX_NEEDED: Vault paths must be added to Tauri asset protocol scope.
 * Until then, convertFileSrc() will return 403.
 */
export function vaultFileUrl(filePath: string): string {
  if (/^(https?|asset|file|data|blob):/i.test(filePath)) return filePath;
  try { return convertFileSrc(filePath); } catch {}
  return filePath;
}

/**
 * Get the thumbnail URL for a vault item.
 * Thumbnails are stored at {vaultRoot}/.thumbnails/{id}.jpg
 *
 * CODEX_NEEDED: Resolve vault root dynamically via Tauri path resolver
 * or a vault_get_root command. The fallback here is a placeholder.
 */
export function vaultThumbnailUrl(itemId: string, vaultRoot?: string): string {
  // Fallback uses a common default; callers should pass the actual root from vault config.
  const root = vaultRoot || '';
  if (!root) {
    // Without a vault root, return the item ID as a stub; the Tauri backend
    // should expose a vault_thumbnail command that resolves this properly.
    return `vault://thumbnail/${itemId}`;
  }
  const thumbPath = `${root}\\.thumbnails\\${itemId}.jpg`;
  return vaultFileUrl(thumbPath);
}
