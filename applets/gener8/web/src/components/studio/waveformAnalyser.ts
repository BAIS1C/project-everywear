// @ts-nocheck
/**
 * waveformAnalyser — Decodes audio from a URL and returns peak amplitude
 * data for waveform visualisation.
 *
 * Pipeline:
 *   1. fetch(url) → arrayBuffer
 *   2. AudioContext.decodeAudioData (native, off-main-thread where supported)
 *   3. getChannelData → Float32Array
 *   4. Bin scan: single-pass max-track + stride-4 sample walk, run inside
 *      an inline Blob Worker so the main thread stays responsive.
 *   5. In-memory Map cache + localStorage write-through (LRU 600 entries).
 *
 * Speed notes:
 *   • Stride-4 walk still samples ~12k candidates per bin at 48kHz / 3min.
 *   • Single-pass max-track means no second normalise loop.
 *   • Worker hand-off uses Transferable buffer — zero copy.
 *   • localStorage hit means subsequent loads of the same audio URL paint
 *     the real waveform on the first render (no decode, no scan).
 *
 * To enable timing logs during development, set in the browser console:
 *   window.__S3_DEBUG_WAVEFORM__ = true
 */

// ─── Module state ─────────────────────────────────────────────────────

let sharedCtx: AudioContext | null = null;
function getAudioContext(): AudioContext {
  if (!sharedCtx) sharedCtx = new AudioContext();
  return sharedCtx;
}

export interface WaveformData {
  /** Normalised peak values 0..1, one per bin */
  peaks: number[];
  /** Duration of the audio in seconds. 0 when data came from localStorage. */
  duration: number;
  /** Sample rate of the decoded audio. 0 when data came from localStorage. */
  sampleRate: number;
}

// ─── Debug timing helper ──────────────────────────────────────────────

function debugLog(msg: string): void {
  if (
    typeof window !== 'undefined' &&
    (window as unknown as { __S3_DEBUG_WAVEFORM__?: boolean }).__S3_DEBUG_WAVEFORM__
  ) {
    // eslint-disable-next-line no-console
    console.debug(msg);
  }
}

// ─── localStorage cache (write-through, LRU 600) ──────────────────────

const STORAGE_PREFIX = 's3.peaks.v1.';
const STORAGE_INDEX_KEY = 's3.peaks.v1.__index';
const STORAGE_MAX_ENTRIES = 600;

/** FNV-1a hash → base36, 16-char cap. Stable across reloads. */
function hashUrl(url: string): string {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < url.length; i++) {
    h ^= url.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36).slice(0, 16);
}

function storageAvailable(): boolean {
  try {
    return typeof localStorage !== 'undefined';
  } catch {
    return false;
  }
}

function storageGetPeaks(key: string, expectedBins: number): number[] | null {
  if (!storageAvailable()) return null;
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + key);
    if (!raw) return null;
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr) || arr.length !== expectedBins) return null;
    return arr as number[];
  } catch {
    return null;
  }
}

function storageSetPeaks(key: string, peaks: number[]): void {
  if (!storageAvailable()) return;
  try {
    // LRU bookkeeping: move key to end, evict from front if over quota.
    const idxRaw = localStorage.getItem(STORAGE_INDEX_KEY);
    let idx: string[] = idxRaw ? JSON.parse(idxRaw) : [];
    idx = idx.filter((k) => k !== key);
    idx.push(key);
    while (idx.length > STORAGE_MAX_ENTRIES) {
      const old = idx.shift();
      if (old) localStorage.removeItem(STORAGE_PREFIX + old);
    }
    localStorage.setItem(STORAGE_INDEX_KEY, JSON.stringify(idx));
    // 4-decimal rounding keeps payload small without visible fidelity loss.
    const rounded = peaks.map((v) => Math.round(v * 10000) / 10000);
    localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(rounded));
  } catch {
    // Quota exceeded or denied — wipe our slice and give up silently.
    try {
      const idxRaw = localStorage.getItem(STORAGE_INDEX_KEY);
      if (idxRaw) {
        const idx: string[] = JSON.parse(idxRaw);
        idx.forEach((k) => localStorage.removeItem(STORAGE_PREFIX + k));
      }
      localStorage.removeItem(STORAGE_INDEX_KEY);
    } catch {
      /* ignore */
    }
  }
}

// ─── Inline Blob Worker for the bin scan ──────────────────────────────

const workerSource = `
  self.onmessage = (e) => {
    const { channelData, bins } = e.data;
    const len = channelData.length;
    const samplesPerBin = Math.floor(len / bins);
    const peaks = new Float32Array(bins);
    const STRIDE = 4;
    let globalMax = 0;
    for (let i = 0; i < bins; i++) {
      const start = i * samplesPerBin;
      const end = Math.min(start + samplesPerBin, len);
      let binMax = 0;
      for (let j = start; j < end; j += STRIDE) {
        const abs = channelData[j] < 0 ? -channelData[j] : channelData[j];
        if (abs > binMax) binMax = abs;
      }
      peaks[i] = binMax;
      if (binMax > globalMax) globalMax = binMax;
    }
    if (globalMax > 0) {
      const inv = 1 / globalMax;
      for (let i = 0; i < bins; i++) peaks[i] = peaks[i] * inv;
    }
    self.postMessage({ peaks }, [peaks.buffer]);
  };
`;

