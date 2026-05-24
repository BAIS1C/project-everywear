// @ts-nocheck
/**
 * DawPage — Full DAW timeline editor for Creator Studio.
 *
 * Two-layer architecture: all compute runs in the Rust backend via
 * localhost:3001/api/daw/* endpoints. This component is purely
 * presentational: waveform data, meters, and playback position come
 * from the backend over fetch/SSE.
 *
 * Layout (PROJECT-WIKI.md §9.10):
 *   HEADER:   Transport bar (play/stop/loop, tempo, position)
 *   LEFT:     Track headers (name, M/S, fader, pan)
 *   CENTER:   Timeline (track lanes, regions, waveforms, beat grid)
 *   RIGHT:    AI panel (repaint/lego/extend/complete) — Phase 2
 *   BOTTOM:   Status bar (project name, track count, zoom)
 *
 * EWDS pass 2026-05-12 SGT: migrated from inline style={{}} hex
 * values to Tailwind s3/accent design tokens for skin-awareness.
 */
import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  Play, Pause, Square, Volume2, Plus,
  Trash2, Import, Undo2, Redo2,
  Radio, Save, ChevronsLeftRight, Mic2, Keyboard,
} from "lucide-react";

// ─── API ────────────────────────────────────────────────────────────

// Relative path works when vite dev proxy is active. When running from
// a hosted origin (s3studio.xyz, vercel, strandsnation.xyz) the Tauri
// shim lives at localhost:3001 so we need the full URL.
const LOCAL_ENGINE = 'http://localhost:3001';

function dawApiUrl(path: string): string {
  if (typeof window === 'undefined') return `/api/daw${path}`;
  const host = window.location.hostname;
  if (host.includes('strandsnation.xyz') || host.includes('s3studio.xyz') || host.includes('vercel.app')) {
    return `${LOCAL_ENGINE}/api/daw${path}`;
  }
  return `/api/daw${path}`;
}

async function dawFetch<T>(endpoint: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(dawApiUrl(endpoint), {
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || res.statusText);
  }
  return res.json();
}

async function dawPost<T>(endpoint: string, body?: unknown): Promise<T> {
  return dawFetch<T>(endpoint, {
    method: "POST",
    body: body ? JSON.stringify(body) : undefined,
  });
}

// ─── Types ──────────────────────────────────────────────────────────

interface DawTrack {
  id: string;
  name: string;
  color: string;
  volume_db: number;
  pan: number;
  mute: boolean;
  solo: boolean;
  regions: DawRegion[];
  automation: unknown[];
}

interface DawRegion {
  id: string;
  audio_ref: string;
  position_ms: number;
  start_offset_ms: number;
  end_offset_ms: number;
  fade_in_ms: number;
  fade_out_ms: number;
  fade_curve: string;
  generation_dna: string | null;
}

interface DawProject {
  version: number;
  name: string;
  tempo_bpm: number;
  time_signature: [number, number];
  sample_rate: number;
  tracks: DawTrack[];
  loop_range: { start_ms: number; end_ms: number; enabled: boolean } | null;
}

interface PositionEvent {
  position_ms: number;
  bar: number;
  beat: number;
  tick: number;
  mode: "stopped" | "playing" | "paused";
}

type RiffTab = "bank" | "layer" | "mic" | "midi";

const RIFF_TYPES = ["drums", "bass", "chords", "lead", "texture", "full groove"] as const;
const BAR_CHOICES = [4, 8, 16, 32] as const;

function msPerBar(tempo: number, timeSig: [number, number]): number {
  const safeTempo = Number.isFinite(tempo) && tempo > 0 ? tempo : 120;
  return (60000 / safeTempo) * Math.max(1, timeSig[0] || 4);
}

function barsToMs(bars: number, tempo: number, timeSig: [number, number]): number {
  return Math.round(Math.max(0, bars) * msPerBar(tempo, timeSig));
}

function formatTime(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  const frac = Math.floor((ms % 1000) / 10);
  return `${m}:${sec.toString().padStart(2, "0")}.${frac.toString().padStart(2, "0")}`;
}

// ─── Transport Bar ──────────────────────────────────────────────────

