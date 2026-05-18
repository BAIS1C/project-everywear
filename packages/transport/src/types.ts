/**
 * Transport abstraction types.
 * Normalises Tauri IPC and WebSocket/HTTP behind a single interface.
 */

export interface TransportConfig {
  mode: 'tauri' | 'web';
  /** WebSocket endpoint for web mode (ignored in tauri mode) */
  wsUrl?: string;
  /** HTTP base URL for web mode REST fallback */
  httpUrl?: string;
}

export interface Transport {
  /** Call a command and await the typed response */
  call<T = unknown>(command: string, args?: Record<string, unknown>): Promise<T>;
  /** Subscribe to an event stream */
  listen<T = unknown>(event: string, handler: (payload: T) => void): () => void;
  /** Whether the transport is connected */
  connected(): boolean;
  /** Destroy the transport and clean up listeners */
  destroy(): void;
}
