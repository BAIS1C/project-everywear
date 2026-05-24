// @ts-nocheck
/**
 * Waveform — canvas-based peak renderer for S3 Studio.
 *
 * Draws a centred bar waveform from a `peaks: number[]` (0..1) array,
 * using EWDS tokens for colour so it inherits the current skin/accent.
 *
 * Modes:
 *   • 'real'  — fully-drawn peaks at full opacity.
 *   • 'faux'  — placeholder peaks rendered softer (80% of real opacity)
 *               so the eye reads "this isn't the final shape yet".
 *
 * Optional progress overlay:
 *   • `progressPct` 0..1 draws the reveal sweep. Bars to the left of
 *     the playhead render in `--ew-primary`; bars to the right render
 *     in `--ew-primary-soft` (plus a fainter opacity fallback for
 *     browsers without color-mix). Pass `undefined` to disable.
 *
 * Optional playhead:
 *   • `playheadPct` draws a 2px vertical seam in `--ew-primary` at the
 *     given position. Independent of progressPct.
 *
 * Interactions:
 *   • If `onSeek` is provided, click-to-seek is enabled (ratio 0..1).
 *
 * Performance: redraw on every prop change using a single canvas. At
 * 800 buckets × retina 2× this is a sub-ms paint. Don't memoise the
 * peaks array identity; parents own caching.
 */
import React, { useEffect, useRef } from 'react';

export interface WaveformProps {
  peaks: number[];
  /** Visual mode. 'real' is full opacity; 'faux' dims slightly. */
  mode?: 'real' | 'faux';
  /** 0..1 fill reveal. Bars left of progress render solid, right render soft. */
  progressPct?: number;
  /** 0..1 playhead line position. Rendered on top of everything else. */
  playheadPct?: number;
  /** Pixel height of the canvas. Width is 100% of parent. */
  height?: number;
  /**
   * Gap in pixels between bars. Default 1. Set to 0 for a continuous
   * shape. Ignored if bars would end up narrower than 1px.
   */
  barGap?: number;
  /**
   * Minimum visible bar height in pixels, so silent sections still
   * read as a thin line. Default 1.
   */
  minBarPx?: number;
  className?: string;
  /** Optional click-to-seek. Called with ratio 0..1 of the click x. */
  onSeek?: (ratio: number) => void;
  /** Accessible label. */
  'aria-label'?: string;
}

export default function Waveform({
  peaks,
  mode = 'real',
  progressPct,
  playheadPct,
  height = 40,
  barGap = 1,
  minBarPx = 1,
  className = '',
  onSeek,
  'aria-label': ariaLabel = 'Audio waveform',
}: WaveformProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Draw + re-draw on any prop change or resize.
  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;

    const paint = () => {
      const dpr = Math.max(1, window.devicePixelRatio || 1);
      const cssW = wrap.clientWidth || 1;
      const cssH = height;
      // Size canvas in device pixels, scale context for crisp bars.
      canvas.width = Math.round(cssW * dpr);
      canvas.height = Math.round(cssH * dpr);
      canvas.style.width = `${cssW}px`;
      canvas.style.height = `${cssH}px`;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, cssW, cssH);

      if (!peaks || peaks.length === 0) return;

      // Resolve EWDS tokens at paint time (not first mount) so theme
      // changes repaint with new colours.
      const styles = getComputedStyle(document.body);
      const primary = styles.getPropertyValue('--ew-primary').trim() || '#00C2FF';
      const primarySoft =
        styles.getPropertyValue('--ew-primary-soft').trim() ||
        'rgba(0, 194, 255, 0.25)';

      // Mode affects base alpha only.
      const baseAlpha = mode === 'faux' ? 0.8 : 1;

      const bins = peaks.length;
      // Total pixel budget per bar = barWidth + gap.
      const slot = cssW / bins;
      const gap = slot > 2 ? Math.min(barGap, Math.max(0, slot - 1)) : 0;
      const barW = Math.max(1, slot - gap);

      const mid = cssH / 2;
      const maxH = cssH - 2; // 1px top / 1px bottom padding

      const progress = clamp01(progressPct);
      const hasProgress = progressPct !== undefined && progressPct !== null;

      for (let i = 0; i < bins; i++) {
        const x = i * slot;
        const amp = clamp01(peaks[i]);
        const h = Math.max(minBarPx, amp * maxH);

        const binPct = (i + 0.5) / bins;
        const isRevealed = !hasProgress || binPct <= progress;

        if (isRevealed) {
          ctx.fillStyle = primary;
          ctx.globalAlpha = baseAlpha;
        } else {
          // Unrevealed: dim, soft tint.
          ctx.fillStyle = primarySoft;
          ctx.globalAlpha = baseAlpha * 0.55;
        }

        ctx.fillRect(x, mid - h / 2, barW, h);
      }

      // Playhead seam (optional)
      if (playheadPct !== undefined && playheadPct !== null) {
        const p = clamp01(playheadPct);
        const px = Math.floor(p * cssW);
        ctx.globalAlpha = 1;
        ctx.fillStyle = primary;
        ctx.fillRect(px - 1, 0, 2, cssH);
      }

      // Scan-line seam at the progress front — only when revealing.
      if (hasProgress && progress > 0 && progress < 1) {
        const px = Math.floor(progress * cssW);
        ctx.globalAlpha = 0.9;
        ctx.fillStyle = primary;
        ctx.fillRect(px - 1, 0, 2, cssH);
      }

      ctx.globalAlpha = 1;
    };

    paint();

    // Repaint on resize (canvas doesn't auto-scale with CSS width).
    const ro = new ResizeObserver(paint);
    ro.observe(wrap);

    // Repaint on skin / accent / mode changes. The big transport
    // waveform repaints constantly via progressPct ticks during
    // playback, so it picks up new primary colors automatically. The
    // small song-card waveforms have static peaks + no progress, so
    // they never re-paint after a skin flip and freeze on the previous
    // primary. Watch body attribute changes (data-skin, data-mode, and
    // the style attribute used by the accent override) to force a
    // repaint when the active palette changes.
    // (Sean, 2026-04-25 SGT: workspace waveforms must follow skin.)
    const mo = new MutationObserver(paint);
    mo.observe(document.body, {
      attributes: true,
      attributeFilter: ['data-skin', 'data-mode', 'style'],
    });

    return () => {
      ro.disconnect();
      mo.disconnect();
    };
  }, [peaks, mode, progressPct, playheadPct, height, barGap, minBarPx]);

  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!onSeek || !wrapRef.current) return;
    const rect = wrapRef.current.getBoundingClientRect();
    const ratio = clamp01((e.clientX - rect.left) / Math.max(1, rect.width));
    onSeek(ratio);
  };

  return (
    <div
      ref={wrapRef}
      className={className}
      style={{ width: '100%', height, cursor: onSeek ? 'pointer' : 'default' }}
      onClick={onSeek ? handleClick : undefined}
      role={onSeek ? 'slider' : 'img'}
      aria-label={ariaLabel}
      aria-valuemin={onSeek ? 0 : undefined}
      aria-valuemax={onSeek ? 100 : undefined}
      aria-valuenow={
        onSeek && progressPct !== undefined
          ? Math.round(clamp01(progressPct) * 100)
          : undefined
      }
    >
      <canvas ref={canvasRef} style={{ display: 'block' }} />
    </div>
  );
}

function clamp01(v: number | undefined | null): number {
  if (v === undefined || v === null || !Number.isFinite(v)) return 0;
  return Math.min(1, Math.max(0, v));
}