function TransportBar({
  position, isPlaying, tempo,
  onPlay, onPause, onStop, onSetTempo, onUndo, onRedo,
}: {
  position: PositionEvent;
  isPlaying: boolean;
  tempo: number;
  onPlay: () => void;
  onPause: () => void;
  onStop: () => void;
  onSetTempo: (bpm: number) => void;
  onUndo: () => void;
  onRedo: () => void;
}) {
  const formatTime = (ms: number) => {
    const s = Math.floor(ms / 1000);
    const m = Math.floor(s / 60);
    const sec = s % 60;
    const frac = Math.floor((ms % 1000) / 10);
    return `${m}:${sec.toString().padStart(2, "0")}.${frac.toString().padStart(2, "0")}`;
  };

  return (
    <div className="flex items-center gap-3 px-4 h-12 bg-s3-panel border-b border-s3-border select-none flex-shrink-0">
      {/* Undo / Redo */}
      <div className="flex gap-0.5">
        <button onClick={onUndo} className="p-1.5 rounded-lg hover:bg-white/[0.06] active:bg-white/10 transition-colors" title="Undo">
          <Undo2 size={15} className="text-s3-text-muted" />
        </button>
        <button onClick={onRedo} className="p-1.5 rounded-lg hover:bg-white/[0.06] active:bg-white/10 transition-colors" title="Redo">
          <Redo2 size={15} className="text-s3-text-muted" />
        </button>
      </div>

      <div className="w-px h-5 bg-s3-border" />

      {/* Transport controls */}
      <div className="flex items-center gap-1">
        <button onClick={onStop} className="p-1.5 rounded-lg hover:bg-white/[0.06] active:bg-white/10 transition-colors" title="Stop">
          <Square size={15} className="text-s3-text-primary" />
        </button>
        {isPlaying ? (
          <button
            onClick={onPause}
            className="p-2 rounded-full bg-accent-500 hover:bg-accent-400 active:bg-accent-600 transition-colors shadow-lg shadow-accent-500/20"
            title="Pause"
          >
            <Pause size={16} className="text-black" />
          </button>
        ) : (
          <button
            onClick={onPlay}
            className="p-2 rounded-full bg-accent-500 hover:bg-accent-400 active:bg-accent-600 transition-colors shadow-lg shadow-accent-500/20"
            title="Play"
          >
            <Play size={16} className="text-black" />
          </button>
        )}
      </div>

      {/* Position readout */}
      <div className="flex flex-col items-center min-w-[110px] bg-black/20 rounded-lg px-3 py-1">
        <span className="text-xs font-mono text-s3-text-primary tabular-nums tracking-tight">
          {formatTime(position.position_ms)}
        </span>
        <span className="text-[9px] font-mono text-s3-text-muted tabular-nums">
          {position.bar}:{position.beat}:{String(position.tick).padStart(3, "0")}
        </span>
      </div>

      <div className="w-px h-5 bg-s3-border" />

      {/* Tempo */}
      <div className="flex items-center gap-1.5">
        <span className="text-[10px] font-medium uppercase tracking-wider text-s3-text-muted">BPM</span>
        <input
          type="number"
          value={tempo}
          onChange={(event) => onSetTempo(Number(event.target.value))}
          className="w-14 text-xs font-mono text-center tabular-nums rounded-md px-1.5 py-0.5 bg-black/20 border border-s3-border text-s3-text-primary focus:border-accent-500/50 focus:outline-none transition-colors"
          min={20}
          max={300}
          step={1}
        />
      </div>

      <div className="flex-1" />

      {/* Playback mode badge */}
      <div className={`
        text-[9px] font-medium uppercase tracking-widest px-2.5 py-0.5 rounded-full
        ${isPlaying
          ? "bg-accent-500/15 text-accent-500 border border-accent-500/20"
          : position.mode === "paused"
            ? "bg-amber-500/15 text-amber-400 border border-amber-500/20"
            : "bg-white/[0.04] text-s3-text-muted border border-s3-border"
        }
      `}>
        {position.mode}
      </div>
    </div>
  );
}

// ─── Track Header ───────────────────────────────────────────────────

