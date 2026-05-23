import type { LayerURuntimeHealth } from './types';

export const LAYER_U_BASE_URL = 'http://127.0.0.1:3117';
const REQUEST_TIMEOUT_MS = 4500;

async function fetchLayerU<T>(path: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(`${LAYER_U_BASE_URL}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        'Accept': 'application/json',
        ...(init?.headers ?? {}),
      },
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(detail || `Layer U returned ${res.status}`);
    }

    return await res.json() as T;
  } finally {
    window.clearTimeout(timeout);
  }
}

export function getLayerUHealth() {
  return fetchLayerU<LayerURuntimeHealth>('/api/health');
}

export function getLayerUData() {
  return fetchLayerU<Record<string, any>>('/api/data');
}

export function triggerLayerUSweep() {
  return fetchLayerU<{ status: string; timestamp?: string }>('/api/sweep', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ source: 'everywear-layer-u' }),
  });
}

export function layerUWorldviewUrl() {
  return `${LAYER_U_BASE_URL}/worldview`;
}
