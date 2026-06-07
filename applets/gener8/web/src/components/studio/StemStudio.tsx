// @ts-nocheck
/**
 * StemStudio — Stem separation, per-track regeneration, and repaint interface.
 *
 * State machine: Empty → Track Loaded → Extracting → Extracted
 *
 * Wired to real local extract/add-layer/repaint task types via studioApi.
 * Surfaces clear errors when the engine is unreachable (no fake fallback).
 */
import React, { useState, useRef, useCallback, useEffect, useMemo } from "react";
import type { Song } from "../../types";
import {
  studioApi,
  generateApi,
  getApiBase,
  getAudioUrl,
  TRACK_NAMES,
  type TrackName,
  type GenerationJob,
  type StemJob,
  type StemGroup,
} from "../../services/api";
import { useAuth } from "../../context/AuthContext";
import { analyseWaveformCached, type WaveformData } from "./waveformAnalyser";
import { Knob, VolumeFader } from "./SvgControls";
import { ensureModel } from "../../shell/intentBus";
import { useSongStore } from "../../shell/SongStoreContext";
import { showToast } from "../ToastHost";

// ─── Types ─────────────────────────────────────────────────────────

interface LoadedTrack {
  title: string;
  audioUrl: string;
  duration: number;
  bpm?: number;
  key?: string;
}

type StudioPhase = "empty" | "loaded" | "extracting" | "extracted" | "error";

interface StemState {
  id: TrackName;
  label: string;
  color: string;
  muted: boolean;
  solo: boolean;
  volume: number;
  pan: number;           // -1..1 (0 = center)
  audioUrl: string | null;
  extractStatus: "idle" | "pending" | "running" | "done" | "failed";
  regenStatus: "idle" | "running";
  jobId: string | null;
}

// ─── Constants ──────────────────────────────────────────────────────

const STEM_COLORS = [
  "#F472B6", "#FB923C", "#A78BFA", "#34D399",
  "#60A5FA", "#FBBF24", "#F87171", "#2DD4BF",
  "#C084FC", "#FB7185", "#E879F9", "#94A3B8",
];

const STEM_LABELS: Record<TrackName, string> = {
  vocals: "Vocals",
  backing_vocals: "Backing Vocals",
  drums: "Drums",
  bass: "Bass",
  guitar: "Guitar",
  keyboard: "Keyboard",
  percussion: "Percussion",
  strings: "Strings",
  synth: "Synth",
  fx: "FX",
  brass: "Brass",
  woodwinds: "Woodwinds",
};

const STEM_META: Record<TrackName, { label: string; color: string }> = Object.fromEntries(
  TRACK_NAMES.map((id, i) => [id, { label: STEM_LABELS[id], color: STEM_COLORS[i] || '#94A3B8' }])
) as Record<TrackName, { label: string; color: string }>;

function initStems(): StemState[] {
  return TRACK_NAMES.map(id => ({
    id,
    label: STEM_META[id].label,
    color: STEM_META[id].color,
    muted: false,
    solo: false,
    volume: 0.8,
    pan: 0,
    audioUrl: null,
    extractStatus: "idle",
    regenStatus: "idle",
    jobId: null,
  }));
}

// ─── Helpers ────────────────────────────────────────────────────────

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

async function audioSignature(url: string): Promise<string> {
  const response = await fetch(url, { credentials: "omit" });
  if (!response.ok) throw new Error(`fetch ${response.status}`);
  const bytes = await response.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function waveformCorrelation(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n < 8) return 0;
  let meanA = 0;
  let meanB = 0;
  for (let i = 0; i < n; i++) {
    meanA += a[i];
    meanB += b[i];
  }
  meanA /= n;
  meanB /= n;

  let numerator = 0;
  let denomA = 0;
  let denomB = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i] - meanA;
    const db = b[i] - meanB;
    numerator += da * db;
    denomA += da * da;
    denomB += db * db;
  }
  const denom = Math.sqrt(denomA * denomB);
  return denom > 0 ? numerator / denom : 0;
}

async function validateStemOutputs(
  sourceUrl: string | null,
  stems: Array<{ trackName: TrackName; audioUrl: string }>,
): Promise<{ ok: true } | { ok: false; message: string }> {
  if (stems.length < 2) {
    return { ok: false, message: "Stem extraction produced fewer than two audio files." };
  }

  const stemSignatures = await Promise.all(
    stems.map(async (stem) => ({
      trackName: stem.trackName,
      hash: await audioSignature(stem.audioUrl),
    })),
  );
  const uniqueStemHashes = new Set(stemSignatures.map((stem) => stem.hash));

  if (uniqueStemHashes.size <= 1) {
    return {
      ok: false,
      message: "Stem extraction returned identical audio for every stem. This is the engine fallback cloning the original track, not real separation.",
    };
  }

  if (sourceUrl) {
    try {
      const sourceHash = await audioSignature(sourceUrl);
      const sourceCloneCount = stemSignatures.filter((stem) => stem.hash === sourceHash).length;
      if (sourceCloneCount > 0) {
        return {
          ok: false,
          message: `Stem extraction returned ${sourceCloneCount} full-track fallback clone${sourceCloneCount === 1 ? "" : "s"}. Real stem separation did not complete.`,
        };
      }
    } catch (err) {
      console.warn("[StemStudio] Could not compare stems against source audio:", err);
    }
  }

  try {
    const stemWaveforms = await Promise.all(
      stems.map(async (stem) => ({
        trackName: stem.trackName,
        peaks: (await analyseWaveformCached(stem.audioUrl, 160)).peaks,
      })),
    );
    const correlations: number[] = [];
    for (let i = 0; i < stemWaveforms.length; i++) {
      for (let j = i + 1; j < stemWaveforms.length; j++) {
        correlations.push(waveformCorrelation(stemWaveforms[i].peaks, stemWaveforms[j].peaks));
      }
    }
    const averageCorrelation =
      correlations.reduce((sum, value) => sum + value, 0) / Math.max(correlations.length, 1);
    const highlySimilar = correlations.filter((value) => value >= 0.985).length;
    if (averageCorrelation >= 0.97 && highlySimilar >= correlations.length * 0.85) {
      return {
        ok: false,
        message: "Stem extraction returned stems with the same full-track waveform envelope. Real semantic separation did not complete.",
      };
    }
  } catch (err) {
    console.warn("[StemStudio] Could not compare stem waveform envelopes:", err);
  }

  return { ok: true };
}

// ─── WaveformDisplay — renders real audio peaks ─────────────────────

function WaveformDisplay({
  peaks,
  color,
  height = 40,
  muted,
  solo,
  analysing,
}: {
  peaks: number[] | null;
  color: string;
  height?: number;
  muted: boolean;
  solo: boolean;
  analysing: boolean;
}) {
  const opacity = muted ? 0.2 : 1;

  if (analysing) {
    return (
      <div style={{ height: height + 15, display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0.5 }}>
        <div style={{ width: 8, height: 8, borderRadius: '50%', background: color, animation: 'pulse 1.5s ease-in-out infinite' }} />
        <span style={{ fontSize: 10, color, marginLeft: 6, fontFamily: 'monospace' }}>Analysing...</span>
      </div>
    );
  }

  if (!peaks || peaks.length === 0) {
    // Placeholder: no data yet
    return (
      <div style={{ height: height + 15, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ fontSize: 10, color: '#334155' }}>No waveform data</span>
      </div>
    );
  }

  // Render as SVG polyline + fill, mirrored around center
  const mid = height / 2;
  const topPoints = peaks.map((v, i) => `${(i / peaks.length) * 100},${mid - v * mid}`).join(' ');
  const bottomPoints = peaks.map((v, i) => `${(i / peaks.length) * 100},${mid + v * mid}`).join(' ');
  const gradId = `grad-${color.replace('#', '')}-${Math.random().toString(36).slice(2, 6)}`;

  return (
    <svg
      width="100%"
      height={height + 15}
      viewBox={`0 0 100 ${height + 15}`}
      preserveAspectRatio="none"
      style={{ opacity }}
    >
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.7} />
          <stop offset="50%" stopColor={color} stopOpacity={0.4} />
          <stop offset="100%" stopColor={color} stopOpacity={0.7} />
        </linearGradient>
      </defs>
      {/* Top half waveform */}
      <polyline points={topPoints} fill="none" stroke={color} strokeWidth="0.4" />
      {/* Bottom half waveform (mirrored) */}
      <polyline points={bottomPoints} fill="none" stroke={color} strokeWidth="0.4" />
      {/* Filled area between top and bottom */}
      <polygon
        points={`${topPoints} ${peaks.map((v, i) => `${((peaks.length - 1 - i) / peaks.length) * 100},${mid + peaks[peaks.length - 1 - i] * mid}`).join(' ')}`}
        fill={`url(#${gradId})`}
      />
      {/* Center line */}
      <line x1="0" y1={mid} x2="100" y2={mid} stroke={color} strokeWidth="0.15" opacity={0.3} />
      {solo && (
        <rect x="0" y="0" width="100" height={height + 15} fill={color} opacity={0.08} rx={1} />
      )}
    </svg>
  );
}