function TrackHeader({
  track, onMute, onSolo, onVolumeChange, onPanChange, onRemove,
}: {
  track: DawTrack;
  onMute: () => void;
  onSolo: () => void;
  onVolumeChange: (db: number) => void;
  onPanChange: (pan: number) => void;
  onRemove: () => void;
}) {
  return (
    <div className="flex items-center gap-2 px-3 h-[80px] border-b border-s3-border bg-s3-panel group">
      {/* Track colour bar */}
      <div className="w-1 h-12 rounded-full flex-shrink-0 shadow-sm" style={{ background: track.color, boxShadow: `0 0 8px ${track.color}30` }} />

      {/* Name + pan knob */}
      <div className="flex flex-col gap-0.5 min-w-0 flex-1">
        <span className="text-xs font-medium text-s3-text-primary truncate leading-tight">{track.name}</span>
        <div className="flex items-center gap-1">
          <span className="text-[9px] text-s3-text-muted">Pan</span>
          <input
            type="range"
            min={-100}
            max={100}
            value={Math.round(track.pan * 100)}
            onChange={(event) => onPanChange(Number(event.target.value) / 100)}
            className="w-12 h-0.5 accent-accent-500 cursor-pointer"
            title={`Pan: ${track.pan > 0 ? `R${Math.round(track.pan * 100)}` : track.pan < 0 ? `L${Math.round(-track.pan * 100)}` : "C"}`}
          />
        </div>
      </div>

      {/* M / S buttons */}
      <div className="flex gap-1">
        <button
          onClick={onMute}
          className={`
            text-[10px] font-bold w-6 h-6 rounded-md flex items-center justify-center transition-all
            ${track.mute
              ? "bg-red-500 text-white shadow-sm shadow-red-500/30"
              : "bg-white/[0.04] text-s3-text-muted border border-s3-border hover:bg-white/[0.08]"
            }
          `}
        >
          M
        </button>
        <button
          onClick={onSolo}
          className={`
            text-[10px] font-bold w-6 h-6 rounded-md flex items-center justify-center transition-all
            ${track.solo
              ? "bg-amber-500 text-black shadow-sm shadow-amber-500/30"
              : "bg-white/[0.04] text-s3-text-muted border border-s3-border hover:bg-white/[0.08]"
            }
          `}
        >
          S
        </button>
      </div>

      {/* Volume fader */}
      <div className="flex flex-col items-center gap-0.5">
        <Volume2 size={10} className="text-s3-text-muted" />
        <input
          type="range"
          min={-36}
          max={6}
          step={0.5}
          value={track.volume_db}
          onChange={(event) => onVolumeChange(Number(event.target.value))}
          className="w-14 h-1 accent-accent-500 cursor-pointer"
          title={`${track.volume_db.toFixed(1)} dB`}
        />
        <span className="text-[8px] font-mono text-s3-text-muted tabular-nums">{track.volume_db.toFixed(0)}dB</span>
      </div>

      {/* Remove */}
      <button
        onClick={onRemove}
        className="p-1 rounded-md hover:bg-red-500/10 text-s3-text-muted hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100"
        title="Remove track"
      >
        <Trash2 size={12} />
      </button>
    </div>
  );
}

// ─── Waveform Region ────────────────────────────────────────────────

function WaveformRegion({
  region, trackColor, pixelsPerMs, viewStartMs, peaks, laneHeight,
}: {
  region: DawRegion;
  trackColor: string;
  pixelsPerMs: number;
  viewStartMs: number;
  peaks: [number, number][];
  laneHeight: number;
}) {
  const left = (region.position_ms - viewStartMs) * pixelsPerMs;
  const width = (region.end_offset_ms - region.start_offset_ms) * pixelsPerMs;
  const mid = laneHeight / 2;

  return (
    <div
      className="absolute top-1 bottom-1 rounded-md overflow-hidden transition-shadow hover:shadow-lg"
      style={{
        left: `${left}px`,
        width: `${width}px`,
        background: `linear-gradient(180deg, ${trackColor}18 0%, ${trackColor}08 100%)`,
        border: `1px solid ${trackColor}35`,
        boxShadow: `inset 0 1px 0 ${trackColor}10`,
      }}
    >
      {/* Region label */}
      <div
        className="absolute top-0 left-0 right-0 h-4 flex items-center px-1.5 text-[8px] font-medium truncate"
        style={{ color: `${trackColor}CC`, background: `${trackColor}12` }}
      >
        {region.audio_ref.split(/[\\/]/).pop()?.replace(/\.[^.]+$/, "")}
      </div>
      <svg
        className="absolute top-4 left-0"
        width="100%"
        height={laneHeight - 16}
        preserveAspectRatio="none"
        viewBox={`0 0 ${peaks.length} ${laneHeight - 16}`}
      >
        {peaks.length > 0 && (
          <path
            d={peaks.map(([lo, hi], index) => {
              const adjMid = (laneHeight - 16) / 2;
              const y1 = adjMid - hi * adjMid;
              const y2 = adjMid - lo * adjMid;
              return `M${index},${y1}L${index},${y2}`;
            }).join("")}
            stroke={trackColor}
            strokeWidth={1.2}
            strokeOpacity={0.7}
            fill="none"
          />
        )}
      </svg>
    </div>
  );
}

// ─── Timeline Lane ──────────────────────────────────────────────────

