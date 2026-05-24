// @ts-nocheck
/**
 * seededFauxPeaks — deterministic placeholder waveform shape.
 *
 * Given a stable seed (usually `song.id` or the temp id), produce a
 * plausible-looking waveform amplitude array in the range 0..1.
 *
 * The same seed always produces the same shape, which means:
 *   • A generating song's faux peaks stay stable across re-renders.
 *   • When the real song metadata arrives under a different id, we
 *     can reseed and cross-fade against the real peaks without a
 *     jarring reshuffle in between.
 *
 * Shape recipe:
 *   1. mulberry32 PRNG seeded from a 32-bit string hash.
 *   2. Raw bucket values, uniform [0,1].
 *   3. Three-tap moving average so it reads like music, not noise.
 *   4. Envelope: gentle intro ramp (8%), flat body, outro dip (12%).
 *   5. Light soft-clip to keep it away from 0 and 1 extremes.
 */

/** 32-bit string hash, FNV-1a-ish. Keeps output within u32. */
function hash32(seed: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  // One extra avalanche to reduce obvious correlations across similar ids.
  h ^= h >>> 13;
  h = Math.imul(h, 2654435769) >>> 0;
  h ^= h >>> 16;
  return h >>> 0;
}

/** mulberry32 PRNG, deterministic and decent for visual work. */
function mulberry32(seed: number) {
  let s = seed >>> 0;
  return function rand(): number {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface FauxPeakOptions {
  /** Bucket count, default 200. Keep between 64 and 1024. */
  bins?: number;
  /** Smoothing passes (3-tap box). Default 2. */
  smoothPasses?: number;
  /** Intro ramp length as fraction of total. Default 0.08. */
  introFraction?: number;
  /** Outro dip length as fraction of total. Default 0.12. */
  outroFraction?: number;
  /** Minimum visible amplitude so the shape never flatlines. Default 0.08. */
  floor?: number;
  /** Peak-compression ceiling. Default 0.92. */
  ceiling?: number;
}

/**
 * Generate a deterministic placeholder amplitude array for a song id.
 * Values returned are in [floor, ceiling], default ≈ [0.08, 0.92].
 */
export function seededFauxPeaks(
  seed: string,
  opts: FauxPeakOptions = {},
): number[] {
  const bins = clampInt(opts.bins ?? 200, 16, 4096);
  const smoothPasses = Math.max(0, Math.floor(opts.smoothPasses ?? 2));
  const introFrac = clamp(opts.introFraction ?? 0.08, 0, 0.4);
  const outroFrac = clamp(opts.outroFraction ?? 0.12, 0, 0.4);
  const floor = clamp(opts.floor ?? 0.08, 0, 0.3);
  const ceiling = clamp(opts.ceiling ?? 0.92, 0.6, 1);

  const rand = mulberry32(hash32(seed || 'strands'));

  // 1. Raw
  const raw = new Array<number>(bins);
  for (let i = 0; i < bins; i++) raw[i] = rand();

  // 2. Smooth (in-place, with temp buffer per pass)
  let buf = raw;
  for (let p = 0; p < smoothPasses; p++) {
    const next = new Array<number>(bins);
    for (let i = 0; i < bins; i++) {
      const a = buf[(i - 1 + bins) % bins];
      const b = buf[i];
      const c = buf[(i + 1) % bins];
      next[i] = (a + b + c) / 3;
    }
    buf = next;
  }

  // 3. Envelope: gentle intro ramp + outro dip. Body rides full scale.
  const introBins = Math.round(bins * introFrac);
  const outroBins = Math.round(bins * outroFrac);
  for (let i = 0; i < bins; i++) {
    let env = 1;
    if (i < introBins) {
      env = easeInOut(i / Math.max(1, introBins));
    } else if (i >= bins - outroBins) {
      env = easeInOut((bins - 1 - i) / Math.max(1, outroBins));
    }
    buf[i] *= env;
  }

  // 4. Normalise to [floor, ceiling] so the shape is always visible.
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < bins; i++) {
    if (buf[i] < min) min = buf[i];
    if (buf[i] > max) max = buf[i];
  }
  const range = Math.max(1e-6, max - min);
  for (let i = 0; i < bins; i++) {
    const n = (buf[i] - min) / range; // 0..1
    buf[i] = floor + n * (ceiling - floor);
  }

  return buf;
}

// ── utils ───────────────────────────────────────────────────────

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}
function clampInt(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, Math.round(v)));
}
/** Smooth-step ease. Cheaper than a cosine and pretty enough. */
function easeInOut(t: number): number {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
}
