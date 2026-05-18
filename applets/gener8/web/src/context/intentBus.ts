/**
 * Everywear Intent Bus -- cross-applet communication within Gener8.
 * Ported from s3studio-web/src/shell/intentBus.ts.
 *
 * Stripped of VRAM management (handled by the shell's Rust launcher),
 * model management (handled by Gener8 backend), and S3-specific
 * dispatchers. Retained: core pub/sub + openVidWithSong convenience.
 */

export interface AppIntent {
  source: string;
  target: string;
  action: string;
  payload?: Record<string, any>;
  timestamp?: number;
}

type IntentHandler = (intent: AppIntent) => void;

class IntentBus {
  private listeners = new Map<string, Set<IntentHandler>>();
  private log: AppIntent[] = [];
  private pending = new Map<string, AppIntent>();

  subscribe(appId: string, handler: IntentHandler): () => void {
    if (!this.listeners.has(appId)) this.listeners.set(appId, new Set());
    this.listeners.get(appId)!.add(handler);
    // Replay pending intent if one was dispatched before subscription
    const queued = this.pending.get(appId);
    if (queued) {
      this.pending.delete(appId);
      handler(queued);
    }
    return () => { this.listeners.get(appId)?.delete(handler); };
  }

  dispatch(intent: AppIntent): void {
    const stamped = { ...intent, timestamp: Date.now() };
    this.log.push(stamped);
    // Shell always receives all intents
    this.listeners.get('shell')?.forEach(h => h(stamped));
    if (intent.target !== 'shell') {
      const handlers = this.listeners.get(intent.target);
      if (handlers && handlers.size > 0) {
        handlers.forEach(h => h(stamped));
      } else {
        this.pending.set(intent.target, stamped);
      }
    }
  }

  getLog(): AppIntent[] {
    return [...this.log];
  }
}

export const intentBus = new IntentBus();

// Convenience dispatchers
export function openVidWithSong(sourceApp: string, songId: string, songTitle?: string) {
  intentBus.dispatch({
    source: sourceApp,
    target: 'vid',
    action: 'open-with-song',
    payload: { songId, songTitle },
  });
}