function TimelineLane({
  track, pixelsPerMs, viewStartMs, laneHeight,
}: {
  track: DawTrack;
  pixelsPerMs: number;
  viewStartMs: number;
  laneHeight: number;
}) {
  const [peaksByRegion, setPeaksByRegion] = useState<Record<string, [number, number][]>>({});

  useEffect(() => {
    for (const region of track.regions) {
      const widthPx = Math.max(1, Math.round((region.end_offset_ms - region.start_offset_ms) * pixelsPerMs));
      if (widthPx < 2) continue;
      dawFetch<{ peaks: [number, number][] }>(
        `/waveform-peaks?audio_path=${encodeURIComponent(region.audio_ref)}&width_px=${widthPx}&start_ms=${region.start_offset_ms}&end_ms=${region.end_offset_ms}`
      ).then((data) => {
        setPeaksByRegion((prev) => ({ ...prev, [region.id]: data.peaks }));
      }).catch(() => {
        const fakePeaks: [number, number][] = Array.from({ length: widthPx }, () => {
          const v = Math.random() * 0.6 + 0.1;
          return [-v, v];
        });
        setPeaksByRegion((prev) => ({ ...prev, [region.id]: fakePeaks }));
      });
    }
  }, [track.regions, pixelsPerMs]);

  return (
    <div className="relative border-b border-s3-border bg-s3/80" style={{ height: `${laneHeight}px` }}>
      {/* Alternate lane shading */}
      <div className="absolute inset-0 bg-white/[0.01]" />
      {track.regions.map((region) => (
        <WaveformRegion
          key={region.id}
          region={region}
          trackColor={track.color}
          pixelsPerMs={pixelsPerMs}
          viewStartMs={viewStartMs}
          peaks={peaksByRegion[region.id] || []}
          laneHeight={laneHeight}
        />
      ))}
    </div>
  );
}

// ─── Beat Grid Ruler ────────────────────────────────────────────────

function Ruler({
  tempo, timeSig, viewStartMs, viewWidthMs, pixelsPerMs,
}: {
  tempo: number;
  timeSig: [number, number];
  viewStartMs: number;
  viewWidthMs: number;
  pixelsPerMs: number;
}) {
  const msPerBeat = 60000 / tempo;
  const msPerBar = msPerBeat * timeSig[0];
  const startBar = Math.floor(viewStartMs / msPerBar);
  const endBar = Math.ceil((viewStartMs + viewWidthMs) / msPerBar) + 1;
  const markers: { x: number; label: string }[] = [];
  for (let bar = startBar; bar <= endBar; bar++) {
    const barMs = bar * msPerBar;
    if (barMs < viewStartMs - msPerBar) continue;
    markers.push({ x: (barMs - viewStartMs) * pixelsPerMs, label: `${bar + 1}` });
  }

  return (
    <div className="relative h-7 bg-s3-panel border-b border-s3-border flex-shrink-0 overflow-hidden">
      {markers.map((marker, index) => (
        <React.Fragment key={index}>
          <div className="absolute top-0 h-full border-l border-white/[0.06]" style={{ left: `${marker.x}px` }} />
          <span
            className="absolute bottom-1 text-[9px] font-mono text-s3-text-muted select-none tabular-nums"
            style={{ left: `${marker.x + 4}px` }}
          >
            {marker.label}
          </span>
        </React.Fragment>
      ))}
    </div>
  );
}

// ─── Playhead ───────────────────────────────────────────────────────

function Playhead({ positionMs, viewStartMs, pixelsPerMs }: {
  positionMs: number;
  viewStartMs: number;
  pixelsPerMs: number;
}) {
  const x = (positionMs - viewStartMs) * pixelsPerMs;
  if (x < -2 || x > 5000) return null;
  return (
    <div className="absolute top-0 bottom-0 z-20 pointer-events-none" style={{ left: `${x}px` }}>
      {/* Head triangle */}
      <div className="w-3 h-3 -ml-[5px] bg-accent-500 clip-playhead" style={{ clipPath: "polygon(0 0, 100% 0, 50% 100%)" }} />
      {/* Needle */}
      <div className="w-px h-full bg-accent-500 shadow-[0_0_6px_var(--accent-500,#00C2FF)]" />
    </div>
  );
}

// ─── Riff Create Pane ───────────────────────────────────────────────

