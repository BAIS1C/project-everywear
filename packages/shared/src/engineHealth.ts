export interface EngineHealthEndpoint {
  id: string;
  applet_id: string;
  port: number;
  kind: string;
  online: boolean;
  latency_ms?: number | null;
}

export interface EngineHealthPayload {
  checked_at_ms: number;
  endpoints: EngineHealthEndpoint[];
}

export const ENGINE_HEALTH_WINDOW_EVENT = 'everywear:engine-health';

declare global {
  interface Window {
    __EVERYWEAR_ENGINE_HEALTH__?: EngineHealthPayload;
  }
}

export function publishEngineHealth(payload: EngineHealthPayload) {
  if (typeof window === 'undefined') return;
  window.__EVERYWEAR_ENGINE_HEALTH__ = payload;
  window.dispatchEvent(new CustomEvent<EngineHealthPayload>(ENGINE_HEALTH_WINDOW_EVENT, {
    detail: payload,
  }));
}

export function readEngineHealth(): EngineHealthPayload | null {
  if (typeof window === 'undefined') return null;
  return window.__EVERYWEAR_ENGINE_HEALTH__ ?? null;
}

export function subscribeEngineHealth(handler: (payload: EngineHealthPayload) => void) {
  if (typeof window === 'undefined') return () => {};

  const listener = (event: Event) => {
    const payload = (event as CustomEvent<EngineHealthPayload>).detail;
    if (payload) handler(payload);
  };

  window.addEventListener(ENGINE_HEALTH_WINDOW_EVENT, listener);
  return () => window.removeEventListener(ENGINE_HEALTH_WINDOW_EVENT, listener);
}

export function findEngineEndpoint(
  payload: EngineHealthPayload | null | undefined,
  endpointId: string,
): EngineHealthEndpoint | null {
  return payload?.endpoints.find((endpoint) => endpoint.id === endpointId) ?? null;
}

export function formatEngineLastChecked(payload: EngineHealthPayload | null | undefined): string | null {
  if (!payload?.checked_at_ms) return null;
  return new Date(payload.checked_at_ms).toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  });
}
