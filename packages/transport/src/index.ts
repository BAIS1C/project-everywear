/**
 * @everywear/transport: unified IPC abstraction.
 *
 * Tauri applets use invoke() for IPC commands.
 * Web applets (s3studio, strands-game) use WebSocket or HTTP.
 * This package normalises both behind a single typed interface
 * so applet code is transport-agnostic.
 *
 * Pattern:
 *   const transport = createTransport({ mode: 'tauri' | 'web' });
 *   const result = await transport.call('generate_image', { prompt });
 */

export { createTransport } from './transport';
export type { Transport, TransportConfig } from './types';

// Vault — Tauri invoke wrappers for the Everywear Vault
export {
  vaultSearch,
  vaultGetItem,
  vaultGetStats,
  vaultSetFavorite,
  vaultSetTags,
  vaultDeleteItem,
  vaultRegisterImage,
  vaultRegisterAudio,
  vaultRegisterVideo,
  vaultFileUrl,
  vaultThumbnailUrl,
  runGener8VaultAudioImport,
} from './vault';
export type {
  VaultItem,
  VaultAssetKind,
  VaultSearchResponse,
  VaultStats,
  MigrationSummary,
  MigrationReceipt,
  MigrationOperation,
  RegisterImageParams,
  RegisterAudioParams,
  RegisterVideoParams,
} from './vault';

// Auth — shell-owned session/licence context for applets
export { getAuthContext } from './auth';
export type { ShellAuthContext, LicenceTier } from './auth';

// Gener8 — shell-owned ACE bridge for the first-party music applet
export {
  gener8UploadAudio,
  gener8Generate,
  gener8GenerationStatus,
  gener8EngineModels,
  fileToBase64,
} from './gener8';
export type {
  Gener8UploadAudioRequest,
  Gener8UploadAudioResponse,
  Gener8GenerationJob,
  Gener8GenerateParams,
} from './gener8';

// Logging types — session logging, bug reports, system info
export type {
  LogLevel,
  LogCategory,
  LogEntry,
  SessionLog,
  SessionSummary,
  BugReportPayload,
  SystemInfo,
} from './logging';
export { LOG_CATEGORY_META } from './logging';