// ─── RepaintOverlay ─────────────────────────────────────────────────

function RepaintOverlay({
  duration,
  start,
  end,
  onChangeRange,
  color,
}: {
  duration: number;
  start: number;
  end: number;
  onChangeRange: (start: number, end: number) => void;
  color: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const dragging = useRef<'start' | 'end' | null>(null);

  const startPct = (start / duration) * 100;
  const endPct = (end / duration) * 100;

  const handleMouseDown = (handle: 'start' | 'end') => (e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = handle;

    const onMove = (ev: MouseEvent) => {
      if (!containerRef.current || !dragging.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const pct = Math.max(0, Math.min(100, ((ev.clientX - rect.left) / rect.width) * 100));
      const time = (pct / 100) * duration;

      if (dragging.current === 'start') {
        onChangeRange(Math.min(time, end - 0.5), end);
      } else {
        onChangeRange(start, Math.max(time, start + 0.5));
      }
    };

    const onUp = () => {
      dragging.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  return (
    <div
      ref={containerRef}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        pointerEvents: 'auto',
        zIndex: 10,
      }}
    >
      {/* Highlighted repaint zone */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          bottom: 0,
          left: `${startPct}%`,
          width: `${endPct - startPct}%`,
          background: `${color}20`,
          borderLeft: `2px solid ${color}`,
          borderRight: `2px solid ${color}`,
        }}
      />

      {/* Left handle */}
      <div
        onMouseDown={handleMouseDown('start')}
        style={{
          position: 'absolute',
          top: 0,
          bottom: 0,
          left: `${startPct}%`,
          width: 10,
          marginLeft: -5,
          cursor: 'ew-resize',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <div style={{ width: 4, height: 20, borderRadius: 2, background: color }} />
      </div>

      {/* Right handle */}
      <div
        onMouseDown={handleMouseDown('end')}
        style={{
          position: 'absolute',
          top: 0,
          bottom: 0,
          left: `${endPct}%`,
          width: 10,
          marginLeft: -5,
          cursor: 'ew-resize',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <div style={{ width: 4, height: 20, borderRadius: 2, background: color }} />
      </div>
    </div>
  );
}

// ─── TrackRow ───────────────────────────────────────────────────────

function TrackRow({
  stem,
  peaks,
  analysingWaveform,
  playheadPct,
  onToggleMute,
  onToggleSolo,
  onRegenerate,
  onVolumeChange,
  onPanChange,
  onSeek,
  repaintMode,
  repaintRange,
  onRepaintRangeChange,
  duration,
}: {
  stem: StemState;
  peaks: number[] | null;
  analysingWaveform: boolean;
  playheadPct: number;
  onToggleMute: () => void;
  onToggleSolo: () => void;
  onRegenerate: () => void;
  onVolumeChange: (volume: number) => void;
  onPanChange: (pan: number) => void;
  onSeek: (time: number) => void;
  repaintMode: boolean;
  repaintRange: { start: number; end: number };
  onRepaintRangeChange: (start: number, end: number) => void;
  duration: number;
}) {
  const isExtracting = stem.extractStatus === 'pending' || stem.extractStatus === 'running';
  const effectiveMuted = stem.muted;
  const isRegenerating = stem.regenStatus === 'running';

  return (
    <div
      data-tour="daw.stems"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 0,
        borderBottom: "1px solid #1E293B",
        background: stem.solo ? `${stem.color}08` : "transparent",
        transition: "background 0.2s",
        opacity: isExtracting ? 0.5 : 1,
      }}
    >
      {/* Track label + controls */}
      <div
        style={{
          width: 200,
          minWidth: 200,
          padding: "8px 12px",
          display: "flex",
          alignItems: "center",
          gap: 8,
          borderRight: "1px solid #1E293B",
          background: "#0F1219",
        }}
      >
        <div
          style={{
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: effectiveMuted ? "#475569" : stem.color,
            boxShadow: effectiveMuted ? "none" : `0 0 6px ${stem.color}60`,
            transition: "all 0.2s",
          }}
        />
        <span
          style={{
            color: effectiveMuted ? "#475569" : "#E2E8F0",
            fontSize: 13,
            fontWeight: 600,
            flex: 1,
            fontFamily: "system-ui",
          }}
        >
          {stem.label}
        </span>

        {/* Status badges */}
        {isExtracting && (
          <span style={{ fontSize: 9, color: '#FBBF24', fontWeight: 600 }}>EXTRACTING</span>
        )}
        {stem.extractStatus === 'failed' && (
          <span style={{ fontSize: 9, color: '#EF4444', fontWeight: 600 }}>FAILED</span>
        )}

        <div style={{ display: "flex", gap: 4 }}>
          <button
            onClick={onToggleMute}
            style={{
              width: 24, height: 24, borderRadius: 4, border: "none", cursor: "pointer",
              fontSize: 10, fontWeight: 700,
              background: stem.muted ? "#DC2626" : "#1E293B",
              color: stem.muted ? "#FFF" : "#94A3B8",
              transition: "all 0.15s", fontFamily: "system-ui",
            }}
          >
            M
          </button>
          <button
            onClick={onToggleSolo}
            style={{
              width: 24, height: 24, borderRadius: 4, border: "none", cursor: "pointer",
              fontSize: 10, fontWeight: 700,
              background: stem.solo ? "#F59E0B" : "#1E293B",
              color: stem.solo ? "#000" : "#94A3B8",
              transition: "all 0.15s", fontFamily: "system-ui",
            }}
          >
            S
          </button>
          <button
            onClick={onRegenerate}
            disabled={isRegenerating || !stem.audioUrl}
            title="Regenerate this stem (Lego mode)"
            style={{
              width: 24, height: 24, borderRadius: 4, border: "none",
              cursor: isRegenerating || !stem.audioUrl ? "default" : "pointer",
              fontSize: 12,
              background: isRegenerating ? stem.color + '30' : "#1E293B",
              color: stem.color,
              transition: "all 0.15s",
              opacity: !stem.audioUrl ? 0.3 : 1,
            }}
          >
            &#x21BB;
          </button>
        </div>
      </div>

      {/* Volume + Pan strip (SVG controls) */}
      <div
        style={{
          width: 80,
          minWidth: 80,
          padding: "4px 6px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 4,
          borderRight: "1px solid #1E293B",
          background: "#0F1219",
        }}
      >
        <VolumeFader
          value={stem.volume}
          height={44}
          color={stem.color}
          onChange={onVolumeChange}
        />
        <Knob
          value={(stem.pan + 1) / 2}
          anchor={0.5}
          size={30}
          color={stem.color}
          onChange={(v) => onPanChange(v * 2 - 1)}
          label={`Pan: ${stem.pan === 0 ? 'C' : stem.pan < 0 ? `L${Math.round(Math.abs(stem.pan) * 100)}` : `R${Math.round(stem.pan * 100)}`}`}
        />
      </div>

      {/* Waveform area — click to seek */}
      <div
        style={{ flex: 1, position: "relative", padding: "4px 0", minHeight: 48, cursor: duration > 0 ? "pointer" : "default" }}
        onClick={(e) => {
          if (duration <= 0 || repaintMode) return;
          const rect = e.currentTarget.getBoundingClientRect();
          const pct = (e.clientX - rect.left) / rect.width;
          onSeek(Math.max(0, Math.min(duration, pct * duration)));
        }}
      >
        {stem.audioUrl ? (
          <WaveformDisplay peaks={peaks} color={stem.color} muted={effectiveMuted} solo={stem.solo} analysing={analysingWaveform} />
        ) : (
          <div style={{ height: 40, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {isExtracting ? (
              <div style={{ width: '60%', height: 4, borderRadius: 2, background: '#1E293B', overflow: 'hidden' }}>
                <div style={{
                  height: '100%', width: '40%', borderRadius: 2,
                  background: `linear-gradient(90deg, ${stem.color}, ${stem.color}80)`,
                  animation: 'pulse 1.5s ease-in-out infinite',
                }} />
              </div>
            ) : (
              <span style={{ fontSize: 10, color: '#334155' }}>No stem data</span>
            )}
          </div>
        )}

        {/* Playhead */}
        <div
          style={{
            position: "absolute", top: 0, bottom: 0,
            left: `${playheadPct}%`, width: 1,
            background: "#00C2FF", opacity: 0.6, pointerEvents: "none",
          }}
        />

        {/* Repaint overlay */}
        {repaintMode && stem.audioUrl && (
          <RepaintOverlay
            duration={duration}
            start={repaintRange.start}
            end={repaintRange.end}
            onChangeRange={onRepaintRangeChange}
            color={stem.color}
          />
        )}

        {/* Regen overlay */}
        {isRegenerating && (
          <div
            style={{
              position: "absolute", top: 0, left: 0, right: 0, bottom: 0,
              background: `${stem.color}15`,
              display: "flex", alignItems: "center", justifyContent: "center", zIndex: 20,
            }}
          >
            <div
              style={{
                padding: "6px 16px", borderRadius: 6,
                background: "#0F172AE0", border: `1px solid ${stem.color}40`,
                color: stem.color, fontSize: 12, fontWeight: 600, fontFamily: "system-ui",
              }}
            >
              Regenerating {stem.label}...
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── TimeRuler ──────────────────────────────────────────────────────

function TimeRuler({ duration, playheadPct, onSeek }: { duration: number; playheadPct: number; onSeek?: (time: number) => void }) {
  const markers = useMemo(() => {
    const m = [];
    const interval = duration > 120 ? 15 : duration > 30 ? 5 : 2;
    for (let s = 0; s <= duration; s += interval) {
      const pct = (s / duration) * 100;
      m.push(
        <div
          key={s}
          style={{
            position: "absolute", left: `${pct}%`, top: 0, height: "100%",
            borderLeft: "1px solid #1E293B", paddingLeft: 4,
          }}
        >
          <span style={{ fontSize: 10, color: "#64748B", fontFamily: "monospace" }}>
            {formatTime(s)}
          </span>
        </div>
      );
    }
    return m;
  }, [duration]);

  return (
    <div
      style={{
        position: "relative", height: 24,
        borderBottom: "1px solid #334155", marginLeft: 200, background: "#0A0B0D",
        cursor: "pointer",
      }}
      onClick={(e) => {
        if (!onSeek || duration <= 0) return;
        const rect = e.currentTarget.getBoundingClientRect();
        const pct = (e.clientX - rect.left) / rect.width;
        onSeek(Math.max(0, Math.min(duration, pct * duration)));
      }}
    >
      {markers}
      <div
        style={{
          position: "absolute", top: 0, bottom: 0,
          left: `${playheadPct}%`, width: 2, background: "#00C2FF", zIndex: 2,
        }}
      >
        <div
          style={{
            position: "absolute", top: -2, left: -5,
            width: 12, height: 12, background: "#00C2FF",
            borderRadius: "50%", border: "2px solid #0A0B0D",
          }}
        />
      </div>
    </div>
  );
}

// ─── EmptyState ─────────────────────────────────────────────────────

function EmptyState({
  onLoadFile,
  onLoadFromLibrary,
  onDroppedSong,
  savedStemGroups,
  onLoadSavedStems,
}: {
  onLoadFile: () => void;
  onLoadFromLibrary: () => void;
  onDroppedSong?: (songData: { audioUrl: string; title: string; duration?: number; style?: string }) => void;
  savedStemGroups?: StemGroup[];
  onLoadSavedStems?: (group: StemGroup) => void;
}) {
  const [dragOver, setDragOver] = React.useState(false);

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    setDragOver(true);
  };

  const handleDragLeave = () => {
    setDragOver(false);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(false);

    const data = e.dataTransfer.getData('application/s3-song');
    if (!data || !onDroppedSong) return;

    try {
      const draggedSong = JSON.parse(data);
      if (draggedSong.audioUrl) {
        onDroppedSong({
          audioUrl: draggedSong.audioUrl,
          title: draggedSong.title || 'Untitled',
          duration: draggedSong.duration,
          style: draggedSong.style,
        });
      }
    } catch (err) {
      console.error('[EmptyState] Failed to parse dropped song:', err);
    }
  };

  return (
    <div
      data-tour="daw.load"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      style={{
        display: "flex", flexDirection: "column", alignItems: "center",
        justifyContent: "center", gap: 20, padding: 60, textAlign: "center",
        borderWidth: dragOver ? "2px" : "0px",
        borderStyle: "dashed",
        borderColor: dragOver ? "#00C2FF" : "transparent",
        borderRadius: 12,
        transition: "all 0.2s",
        boxShadow: dragOver ? "0 0 20px rgba(0, 194, 255, 0.3)" : "none",
      }}
    >
      <div
        style={{
          width: 80, height: 80, borderRadius: 20,
          background: "linear-gradient(135deg, #00C2FF10, #8B5CF610)",
          border: "1px solid #00C2FF20",
          display: "flex", alignItems: "center", justifyContent: "center", fontSize: 36,
        }}
      >
        🎛️
      </div>
      <div>
        <h2 style={{ color: "#E2E8F0", fontSize: 18, fontWeight: 700, margin: 0, fontFamily: "system-ui" }}>
          Load a Track
        </h2>
        <p style={{ color: "#64748B", fontSize: 13, marginTop: 6, fontFamily: "system-ui", maxWidth: 360 }}>
          Upload an audio file or pick a song from your Strands Library to separate into stems.
        </p>
      </div>
      <div style={{ display: "flex", gap: 12 }}>
        <button
          data-tour="daw.upload"
          onClick={onLoadFile}
          style={{
            padding: "10px 24px", borderRadius: 8, border: "none", cursor: "pointer",
            background: "linear-gradient(135deg, #00C2FF, #8B5CF6)",
            color: "#FFF", fontWeight: 600, fontSize: 14, fontFamily: "system-ui",
          }}
        >
          Upload Audio File
        </button>
        <button
          data-tour="daw.library"
          onClick={onLoadFromLibrary}
          style={{
            padding: "10px 24px", borderRadius: 8,
            border: "1px solid #334155", cursor: "pointer",
            background: "#1E293B", color: "#E2E8F0",
            fontWeight: 600, fontSize: 14, fontFamily: "system-ui",
          }}
        >
          From Library
        </button>
      </div>
      <p style={{ color: "#475569", fontSize: 11, fontFamily: "system-ui", marginTop: 8 }}>
        Supports MP3, WAV, FLAC, OGG, M4A
      </p>
      {savedStemGroups && savedStemGroups.length > 0 && (
        <div style={{ marginTop: 24, width: "100%", maxWidth: 480 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
            <div style={{ flex: 1, height: 1, background: "#1E293B" }} />
            <span style={{ fontSize: 11, color: "#64748B", fontFamily: "system-ui", fontWeight: 600, textTransform: "uppercase", letterSpacing: 1 }}>
              Saved Stems
            </span>
            <div style={{ flex: 1, height: 1, background: "#1E293B" }} />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 200, overflowY: "auto" }}>
            {savedStemGroups.map(group => (
              <button
                key={group.songTitle}
                onClick={() => onLoadSavedStems?.(group)}
                style={{
                  display: "flex", alignItems: "center", gap: 10, padding: "8px 12px",
                  borderRadius: 6, border: "1px solid #1E293B", background: "#0F1219",
                  cursor: "pointer", textAlign: "left", transition: "all 0.15s",
                }}
                onMouseEnter={event => { (event.currentTarget as HTMLElement).style.borderColor = '#00C2FF40'; }}
                onMouseLeave={event => { (event.currentTarget as HTMLElement).style.borderColor = '#1E293B'; }}
              >
                <span style={{ fontSize: 18 }}>📂</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, color: "#E2E8F0", fontFamily: "system-ui", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {group.songTitle}
                  </div>
                  <div style={{ fontSize: 11, color: "#64748B", fontFamily: "system-ui" }}>
                    {group.stems.length} stems
                  </div>
                </div>
                <span style={{ fontSize: 11, color: "#475569", fontFamily: "system-ui" }}>
                  {group.createdAt ? new Date(group.createdAt).toLocaleDateString() : ''}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── MasterTransport ────────────────────────────────────────────────

function MasterTransport({
  playing,
  onTogglePlay,
  onStop,
  playheadTime,
  duration,
  trackTitle,
  disabled,
}: {
  playing: boolean;
  onTogglePlay: () => void;
  onStop: () => void;
  playheadTime: number;
  duration: number;
  trackTitle: string;
  disabled: boolean;
}) {
  return (
    <div
      style={{
        display: "flex", alignItems: "center", justifyContent: "center", gap: 16,
        padding: "12px 16px", background: "#0A0B0D", borderTop: "1px solid #1E293B",
      }}
    >
      <button onClick={onStop} disabled={disabled}
        style={{ background: "none", border: "none", color: disabled ? "#334155" : "#94A3B8", fontSize: 18, cursor: disabled ? "default" : "pointer" }}>
        &#x23EE;
      </button>
      <button onClick={onTogglePlay} disabled={disabled}
        style={{
          width: 40, height: 40, borderRadius: "50%",
          border: `2px solid ${disabled ? "#334155" : "#00C2FF"}`,
          background: playing ? "#00C2FF20" : "transparent",
          cursor: disabled ? "default" : "pointer",
          display: "flex", alignItems: "center", justifyContent: "center",
          color: disabled ? "#334155" : "#00C2FF", fontSize: 16,
          transition: "all 0.2s", opacity: disabled ? 0.4 : 1,
        }}>
        {playing ? "||" : "\u25B6"}
      </button>
      <button disabled={disabled}
        style={{ background: "none", border: "none", color: disabled ? "#334155" : "#94A3B8", fontSize: 18, cursor: disabled ? "default" : "pointer" }}>
        &#x23ED;
      </button>
      <div style={{ width: 1, height: 24, background: "#1E293B" }} />
      <span style={{ fontFamily: "monospace", fontSize: 14, color: disabled ? "#334155" : "#E2E8F0", minWidth: 90 }}>
        {formatTime(playheadTime)} / {formatTime(duration)}
      </span>
      <div style={{ flex: 1, textAlign: "left" }}>
        {trackTitle && <span style={{ fontSize: 12, color: "#64748B", fontFamily: "system-ui" }}>{trackTitle}</span>}
      </div>
      <div style={{
        padding: "4px 10px", borderRadius: 4, background: "#16A34A15",
        border: "1px solid #16A34A40", fontSize: 11, color: "#16A34A", fontWeight: 600, fontFamily: "system-ui",
      }}>
        S&sup3; DAW
      </div>
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────────────────

interface StemStudioProps {
  initialSong?: Song | null;
  autoExtract?: boolean;
  /** Callback when stems are extracted; passes stem audio URLs keyed by track name */
  onStemsExtracted?: (stems: Record<TrackName, string | null>) => void;
  /** Callback when source audio URL is available */
  onSourceAudioUrl?: (url: string) => void;
  /** Callback when track duration is determined */
  onTrackDuration?: (duration: number) => void;
  /** Shared AudioMixer controls from DawCore (optional; when present, uses mixer for playback) */
  mixer?: import('./useMixer').MixerControls;
}

export default function StemStudio({ initialSong, autoExtract, onStemsExtracted, onSourceAudioUrl, onTrackDuration, mixer }: StemStudioProps = {}) {
  const { token, hasTier, isTrialActive } = useAuth();
  const { songs: librarySongs } = useSongStore();
  const [showLibraryPicker, setShowLibraryPicker] = useState(false);
  const [librarySearch, setLibrarySearch] = useState('');
  const [phase, setPhase] = useState<StudioPhase>("empty");
  const [loadedTrack, setLoadedTrack] = useState<LoadedTrack | null>(null);
  const [stems, setStems] = useState<StemState[]>(initStems);
  const [extractProgress, setExtractProgress] = useState(0);
  const [sourceAudioUrl, setSourceAudioUrl] = useState<string | null>(null);
  const [sourceUploadPending, setSourceUploadPending] = useState(false);

  // Error state for extraction failures
  const [extractError, setExtractError] = useState<string | null>(null);
  const [proModelPresent, setProModelPresent] = useState<boolean | null>(null);
  const [proModelDownloading, setProModelDownloading] = useState(false);
  const canUseProModel = hasTier('gener8_pro') && !isTrialActive;

  // Saved stem groups from disk
  const [savedStemGroups, setSavedStemGroups] = useState<StemGroup[]>([]);
  useEffect(() => {
    studioApi.listStemGroups()
      .then(res => setSavedStemGroups(res.stemGroups || []))
      .catch(() => {});
  }, [phase]); // Re-fetch when phase changes (new extractions may have landed)

  const refreshProModelStatus = useCallback(async (): Promise<boolean> => {
    try {
      const res = await fetch(`${getApiBase()}/api/engine/pack-status?pack_id=pro_base`, {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      if (!res.ok) {
        setProModelPresent(false);
        return false;
      }
      const data = await res.json();
      const present = !!data.present;
      setProModelPresent(present);
      return present;
    } catch {
      setProModelPresent(false);
      return false;
    }
  }, [token]);

  useEffect(() => {
    if (!token || !canUseProModel) {
      setProModelPresent(false);
      return;
    }
    void refreshProModelStatus();
  }, [token, canUseProModel, refreshProModelStatus]);

  const handleDownloadProModel = useCallback(async () => {
    if (!canUseProModel) {
      setExtractError('Stem extraction requires the Pro Model.');
      setPhase("error");
      return;
    }
    setProModelDownloading(true);
    setExtractError('Downloading Pro Model...');
    showToast({
      kind: 'info',
      eyebrow: 'Everywear · model lifecycle',
      message: 'Stem separation requested the Pro Model. Everywear is pulling the VRAM-fit pack now.',
      durationMs: 9000,
    });
    try {
      const res = await fetch(`${getApiBase()}/api/engine/install-pack`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ pack_id: 'pro_base' }),
      });
      const text = await res.text();
      if (!res.ok || text.includes('event: error')) {
        throw new Error('Pro Model download failed. Check launcher logs for details.');
      }
      setProModelPresent(true);
      setExtractError('Pro Model installed. Stem extraction is ready.');
      showToast({
        kind: 'success',
        eyebrow: 'Everywear · model lifecycle',
        message: 'Pro Model installed. Stem separation is ready.',
        durationMs: 6500,
      });
      if (phase === "error") setPhase("loaded");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setExtractError(msg);
      showToast({
        kind: 'error',
        eyebrow: 'Everywear · model lifecycle',
        message: msg,
        durationMs: 9000,
      });
      setPhase("error");
    } finally {
      setProModelDownloading(false);
    }
  }, [canUseProModel, phase, token]);

  const ensureProModelPresent = useCallback(async (): Promise<boolean> => {
    if (!canUseProModel) {
      setExtractError('Stem extraction requires the Pro Model.');
      setPhase("error");
      return false;
    }
    const present = proModelPresent ?? await refreshProModelStatus();
    if (!present) {
      setExtractError('Download Pro Model. Stem extraction requires the Pro Model.');
      setPhase("error");
      return false;
    }
    return true;
  }, [canUseProModel, proModelPresent, refreshProModelStatus]);

  // Real waveform data from audio analysis
  const [waveformData, setWaveformData] = useState<Record<string, WaveformData | null>>({});
  const [analysingWaveforms, setAnalysingWaveforms] = useState<Set<string>>(new Set());

  // Trigger waveform analysis when stem audioUrl changes
  useEffect(() => {
    for (const stem of stems) {
      if (!stem.audioUrl || stem.audioUrl === 'simulated') continue;
      if (waveformData[stem.id]) continue;
      if (analysingWaveforms.has(stem.id)) continue;

      setAnalysingWaveforms(prev => new Set(prev).add(stem.id));

      analyseWaveformCached(stem.audioUrl, 200)
        .then(data => {
          setWaveformData(prev => ({ ...prev, [stem.id]: data }));
          setAnalysingWaveforms(prev => {
            const next = new Set(prev);
            next.delete(stem.id);
            return next;
          });
        })
        .catch(err => {
          console.warn(`[StemStudio] Waveform analysis failed for ${stem.id}:`, err);
          setAnalysingWaveforms(prev => {
            const next = new Set(prev);
            next.delete(stem.id);
            return next;
          });
        });
    }
  }, [stems]);

  const [playing, setPlaying] = useState(false);
  const [playheadTime, setPlayheadTime] = useState(0);
  const [repaintActive, setRepaintActive] = useState(false);
  const [repaintTrack, setRepaintTrack] = useState<TrackName | null>(null);
  const [repaintRange, setRepaintRange] = useState({ start: 0, end: 10 });
  const [repaintMode, setRepaintMode] = useState<'conservative' | 'balanced' | 'aggressive'>('balanced');
  const [repaintStrength, setRepaintStrength] = useState(70);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const animRef = useRef<number | null>(null);
  const lastInitialSongIdRef = useRef<string | null>(null);
  const pollIntervalsRef = useRef<Map<string, ReturnType<typeof setInterval>>>(new Map());

  const duration = loadedTrack?.duration ?? 0;
  const playheadPct = duration > 0 ? (playheadTime / duration) * 100 : 0;

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      pollIntervalsRef.current.forEach(interval => clearInterval(interval));
    };
  }, []);

  // ── Auto-load song from intent bus ──
  useEffect(() => {
    if (!initialSong || !initialSong.audioUrl) return;
    if (lastInitialSongIdRef.current === initialSong.id) return;
    lastInitialSongIdRef.current = initialSong.id;

    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    setPlaying(false);
    setPlayheadTime(0);
    setStems(initStems());

    const audio = new Audio(initialSong.audioUrl);
    audio.addEventListener("loadedmetadata", () => {
      const track: LoadedTrack = {
        title: initialSong.title || "Untitled",
        audioUrl: initialSong.audioUrl!,
        duration: audio.duration,
      };
      setLoadedTrack(track);
      setSourceAudioUrl(initialSong.audioUrl!);
      audioRef.current = audio;
      setPhase("loaded");

      if (autoExtract) {
        setTimeout(() => handleExtract(initialSong.audioUrl!, initialSong.title || "Untitled"), 500);
      }
    });

    audio.addEventListener("error", () => {
      console.warn("[StemStudio] Failed to load audio from intent:", initialSong.audioUrl);
    });
  }, [initialSong, autoExtract]);

  // ── Determine if mixer should handle playback (stems extracted + mixer available) ──
  const useMixerPlayback = !!(mixer && phase === 'extracted' && mixer.loadedStems.size > 0);

  // ── Sync playhead from mixer when in mixer mode ──
  useEffect(() => {
    if (!useMixerPlayback) return;
    // Mixer drives playhead time; sync it to our local state for the waveform UI
    const id = setInterval(() => {
      if (mixer!.isPlaying) {
        setPlayheadTime(mixer!.currentTime);
      }
    }, 50); // 20fps update is plenty for the playhead indicator
    return () => clearInterval(id);
  }, [useMixerPlayback, mixer]);

  // ── Audio playback sync (HTML5 fallback for pre-extraction) ──
  useEffect(() => {
    if (useMixerPlayback) return; // Mixer handles playback
    if (!playing || !audioRef.current) {
      if (animRef.current) cancelAnimationFrame(animRef.current);
      return;
    }
    const audio = audioRef.current;
    audio.play().catch(() => {});

    const tick = () => {
      setPlayheadTime(audio.currentTime);
      if (!audio.paused && !audio.ended) {
        animRef.current = requestAnimationFrame(tick);
      } else if (audio.ended) {
        setPlaying(false);
        setPlayheadTime(0);
      }
    };
    animRef.current = requestAnimationFrame(tick);
    return () => { if (animRef.current) cancelAnimationFrame(animRef.current); };
  }, [playing, useMixerPlayback]);

  useEffect(() => {
    if (useMixerPlayback) return; // Mixer handles pause
    if (!playing && audioRef.current && !audioRef.current.paused) {
      audioRef.current.pause();
    }
  }, [playing, useMixerPlayback]);

  // ── File upload handler ──
  const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const url = URL.createObjectURL(file);
    const audio = new Audio(url);

    audio.addEventListener("loadedmetadata", () => {
      const track: LoadedTrack = {
        title: file.name.replace(/\.[^.]+$/, ""),
        audioUrl: url,
        duration: audio.duration,
      };
      setLoadedTrack(track);
      audioRef.current = audio;
      setPhase("loaded");
      setPlayheadTime(0);
      setPlaying(false);
      setStems(initStems());
      setExtractError(null);
      setSourceAudioUrl(null);

      // Upload to server for engine access
      if (token) {
        setSourceUploadPending(true);
        generateApi.uploadAudio(file, token)
          .then(({ url: serverUrl }) => {
            setSourceAudioUrl(serverUrl);
            setExtractError(null);
          })
          .catch((err) => {
            console.warn('[StemStudio] Upload failed; extraction requires a server-accessible source:', err);
            setSourceAudioUrl(null);
            setExtractError(err instanceof Error ? err.message : 'Upload failed. Try again or restart the local engine.');
          })
          .finally(() => {
            setSourceUploadPending(false);
          });
      } else {
        setSourceUploadPending(false);
        setSourceAudioUrl(null);
        setExtractError('Authentication required. Please sign in before extracting uploaded audio.');
      }
    });

    audio.addEventListener("error", () => {
      alert("Could not load audio file. Ensure it's a valid MP3, WAV, FLAC, OGG, or M4A.");
    });
  }, [token]);

  const handleLoadFromLibrary = useCallback(() => {
    setShowLibraryPicker(true);
    setLibrarySearch('');
  }, []);

  // ── Extract stems (real API only; no fake fallback) ──
  const handleExtract = useCallback(async (audioUrlOverride?: string, sourceTitleOverride?: string) => {
    // Auto-extract is scheduled immediately after loading a track. React may
    // not have committed phase="loaded" by the time that timer fires, so an
    // explicit audio URL is enough to proceed.
    if (!audioUrlOverride && phase !== "loaded" && phase !== "extracted" && phase !== "error") return;
    const srcUrl = audioUrlOverride || sourceAudioUrl;
    if (!srcUrl || !token) {
      setExtractError(srcUrl ? 'Authentication required. Please sign in to extract stems.' : 'No audio source loaded.');
      setPhase("error");
      return;
    }

    const proReady = await ensureProModelPresent();
    if (!proReady) return;

    // Ensure Pro Model is selected (extraction requires it)
    const modelOk = await ensureModel('base');
    if (!modelOk) {
      setExtractError('Could not load the Pro Model. Ensure the local engine is running.');
      setPhase("error");
      return;
    }

    setPhase("extracting");
    setExtractProgress(0);
    setExtractError(null);

    // Mark all stems as pending
    setStems(prev => prev.map(s => ({ ...s, extractStatus: 'pending' as const, audioUrl: null })));

    let completedCount = 0;
    let finalising = false;
    const completedUrls = new Map<TrackName, string>();

    const finaliseExtraction = async () => {
      if (finalising) return;
      finalising = true;

      const succeeded = completedUrls.size;
      if (succeeded === 0) {
        setExtractError(`All ${TRACK_NAMES.length} stem extractions failed.`);
        setPhase("error");
        return;
      }

      setExtractProgress(100);
      setExtractError("Validating separated stems...");

      try {
        const validation = await validateStemOutputs(
          srcUrl,
          Array.from(completedUrls.entries()).map(([trackName, audioUrl]) => ({ trackName, audioUrl })),
        );

        if (validation.ok === false) {
          setStems(prev => prev.map(s =>
            s.audioUrl ? { ...s, extractStatus: 'failed' as const } : s
          ));
          setExtractError(validation.message);
          setPhase("error");
          return;
        }

        setExtractError(null);
        setPhase("extracted");
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setExtractError(`Could not validate stem outputs: ${msg}`);
        setPhase("error");
      }
    };

    // Launch extraction for each stem
    for (const trackName of TRACK_NAMES) {
      try {
        const job = await studioApi.extractStem(srcUrl, trackName, token, sourceTitleOverride || loadedTrack?.title);

        // Update stem with job ID
        setStems(prev => prev.map(s =>
          s.id === trackName ? { ...s, jobId: job.jobId, extractStatus: 'running' as const } : s
        ));

        // Poll this job
        studioApi.pollJob(job.jobId, token, (status) => {
          if (status.status === 'succeeded' && status.result?.audioUrls?.[0]) {
            const stemUrl = getAudioUrl(status.result.audioUrls[0]) || status.result.audioUrls[0];
            completedUrls.set(trackName, stemUrl);
            setStems(prev => prev.map(s =>
              s.id === trackName ? { ...s, audioUrl: stemUrl, extractStatus: 'done' as const } : s
            ));
            completedCount++;
            setExtractProgress(Math.round((completedCount / TRACK_NAMES.length) * 100));

            if (completedCount >= TRACK_NAMES.length) {
              void finaliseExtraction();
            }
          } else if (status.status === 'failed') {
            setStems(prev => prev.map(s =>
              s.id === trackName ? { ...s, extractStatus: 'failed' as const } : s
            ));
            completedCount++;
            setExtractProgress(Math.round((completedCount / TRACK_NAMES.length) * 100));

            if (completedCount >= TRACK_NAMES.length) {
              void finaliseExtraction();
            }
          }
        }).catch(() => {
          setStems(prev => prev.map(s =>
            s.id === trackName ? { ...s, extractStatus: 'failed' as const } : s
          ));
          completedCount++;
          if (completedCount >= TRACK_NAMES.length) {
            void finaliseExtraction();
          }
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[StemStudio] Extract API failed for ${trackName}:`, msg);
        setExtractError(`Stem extraction failed: ${msg}. Ensure the engine is running on localhost:3001.`);
        setPhase("error");
        // Reset all stems to idle on total failure
        setStems(prev => prev.map(s => ({ ...s, extractStatus: 'idle' as const })));
        return;
      }
    }
  }, [phase, sourceAudioUrl, token, loadedTrack, ensureProModelPresent]);

  const handleDroppedSong = useCallback((songData: { audioUrl: string; title: string; duration?: number; style?: string }) => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    setPlaying(false);
    setPlayheadTime(0);
    setStems(initStems());

    const audio = new Audio(songData.audioUrl);
    audio.addEventListener("loadedmetadata", () => {
      const track: LoadedTrack = {
        title: songData.title || "Untitled",
        audioUrl: songData.audioUrl,
        duration: audio.duration,
      };
      setLoadedTrack(track);
      setSourceAudioUrl(songData.audioUrl);
      audioRef.current = audio;
      setPhase("loaded");
      // Auto-extract after drop
      setTimeout(() => handleExtract(songData.audioUrl, songData.title || "Untitled"), 500);
    });

    audio.addEventListener("error", () => {
      console.warn("[StemStudio] Failed to load dropped audio:", songData.audioUrl);
    });
  }, [handleExtract]);

  const handleSelectFromLibrary = useCallback((song: Song) => {
    setShowLibraryPicker(false);
    const audioUrl = song.audioUrl ? getAudioUrl(song.audioUrl, song.id) : null;
    if (!audioUrl) return;
    handleDroppedSong({ audioUrl, title: song.title, duration: typeof song.duration === 'string' ? parseFloat(song.duration) : undefined });
  }, [handleDroppedSong]);

  // ── Load saved stem group back into workspace ──
  const handleLoadSavedStems = useCallback(async (group: StemGroup) => {
    const track: LoadedTrack = {
      title: group.songTitle,
      audioUrl: '',
      duration: 0,
    };

    const savedStemEntries = group.stems
      .filter((saved): saved is typeof saved & { trackName: TrackName } =>
        TRACK_NAMES.includes(saved.trackName as TrackName) && !!saved.audioUrl,
      )
      .map(saved => ({
        trackName: saved.trackName,
        audioUrl: saved.audioUrl,
      }));

    if (savedStemEntries.length < 2 && group.stems.length >= 2) {
      setLoadedTrack(track);
      setStems(initStems());
      setExtractProgress(0);
      setPhase("error");
      setExtractError(
        `Saved stem group "${group.songTitle}" was not loaded: it uses legacy track labels and needs to be re-extracted with semantic stems.`,
      );
      return;
    }

    const validation = await validateStemOutputs(null, savedStemEntries);
    if (validation.ok === false) {
      setLoadedTrack(track);
      setStems(initStems());
      setExtractProgress(0);
      setPhase("error");
      setExtractError(`Saved stem group "${group.songTitle}" was not loaded: ${validation.message}`);
      return;
    }

    setLoadedTrack(track);
    setPhase("extracted");
    setExtractProgress(100);
    setExtractError(null);
    const newStems = initStems().map(stem => {
      const saved = group.stems.find(sf => sf.trackName === stem.id);
      if (saved) {
        return { ...stem, audioUrl: saved.audioUrl, extractStatus: 'done' as const };
      }
      return stem;
    });
    setStems(newStems);
  }, []);

  // ── Lego regeneration ──
  const handleRegenerate = useCallback(async (trackName: TrackName) => {
    if (!sourceAudioUrl || !token) {
      console.warn('[StemStudio] Cannot regenerate: no source audio or auth token');
      return;
    }

    setStems(prev => prev.map(s =>
      s.id === trackName ? { ...s, regenStatus: 'running' as const } : s
    ));

    try {
      const job = await studioApi.legoRegenerate({
        sourceAudioUrl,
        trackName,
        style: loadedTrack?.key ? `Key: ${loadedTrack.key}` : '',
        duration: loadedTrack?.duration,
      }, token);

      studioApi.pollJob(job.jobId, token, (status) => {
        if (status.status === 'succeeded' && status.result?.audioUrls?.[0]) {
          const audioUrl = getAudioUrl(status.result.audioUrls[0]) || status.result.audioUrls[0];
          setStems(prev => prev.map(s =>
            s.id === trackName ? {
              ...s,
              audioUrl,
              regenStatus: 'idle' as const,
            } : s
          ));
        } else if (status.status === 'failed') {
          setStems(prev => prev.map(s =>
            s.id === trackName ? { ...s, regenStatus: 'idle' as const } : s
          ));
        }
      }).catch(() => {
        setStems(prev => prev.map(s =>
          s.id === trackName ? { ...s, regenStatus: 'idle' as const } : s
        ));
      });
    } catch {
      setStems(prev => prev.map(s =>
        s.id === trackName ? { ...s, regenStatus: 'idle' as const } : s
      ));
    }
  }, [sourceAudioUrl, token, loadedTrack]);

  // ── Repaint ──
  const handleRepaint = useCallback(async () => {
    if (!sourceAudioUrl || !token || !repaintTrack) return;

    const trackName = repaintTrack;
    setStems(prev => prev.map(s =>
      s.id === trackName ? { ...s, regenStatus: 'running' as const } : s
    ));

    try {
      const job = await studioApi.repaint({
        sourceAudioUrl,
        start: repaintRange.start,
        end: repaintRange.end,
        mode: repaintMode,
        strength: repaintStrength / 100,
        trackName,
      }, token);

      studioApi.pollJob(job.jobId, token, (status) => {
        if (status.status === 'succeeded' && status.result?.audioUrls?.[0]) {
          const audioUrl = getAudioUrl(status.result.audioUrls[0]) || status.result.audioUrls[0];
          setStems(prev => prev.map(s =>
            s.id === trackName ? {
              ...s,
              audioUrl,
              regenStatus: 'idle' as const,
            } : s
          ));
        } else if (status.status === 'failed') {
          setStems(prev => prev.map(s =>
            s.id === trackName ? { ...s, regenStatus: 'idle' as const } : s
          ));
        }
      });
    } catch {
      setStems(prev => prev.map(s =>
        s.id === trackName ? { ...s, regenStatus: 'idle' as const } : s
      ));
    }
  }, [sourceAudioUrl, token, repaintTrack, repaintRange, repaintMode, repaintStrength]);

  // ── Transport controls ──
  const toggleMute = useCallback((id: TrackName) => {
    setStems(prev => prev.map(s => {
      if (s.id !== id) return s;
      const newMuted = !s.muted;
      mixer?.setMuted(id, newMuted);
      return { ...s, muted: newMuted };
    }));
  }, [mixer]);

  const toggleSolo = useCallback((id: TrackName) => {
    setStems(prev => prev.map(s => {
      if (s.id !== id) return s;
      const newSolo = !s.solo;
      mixer?.setSolo(id, newSolo);
      return { ...s, solo: newSolo };
    }));
  }, [mixer]);

  const handleSeek = useCallback((time: number) => {
    if (useMixerPlayback) {
      mixer!.seek(time);
    } else if (audioRef.current) {
      audioRef.current.currentTime = time;
    }
    setPlayheadTime(time);
  }, [useMixerPlayback, mixer]);

  const handleTogglePlay = useCallback(() => {
    if (!loadedTrack) return;
    if (useMixerPlayback) {
      if (mixer!.isPlaying) {
        mixer!.pause();
      } else {
        mixer!.play();
      }
      setPlaying(!mixer!.isPlaying);
    } else {
      setPlaying(p => !p);
    }
  }, [loadedTrack, useMixerPlayback, mixer]);

  const handleStop = useCallback(() => {
    if (useMixerPlayback) {
      mixer!.stop();
    }
    setPlaying(false);
    setPlayheadTime(0);
    if (audioRef.current) audioRef.current.currentTime = 0;
  }, [useMixerPlayback, mixer]);

  const handleUnload = useCallback(() => {
    if (useMixerPlayback) {
      mixer!.stop();
    }
    setPlaying(false);
    if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; }
    setLoadedTrack(null);
    setPhase("empty");
    setPlayheadTime(0);
    setExtractProgress(0);
    setStems(initStems());
    setSourceAudioUrl(null);
    setSourceUploadPending(false);
    setRepaintActive(false);
    setRepaintTrack(null);
    setExtractError(null);
  }, []);

  // Notify parent when extraction completes
  useEffect(() => {
    if (phase === "extracted" && onStemsExtracted) {
      const stemMap = stems.reduce((acc, s) => {
        acc[s.id] = s.audioUrl;
        return acc;
      }, {} as Record<TrackName, string | null>);
      const populated = Object.values(stemMap).filter(Boolean).length;
      const failed = Object.values(stemMap).filter(v => !v).length;
      console.log(`[StemStudio] Firing onStemsExtracted: ${populated} URLs, ${failed} failed`, stemMap);
      onStemsExtracted(stemMap);
    }
  }, [phase, stems, onStemsExtracted]);

  // ── Notify parent of source audio URL and track duration ──
  useEffect(() => {
    if (sourceAudioUrl && onSourceAudioUrl) {
      onSourceAudioUrl(sourceAudioUrl);
    }
  }, [sourceAudioUrl, onSourceAudioUrl]);

  useEffect(() => {
    if (loadedTrack && onTrackDuration) {
      onTrackDuration(loadedTrack.duration);
    }
  }, [loadedTrack, onTrackDuration]);

  const completedStems = stems.filter(s => s.extractStatus === 'done').length;
  const hasSolo = stems.some(s => s.solo);
  const extractionUnavailable = phase === "extracting" || sourceUploadPending || proModelDownloading || !sourceAudioUrl;

  // ── Render ──
  return (
    <div
      style={{
        background: "#0A0B0D", overflow: "hidden", fontFamily: "system-ui",
        height: "100%", display: "flex", flexDirection: "column",
      }}
    >
      <input ref={fileInputRef} type="file" accept="audio/*" style={{ display: "none" }} onChange={handleFileUpload} />

      {/* Header */}
      <div
        style={{
          display: "flex", alignItems: "center", padding: "12px 16px",
          background: "linear-gradient(135deg, #0F172A 0%, #1E1B4B 100%)",
          borderBottom: "1px solid #1E293B", flexShrink: 0,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 20, color: "#00C2FF", fontWeight: 800 }}>S&sup3;</span>
          <span style={{ fontSize: 15, color: "#E2E8F0", fontWeight: 600 }}>S3 DAW</span>
          <span style={{
            fontSize: 10, padding: "2px 6px", borderRadius: 3,
            background: phase === "extracted" ? "#16A34A20" : phase === "error" ? "#EF444420" : "#8B5CF620",
            border: `1px solid ${phase === "extracted" ? "#16A34A40" : phase === "error" ? "#EF444440" : "#8B5CF640"}`,
            color: phase === "extracted" ? "#16A34A" : phase === "error" ? "#EF4444" : "#A78BFA",
          }}>
            {phase === "extracted"
              ? `${completedStems}/12 STEMS READY`
              : phase === "extracting"
              ? `EXTRACTING ${extractProgress}%`
              : phase === "error"
              ? "EXTRACTION FAILED"
              : phase === "loaded"
              ? "TRACK LOADED"
              : "AUDIO STUDIO"}
          </span>
        </div>
        <div style={{ flex: 1 }} />
        {loadedTrack && (
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 12, color: "#94A3B8" }}>{loadedTrack.title}</span>
            <span style={{ fontSize: 11, color: "#475569" }}>{formatTime(loadedTrack.duration)}</span>
            <button onClick={handleUnload}
              style={{
                padding: "3px 8px", borderRadius: 4, border: "1px solid #334155",
                background: "#1E293B", color: "#94A3B8", fontSize: 11, cursor: "pointer",
              }}>
              Unload
            </button>
          </div>
        )}
        {phase === "empty" && (
          <span style={{ fontSize: 12, color: "#64748B", fontStyle: "italic" }}>
            Upload audio or generate a track to begin
          </span>
        )}
      </div>

      {/* EMPTY STATE */}
      {phase === "empty" && (
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <EmptyState
            onLoadFile={() => fileInputRef.current?.click()}
            onLoadFromLibrary={handleLoadFromLibrary}
            onDroppedSong={handleDroppedSong}
            savedStemGroups={savedStemGroups}
            onLoadSavedStems={handleLoadSavedStems}
          />
        </div>
      )}

      {/* LOADED / EXTRACTING / EXTRACTED / ERROR */}
      {phase !== "empty" && (
        <>
          {/* Error Banner */}
          {phase === "error" && extractError && (
            <div
              style={{
                display: "flex", alignItems: "center", gap: 12, padding: "10px 16px",
                background: "#1C0A0A", borderBottom: "1px solid #7F1D1D",
                color: "#FCA5A5", fontSize: 12, fontFamily: "system-ui", flexShrink: 0,
              }}
            >
              <span style={{ fontWeight: 700, color: "#EF4444" }}>Error:</span>
              <span style={{ flex: 1 }}>{extractError}</span>
              <button
                onClick={() => { setExtractError(null); setPhase("loaded"); }}
                style={{
                  padding: "4px 12px", borderRadius: 4, border: "1px solid #7F1D1D",
                  background: "#1E293B", color: "#FCA5A5", fontSize: 11, cursor: "pointer",
                }}
              >
                Dismiss
              </button>
            </div>
          )}

          {phase !== "extracting" && proModelPresent === false && (
            <div
              style={{
                display: "flex", alignItems: "center", gap: 12, padding: "10px 16px",
                background: "#17110A", borderBottom: "1px solid #78350F",
                color: "#FCD34D", fontSize: 12, fontFamily: "system-ui", flexShrink: 0,
              }}
            >
              <span style={{ fontWeight: 700 }}>Download Pro Model.</span>
              <span style={{ flex: 1 }}>Stem extraction requires the Pro Model.</span>
              {canUseProModel && (
                <button
                  onClick={handleDownloadProModel}
                  disabled={proModelDownloading}
                  style={{
                    padding: "6px 12px", borderRadius: 4, border: "1px solid #F59E0B",
                    background: "#F59E0B", color: "#111827", fontSize: 11,
                    fontWeight: 700, cursor: proModelDownloading ? "default" : "pointer",
                    opacity: proModelDownloading ? 0.75 : 1,
                  }}
                >
                  {proModelDownloading ? "Downloading..." : "Download Pro Model"}
                </button>
              )}
            </div>
          )}

          {/* Action Bar */}
          <div
            data-tour="daw.actions"
            style={{
              display: "flex", alignItems: "center", gap: 12, padding: "10px 16px",
              background: "#0F1219", borderBottom: "1px solid #1E293B", flexShrink: 0,
            }}
          >
            <button
              data-tour="daw.extract"
              onClick={() => handleExtract()}
              disabled={extractionUnavailable}
              style={{
                padding: "8px 16px", borderRadius: 6, border: "none",
                cursor: extractionUnavailable ? "default" : "pointer",
                background: (phase === "extracting" || sourceUploadPending || !sourceAudioUrl) ? "#1E293B"
                  : phase === "extracted" ? "#16A34A20"
                  : phase === "error" ? "#EF444420"
                  : "linear-gradient(135deg, #00C2FF, #8B5CF6)",
                color: phase === "extracted" ? "#16A34A" : phase === "error" ? "#EF4444" : "#FFF",
                fontWeight: 600, fontSize: 13, fontFamily: "system-ui",
                opacity: extractionUnavailable ? 0.7 : 1,
                transition: "all 0.2s", minWidth: 160,
              }}
            >
              {phase === "extracting"
                ? `Extracting... ${extractProgress}%`
                : proModelDownloading
                ? "Downloading Pro Model..."
                : sourceUploadPending
                ? "Preparing audio..."
                : !sourceAudioUrl
                ? "Audio not ready"
                : phase === "extracted"
                ? `${completedStems} Stems Extracted`
                : phase === "error"
                ? "Retry Extraction"
                : "Extract Stems"}
            </button>

            {phase === "extracted" && (
              <>
                <div style={{ width: 1, height: 24, background: "#1E293B" }} />
                <button
                  data-tour="daw.repaint"
                  onClick={() => {
                    setRepaintActive(!repaintActive);
                    if (!repaintActive && !repaintTrack) {
                      // Default to first stem with audio
                      const first = stems.find(s => s.audioUrl);
                      if (first) setRepaintTrack(first.id);
                    }
                  }}
                  style={{
                    padding: "8px 16px", borderRadius: 6,
                    border: repaintActive ? "1px solid #00C2FF" : "1px solid #334155",
                    cursor: "pointer",
                    background: repaintActive ? "#00C2FF15" : "#1E293B",
                    color: repaintActive ? "#00C2FF" : "#94A3B8",
                    fontWeight: 600, fontSize: 13, fontFamily: "system-ui",
                  }}
                >
                  {repaintActive ? "Exit Repaint" : "Repaint Mode"}
                </button>

                {repaintActive && (
                  <>
                    {/* Track selector */}
                    <select
                      value={repaintTrack || ''}
                      onChange={(e) => setRepaintTrack(e.target.value as TrackName)}
                      style={{
                        background: "#1E293B", color: "#E2E8F0",
                        border: "1px solid #334155", borderRadius: 4,
                        padding: "4px 8px", fontSize: 12,
                      }}
                    >
                      {stems.filter(s => s.audioUrl).map(s => (
                        <option key={s.id} value={s.id}>{s.label}</option>
                      ))}
                    </select>

                    <select
                      value={repaintMode}
                      onChange={(e) => setRepaintMode(e.target.value as typeof repaintMode)}
                      style={{
                        background: "#1E293B", color: "#E2E8F0",
                        border: "1px solid #334155", borderRadius: 4,
                        padding: "4px 8px", fontSize: 12,
                      }}
                    >
                      <option value="conservative">Conservative</option>
                      <option value="balanced">Balanced</option>
                      <option value="aggressive">Aggressive</option>
                    </select>

                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ fontSize: 11, color: "#64748B" }}>Strength</span>
                      <input type="range" min="0" max="100" value={repaintStrength}
                        onChange={(e) => setRepaintStrength(Number(e.target.value))}
                        style={{ width: 80, accentColor: "#00C2FF" }} />
                      <span style={{ fontSize: 11, color: "#94A3B8", fontFamily: "monospace", minWidth: 30 }}>
                        {repaintStrength}%
                      </span>
                    </div>

                    <button
                      onClick={handleRepaint}
                      style={{
                        padding: "6px 14px", borderRadius: 6, border: "none", cursor: "pointer",
                        background: "linear-gradient(135deg, #00C2FF, #8B5CF6)",
                        color: "#FFF", fontWeight: 600, fontSize: 12,
                      }}
                    >
                      Repaint
                    </button>
                  </>
                )}
              </>
            )}

            <div style={{ flex: 1 }} />
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              {loadedTrack?.bpm && <span style={{ fontSize: 11, color: "#64748B" }}>BPM: {loadedTrack.bpm}</span>}
              <span style={{ fontSize: 11, color: "#64748B" }}>Duration: {formatTime(duration)}</span>
              {loadedTrack?.key && (
                <>
                  <span style={{ fontSize: 11, color: "#334155" }}>|</span>
                  <span style={{ fontSize: 11, color: "#64748B" }}>Key: {loadedTrack.key}</span>
                </>
              )}
            </div>
          </div>

          {/* Extraction progress bar */}
          {phase === "extracting" && (
            <div style={{ padding: "16px", background: "#0F1219", borderBottom: "1px solid #1E293B", flexShrink: 0 }}>
              <div style={{ height: 4, borderRadius: 2, background: "#1E293B", overflow: "hidden" }}>
                <div style={{
                  height: "100%", width: `${extractProgress}%`,
                  background: "linear-gradient(90deg, #00C2FF, #8B5CF6)",
                  borderRadius: 2, transition: "width 0.3s",
                }} />
              </div>
              <p style={{ fontSize: 11, color: "#64748B", marginTop: 6 }}>
                Separating audio into {TRACK_NAMES.length} stems... {completedStems}/{TRACK_NAMES.length} complete
              </p>
            </div>
          )}

          {/* Time ruler */}
          {(phase === "loaded" || phase === "extracted") && duration > 0 && (
            <TimeRuler duration={duration} playheadPct={playheadPct} onSeek={handleSeek} />
          )}

          {/* Loaded prompt */}
          {phase === "loaded" && (
            <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <div style={{ textAlign: "center" }}>
                <p style={{ color: "#64748B", fontSize: 14 }}>
                  {sourceUploadPending ? (
                    "Preparing uploaded audio for the local engine. Stem extraction will unlock in a moment."
                  ) : sourceAudioUrl ? (
                    <>Track loaded. Click <strong style={{ color: "#00C2FF" }}>Extract Stems</strong> to separate into 12 tracks.</>
                  ) : (
                    "Track loaded for preview, but extraction needs a server-accessible audio source."
                  )}
                </p>
                <p style={{ color: "#475569", fontSize: 11, marginTop: 4 }}>
                  Uses the Pro Model for semantic stem extraction.
                </p>
              </div>
            </div>
          )}

          {/* Stem track rows */}
          {(phase === "extracted" || phase === "extracting") && (
            <div style={{ flex: 1, overflowY: "auto" }}>
              {stems.map(stem => {
                const effectiveMute = hasSolo ? !stem.solo : stem.muted;
                return (
                  <TrackRow
                    key={stem.id}
                    stem={{ ...stem, muted: effectiveMute }}
                    peaks={waveformData[stem.id]?.peaks ?? null}
                    analysingWaveform={analysingWaveforms.has(stem.id)}
                    playheadPct={playheadPct}
                    onToggleMute={() => toggleMute(stem.id)}
                    onToggleSolo={() => toggleSolo(stem.id)}
                    onRegenerate={() => handleRegenerate(stem.id)}
                    onVolumeChange={(vol) => {
                      setStems(prev => prev.map(s => s.id === stem.id ? { ...s, volume: vol } : s));
                      mixer?.setVolume(stem.id, vol);
                    }}
                    onPanChange={(pan) => {
                      setStems(prev => prev.map(s => s.id === stem.id ? { ...s, pan } : s));
                      mixer?.setPan(stem.id, pan);
                    }}
                    onSeek={handleSeek}
                    repaintMode={repaintActive && repaintTrack === stem.id}
                    repaintRange={repaintRange}
                    onRepaintRangeChange={(start, end) => setRepaintRange({ start, end })}
                    duration={duration}
                  />
                );
              })}
            </div>
          )}
        </>
      )}

      {/* Master Transport */}
      <MasterTransport
        playing={playing}
        onTogglePlay={handleTogglePlay}
        onStop={handleStop}
        playheadTime={playheadTime}
        duration={duration}
        trackTitle={loadedTrack?.title ?? ""}
        disabled={!loadedTrack}
      />

      {/* Library Picker Modal */}
      {showLibraryPicker && (
        <div
          style={{
            position: "fixed", inset: 0, zIndex: 9999,
            display: "flex", alignItems: "center", justifyContent: "center",
            background: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)",
          }}
          onClick={() => setShowLibraryPicker(false)}
        >
          <div
            style={{
              background: "#111827", border: "1px solid #374151", borderRadius: 16,
              width: 480, maxHeight: "70vh", display: "flex", flexDirection: "column",
              overflow: "hidden", boxShadow: "0 25px 50px rgba(0,0,0,0.5)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div style={{ padding: "16px 20px", borderBottom: "1px solid #1F2937" }}>
              <h3 style={{ color: "#E2E8F0", fontSize: 15, fontWeight: 700, margin: 0 }}>
                Select from S³ Library
              </h3>
              <p style={{ color: "#64748B", fontSize: 12, marginTop: 4 }}>
                Choose a track to load for stem separation
              </p>
              <input
                type="text"
                placeholder="Search songs..."
                value={librarySearch}
                onChange={(e) => setLibrarySearch(e.target.value)}
                autoFocus
                style={{
                  width: "100%", marginTop: 10, padding: "8px 12px", borderRadius: 8,
                  border: "1px solid #374151", background: "#0F172A", color: "#E2E8F0",
                  fontSize: 13, outline: "none",
                }}
              />
            </div>

            {/* Song List */}
            <div style={{ flex: 1, overflowY: "auto", padding: "8px 12px" }}>
              {librarySongs.length === 0 ? (
                <div style={{ padding: 32, textAlign: "center", color: "#64748B", fontSize: 13 }}>
                  No songs in your library yet. Generate some tracks in Gener8 first.
                </div>
              ) : (
                librarySongs
                  .filter(s => {
                    if (!librarySearch.trim()) return true;
                    const q = librarySearch.toLowerCase();
                    return (s.title?.toLowerCase().includes(q)) || (s.style?.toLowerCase().includes(q));
                  })
                  .map(song => (
                    <button
                      key={song.id}
                      onClick={() => handleSelectFromLibrary(song)}
                      style={{
                        display: "flex", alignItems: "center", gap: 12, width: "100%",
                        padding: "10px 12px", borderRadius: 10, border: "none",
                        background: "transparent", cursor: "pointer", textAlign: "left",
                        transition: "background 0.15s",
                      }}
                      onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "#1E293B"; }}
                      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
                    >
                      <img
                        src={song.coverUrl || `https://picsum.photos/seed/${song.id}/48/48`}
                        alt=""
                        style={{ width: 44, height: 44, borderRadius: 8, objectFit: "cover", flexShrink: 0 }}
                      />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ color: "#E2E8F0", fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {song.title || "Untitled"}
                        </div>
                        <div style={{ color: "#64748B", fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginTop: 2 }}>
                          {song.style || "No style"}
                        </div>
                      </div>
                      {(song.likeCount || song.like_count) ? (
                        <span style={{ color: "#94A3B8", fontSize: 11, flexShrink: 0, display: "flex", alignItems: "center", gap: 3 }}>
                          ♥ {song.likeCount || song.like_count}
                        </span>
                      ) : null}
                      <span style={{ color: "#475569", fontSize: 11, flexShrink: 0 }}>
                        {song.duration || ""}
                      </span>
                    </button>
                  ))
              )}
            </div>

            {/* Footer */}
            <div style={{ padding: "12px 20px", borderTop: "1px solid #1F2937", display: "flex", justifyContent: "flex-end" }}>
              <button
                onClick={() => setShowLibraryPicker(false)}
                style={{
                  padding: "8px 20px", borderRadius: 8, border: "1px solid #374151",
                  background: "#1E293B", color: "#94A3B8", fontSize: 13, fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
