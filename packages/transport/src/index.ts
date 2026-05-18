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
} from './vault';
export type {
  VaultItem,
  VaultSearchResponse,
  VaultStats,
  RegisterImageParams,
  RegisterAudioParams,
  RegisterVideoParams,
} from './vault';

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