function RiffCreatePane({
  project,
}: {
  project: DawProject;
}) {
  const [tab, setTab] = useState<RiffTab>("bank");
  const [prompt, setPrompt] = useState("");
  const [riffType, setRiffType] = useState<(typeof RIFF_TYPES)[number]>("drums");
  const [bars, setBars] = useState<(typeof BAR_CHOICES)[number]>(8);
  const [keyScale, setKeyScale] = useState("C minor");
  const [seed, setSeed] = useState("");
  const durationMs = barsToMs(bars, project.tempo_bpm, project.time_signature);

  return (
    <section className="h-[198px] flex flex-col border-t border-s3-border bg-s3-panel/70 flex-shrink-0">
      <div className="h-[86px] px-3 py-2 border-b border-s3-border bg-s3-panel flex items-end gap-3 overflow-x-auto">
        <div className="flex flex-col justify-center min-w-[72px] h-full">
          <span className="text-[10px] font-medium uppercase tracking-widest text-s3-text-muted">Create</span>
          <span className="text-sm font-medium text-s3-text-primary">Riff</span>
        </div>

        <label className="flex flex-col gap-1 min-w-[320px] flex-[1_1_360px]">
          <span className="text-[10px] font-medium uppercase tracking-wider text-s3-text-muted">Prompt</span>
          <input
            className="h-10 rounded-md px-3 bg-black/20 border border-s3-border text-sm text-s3-text-primary placeholder:text-s3-text-muted focus:border-accent-500/50 focus:outline-none"
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder="tight dusty drum loop with chopped soul accents"
          />
        </label>

        <div className="flex flex-col gap-1 min-w-[116px]">
          <span className="text-[10px] font-medium uppercase tracking-wider text-s3-text-muted">Riff Model</span>
          <div className="h-10 px-3 rounded-md border border-s3-border bg-black/20 flex items-center text-xs font-medium text-s3-text-primary whitespace-nowrap">
            Ready
          </div>
        </div>

        <label className="flex flex-col gap-1 min-w-[128px]">
          <span className="text-[10px] font-medium uppercase tracking-wider text-s3-text-muted">Role</span>
          <select
            className="h-10 rounded-md px-2 bg-black/20 border border-s3-border text-sm text-s3-text-primary focus:border-accent-500/50 focus:outline-none"
            value={riffType}
            onChange={(event) => setRiffType(event.target.value as typeof riffType)}
          >
            {RIFF_TYPES.map((type) => (
              <option key={type} value={type}>{type}</option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 min-w-[86px]">
          <span className="text-[10px] font-medium uppercase tracking-wider text-s3-text-muted">Bars</span>
          <select
            className="h-10 rounded-md px-2 bg-black/20 border border-s3-border text-sm text-s3-text-primary focus:border-accent-500/50 focus:outline-none"
            value={bars}
            onChange={(event) => setBars(Number(event.target.value) as typeof bars)}
          >
            {BAR_CHOICES.map((choice) => (
              <option key={choice} value={choice}>{choice}</option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 min-w-[108px]">
          <span className="text-[10px] font-medium uppercase tracking-wider text-s3-text-muted">Key</span>
          <input
            className="h-10 rounded-md px-3 bg-black/20 border border-s3-border text-sm text-s3-text-primary focus:border-accent-500/50 focus:outline-none"
            value={keyScale}
            onChange={(event) => setKeyScale(event.target.value)}
          />
        </label>

        <label className="flex flex-col gap-1 min-w-[104px]">
          <span className="text-[10px] font-medium uppercase tracking-wider text-s3-text-muted">Seed</span>
          <input
            className="h-10 rounded-md px-3 bg-black/20 border border-s3-border text-sm text-s3-text-primary placeholder:text-s3-text-muted focus:border-accent-500/50 focus:outline-none"
            value={seed}
            onChange={(event) => setSeed(event.target.value)}
            placeholder="random"
          />
        </label>

        <div className="flex flex-col items-start justify-end gap-1 min-w-[116px]">
          <button
            className="h-10 px-3 rounded-md flex items-center gap-1.5 bg-accent-500 hover:bg-accent-400 disabled:bg-white/[0.06] disabled:text-s3-text-muted text-black text-sm font-medium transition-colors"
            disabled={!prompt.trim()}
            title="Generate riff"
          >
            <Radio size={15} />
            Generate
          </button>
          <span className="text-[10px] font-mono text-s3-text-muted tabular-nums">
            {formatTime(durationMs)} · {project.tempo_bpm.toFixed(0)} BPM
          </span>
        </div>
      </div>

      <div className="flex items-center gap-1 h-9 px-3 border-b border-s3-border">
        <PanelTab active={tab === "bank"} onClick={() => setTab("bank")} icon={<Save size={14} />} label="Riff Bank" />
        <PanelTab active={tab === "layer"} onClick={() => setTab("layer")} icon={<ChevronsLeftRight size={14} />} label="Add Layer" />
        <PanelTab active={tab === "mic"} onClick={() => setTab("mic")} icon={<Mic2 size={14} />} label="Mic" />
        <PanelTab active={tab === "midi"} onClick={() => setTab("midi")} icon={<Keyboard size={14} />} label="MIDI" />
        <div className="flex-1" />
        <div className="text-[10px] font-mono text-s3-text-muted tabular-nums">
          {project.time_signature[0]}/{project.time_signature[1]}
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-auto p-3">
        {tab === "bank" && (
          <div className="h-full grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-3 content-start">
            <div className="border border-dashed border-s3-border rounded-md p-3 min-h-[86px] flex items-center justify-center text-xs text-s3-text-muted">
              Empty
            </div>
          </div>
        )}

        {tab === "layer" && (
          <div className="grid grid-cols-[minmax(220px,1fr)_320px] gap-3 max-lg:grid-cols-1">
            <div className="grid grid-cols-2 gap-2 content-start">
              <div className="flex flex-col gap-1 col-span-2">
                <span className="text-[10px] font-medium uppercase tracking-wider text-s3-text-muted">Source</span>
                <div className="h-10 px-3 rounded-md border border-s3-border bg-black/20 flex items-center text-sm text-s3-text-primary">
                  No region selected
                </div>
              </div>
              <label className="flex flex-col gap-1">
                <span className="text-[10px] font-medium uppercase tracking-wider text-s3-text-muted">Layer</span>
                <select className="h-10 rounded-md px-2 bg-black/20 border border-s3-border text-sm text-s3-text-primary">
                  {RIFF_TYPES.slice(0, 5).map((type) => (
                    <option key={type} value={type}>{type}</option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[10px] font-medium uppercase tracking-wider text-s3-text-muted">Bars</span>
                <input className="h-10 rounded-md px-3 bg-black/20 border border-s3-border text-sm text-s3-text-primary" readOnly value="" />
              </label>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-[10px] font-medium uppercase tracking-wider text-s3-text-muted">Prompt</span>
              <div className="flex gap-2">
                <input className="h-10 rounded-md px-3 bg-black/20 border border-s3-border text-sm text-s3-text-primary placeholder:text-s3-text-muted focus:border-accent-500/50 focus:outline-none flex-1" placeholder="warm rolling bass that follows the groove" />
                <button className="h-10 px-3 rounded-md flex items-center gap-1.5 bg-white/[0.06] text-s3-text-muted text-sm font-medium" disabled title="Generate layer">
                  <ChevronsLeftRight size={15} />
                  Generate Layer
                </button>
              </div>
            </div>
          </div>
        )}

        {tab === "mic" && (
          <div className="h-full flex items-center text-xs text-s3-text-muted">
            Mic capture will land recordings into the riff bank.
          </div>
        )}

        {tab === "midi" && (
          <div className="h-full flex items-center text-xs text-s3-text-muted">
            MIDI capture and piano roll are reserved for the next slice.
          </div>
        )}
      </div>
    </section>
  );
}

function PanelTab({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`h-8 px-3 flex items-center gap-1.5 text-xs border-b-2 transition-colors ${
        active
          ? "text-accent-500 border-accent-500 bg-accent-500/5"
          : "text-s3-text-muted border-transparent hover:text-s3-text-primary hover:bg-white/[0.04]"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

// ─── Main DawPage ───────────────────────────────────────────────────

export function DawPage() {
  const [project, setProject] = useState<DawProject | null>(null);
  const [position, setPosition] = useState<PositionEvent>({
    position_ms: 0, bar: 1, beat: 1, tick: 0, mode: "stopped",
  });
  const [viewStartMs, setViewStartMs] = useState(0);
  const [viewWidthMs, setViewWidthMs] = useState(30000);
  const [error, setError] = useState<string | null>(null);
  const positionPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timelineRef = useRef<HTMLDivElement>(null);

  const isPlaying = position.mode === "playing";
  const tempo = project?.tempo_bpm ?? 120;
  const timeSig = project?.time_signature ?? [4, 4];
  const laneHeight = 80;

  const timelineWidth = timelineRef.current?.clientWidth ?? 800;
  const pixelsPerMs = timelineWidth / viewWidthMs;

  // ── Init ──

  useEffect(() => {
    dawPost("/init")
      .then(() => dawFetch<DawProject>("/project"))
      .then(setProject)
      .catch((err) => setError(err.message));
    return () => {
      dawPost("/destroy").catch(() => {});
      if (positionPollRef.current) clearInterval(positionPollRef.current);
    };
  }, []);

  // ── Position polling ──

  useEffect(() => {
    if (positionPollRef.current) clearInterval(positionPollRef.current);
    if (isPlaying) {
      positionPollRef.current = setInterval(() => {
        dawFetch<PositionEvent>("/position").then(setPosition).catch(() => {});
      }, 1000 / 30);
    }
    return () => { if (positionPollRef.current) clearInterval(positionPollRef.current); };
  }, [isPlaying]);

  // ── Refresh project ──

  const refreshProject = useCallback(async () => {
    try {
      const proj = await dawFetch<DawProject>("/project");
      setProject(proj);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  // ── Transport ──

  const handlePlay = useCallback(async () => {
    const pos = await dawPost<PositionEvent>("/play");
    setPosition(pos);
  }, []);
  const handlePause = useCallback(async () => {
    const pos = await dawPost<PositionEvent>("/pause");
    setPosition(pos);
  }, []);
  const handleStop = useCallback(async () => {
    await dawPost("/stop");
    setPosition({ position_ms: 0, bar: 1, beat: 1, tick: 0, mode: "stopped" });
  }, []);
  const handleSetTempo = useCallback(async (bpm: number) => {
    await dawPost("/set-tempo", { bpm });
    await refreshProject();
  }, [refreshProject]);
  const handleUndo = useCallback(async () => {
    await dawPost("/undo").catch(() => {});
    await refreshProject();
  }, [refreshProject]);
  const handleRedo = useCallback(async () => {
    await dawPost("/redo").catch(() => {});
    await refreshProject();
  }, [refreshProject]);

  // ── Tracks ──

  const handleMute = useCallback(async (trackId: string, muted: boolean) => {
    await dawPost("/set-track-mute", { track_id: trackId, muted });
    await refreshProject();
  }, [refreshProject]);
  const handleSolo = useCallback(async (trackId: string, solo: boolean) => {
    await dawPost("/set-track-solo", { track_id: trackId, solo });
    await refreshProject();
  }, [refreshProject]);
  const handleVolumeChange = useCallback(async (trackId: string, db: number) => {
    setProject(prev => prev ? {
      ...prev,
      tracks: prev.tracks.map(t => t.id === trackId ? { ...t, volume_db: db } : t),
    } : prev);
    await dawPost("/set-track-volume", { track_id: trackId, db });
  }, []);
  const handlePanChange = useCallback(async (trackId: string, pan: number) => {
    setProject(prev => prev ? {
      ...prev,
      tracks: prev.tracks.map(t => t.id === trackId ? { ...t, pan } : t),
    } : prev);
    await dawPost("/set-track-pan", { track_id: trackId, pan });
  }, []);
  const handleRemoveTrack = useCallback(async (trackId: string) => {
    await dawPost("/remove-track", { track_id: trackId });
    await refreshProject();
  }, [refreshProject]);
  const handleAddTrack = useCallback(async () => {
    try {
      console.log("[DAW] Adding track...");
      await dawPost("/add-track", { name: "New Track", color: "#60A5FA" });
      console.log("[DAW] Track added, refreshing...");
      await refreshProject();
    } catch (err) {
      console.error("[DAW] Add track failed:", err);
    }
  }, [refreshProject]);

  // ── Zoom / scroll ──

  const handleWheel = useCallback((event: React.WheelEvent) => {
    if (event.ctrlKey || event.metaKey) {
      event.preventDefault();
      const factor = event.deltaY > 0 ? 1.2 : 0.8;
      setViewWidthMs((prev) => Math.max(5000, Math.min(300000, prev * factor)));
    } else {
      setViewStartMs((prev) => Math.max(0, prev + event.deltaY * 10));
    }
  }, []);

  // ── Error state ──

  if (error) {
    return (
      <div className="flex items-center justify-center h-full bg-s3 text-s3-text-primary">
        <div className="text-center max-w-sm">
          <div className="w-12 h-12 mx-auto mb-4 rounded-xl bg-red-500/10 border border-red-500/20 flex items-center justify-center">
            <span className="text-red-400 text-lg">!</span>
          </div>
          <p className="text-sm font-medium mb-1">DAW Engine Error</p>
          <p className="text-xs text-s3-text-muted mb-4 leading-relaxed">{error}</p>
          <button
            onClick={() => {
              setError(null);
              dawPost("/init").then(() => dawFetch<DawProject>("/project").then(setProject)).catch((err) => setError(err.message));
            }}
            className="px-4 py-1.5 rounded-lg text-xs font-medium bg-accent-500 text-black hover:bg-accent-400 active:bg-accent-600 transition-colors shadow-lg shadow-accent-500/20"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  // ── Loading state ──

  if (!project) {
    return (
      <div className="flex items-center justify-center h-full bg-s3">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 rounded-full border-2 border-accent-500/30 border-t-accent-500 animate-spin" />
          <span className="text-xs text-s3-text-muted">Initialising DAW engine...</span>
        </div>
      </div>
    );
  }

  // ── Main layout ──

  return (
    <div className="flex flex-col h-full overflow-hidden bg-s3 text-s3-text-primary">
      {/* Transport */}
      <TransportBar
        position={position}
        isPlaying={isPlaying}
        tempo={tempo}
        onPlay={handlePlay}
        onPause={handlePause}
        onStop={handleStop}
        onSetTempo={handleSetTempo}
        onUndo={handleUndo}
        onRedo={handleRedo}
      />

      {/* Track headers + timeline */}
      <div className="flex flex-1 overflow-hidden" onWheel={handleWheel}>
        {/* Track headers */}
        <div className="w-[220px] flex-shrink-0 overflow-y-auto border-r border-s3-border scrollbar-hide">
          {/* Header bar */}
          <div className="h-7 border-b border-s3-border bg-s3-panel flex items-center justify-between px-3 sticky top-0 z-10">
            <span className="text-[9px] font-medium uppercase tracking-widest text-s3-text-muted">Tracks</span>
            <button
              onClick={handleAddTrack}
              className="flex items-center gap-1 px-1.5 py-0.5 rounded-md text-accent-500 hover:bg-accent-500/10 transition-colors"
              title="Add track"
            >
              <Plus size={11} />
              <span className="text-[9px] font-medium">Add</span>
            </button>
          </div>
          {project.tracks.map((track) => (
            <TrackHeader
              key={track.id}
              track={track}
              onMute={() => handleMute(track.id, !track.mute)}
              onSolo={() => handleSolo(track.id, !track.solo)}
              onVolumeChange={(db) => handleVolumeChange(track.id, db)}
              onPanChange={(pan) => handlePanChange(track.id, pan)}
              onRemove={() => handleRemoveTrack(track.id)}
            />
          ))}
          {project.tracks.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 gap-4">
              <div className="w-14 h-14 rounded-2xl bg-accent-500/5 border border-accent-500/10 flex items-center justify-center">
                <Import size={22} className="text-accent-500/60" />
              </div>
              <div className="text-center px-6">
                <p className="text-xs font-medium text-s3-text-primary/70 mb-1">No tracks yet</p>
                <p className="text-[10px] text-s3-text-muted leading-relaxed">
                  Import stems or add a track to start building
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Timeline */}
        <div ref={timelineRef} className="flex-1 overflow-hidden relative">
          <Ruler
            tempo={tempo}
            timeSig={timeSig as [number, number]}
            viewStartMs={viewStartMs}
            viewWidthMs={viewWidthMs}
            pixelsPerMs={pixelsPerMs}
          />
          <div className="overflow-y-auto" style={{ height: "calc(100% - 28px)" }}>
            {project.tracks.map((track) => (
              <TimelineLane
                key={track.id}
                track={track}
                pixelsPerMs={pixelsPerMs}
                viewStartMs={viewStartMs}
                laneHeight={laneHeight}
              />
            ))}
            {project.tracks.length === 0 && (
              <div className="flex items-center justify-center h-full min-h-[200px]">
                <p className="text-xs text-s3-text-muted/50">Timeline empty</p>
              </div>
            )}
          </div>
          <Playhead positionMs={position.position_ms} viewStartMs={viewStartMs} pixelsPerMs={pixelsPerMs} />
        </div>
      </div>

      <RiffCreatePane project={project} />

      {/* Status bar */}
      <div className="flex items-center justify-between px-4 h-7 bg-s3-panel border-t border-s3-border text-[9px] font-mono text-s3-text-muted flex-shrink-0 tabular-nums select-none">
        <span className="font-sans font-medium">{project.name}</span>
        <div className="flex items-center gap-4">
          <span>{project.tracks.length} track{project.tracks.length !== 1 ? "s" : ""}</span>
          <span className="w-px h-3 bg-s3-border" />
          <span>{tempo} BPM</span>
          <span className="w-px h-3 bg-s3-border" />
          <span>{timeSig[0]}/{timeSig[1]}</span>
          <span className="w-px h-3 bg-s3-border" />
          <span>Zoom: {(viewWidthMs / 1000).toFixed(0)}s</span>
        </div>
      </div>
    </div>
  );
}