let workerUrl: string | null = null;
function getWorkerUrl(): string | null {
  if (
    typeof Blob === 'undefined' ||
    typeof URL === 'undefined' ||
    typeof Worker === 'undefined'
  ) {
    return null;
  }
  if (workerUrl) return workerUrl;
  try {
    const blob = new Blob([workerSource], { type: 'application/javascript' });
    workerUrl = URL.createObjectURL(blob);
    return workerUrl;
  } catch {
    return null;
  }
}

function scanPeaksSync(channelData: Float32Array, bins: number): number[] {
  const len = channelData.length;
  const samplesPerBin = Math.floor(len / bins);
  const peaks = new Array<number>(bins);
  const STRIDE = 4;
  let globalMax = 0;
  for (let i = 0; i < bins; i++) {
    const start = i * samplesPerBin;
    const end = Math.min(start + samplesPerBin, len);
    let binMax = 0;
    for (let j = start; j < end; j += STRIDE) {
      const v = channelData[j];
      const abs = v < 0 ? -v : v;
      if (abs > binMax) binMax = abs;
    }
    peaks[i] = binMax;
    if (binMax > globalMax) globalMax = binMax;
  }
  if (globalMax > 0) {
    const inv = 1 / globalMax;
    for (let i = 0; i < bins; i++) peaks[i] = peaks[i] * inv;
  }
  return peaks;
}

async function scanPeaksInWorker(
  channelData: Float32Array,
  bins: number,
): Promise<number[]> {
  const url = getWorkerUrl();
  if (!url) return scanPeaksSync(channelData, bins);

  return new Promise<number[]>((resolve) => {
    let worker: Worker;
    try {
      worker = new Worker(url);
    } catch {
      resolve(scanPeaksSync(channelData, bins));
      return;
    }
    const fallback = () => {
      try { worker.terminate(); } catch { /* ignore */ }
      resolve(scanPeaksSync(channelData, bins));
    };
    worker.onmessage = (e) => {
      try {
        const out = e.data?.peaks as Float32Array | undefined;
        if (!out) return fallback();
        resolve(Array.from(out));
        worker.terminate();
      } catch {
        fallback();
      }
    };
    worker.onerror = fallback;
    // Defensive copy so the caller's Float32Array isn't neutered if it
    // gets reused (AudioBuffer channel data is backed by the decoded PCM).
    const copy = new Float32Array(channelData);
    worker.postMessage({ channelData: copy, bins }, [copy.buffer]);
  });
}

// ─── Public API ───────────────────────────────────────────────────────

/**
 * Analyse an audio URL and return waveform peak data.
 *
 * @param url        Audio file URL (can be blob:, /api/..., or https://...)
 * @param bins       Number of output bins (default 120)
 * @param channel    Which channel to analyse (default 0 = left / mono)
 */
export async function analyseWaveform(
  url: string,
  bins: number = 120,
  channel: number = 0,
): Promise<WaveformData> {
  const ctx = getAudioContext();

  const t0 = performance.now();
  const response = await fetch(url);
  const arrayBuffer = await response.arrayBuffer();
  const t1 = performance.now();
  const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
  const t2 = performance.now();
  const channelData = audioBuffer.getChannelData(
    Math.min(channel, audioBuffer.numberOfChannels - 1),
  );
  const peaks = await scanPeaksInWorker(channelData, bins);
  const t3 = performance.now();

  debugLog(
    `[waveform] fetch ${(t1 - t0).toFixed(0)}ms · decode ${(t2 - t1).toFixed(0)}ms · scan ${(t3 - t2).toFixed(0)}ms · total ${(t3 - t0).toFixed(0)}ms · ${url}`,
  );

  return {
    peaks,
    duration: audioBuffer.duration,
    sampleRate: audioBuffer.sampleRate,
  };
}

/** In-memory Map cache (session-scoped). */
const memCache = new Map<string, WaveformData>();

/**
 * Cached analyse. Checks in-memory Map first, then localStorage, then
 * falls back to a fresh decode + scan and writes through to both caches.
 */
export async function analyseWaveformCached(
  url: string,
  bins: number = 120,
): Promise<WaveformData> {
  const memKey = `${url}|${bins}`;
  const hit = memCache.get(memKey);
  if (hit) {
    debugLog(`[waveform] mem-hit · ${url}`);
    return hit;
  }

  const storageKey = `${hashUrl(url)}.b${bins}`;
  const stored = storageGetPeaks(storageKey, bins);
  if (stored) {
    debugLog(`[waveform] ls-hit · ${url}`);
    const data: WaveformData = { peaks: stored, duration: 0, sampleRate: 0 };
    memCache.set(memKey, data);
    return data;
  }

  const data = await analyseWaveform(url, bins);
  memCache.set(memKey, data);
  storageSetPeaks(storageKey, data.peaks);
  return data;
}

/** Test helper — clears both layers. Not exported from the barrel. */
export function __clearWaveformCache(): void {
  memCache.clear();
  if (!storageAvailable()) return;
  try {
    const idxRaw = localStorage.getItem(STORAGE_INDEX_KEY);
    if (idxRaw) {
      const idx: string[] = JSON.parse(idxRaw);
      idx.forEach((k) => localStorage.removeItem(STORAGE_PREFIX + k));
    }
    localStorage.removeItem(STORAGE_INDEX_KEY);
  } catch {
    /* ignore */
  }
}
