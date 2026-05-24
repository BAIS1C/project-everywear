// @ts-nocheck
/**
 * StudioTab — engine-first S3 DAW timeline.
 *
 * The Rust DAW engine owns project, transport, loop, tempo, mute/solo/pan,
 * fades and region metadata. The browser renders the workstation surface and,
 * while native cpal output is still a backend stub, mirrors audio for preview.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  AudioLines,
  ChevronsLeft,
  ChevronsRight,
  Clock3,
  Disc3,
  Flag,
  Gauge,
  KeyboardMusic,
  ListMusic,
  LocateFixed,
  Magnet,
  Mic2,
  Pause,
  Piano,
  Play,
  Plus,
  RefreshCcw,
  Scissors,
  SlidersHorizontal,
  Sparkles,
  Square,
  Upload,
  Wand2,
  Waves,
} from "lucide-react";
import type { TrackName } from "../../services/api";
import { TRACK_NAMES, generateApi } from "../../services/api";
import { useAuth } from "../../context/AuthContext";
import { analyseWaveformCached, type WaveformData } from "./waveformAnalyser";
import type { MixerControls } from "./useMixer";
import { Knob, PeakMeter, VolumeFader } from "./SvgControls";
import {
  dawApi,
  type DawPosition,
  type DawProject,
  type DawTrackFx,
  type FxSuiteId,
  type StemUrlEntry,
} from "../../services/dawApi";

interface TimelineTrack {
  id: string;
  engineTrackId?: string;
  stemName?: TrackName;
  name: string;
  color: string;
  audioUrl: string | null;
  muted: boolean;
  solo: boolean;
  volume: number;
  pan: number;
  pitch: number;
  keyShift: number;
  fx: DawTrackFx;
}

interface UserMarker {
  id: string;
  bar: number;
  label: string;
  color: string;
}

interface AnchorZone {
  id: string;
  trackId: string | "all";
  startMs: number;
  endMs: number;
  label: string;
}

interface UploadedTrack {
  id: string;
  name: string;
  audioUrl: string;
  durationMs: number;
  color: string;
}

export interface StudioTabProps {
  stems?: Record<TrackName, string | null>;
  duration?: number;
  bpm?: number;
  keySignature?: string;
  trackTitle?: string;
  mixer?: MixerControls;
  engineSynced?: boolean;
}

const BAR_WIDTH = 48;
const BEATS_PER_BAR = 4;

const TRACK_COLORS = [
  "#F472B6", "#FB923C", "#A78BFA", "#34D399",
  "#60A5FA", "#FBBF24", "#F87171", "#2DD4BF",
  "#C084FC", "#FB7185", "#E879F9", "#94A3B8",
];

const MARKER_COLORS = [
  "#22d3ee", "#f59e0b", "#a78bfa", "#ec4899",
  "#34d399", "#fb923c", "#f87171", "#60a5fa",
];

const SEMANTIC_LABELS = [
  "Vocals", "Backing Vocals", "Drums", "Bass", "Guitar", "Keyboard",
  "Percussion", "Strings", "Synth", "FX", "Brass", "Woodwinds",
];

const FX_PRESETS: Record<FxSuiteId, Omit<DawTrackFx, "suite" | "bypass">> = {
  clean: { eq_low_db: 0, eq_mid_db: 0, eq_high_db: 0, compressor: 0, saturation: 0, reverb: 0, delay: 0 },
  "vocal-polish": { eq_low_db: -1, eq_mid_db: 1, eq_high_db: 3, compressor: 55, saturation: 10, reverb: 18, delay: 8 },
  "drum-bus": { eq_low_db: 3, eq_mid_db: -1, eq_high_db: 2, compressor: 70, saturation: 22, reverb: 8, delay: 0 },
  "bass-weight": { eq_low_db: 5, eq_mid_db: -2, eq_high_db: -1, compressor: 50, saturation: 20, reverb: 0, delay: 0 },
  "wide-synth": { eq_low_db: -2, eq_mid_db: 0, eq_high_db: 2, compressor: 18, saturation: 12, reverb: 32, delay: 24 },
  "lofi-tape": { eq_low_db: 1, eq_mid_db: -1, eq_high_db: -4, compressor: 35, saturation: 55, reverb: 12, delay: 10 },
  "space-delay": { eq_low_db: -2, eq_mid_db: 0, eq_high_db: 1, compressor: 12, saturation: 8, reverb: 45, delay: 55 },
};

const DEFAULT_FX: DawTrackFx = { bypass: false, suite: "clean", ...FX_PRESETS.clean };

const PIANO_KEYS = ["C", "B", "A#", "A", "G#", "G", "F#", "F", "E", "D#", "D", "C#"];

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function formatBarBeat(seconds: number, secPerBar: number): string {
  const totalBeats = (seconds / secPerBar) * BEATS_PER_BAR;
  const bar = Math.floor(totalBeats / BEATS_PER_BAR) + 1;
  const beat = Math.floor(totalBeats % BEATS_PER_BAR) + 1;
  return `${bar}:${beat}`;
}

function pxToMs(px: number, secPerBar: number): number {
  return Math.max(0, Math.round((px / BAR_WIDTH) * secPerBar * 1000));
}

function msToPx(ms: number, secPerBar: number): number {
  return (ms / 1000 / secPerBar) * BAR_WIDTH;
}

function snapPx(px: number, enabled: boolean): number {
  return enabled ? Math.round(px / BAR_WIDTH) * BAR_WIDTH : px;
}

function dbFromVolume(volume: number): number {
  if (volume <= 0.001) return -96;
  return Math.round(20 * Math.log10(volume) * 10) / 10;
}

function volumeFromDb(db: number): number {
  if (db <= -95) return 0;
  return Math.max(0, Math.min(1.25, Math.pow(10, db / 20)));
}

function sectionBands(durationSec: number, bpm: number) {
  const secPerBar = (60 / bpm) * BEATS_PER_BAR;
  const totalBars = Math.max(1, Math.ceil(durationSec / secPerBar));
  const templates = [
    ["Intro", 8, "#22d3ee"],
    ["Verse", 16, "#a78bfa"],
    ["Chorus", 16, "#f59e0b"],
    ["Verse 2", 16, "#a78bfa"],
    ["Chorus 2", 16, "#f59e0b"],
    ["Bridge", 8, "#ec4899"],
    ["Outro", totalBars, "#22d3ee"],
  ] as const;

  let bar = 1;
  const bands: Array<{ id: string; label: string; startBar: number; endBar: number; color: string }> = [];
  for (const [label, bars, color] of templates) {
    if (bar > totalBars) break;
    const endBar = Math.min(totalBars, bar + bars - 1);
    bands.push({ id: `${label}-${bar}`, label, startBar: bar, endBar, color });
    bar = endBar + 1;
  }
  return bands;
}

function TrackWaveform({
  peaks,
  color,
  width,
  muted,
}: {
  peaks: number[];
  color: string;
  width: number;
  muted: boolean;
}) {
  const barWidth = Math.max(1, width / Math.max(1, peaks.length));
  return (
    <div className="absolute inset-y-2 left-0 flex items-center" style={{ width, opacity: muted ? 0.22 : 1 }}>
      {peaks.map((peak, i) => {
        const h = Math.max(2, peak * 42);
        return (
          <div
            key={i}
            style={{
              width: Math.max(1, barWidth - 1),
              height: h,
              marginRight: 1,
              borderRadius: 2,
              background: `linear-gradient(180deg, ${color}BB, ${color}44)`,
            }}
          />
        );
      })}
    </div>
  );
}

function EngineButton({
  active,
  title,
  children,
  onClick,
  disabled,
}: {
  active?: boolean;
  title: string;
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className="daw-button"
      data-active={active ? "true" : "false"}
      data-disabled={disabled ? "true" : "false"}
    >
      {children}
    </button>
  );
}

function MiniPianoRoll({ secPerBar, totalBars }: { secPerBar: number; totalBars: number }) {
  const width = totalBars * BAR_WIDTH;
  const notes = [
    { key: "C", bar: 1, len: 2, row: 11 },
    { key: "E", bar: 3, len: 1.5, row: 7 },
    { key: "G", bar: 4.5, len: 1.5, row: 5 },
    { key: "B", bar: 7, len: 2, row: 1 },
    { key: "A", bar: 10, len: 1.75, row: 2 },
  ];

  return (
    <div className="daw-piano">
      <div className="daw-piano-keys">
        {PIANO_KEYS.map((key) => (
          <div key={key} className={key.includes("#") ? "black" : ""}>{key}</div>
        ))}
      </div>
      <div className="daw-piano-grid" style={{ width }}>
        {Array.from({ length: totalBars }, (_, i) => (
          <div key={i} className="daw-piano-bar" style={{ left: i * BAR_WIDTH }} />
        ))}
        {notes.map((note, i) => (
          <button
            key={`${note.key}-${i}`}
            className="daw-midi-note"
            style={{
              left: (note.bar - 1) * BAR_WIDTH,
              top: note.row * 18 + 2,
              width: note.len * BAR_WIDTH,
            }}
            title={`${note.key} MIDI note placeholder`}
          />
        ))}
      </div>
    </div>
  );
}

export default function StudioTab({
  stems,
  duration: propDuration,
  bpm: propBpm,
  keySignature,
  trackTitle,
  mixer,
  engineSynced,
}: StudioTabProps) {
  const { token } = useAuth();
  const timelineRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const nextMarkerId = useRef(1);
  const nextZoneId = useRef(1);
  const nextUploadId = useRef(1);

  const [bpm, setBpm] = useState(propBpm || 120);
  const [keyShift, setKeyShift] = useState(0);
  const [engineProject, setEngineProject] = useState<DawProject | null>(null);
  const [enginePosition, setEnginePosition] = useState<DawPosition | null>(null);
  const [engineError, setEngineError] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [metronome, setMetronome] = useState(false);
  const [snap, setSnap] = useState(true);
  const [selectedTrackId, setSelectedTrackId] = useState<string | "all">("all");
  const [selectedZoneId, setSelectedZoneId] = useState<string | null>(null);
  const [markers, setMarkers] = useState<UserMarker[]>([]);
  const [zones, setZones] = useState<AnchorZone[]>([]);
  const [uploads, setUploads] = useState<UploadedTrack[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [showPiano, setShowPiano] = useState(false);
  const [waveformData, setWaveformData] = useState<Record<string, WaveformData | null>>({});
  const [analysing, setAnalysing] = useState<Set<string>>(new Set());
  const [tracks, setTracks] = useState<TimelineTrack[]>(() =>
    TRACK_NAMES.map((id, i) => ({
      id,
      stemName: id,
      name: SEMANTIC_LABELS[i] || `Track ${i + 1}`,
      color: TRACK_COLORS[i] || "#94A3B8",
      audioUrl: stems?.[id] || null,
      muted: false,
      solo: false,
      volume: 0.8,
      pan: 0,
      pitch: 0,
      keyShift: 0,
      fx: { ...DEFAULT_FX },
    })),
  );

  useEffect(() => {
    if (propBpm) setBpm(propBpm);
  }, [propBpm]);

  const refreshProject = useCallback(async () => {
    try {
      await dawApi.ensureInit();
      const project = await dawApi.getProject();
      setEngineProject(project);
      setEngineError(null);
      if (project.tempo_bpm) setBpm(project.tempo_bpm);
      setTracks((prev) => prev.map((track, i) => {
        const engineTrack = project.tracks[i];
        if (!engineTrack) return track;
        return {
          ...track,
          engineTrackId: engineTrack.id,
          name: track.audioUrl ? track.name : engineTrack.name || track.name,
          muted: engineTrack.mute,
          solo: engineTrack.solo,
          volume: volumeFromDb(engineTrack.volume_db),
          pan: engineTrack.pan,
        };
      }));
    } catch (err) {
      setEngineError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void refreshProject();
  }, [refreshProject, engineSynced]);

  useEffect(() => {
    if (!stems) return;
    setTracks((prev) => prev.map((track) => (
      track.stemName ? { ...track, audioUrl: stems[track.stemName] || track.audioUrl } : track
    )));
  }, [stems]);

  const duration = Math.max(
    propDuration || 0,
    mixer?.duration || 0,
    ...uploads.map((u) => u.durationMs / 1000),
    engineProject?.tracks.reduce((max, track) => {
      const trackEnd = track.regions.reduce((tMax, region) => (
        Math.max(tMax, region.position_ms + region.end_offset_ms - region.start_offset_ms)
      ), 0);
      return Math.max(max, trackEnd / 1000);
    }, 0) || 0,
    120,
  );
  const secPerBar = (60 / Math.max(1, bpm)) * BEATS_PER_BAR;
  const totalBars = Math.max(1, Math.ceil(duration / secPerBar));
  const totalWidth = totalBars * BAR_WIDTH;
  const playheadSec = (enginePosition?.position_ms || 0) / 1000;
  const playheadPx = msToPx(enginePosition?.position_ms || 0, secPerBar);
  const hasSolo = tracks.some((track) => track.solo);
  const populatedTracks = tracks.filter((track) => track.audioUrl);
  const selectedTrack = tracks.find((track) => track.id === selectedTrackId);
  const selectedZone = zones.find((zone) => zone.id === selectedZoneId);
  const sections = useMemo(() => sectionBands(duration, bpm), [duration, bpm]);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const position = await dawApi.getPosition();
        if (cancelled) return;
        setEnginePosition(position);
        setIsPlaying(position.mode === "playing");
        if (position.mode === "playing" && mixer && mixer.currentTime < 0.1 && populatedTracks.length > 0) {
          mixer.play(position.position_ms / 1000);
        }
      } catch {
        if (!cancelled && engineSynced) setEngineError("DAW engine position unavailable");
      }
    };
    void tick();
    const id = window.setInterval(tick, isPlaying ? 120 : 500);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [isPlaying, engineSynced, mixer, populatedTracks.length]);

  useEffect(() => {
    for (const track of tracks) {
      if (!track.audioUrl || track.audioUrl === "simulated") continue;
      if (waveformData[track.id] || analysing.has(track.id)) continue;
      setAnalysing((prev) => new Set(prev).add(track.id));
      analyseWaveformCached(track.audioUrl, Math.max(120, totalBars * 5))
        .then((data) => setWaveformData((prev) => ({ ...prev, [track.id]: data })))
        .catch((err) => console.warn(`[StudioTab] waveform failed for ${track.name}:`, err))
        .finally(() => setAnalysing((prev) => {
          const next = new Set(prev);
          next.delete(track.id);
          return next;
        }));
    }
  }, [tracks, waveformData, analysing, totalBars]);

  const getTimelineX = useCallback((e: React.MouseEvent) => {
    const el = timelineRef.current;
    if (!el) return 0;
    const rect = el.getBoundingClientRect();
    return Math.max(0, e.clientX - rect.left + el.scrollLeft);
  }, []);

  const seekToMs = useCallback(async (ms: number) => {
    const clamped = Math.max(0, Math.min(ms, duration * 1000));
    await dawApi.seek(clamped);
    setEnginePosition((prev) => prev ? { ...prev, position_ms: clamped } : {
      position_ms: clamped,
      bar: Math.floor((clamped / 1000) / secPerBar) + 1,
      beat: 1,
      tick: 0,
      mode: "paused",
    });
    mixer?.seek(clamped / 1000);
  }, [duration, mixer, secPerBar]);

  const handleTimelineClick = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest("button,input,select")) return;
    const ms = pxToMs(snapPx(getTimelineX(e), snap), secPerBar);
    void seekToMs(ms);
  }, [getTimelineX, snap, secPerBar, seekToMs]);

  const transport = useCallback(async (action: "play" | "pause" | "stop") => {
    try {
      await dawApi.ensureInit();
      if (action === "play") {
        const position = await dawApi.play();
        setEnginePosition(position);
        setIsPlaying(true);
        mixer?.play(position.position_ms / 1000);
      } else if (action === "pause") {
        const position = await dawApi.pause();
        setEnginePosition(position);
        setIsPlaying(false);
        mixer?.pause();
      } else {
        await dawApi.stop();
        setEnginePosition((prev) => prev ? { ...prev, position_ms: 0, mode: "stopped" } : null);
        setIsPlaying(false);
        mixer?.stop();
      }
      setEngineError(null);
    } catch (err) {
      setEngineError(err instanceof Error ? err.message : String(err));
    }
  }, [mixer]);

  const handleTempoChange = useCallback(async (next: number) => {
    const safe = Math.max(40, Math.min(240, next || 120));
    setBpm(safe);
    try {
      await dawApi.setTempo(safe);
      await refreshProject();
    } catch (err) {
      setEngineError(err instanceof Error ? err.message : String(err));
    }
  }, [refreshProject]);

  const toggleMetronome = useCallback(async () => {
    const next = !metronome;
    setMetronome(next);
    try {
      await dawApi.setMetronome(next);
    } catch (err) {
      setEngineError(err instanceof Error ? err.message : String(err));
    }
  }, [metronome]);

  const applyTrackEngine = useCallback(async (track: TimelineTrack) => {
    if (!track.engineTrackId) return;
    await Promise.all([
      dawApi.setTrackVolume(track.engineTrackId, dbFromVolume(track.volume)),
      dawApi.setTrackPan(track.engineTrackId, track.pan),
      dawApi.setTrackMute(track.engineTrackId, track.muted),
      dawApi.setTrackSolo(track.engineTrackId, track.solo),
    ]);
  }, []);

  const updateTrack = useCallback((id: string, patcher: (track: TimelineTrack) => TimelineTrack) => {
    setTracks((prev) => {
      const next = prev.map((track) => track.id === id ? patcher(track) : track);
      const changed = next.find((track) => track.id === id);
      if (changed) {
        void applyTrackEngine(changed).catch((err) => {
          setEngineError(err instanceof Error ? err.message : String(err));
        });
        if (changed.stemName) {
          mixer?.setVolume(changed.stemName, changed.volume);
          mixer?.setPan(changed.stemName, changed.pan);
          mixer?.setMuted(changed.stemName, changed.muted);
          mixer?.setSolo(changed.stemName, changed.solo);
        }
      }
      return next;
    });
  }, [applyTrackEngine, mixer]);

  const setFxSuite = useCallback((trackId: string, suite: FxSuiteId) => {
    updateTrack(trackId, (track) => ({
      ...track,
      fx: { bypass: false, suite, ...FX_PRESETS[suite] },
    }));
  }, [updateTrack]);

  const handleAddMarker = useCallback((e: React.MouseEvent) => {
    const bar = Math.max(1, Math.min(totalBars, Math.round(getTimelineX(e) / BAR_WIDTH) + 1));
    const idx = markers.length % MARKER_COLORS.length;
    setMarkers((prev) => [...prev, {
      id: `marker-${nextMarkerId.current++}`,
      bar,
      label: `M${prev.length + 1}`,
      color: MARKER_COLORS[idx],
    }]);
  }, [getTimelineX, markers.length, totalBars]);

  const anchorZone = useCallback(() => {
    const startMs = Math.max(0, Math.round((enginePosition?.position_ms || 0) / 1000 / secPerBar) * secPerBar * 1000);
    const endMs = Math.min(Math.round(duration * 1000), startMs + Math.round(secPerBar * 4000));
    const trackId = selectedTrackId;
    setZones((prev) => {
      const id = `zone-${nextZoneId.current++}`;
      setSelectedZoneId(id);
      return [...prev, {
        id,
        trackId,
        startMs,
        endMs,
        label: trackId === "all" ? `All stems ${prev.length + 1}` : `${selectedTrack?.name || "Stem"} ${prev.length + 1}`,
      }];
    });
    void dawApi.setLoop(startMs, endMs, true).catch((err) => setEngineError(err instanceof Error ? err.message : String(err)));
  }, [duration, enginePosition?.position_ms, secPerBar, selectedTrack?.name, selectedTrackId]);

  const clearLoop = useCallback(() => {
    setSelectedZoneId(null);
    void dawApi.setLoop(0, 0, false).catch((err) => setEngineError(err instanceof Error ? err.message : String(err)));
  }, []);

  const setZoneLoop = useCallback((zone: AnchorZone) => {
    setSelectedZoneId(zone.id);
    setSelectedTrackId(zone.trackId);
    void dawApi.setLoop(zone.startMs, zone.endMs, true)
      .then(() => seekToMs(zone.startMs))
      .catch((err) => setEngineError(err instanceof Error ? err.message : String(err)));
  }, [seekToMs]);

  const handleUpload = useCallback(async (files: FileList | null) => {
    if (!files?.length || !token) return;
    setIsUploading(true);
    try {
      const newUploads: UploadedTrack[] = [];
      for (const file of Array.from(files)) {
        const uploaded = await generateApi.uploadAudio(file, token);
        newUploads.push({
          id: `upload-${nextUploadId.current++}`,
          name: uploaded.original_filename || uploaded.filename || file.name,
          audioUrl: uploaded.url,
          durationMs: Math.round((uploaded.duration_seconds || duration) * 1000),
          color: TRACK_COLORS[(tracks.length + newUploads.length) % TRACK_COLORS.length],
        });
      }
      setUploads((prev) => [...prev, ...newUploads]);
      setTracks((prev) => [
        ...prev,
        ...newUploads.map((u) => ({
          id: u.id,
          name: u.name,
          color: u.color,
          audioUrl: u.audioUrl,
          muted: false,
          solo: false,
          volume: 0.8,
          pan: 0,
          pitch: 0,
          keyShift: 0,
          fx: { ...DEFAULT_FX },
        })),
      ]);

      const stemEntries: StemUrlEntry[] = [
        ...TRACK_NAMES
          .filter((trackName) => stems?.[trackName])
          .map((trackName) => ({
            track_name: trackName,
            audio_url: stems![trackName]!,
            duration_ms: Math.round(duration * 1000),
          })),
        ...uploads,
        ...newUploads,
      ].map((entry, i) => "track_name" in entry ? entry : {
        track_name: `track_${i + 1}`,
        audio_url: entry.audioUrl,
        duration_ms: entry.durationMs,
      });
      await dawApi.ensureInit();
      await dawApi.importStemUrls(stemEntries, trackTitle || "S3 DAW Project", bpm);
      await refreshProject();
    } catch (err) {
      setEngineError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }, [bpm, duration, refreshProject, stems, token, trackTitle, tracks.length, uploads]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
      if (e.code === "Space") {
        e.preventDefault();
        void transport(isPlaying ? "pause" : "play");
      }
      if (e.code === "ArrowRight") {
        e.preventDefault();
        void seekToMs((enginePosition?.position_ms || 0) + secPerBar * 1000);
      }
      if (e.code === "ArrowLeft") {
        e.preventDefault();
        void seekToMs((enginePosition?.position_ms || 0) - secPerBar * 1000);
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [enginePosition?.position_ms, isPlaying, secPerBar, seekToMs, transport]);

  return (
    <div className="daw-root h-full flex flex-col">
      <style>{`
        .daw-root {
          --daw-bg: var(--ew-bg, #0A0B0D);
          --daw-panel: var(--ew-surface, rgba(20,21,28,.88));
          --daw-panel-2: var(--ew-surface-raised, rgba(31,35,48,.92));
          --daw-sunken: var(--ew-sunken, #05060A);
          --daw-border: var(--ew-border, rgba(255,255,255,.08));
          --daw-border-strong: var(--ew-border-strong, rgba(255,255,255,.16));
          --daw-text: var(--ew-text, #E2E8F0);
          --daw-muted: var(--ew-text-muted, #94A3B8);
          --daw-faint: var(--ew-text-faint, #64748B);
          --daw-primary: var(--ew-primary, #00C2FF);
          --daw-primary-fg: var(--ew-primary-fg, #03121A);
          --daw-radius: var(--ew-radius-md, 6px);
          background: var(--daw-bg);
          color: var(--daw-text);
          font-family: var(--ew-font-body, system-ui);
        }
        body[data-skin="white"] .daw-root,
        body[data-mode="light"] .daw-root {
          --daw-bg: #F6F8FB;
          --daw-panel: rgba(255,255,255,.92);
          --daw-panel-2: #FFFFFF;
          --daw-sunken: #E8EEF6;
          --daw-border: rgba(16,24,40,.12);
          --daw-border-strong: rgba(16,24,40,.22);
          --daw-text: #111827;
          --daw-muted: #475569;
          --daw-faint: #64748B;
        }
        .daw-topbar, .daw-footer, .daw-left, .daw-inspector {
          background: var(--daw-panel);
          border-color: var(--daw-border);
        }
        .daw-button {
          width: 32px;
          height: 32px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          border: 1px solid var(--daw-border);
          border-radius: var(--daw-radius);
          background: color-mix(in srgb, var(--daw-text) 6%, transparent);
          color: var(--daw-muted);
          transition: background 120ms ease, color 120ms ease, border-color 120ms ease, transform 120ms ease;
        }
        .daw-button:hover { color: var(--daw-text); border-color: var(--daw-border-strong); }
        .daw-button:active { transform: scale(.96); }
        .daw-button[data-active="true"] {
          background: color-mix(in srgb, var(--daw-primary) 18%, transparent);
          color: var(--daw-primary);
          border-color: color-mix(in srgb, var(--daw-primary) 45%, transparent);
          box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--daw-primary) 14%, transparent);
        }
        .daw-button[data-disabled="true"] { opacity: .38; pointer-events: none; }
        .daw-field {
          height: 30px;
          border: 1px solid var(--daw-border);
          border-radius: var(--daw-radius);
          background: var(--daw-sunken);
          color: var(--daw-text);
          padding: 0 8px;
          font-family: var(--ew-font-mono, monospace);
          font-size: 12px;
          outline: none;
        }
        .daw-field:focus { border-color: color-mix(in srgb, var(--daw-primary) 55%, transparent); }
        .daw-rail { background: var(--daw-sunken); }
        .daw-track-row { border-color: var(--daw-border); }
        .daw-region {
          background: color-mix(in srgb, var(--track-color) 20%, transparent);
          border: 1px solid color-mix(in srgb, var(--track-color) 58%, transparent);
          border-radius: 5px;
          box-shadow: inset 0 1px 0 color-mix(in srgb, white 14%, transparent);
        }
        .daw-playhead {
          background: var(--daw-primary);
          box-shadow: 0 0 0 1px var(--daw-bg), 0 0 16px color-mix(in srgb, var(--daw-primary) 70%, transparent);
        }
        .daw-piano {
          display: flex;
          height: 240px;
          border-top: 1px solid var(--daw-border);
          background: var(--daw-panel);
          overflow: auto;
        }
        .daw-piano-keys {
          width: 72px;
          flex: 0 0 auto;
          border-right: 1px solid var(--daw-border);
          background: var(--daw-sunken);
        }
        .daw-piano-keys > div {
          height: 18px;
          padding: 1px 8px;
          font: 10px var(--ew-font-mono, monospace);
          color: var(--daw-muted);
          border-bottom: 1px solid var(--daw-border);
        }
        .daw-piano-keys > .black { background: color-mix(in srgb, var(--daw-text) 8%, transparent); }
        .daw-piano-grid { position: relative; min-width: 100%; height: 216px; }
        .daw-piano-grid:before {
          content: "";
          position: absolute;
          inset: 0;
          background: repeating-linear-gradient(to bottom, transparent 0 17px, var(--daw-border) 17px 18px);
        }
        .daw-piano-bar {
          position: absolute;
          top: 0;
          bottom: 0;
          width: 1px;
          background: var(--daw-border-strong);
        }
        .daw-midi-note {
          position: absolute;
          height: 14px;
          border-radius: 4px;
          border: 1px solid color-mix(in srgb, var(--daw-primary) 65%, transparent);
          background: color-mix(in srgb, var(--daw-primary) 38%, transparent);
        }
      `}</style>

      <div className="daw-topbar flex items-center justify-between gap-3 px-3 py-2 border-b shrink-0">
        <div className="flex items-center gap-2">
          <EngineButton title={isPlaying ? "Pause engine transport" : "Play engine transport"} active={isPlaying} onClick={() => void transport(isPlaying ? "pause" : "play")}>
            {isPlaying ? <Pause size={15} /> : <Play size={15} />}
          </EngineButton>
          <EngineButton title="Stop" onClick={() => void transport("stop")}><Square size={14} /></EngineButton>
          <EngineButton title="Jump backward one bar" onClick={() => void seekToMs((enginePosition?.position_ms || 0) - secPerBar * 1000)}><ChevronsLeft size={15} /></EngineButton>
          <EngineButton title="Jump forward one bar" onClick={() => void seekToMs((enginePosition?.position_ms || 0) + secPerBar * 1000)}><ChevronsRight size={15} /></EngineButton>
          <EngineButton title="Metronome" active={metronome} onClick={toggleMetronome}><Clock3 size={15} /></EngineButton>
          <EngineButton title="Snap to bar" active={snap} onClick={() => setSnap((v) => !v)}><Magnet size={15} /></EngineButton>
        </div>

        <div className="flex items-center gap-3 min-w-0">
          <div className="font-mono min-w-[110px]">
            <span className="text-base font-bold" style={{ color: "var(--daw-primary)" }}>
              {formatBarBeat(playheadSec, secPerBar)}
            </span>
            <span className="ml-2 text-xs" style={{ color: "var(--daw-muted)" }}>{formatTime(playheadSec)}</span>
          </div>
          <label className="flex items-center gap-1 text-[10px]" style={{ color: "var(--daw-muted)" }}>
            BPM
            <input className="daw-field w-16 text-center" type="number" value={Math.round(bpm)} onChange={(e) => void handleTempoChange(Number(e.target.value))} />
          </label>
          <label className="flex items-center gap-1 text-[10px]" style={{ color: "var(--daw-muted)" }}>
            KEY
            <select className="daw-field w-[84px]" value={keyShift} onChange={(e) => setKeyShift(Number(e.target.value))}>
              {Array.from({ length: 25 }, (_, i) => i - 12).map((shift) => (
                <option key={shift} value={shift}>{shift === 0 ? keySignature || "Orig" : `${shift > 0 ? "+" : ""}${shift} st`}</option>
              ))}
            </select>
          </label>
          <button className="daw-button !w-auto px-2 gap-1" title="Upload separate audio tracks" onClick={() => fileInputRef.current?.click()}>
            <Upload size={14} /> <span className="text-[10px] font-bold">{isUploading ? "Uploading" : "Track"}</span>
          </button>
          <input ref={fileInputRef} type="file" multiple accept="audio/*" className="hidden" onChange={(e) => void handleUpload(e.target.files)} />
        </div>

        <div className="flex items-center gap-2 min-w-0 text-[10px]" style={{ color: "var(--daw-muted)" }}>
          <Disc3 size={13} style={{ color: "var(--daw-primary)" }} />
          <span className="truncate max-w-[180px]">{trackTitle || engineProject?.name || "Untitled Project"}</span>
          <span>{populatedTracks.length}/{tracks.length} tracks</span>
          {engineError ? <span className="text-amber-400 truncate max-w-[210px]">{engineError}</span> : <span className="text-emerald-400">engine-led</span>}
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        <aside className="daw-left w-[318px] shrink-0 border-r overflow-y-auto">
          <div className="h-9 flex items-center justify-between px-3 border-b" style={{ borderColor: "var(--daw-border)" }}>
            <span className="text-[10px] font-bold tracking-wider" style={{ color: "var(--daw-muted)" }}>MIXER</span>
            <div className="flex items-center gap-1">
              <EngineButton title="Refresh engine project" onClick={() => void refreshProject()}><RefreshCcw size={13} /></EngineButton>
              <EngineButton title="Piano roll / MIDI suite" active={showPiano} onClick={() => setShowPiano((v) => !v)}><Piano size={14} /></EngineButton>
            </div>
          </div>

          {tracks.map((track) => {
            const effectiveMute = hasSolo ? !track.solo : track.muted;
            const meterSeed = track.audioUrl ? ((track.volume * 0.55) + (track.solo ? 0.25 : 0.12)) : 0;
            return (
              <div
                key={track.id}
                className="daw-track-row flex items-center gap-2 px-2 py-2 border-b"
                style={{ background: selectedTrackId === track.id ? "color-mix(in srgb, var(--daw-primary) 8%, transparent)" : "transparent" }}
                onClick={() => setSelectedTrackId(track.id)}
              >
                <div className="w-1.5 h-16 rounded-full shrink-0" style={{ background: track.audioUrl ? track.color : "var(--daw-border-strong)" }} />
                <div className="w-[86px] min-w-0">
                  <button
                    className="block text-left text-[11px] font-bold truncate w-full"
                    style={{ color: effectiveMute ? "var(--daw-faint)" : "var(--daw-text)" }}
                    title={track.name}
                  >
                    {track.name}
                  </button>
                  <div className="flex items-center gap-1 mt-1">
                    <EngineButton title="Mute" active={track.muted} onClick={() => updateTrack(track.id, (t) => ({ ...t, muted: !t.muted }))}><span className="text-[9px] font-bold">M</span></EngineButton>
                    <EngineButton title="Solo" active={track.solo} onClick={() => updateTrack(track.id, (t) => ({ ...t, solo: !t.solo }))}><span className="text-[9px] font-bold">S</span></EngineButton>
                    <EngineButton title="Select for repaint zone" active={selectedTrackId === track.id} onClick={() => setSelectedTrackId(track.id)}><LocateFixed size={12} /></EngineButton>
                  </div>
                </div>
                <VolumeFader value={track.volume} color={track.color} height={62} onChange={(v) => updateTrack(track.id, (t) => ({ ...t, volume: v }))} />
                <div className="flex flex-col items-center gap-1">
                  <Knob value={(track.pan + 1) / 2} anchor={0.5} color={track.color} size={32} label="Pan" onChange={(v) => updateTrack(track.id, (t) => ({ ...t, pan: (v - 0.5) * 2 }))} />
                  <PeakMeter level={effectiveMute ? 0 : Math.min(1, meterSeed)} peak={track.solo ? 0.92 : undefined} height={34} />
                </div>
                <div className="flex-1 min-w-0">
                  <select
                    className="daw-field w-full !h-7"
                    value={track.fx.suite}
                    title="FX suite"
                    onChange={(e) => setFxSuite(track.id, e.target.value as FxSuiteId)}
                  >
                    <option value="clean">Clean</option>
                    <option value="vocal-polish">Vocal polish</option>
                    <option value="drum-bus">Drum bus</option>
                    <option value="bass-weight">Bass weight</option>
                    <option value="wide-synth">Wide synth</option>
                    <option value="lofi-tape">Lo-fi tape</option>
                    <option value="space-delay">Space delay</option>
                  </select>
                  <div className="mt-1 grid grid-cols-2 gap-1 text-[9px]" style={{ color: "var(--daw-faint)" }}>
                    <span>Pitch {track.pitch > 0 ? "+" : ""}{track.pitch}</span>
                    <span>FX {track.fx.bypass ? "off" : "on"}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </aside>

        <main className="flex-1 flex flex-col min-w-0">
          <div className="h-9 flex items-center gap-2 px-3 border-b" style={{ borderColor: "var(--daw-border)", background: "var(--daw-panel)" }}>
            <EngineButton title="Anchor current bar as repaint zone" onClick={anchorZone}><Flag size={14} /></EngineButton>
            <EngineButton title="Clear loop zone" onClick={clearLoop}><Scissors size={14} /></EngineButton>
            <EngineButton title="Repaint selected zone" disabled={!selectedZone}><Wand2 size={14} /></EngineButton>
            <EngineButton title="Repaint all stems in zone" disabled={!selectedZone}><Sparkles size={14} /></EngineButton>
            <span className="text-[10px]" style={{ color: "var(--daw-muted)" }}>
              {selectedZone ? `${selectedZone.label}: ${formatTime(selectedZone.startMs / 1000)}-${formatTime(selectedZone.endMs / 1000)}` : "Click the timeline to seek. Use anchors for repaint zones."}
            </span>
            <div className="ml-auto flex items-center gap-2 text-[10px]" style={{ color: "var(--daw-muted)" }}>
              <AudioLines size={13} /> engine project
              <SlidersHorizontal size={13} /> fx lanes
              <KeyboardMusic size={13} /> midi
            </div>
          </div>

          <div ref={timelineRef} className="flex-1 overflow-auto daw-rail relative" onClick={handleTimelineClick} onDoubleClick={handleAddMarker}>
            <div className="sticky top-0 z-20 h-9 flex border-b" style={{ width: totalWidth, minWidth: "100%", background: "var(--daw-sunken)", borderColor: "var(--daw-border)" }}>
              {Array.from({ length: totalBars }, (_, i) => (
                <div
                  key={i}
                  className="shrink-0 border-r flex items-end justify-center pb-1"
                  style={{
                    width: BAR_WIDTH,
                    borderColor: i % 4 === 0 ? "var(--daw-border-strong)" : "var(--daw-border)",
                  }}
                >
                  {i % 4 === 0 && <span className="text-[9px] font-mono" style={{ color: "var(--daw-faint)" }}>{i + 1}</span>}
                </div>
              ))}
              {markers.map((marker) => (
                <button
                  key={marker.id}
                  className="absolute top-0 h-full px-1 text-[8px] font-bold"
                  style={{ left: (marker.bar - 1) * BAR_WIDTH, color: "#071017", background: marker.color }}
                  onClick={(e) => {
                    e.stopPropagation();
                    void seekToMs((marker.bar - 1) * secPerBar * 1000);
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setMarkers((prev) => prev.filter((m) => m.id !== marker.id));
                  }}
                >
                  {marker.label}
                </button>
              ))}
            </div>

            <div className="h-7 relative border-b" style={{ width: totalWidth, minWidth: "100%", borderColor: "var(--daw-border)" }}>
              {sections.map((section) => (
                <div
                  key={section.id}
                  className="absolute top-0 bottom-0 flex items-center justify-center"
                  style={{
                    left: (section.startBar - 1) * BAR_WIDTH,
                    width: (section.endBar - section.startBar + 1) * BAR_WIDTH,
                    background: `${section.color}18`,
                    borderBottom: `2px solid ${section.color}`,
                  }}
                >
                  <span className="text-[10px] font-bold truncate px-1" style={{ color: section.color }}>{section.label}</span>
                </div>
              ))}
            </div>

            {tracks.map((track) => {
              const muted = hasSolo ? !track.solo : track.muted;
              const wd = waveformData[track.id];
              const regionWidth = Math.max(80, totalWidth - 8);
              return (
                <div
                  key={track.id}
                  className="relative h-[68px] border-b"
                  style={{ width: totalWidth, minWidth: "100%", borderColor: "var(--daw-border)", opacity: muted ? 0.45 : 1 }}
                  onClick={(e) => {
                    setSelectedTrackId(track.id);
                    handleTimelineClick(e);
                  }}
                >
                  {Array.from({ length: totalBars }, (_, i) => (
                    <div
                      key={i}
                      className="absolute top-0 bottom-0 border-r"
                      style={{ left: i * BAR_WIDTH, borderColor: i % 4 === 0 ? "var(--daw-border-strong)" : "var(--daw-border)" }}
                    />
                  ))}
                  {track.audioUrl ? (
                    <div
                      className="daw-region absolute top-2 bottom-2 overflow-hidden"
                      style={{ left: 4, width: regionWidth, ["--track-color" as string]: track.color }}
                      title={`${track.name}: click to seek, select track, anchor repaint zones`}
                    >
                      {wd ? (
                        <TrackWaveform peaks={wd.peaks} color={track.color} width={regionWidth} muted={muted} />
                      ) : (
                        <div className="absolute inset-0 flex items-center justify-center text-[10px]" style={{ color: track.color }}>
                          <Waves size={14} className="mr-2 animate-pulse" /> {analysing.has(track.id) ? "Analysing waveform" : "Audio region"}
                        </div>
                      )}
                      <span className="absolute left-2 top-1 text-[9px] font-bold" style={{ color: "var(--daw-text)" }}>{track.name}</span>
                    </div>
                  ) : (
                    <div className="absolute inset-0 flex items-center justify-center text-[10px]" style={{ color: "var(--daw-faint)" }}>
                      <Mic2 size={13} className="mr-2" /> empty lane
                    </div>
                  )}
                </div>
              );
            })}

            {zones.map((zone) => {
              const top = zone.trackId === "all"
                ? 68
                : 68 + Math.max(0, tracks.findIndex((track) => track.id === zone.trackId)) * 68;
              const height = zone.trackId === "all" ? tracks.length * 68 : 68;
              return (
                <button
                  key={zone.id}
                  className="absolute z-10 border text-[9px] font-bold px-1 text-left"
                  style={{
                    left: msToPx(zone.startMs, secPerBar),
                    top,
                    height,
                    width: Math.max(24, msToPx(zone.endMs - zone.startMs, secPerBar)),
                    borderColor: "var(--daw-primary)",
                    color: "var(--daw-primary)",
                    background: "color-mix(in srgb, var(--daw-primary) 10%, transparent)",
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    setZoneLoop(zone);
                  }}
                  title="Repaint anchor zone"
                >
                  {zone.label}
                </button>
              );
            })}

            {markers.map((marker) => (
              <div
                key={`${marker.id}-line`}
                className="absolute top-9 bottom-0 w-px pointer-events-none z-10"
                style={{ left: (marker.bar - 1) * BAR_WIDTH, background: marker.color, opacity: 0.45 }}
              />
            ))}

            <div className="absolute top-0 bottom-0 z-30 w-[2px] daw-playhead pointer-events-none" style={{ left: playheadPx }}>
              <div className="absolute -left-[5px] top-0 w-3 h-4" style={{ background: "var(--daw-primary)", clipPath: "polygon(0 0, 100% 0, 50% 100%)" }} />
            </div>
          </div>

          {showPiano && <MiniPianoRoll secPerBar={secPerBar} totalBars={totalBars} />}
        </main>

        <aside className="daw-inspector w-[282px] shrink-0 border-l overflow-y-auto">
          <div className="h-9 px-3 flex items-center gap-2 border-b" style={{ borderColor: "var(--daw-border)" }}>
            <Gauge size={14} style={{ color: "var(--daw-primary)" }} />
            <span className="text-[10px] font-bold tracking-wider" style={{ color: "var(--daw-muted)" }}>TOOLS</span>
          </div>
          <div className="p-3 space-y-3">
            <section>
              <div className="flex items-center gap-2 text-[10px] font-bold mb-2" style={{ color: "var(--daw-muted)" }}>
                <ListMusic size={13} /> Selection
              </div>
              <select className="daw-field w-full" value={selectedTrackId} onChange={(e) => setSelectedTrackId(e.target.value)}>
                <option value="all">All stems</option>
                {tracks.map((track) => <option key={track.id} value={track.id}>{track.name}</option>)}
              </select>
            </section>

            <section>
              <div className="flex items-center gap-2 text-[10px] font-bold mb-2" style={{ color: "var(--daw-muted)" }}>
                <Activity size={13} /> Pitch / Key
              </div>
              <label className="block text-[10px] mb-1" style={{ color: "var(--daw-faint)" }}>Selected stem pitch</label>
              <input
                type="range"
                min={-12}
                max={12}
                value={selectedTrack?.pitch || 0}
                onChange={(e) => {
                  const pitch = Number(e.target.value);
                  if (selectedTrackId !== "all") updateTrack(selectedTrackId, (track) => ({ ...track, pitch }));
                }}
                className="w-full"
                style={{ accentColor: "var(--daw-primary)" }}
              />
              <div className="flex justify-between text-[10px]" style={{ color: "var(--daw-faint)" }}>
                <span>-12</span><span>{selectedTrack?.pitch || 0} st</span><span>+12</span>
              </div>
              <button
                className="daw-button !w-full mt-2 gap-2"
                onClick={() => setTracks((prev) => prev.map((track) => ({ ...track, keyShift })))}
              >
                <Sparkles size={13} /> Apply key shift to all stems
              </button>
            </section>

            <section>
              <div className="flex items-center gap-2 text-[10px] font-bold mb-2" style={{ color: "var(--daw-muted)" }}>
                <SlidersHorizontal size={13} /> FX Suite
              </div>
              {selectedTrack ? (
                <div className="space-y-2">
                  {(["eq_low_db", "eq_mid_db", "eq_high_db", "compressor", "saturation", "reverb", "delay"] as const).map((field) => (
                    <label key={field} className="grid grid-cols-[74px_1fr_34px] items-center gap-2 text-[10px]" style={{ color: "var(--daw-faint)" }}>
                      <span>{field.replace("eq_", "").replace("_db", "").replace("_", " ")}</span>
                      <input
                        type="range"
                        min={field.includes("eq") ? -12 : 0}
                        max={field.includes("eq") ? 12 : 100}
                        value={selectedTrack.fx[field]}
                        onChange={(e) => updateTrack(selectedTrack.id, (track) => ({
                          ...track,
                          fx: { ...track.fx, [field]: Number(e.target.value) },
                        }))}
                        style={{ accentColor: selectedTrack.color }}
                      />
                      <span className="font-mono">{selectedTrack.fx[field]}</span>
                    </label>
                  ))}
                </div>
              ) : (
                <p className="text-[11px]" style={{ color: "var(--daw-faint)" }}>Select a stem to edit its FX chain.</p>
              )}
            </section>

            <section>
              <div className="flex items-center gap-2 text-[10px] font-bold mb-2" style={{ color: "var(--daw-muted)" }}>
                <Flag size={13} /> Repaint Anchors
              </div>
              <button className="daw-button !w-full gap-2 mb-2" onClick={anchorZone}>
                <Plus size={13} /> Anchor current bar
              </button>
              <div className="space-y-1">
                {zones.length === 0 ? (
                  <p className="text-[11px]" style={{ color: "var(--daw-faint)" }}>No zones yet. Anchors become repaint targets for one stem or all stems.</p>
                ) : zones.map((zone) => (
                  <button
                    key={zone.id}
                    className="w-full text-left px-2 py-1.5 border rounded text-[10px]"
                    style={{
                      borderColor: zone.id === selectedZoneId ? "var(--daw-primary)" : "var(--daw-border)",
                      color: zone.id === selectedZoneId ? "var(--daw-primary)" : "var(--daw-muted)",
                      background: "var(--daw-sunken)",
                    }}
                    onClick={() => setZoneLoop(zone)}
                  >
                    {zone.label} · {formatTime(zone.startMs / 1000)}-{formatTime(zone.endMs / 1000)}
                  </button>
                ))}
              </div>
            </section>
          </div>
        </aside>
      </div>

      <div className="daw-footer border-t px-3 py-1.5 flex items-center justify-between text-[10px] shrink-0" style={{ color: "var(--daw-muted)" }}>
        <span>Engine transport · clickable stems · markers · repaint anchors · uploads · pitch/key · metronome · FX · MIDI suite</span>
        <span>{engineProject ? `${engineProject.tracks.length} engine tracks` : "project pending"} · {totalBars} bars · {formatTime(duration)}</span>
      </div>
    </div>
  );
}
