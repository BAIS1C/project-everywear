/**
 * Transport factory.
 * Creates the appropriate transport based on config.
 */

import type { Transport, TransportConfig } from './types';

class TauriTransport implements Transport {
  async call<T = unknown>(command: string, args?: Record<string, unknown>): Promise<T> {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke<T>(command, args);
  }

  listen<T = unknown>(event: string, handler: (payload: T) => void): () => void {
    let unlisten: (() => void) | null = null;
    import('@tauri-apps/api/event').then(({ listen }) => {
      listen<T>(event, (e) => handler(e.payload)).then((fn) => {
        unlisten = fn;
      });
    });
    return () => { unlisten?.(); };
  }

  connected(): boolean {
    return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
  }

  destroy(): void {
    // Tauri transport has no persistent connections to tear down
  }
}

class WebTransport implements Transport {
  private ws: WebSocket | null = null;
  private listeners = new Map<string, Set<(payload: unknown) => void>>();
  private httpUrl: string;

  constructor(config: TransportConfig) {
    this.httpUrl = config.httpUrl || 'http://127.0.0.1:9877';
    if (config.wsUrl) {
      this.ws = new WebSocket(config.wsUrl);
      this.ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);
          const handlers = this.listeners.get(msg.event);
          handlers?.forEach((h) => h(msg.payload));
        } catch { /* ignore malformed */ }
      };
    }
  }

  async call<T = unknown>(command: string, args?: Record<string, unknown>): Promise<T> {
    const res = await fetch(`${this.httpUrl}/api/${command}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(args || {}),
    });
    if (!res.ok) throw new Error(`Transport error: ${res.status}`);
    return res.json() as Promise<T>;
  }

  listen<T = unknown>(event: string, handler: (payload: T) => void): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    const set = this.listeners.get(event)!;
    set.add(handler as (payload: unknown) => void);
    return () => { set.delete(handler as (payload: unknown) => void); };
  }

  connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  destroy(): void {
    this.ws?.close();
    this.ws = null;
    this.listeners.clear();
  }
}

export function createTransport(config: TransportConfig): Transport {
  if (config.mode === 'tauri') {
    return new TauriTransport();
  }
  return new WebTransport(config);
}
