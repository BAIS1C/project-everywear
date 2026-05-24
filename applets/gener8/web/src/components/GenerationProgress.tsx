// @ts-nocheck
/**
 * GenerationProgress — the Gener8 progress strip shown in place of the
 * actions row while a song is being generated or freshly analysed.
 *
 * Visual shape:
 *   [ faux waveform, painting left-to-right ] [ phase line ]
 *
 * The faux waveform is stable per song id (seededFauxPeaks), so reruns
 * and re-mounts don't reshuffle the shape. The fill advances against a
 * time-estimate proportional to the generation job's expected duration.
 * This is cosmetic motion, not a truth claim. The phase line above the
 * bar carries the actual signal and is driven by the live status.
 *
 * Queued:   0% fill, ghosted faux peaks, `queuedWithPosition(n)` epithet.
 * Running:  fill animates towards ~95% over `averageDurationMs`, running pool.
 * Finishing: reached ~95%, swaps to finishing pool until succeeded hits.
 * Analysing: fill snaps to 100%, peaks strip shows shimmer, analysing pool.
 *
 * This component never kicks off the analyser itself; Gener8Core owns
 * the peaks lifecycle. We just visualise.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import Waveform from './Waveform';
import { seededFauxPeaks } from '../shell/applets/seededFauxPeaks';
import {
  type Gener8Phase,
  makeRotator,
  queuedWithPosition,
} from '../shell/applets/gener8Epithets';

export type GenerationStatus = 'queued' | 'running' | 'analysing';

export interface GenerationProgressProps {
  /** Stable seed for the faux waveform shape. Usually the temp or real song id. */
  songId: string;
  /** Live status from the poll loop. */
  status: GenerationStatus;
  /** Queue position when status === 'queued'. */
  queuePosition?: number;
  /** When the generation job began, in ms since epoch. Required for running fill. */
  startedAt?: number;
  /**
   * Expected total generation time, ms. Default 140_000 — calibrated to
   * ACE-Step v1.5 Turbo measured cold-start (100s model load + 7s CoT +
   * 53s audio codes + 2s diffusion + 2s VAE + 3s mp3 ≈ 165s). Warm runs
   * land closer to 65s, so the fill will briefly overshoot on warm —
   * preferable to the old 35s default which stalled at 95% for 2+ minutes
   * on every cold start.
   */
  averageDurationMs?: number;
  /** Epithet swap interval, ms. Default 4500. */
  epithetIntervalMs?: number;
  /** Height of the waveform strip in px. Default 28. */
  height?: number;
  className?: string;
}

const DEFAULT_AVG = 140_000;

export default function GenerationProgress({
  songId,
  status,
  queuePosition,
  startedAt,
  averageDurationMs = DEFAULT_AVG,
  epithetIntervalMs = 4500,
  height = 28,
  className = '',
}: GenerationProgressProps) {
  // Faux peaks: stable per song id.
  const peaks = useMemo(() => seededFauxPeaks(songId, { bins: 120 }), [songId]);

  // Phase mapping: once running fill passes 90% we switch the epithet
  // pool to 'finishing' for flavour even if the backend is still 'running'.
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (status !== 'running' || !startedAt) {
      setElapsed(0);
      return;
    }
    let raf = 0;
    const tick = () => {
      setElapsed(Date.now() - startedAt);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [status, startedAt]);

  // Compute fill pct and epithet pool.
  const { fillPct, pool } = useMemo((): { fillPct: number; pool: Gener8Phase } => {
    if (status === 'queued') return { fillPct: 0, pool: 'queued' };
    if (status === 'analysing') return { fillPct: 1, pool: 'analysing' };

    // running: ease towards 0.95 over averageDurationMs, then stall.
    const t = Math.min(1, elapsed / Math.max(1, averageDurationMs));
    const target = 0.05 + easeOutCubic(t) * 0.90; // 0.05 → 0.95
    const phase: Gener8Phase = t > 0.85 ? 'finishing' : 'running';
    return { fillPct: target, pool: phase };
  }, [status, elapsed, averageDurationMs]);

  // Epithet rotator — reset when pool changes so each phase starts fresh.
  const rotatorRef = useRef<ReturnType<typeof makeRotator> | null>(null);
  const [line, setLine] = useState<string>('');
  useEffect(() => {
    rotatorRef.current = makeRotator(pool);
    setLine(rotatorRef.current.next());
  }, [pool]);

  // Rotate the epithet on an interval — except in 'queued' where the
  // copy is pegged to the queue position number and shouldn't shuffle.
  useEffect(() => {
    if (pool === 'queued') return;
    const id = setInterval(() => {
      if (rotatorRef.current) setLine(rotatorRef.current.next());
    }, epithetIntervalMs);
    return () => clearInterval(id);
  }, [pool, epithetIntervalMs]);

  // Queued copy overrides the rotator output.
  const displayLine =
    status === 'queued' ? queuedWithPosition(queuePosition ?? 0) : line;

  return (
    <div className={`w-full ${className}`} data-phase={status}>
      <div
        className="text-[11px] uppercase tracking-[0.08em] mb-1 font-mono"
        style={{
          color: 'var(--ew-text-muted, rgba(255,255,255,0.55))',
          letterSpacing: '0.08em',
          // Subtle crossfade on line swap.
          transition: 'opacity 180ms ease',
        }}
        aria-live="polite"
      >
        {displayLine}
      </div>
      <Waveform
        peaks={peaks}
        mode="faux"
        progressPct={fillPct}
        height={height}
        aria-label={`Generation ${status}`}
      />
    </div>
  );
}

function easeOutCubic(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return 1 - Math.pow(1 - x, 3);
}
