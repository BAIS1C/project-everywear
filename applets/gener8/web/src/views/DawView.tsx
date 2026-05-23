import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDownToLine,
  ChevronsLeftRight,
  Circle,
  Keyboard,
  Mic2,
  Music2,
  Pause,
  Play,
  Plus,
  Radio,
  RotateCcw,
  Save,
  Scissors,
  Square,
  Trash2,
  Undo2,
  Volume2,
} from 'lucide-react';
import { barsToMs, msPerBar, msPerBeat, type TimeSignature } from '../lib/barGrid';
import { dawApi, type DawPosition, type DawProject, type DawRegion, type DawTrack } from '../services/dawApi';

const TRACK_COLORS = ['#60A5FA', '#34D399', '#F472B6', '#FBBF24', '#A78BFA', '#2DD4BF'];
const RIFF_TYPES = ['drums', 'bass', 'chords', 'lead', 'texture', 'full groove'] as const;
const BAR_CHOICES = [4, 8, 16, 32] as const;

type SnapMode = 'off' | 'beat' | 'bar' | '4bar' | '8bar';
type RiffTab = 'bank' | 'layer' | 'mic' | 'midi';

const DEFAULT_POSITION: DawPosition = {
  position_ms: 0,
  bar: 1,
  beat: 1,
  tick: 0,
  mode: 'stopped',
};

function formatMs(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const centiseconds = Math.floor((ms % 1000) / 10);
  return `${minutes}:${seconds.toString().padStart(2, '0')}.${centiseconds.toString().padStart(2, '0')}`;
}

function regionDuration(region: DawRegion): number {
  return Math.max(0, region.end_offset_ms - region.start_offset_ms);
}

function regionLabel(region: DawRegion): string {
  const filename = region.audio_ref.split(/[\\/]/).pop() ?? region.audio_ref;
  return filename.replace(/\.[^.]+$/, '') || 'Audio';
}

function TransportBar({
  position,
  tempo,
  snapMode,
  onPlay,
  onPause,
  onStop,
  onSetTempo,
  onUndo,
  onRedo,
  onSnapMode,
}: {
  position: DawPosition;
  tempo: number;
  snapMode: SnapMode;
  onPlay: () => void;
  onPause: () => void;
  onStop: () => void;
  onSetTempo: (bpm: number) => void;
  onUndo: () => void;
  onRedo: () => void;
  onSnapMode: (mode: SnapMode) => void;
}) {
  const isPlaying = position.mode === 'playing';

  return (
    <div className="flex items-center gap-3 px-4 h-12 bg-s3-panel border-b border-s3-border select-none flex-shrink-0">
      <div className="flex gap-0.5">
        <button onClick={onUndo} className="p-1.5 rounded hover:bg-s3-hover text-s3-text-muted hover:text-s3-text-primary" title="Undo">
          <Undo2 size={15} />
        </button>
        <button onClick={onRedo} className="p-1.5 rounded hover:bg-s3-hover text-s3-text-muted hover:text-s3-text-primary" title="Redo">
          <RotateCcw size={15} />
        </button>
      </div>

      <div className="w-px h-5 bg-s3-border" />

      <div className="flex items-center gap-1">
        <button onClick={onStop} className="p-1.5 rounded hover:bg-s3-hover text-s3-text-primary" title="Stop">
          <Square size={15} />
        </button>
        {isPlaying ? (
          <button onClick={onPause} className="p-2 rounded-full bg-accent-500 hover:bg-accent-400 text-black" title="Pause">
            <Pause size={16} />
          </button>
        ) : (
          <button onClick={onPlay} className="p-2 rounded-full bg-accent-500 hover:bg-accent-400 text-black" title="Play">
            <Play size={16} />
          </button>
        )}
      </div>

      <div className="flex flex-col items-center min-w-[112px] bg-black/20 rounded px-3 py-1">
        <span className="text-xs font-mono text-s3-text-primary tabular-nums">{formatMs(position.position_ms)}</span>
        <span className="text-[9px] font-mono text-s3-text-muted tabular-nums">
          {position.bar}:{position.beat}:{String(position.tick).padStart(3, '0')}
        </span>
      </div>

      <div className="w-px h-5 bg-s3-border" />

      <label className="flex items-center gap-1.5">
        <span className="text-[10px] font-medium uppercase tracking-wider text-s3-text-muted">BPM</span>
        <input
          type="number"
          value={tempo}
          min={20}
          max={300}
          step={1}
          onChange={(event) => onSetTempo(Number(event.target.value))}
          className="w-16 text-xs font-mono text-center tabular-nums rounded px-1.5 py-0.5 bg-black/20 border border-s3-border text-s3-text-primary focus:border-accent-500/50 focus:outline-none"
        />
      </label>

      <label className="flex items-center gap-1.5">
        <span className="text-[10px] font-medium uppercase tracking-wider text-s3-text-muted">Snap</span>
        <select
          className="ew-select text-xs h-7 py-0 pl-2 pr-7"
          value={snapMode}
          onChange={(event) => onSnapMode(event.target.value as SnapMode)}
        >
          <option value="off">Off</option>
          <option value="beat">Beat</option>
          <option value="bar">Bar</option>
          <option value="4bar">4 bars</option>
          <option value="8bar">8 bars</option>
        </select>
      </label>

      <div className="flex-1" />

      <div
        className={`text-[9px] font-medium uppercase tracking-widest px-2.5 py-0.5 rounded-full border ${
          isPlaying
            ? 'bg-accent-500/15 text-accent-500 border-accent-500/20'
            : position.mode === 'paused'
              ? 'bg-amber-500/15 text-amber-400 border-amber-500/20'
              : 'bg-white/[0.04] text-s3-text-muted border-s3-border'
        }`}
      >
        {position.mode}
      </div>
    </div>
  );
}

function TrackHeader({
  track,
  onMute,
  onSolo,
  onVolumeChange,
  onPanChange,
  onRemove,
}: {
  track: DawTrack;
  onMute: () => void;
  onSolo: () => void;
  onVolumeChange: (db: number) => void;
  onPanChange: (pan: number) => void;
  onRemove: () => void;
}) {
  return (
    <div className="flex items-center gap-2 px-3 h-[78px] border-b border-s3-border bg-s3-panel group">
      <div className="w-1 h-11 rounded-full flex-shrink-0" style={{ background: track.color }} />

      <div className="flex flex-col gap-1 min-w-0 flex-1">
        <span className="text-xs font-medium text-s3-text-primary truncate leading-tight">{track.name}</span>
        <label className="flex items-center gap-1">
          <span className="text-[9px] text-s3-text-muted">Pan</span>
          <input
            type="range"
            min={-100}
            max={100}
            value={Math.round(track.pan * 100)}
            onChange={(event) => onPanChange(Number(event.target.value) / 100)}
            className="w-12 h-0.5 accent-accent-500 cursor-pointer"
            title={`Pan ${Math.round(track.pan * 100)}`}
          />
        </label>
      </div>

      <div className="flex gap-1">
        <button
          onClick={onMute}
          className={`text-[10px] font-bold w-6 h-6 rounded flex items-center justify-center transition-all ${
            track.mute ? 'bg-red-500 text-white' : 'bg-white/[0.04] text-s3-text-muted border border-s3-border hover:bg-s3-hover'
          }`}
          title="Mute"
        >
          M
        </button>
        <button
          onClick={onSolo}
          className={`text-[10px] font-bold w-6 h-6 rounded flex items-center justify-center transition-all ${
            track.solo ? 'bg-amber-500 text-black' : 'bg-white/[0.04] text-s3-text-muted border border-s3-border hover:bg-s3-hover'
          }`}
          title="Solo"
        >
          S
        </button>
      </div>

      <label className="flex flex-col items-center gap-0.5">
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
      </label>

      <button
        onClick={onRemove}
        className="p-1 rounded hover:bg-red-500/10 text-s3-text-muted hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100"
        title="Remove track"
      >
        <Trash2 size={12} />
      </button>
    </div>
  );
}

function WaveformRegion({
  region,
  trackColor,
  pixelsPerMs,
  viewStartMs,
  peaks,
  laneHeight,
  selected,
  onSelect,
}: {
  region: DawRegion;
  trackColor: string;
  pixelsPerMs: number;
  viewStartMs: number;
  peaks: [number, number][];
  laneHeight: number;
  selected: boolean;
  onSelect: () => void;
}) {
  const left = (region.position_ms - viewStartMs) * pixelsPerMs;
  const width = Math.max(12, regionDuration(region) * pixelsPerMs);

  return (
    <button
      type="button"
      onClick={onSelect}
      className={`absolute top-1 bottom-1 rounded overflow-hidden text-left transition-shadow ${
        selected ? 'ring-1 ring-accent-500 shadow-lg shadow-accent-500/10' : 'hover:shadow-lg'
      }`}
      style={{
        left: `${left}px`,
        width: `${width}px`,
        background: `linear-gradient(180deg, ${trackColor}18 0%, ${trackColor}08 100%)`,
        border: `1px solid ${selected ? trackColor : `${trackColor}35`}`,
      }}
      title={regionLabel(region)}
    >
      <div
        className="absolute top-0 left-0 right-0 h-4 flex items-center px-1.5 text-[8px] font-medium truncate"
        style={{ color: `${trackColor}CC`, background: `${trackColor}14` }}
      >
        {regionLabel(region)}
      </div>
      <svg
        className="absolute top-4 left-0"
        width="100%"
        height={laneHeight - 16}
        preserveAspectRatio="none"
        viewBox={`0 0 ${Math.max(1, peaks.length)} ${laneHeight - 16}`}
      >
        {peaks.length > 0 && (
          <path
            d={peaks
              .map(([lo, hi], index) => {
                const mid = (laneHeight - 16) / 2;
                const y1 = mid - hi * mid;
                const y2 = mid - lo * mid;
                return `M${index},${y1}L${index},${y2}`;
              })
              .join('')}
            stroke={trackColor}
            strokeWidth={1.2}
            strokeOpacity={0.75}
            fill="none"
          />
        )}
      </svg>
    </button>
  );
}

function TimelineLane({
  track,
  pixelsPerMs,
  viewStartMs,
  laneHeight,
  selectedRegionId,
  onSelectRegion,
}: {
  track: DawTrack;
  pixelsPerMs: number;
  viewStartMs: number;
  laneHeight: number;
  selectedRegionId: string | null;
  onSelectRegion: (regionId: string) => void;
}) {
  const [peaksByRegion, setPeaksByRegion] = useState<Record<string, [number, number][]>>({});

  useEffect(() => {
    let cancelled = false;
    for (const region of track.regions) {
      const widthPx = Math.max(1, Math.round(regionDuration(region) * pixelsPerMs));
      if (widthPx < 2) continue;
      dawApi
        .getWaveformPeaks(region.audio_ref, widthPx, region.start_offset_ms, region.end_offset_ms)
        .then((data) => {
          if (!cancelled) {
            setPeaksByRegion((prev) => ({ ...prev, [region.id]: data.peaks }));
          }
        })
        .catch(() => {
          if (cancelled) return;
          const fakePeaks: [number, number][] = Array.from({ length: Math.min(widthPx, 1200) }, () => {
            const value = Math.random() * 0.5 + 0.1;
            return [-value, value];
          });
          setPeaksByRegion((prev) => ({ ...prev, [region.id]: fakePeaks }));
        });
    }
    return () => {
      cancelled = true;
    };
  }, [track.regions, pixelsPerMs]);

  return (
    <div className="relative border-b border-s3-border bg-s3/80" style={{ height: `${laneHeight}px` }}>
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
          selected={selectedRegionId === region.id}
          onSelect={() => onSelectRegion(region.id)}
        />
      ))}
    </div>
  );
}

function BarRuler({
  tempo,
  timeSignature,
  viewStartMs,
  viewWidthMs,
  pixelsPerMs,
}: {
  tempo: number;
  timeSignature: TimeSignature;
  viewStartMs: number;
  viewWidthMs: number;
  pixelsPerMs: number;
}) {
  const beatMs = msPerBeat(tempo);
  const barMs = msPerBar(tempo, timeSignature);
  const startBeat = Math.floor(viewStartMs / beatMs);
  const endBeat = Math.ceil((viewStartMs + viewWidthMs) / beatMs) + 1;
  const beatsInBar = Math.max(1, timeSignature[0]);
  const markers = [];

  for (let beat = startBeat; beat <= endBeat; beat += 1) {
    const markerMs = beat * beatMs;
    const isBar = beat % beatsInBar === 0;
    const barNumber = Math.floor(beat / beatsInBar) + 1;
    const isPhrase = isBar && (barNumber - 1) % 4 === 0;
    markers.push({
      x: (markerMs - viewStartMs) * pixelsPerMs,
      isBar,
      isPhrase,
      label: isBar ? String(barNumber) : '',
    });
  }

  return (
    <div className="relative h-8 bg-s3-panel border-b border-s3-border flex-shrink-0 overflow-hidden">
      {markers.map((marker, index) => (
        <React.Fragment key={index}>
          <div
            className={`absolute top-0 h-full border-l ${
              marker.isPhrase ? 'border-accent-500/25' : marker.isBar ? 'border-white/[0.09]' : 'border-white/[0.035]'
            }`}
            style={{ left: `${marker.x}px` }}
          />
          {marker.label && (
            <span
              className="absolute bottom-1 text-[9px] font-mono text-s3-text-muted select-none tabular-nums"
              style={{ left: `${marker.x + 4}px` }}
            >
              {marker.label}
            </span>
          )}
        </React.Fragment>
      ))}
      <div
        className="absolute top-0 bottom-0 border-l border-dashed border-accent-500/20 pointer-events-none"
        style={{ left: `${((barMs * 8 - viewStartMs) * pixelsPerMs).toFixed(2)}px` }}
      />
    </div>
  );
}

function Playhead({ positionMs, viewStartMs, pixelsPerMs }: { positionMs: number; viewStartMs: number; pixelsPerMs: number }) {
  const x = (positionMs - viewStartMs) * pixelsPerMs;
  if (x < -2 || x > 5000) return null;
  return (
    <div className="absolute top-0 bottom-0 z-20 pointer-events-none" style={{ left: `${x}px` }}>
      <div className="w-3 h-3 -ml-[5px] bg-accent-500" style={{ clipPath: 'polygon(0 0, 100% 0, 50% 100%)' }} />
      <div className="w-px h-full bg-accent-500 shadow-[0_0_6px_var(--accent-500,#00C2FF)]" />
    </div>
  );
}

function RiffBankPanel({
  project,
  selectedRegion,
}: {
  project: DawProject;
  selectedRegion: DawRegion | null;
}) {
  const [tab, setTab] = useState<RiffTab>('bank');
  const [prompt, setPrompt] = useState('');
  const [riffType, setRiffType] = useState<(typeof RIFF_TYPES)[number]>('drums');
  const [bars, setBars] = useState<(typeof BAR_CHOICES)[number]>(8);
  const [keyScale, setKeyScale] = useState('C minor');
  const [seed, setSeed] = useState('');
  const durationMs = barsToMs(bars, project.tempo_bpm, project.time_signature);

  return (
    <section className="h-[198px] flex flex-col border-t border-s3-border bg-s3-panel/70 flex-shrink-0">
      <div className="h-[86px] px-3 py-2 border-b border-s3-border bg-s3-panel flex items-end gap-3 overflow-x-auto">
        <div className="flex flex-col justify-center min-w-[72px] h-full">
          <span className="text-[10px] font-medium uppercase tracking-widest text-s3-text-muted">Create</span>
          <span className="text-sm font-medium text-s3-text-primary">Riff</span>
        </div>

        <label className="ew-field min-w-[320px] flex-[1_1_360px] mb-0">
          <span className="ew-field-label">Prompt</span>
          <input
            className="ew-input"
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder="tight dusty drum loop with chopped soul accents"
          />
        </label>

        <div className="ew-field min-w-[116px] mb-0">
          <span className="ew-field-label">Riff Model</span>
          <div className="h-10 px-3 rounded border border-s3-border bg-black/15 flex items-center text-xs font-medium text-s3-text-primary whitespace-nowrap">
            Ready
          </div>
        </div>

        <label className="ew-field min-w-[128px] mb-0">
          <span className="ew-field-label">Role</span>
          <select className="ew-select" value={riffType} onChange={(event) => setRiffType(event.target.value as typeof riffType)}>
            {RIFF_TYPES.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
        </label>

        <label className="ew-field min-w-[86px] mb-0">
          <span className="ew-field-label">Bars</span>
          <select className="ew-select" value={bars} onChange={(event) => setBars(Number(event.target.value) as typeof bars)}>
            {BAR_CHOICES.map((choice) => (
              <option key={choice} value={choice}>
                {choice}
              </option>
            ))}
          </select>
        </label>

        <label className="ew-field min-w-[108px] mb-0">
          <span className="ew-field-label">Key</span>
          <input className="ew-input" value={keyScale} onChange={(event) => setKeyScale(event.target.value)} />
        </label>

        <label className="ew-field min-w-[104px] mb-0">
          <span className="ew-field-label">Seed</span>
          <input className="ew-input" value={seed} onChange={(event) => setSeed(event.target.value)} placeholder="random" />
        </label>

        <div className="flex flex-col items-start justify-end gap-1 min-w-[116px]">
          <button className="ew-btn ew-btn--primary h-10" disabled={!prompt.trim()} title="Generate riff">
            <Radio size={15} />
            Generate
          </button>
          <span className="text-[10px] font-mono text-s3-text-muted tabular-nums">
            {formatMs(durationMs)} · {project.tempo_bpm.toFixed(0)} BPM
          </span>
        </div>
      </div>

      <div className="flex items-center gap-1 h-9 px-3 border-b border-s3-border">
        <PanelTab active={tab === 'bank'} onClick={() => setTab('bank')} icon={<Save size={14} />} label="Riff Bank" />
        <PanelTab active={tab === 'layer'} onClick={() => setTab('layer')} icon={<ChevronsLeftRight size={14} />} label="Add Layer" />
        <PanelTab active={tab === 'mic'} onClick={() => setTab('mic')} icon={<Mic2 size={14} />} label="Mic" />
        <PanelTab active={tab === 'midi'} onClick={() => setTab('midi')} icon={<Keyboard size={14} />} label="MIDI" />
        <div className="flex-1" />
        <div className="text-[10px] font-mono text-s3-text-muted tabular-nums">
          {project.tempo_bpm.toFixed(0)} BPM · {project.time_signature[0]}/{project.time_signature[1]}
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-auto p-3">
        {tab === 'bank' && (
          <div className="h-full grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-3 content-start">
            <div className="border border-dashed border-s3-border rounded p-3 min-h-[86px] flex items-center justify-center text-xs text-s3-text-muted">
              Empty
            </div>
          </div>
        )}

        {tab === 'layer' && (
          <div className="grid grid-cols-[minmax(220px,1fr)_320px] gap-3 max-lg:grid-cols-1">
            <div className="grid grid-cols-2 gap-2 content-start">
              <div className="ew-field col-span-2 mb-0">
                <label className="ew-field-label">Source</label>
                <div className="h-10 px-3 rounded border border-s3-border bg-black/15 flex items-center text-sm text-s3-text-primary">
                  {selectedRegion ? regionLabel(selectedRegion) : 'No region selected'}
                </div>
              </div>
              <div className="ew-field mb-0">
                <label className="ew-field-label">Layer</label>
                <select className="ew-select" defaultValue="bass">
                  {RIFF_TYPES.slice(0, 5).map((type) => (
                    <option key={type} value={type}>
                      {type}
                    </option>
                  ))}
                </select>
              </div>
              <div className="ew-field mb-0">
                <label className="ew-field-label">Bars</label>
                <input className="ew-input" readOnly value={selectedRegion ? Math.max(1, Math.round(regionDuration(selectedRegion) / msPerBar(project.tempo_bpm, project.time_signature))) : ''} />
              </div>
            </div>
            <div className="ew-field mb-0">
              <label className="ew-field-label">Prompt</label>
              <div className="flex gap-2">
                <input className="ew-input flex-1" placeholder="warm rolling bass that follows the groove" />
              <button className="ew-btn ew-btn--primary" disabled={!selectedRegion} title="Generate layer">
                <ChevronsLeftRight size={15} />
                Generate Layer
              </button>
              </div>
            </div>
          </div>
        )}

        {tab === 'mic' && (
          <div className="h-full flex items-center gap-3">
            <button className="ew-btn ew-btn--ghost" disabled title="Record">
              <Circle size={15} />
              Record
            </button>
            <button className="ew-btn ew-btn--ghost" disabled title="Send to timeline">
              <ArrowDownToLine size={15} />
              Send
            </button>
          </div>
        )}

        {tab === 'midi' && (
          <div className="h-full flex items-center gap-3">
            <button className="ew-btn ew-btn--ghost" disabled title="Capture MIDI">
              <Keyboard size={15} />
              Capture
            </button>
            <button className="ew-btn ew-btn--ghost" disabled title="Open piano roll">
              <Scissors size={15} />
              Piano Roll
            </button>
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
          ? 'text-accent-500 border-accent-500 bg-accent-500/5'
          : 'text-s3-text-muted border-transparent hover:text-s3-text-primary hover:bg-s3-hover'
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

export default function DawView() {
  const [project, setProject] = useState<DawProject | null>(null);
  const [position, setPosition] = useState<DawPosition>(DEFAULT_POSITION);
  const [viewStartMs, setViewStartMs] = useState(0);
  const [viewWidthMs, setViewWidthMs] = useState(30000);
  const [snapMode, setSnapMode] = useState<SnapMode>('bar');
  const [selectedRegionId, setSelectedRegionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<number | null>(null);
  const timelineRef = useRef<HTMLDivElement>(null);

  const tempo = project?.tempo_bpm ?? 120;
  const timeSignature = project?.time_signature ?? [4, 4];
  const timelineWidth = timelineRef.current?.clientWidth ?? 900;
  const pixelsPerMs = timelineWidth / viewWidthMs;
  const laneHeight = 78;
  const isPlaying = position.mode === 'playing';

  const selectedRegion = useMemo(() => {
    if (!project || !selectedRegionId) return null;
    for (const track of project.tracks) {
      const region = track.regions.find((item) => item.id === selectedRegionId);
      if (region) return region;
    }
    return null;
  }, [project, selectedRegionId]);

  const refreshProject = useCallback(async () => {
    const next = await dawApi.getProject();
    setProject(next);
  }, []);

  useEffect(() => {
    let cancelled = false;
    dawApi
      .init()
      .then(() => dawApi.getProject())
      .then((next) => {
        if (!cancelled) setProject(next);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
      if (pollRef.current !== null) window.clearInterval(pollRef.current);
      dawApi.destroy().catch(() => {});
    };
  }, []);

  useEffect(() => {
    if (pollRef.current !== null) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
    if (isPlaying) {
      pollRef.current = window.setInterval(() => {
        dawApi.getPosition().then(setPosition).catch(() => {});
      }, 1000 / 30);
    }
    return () => {
      if (pollRef.current !== null) window.clearInterval(pollRef.current);
    };
  }, [isPlaying]);

  const handlePlay = useCallback(async () => {
    setPosition(await dawApi.play());
  }, []);

  const handlePause = useCallback(async () => {
    setPosition(await dawApi.pause());
  }, []);

  const handleStop = useCallback(async () => {
    await dawApi.stop();
    setPosition(DEFAULT_POSITION);
  }, []);

  const handleSetTempo = useCallback(
    async (bpm: number) => {
      if (!Number.isFinite(bpm) || bpm <= 0) return;
      await dawApi.setTempo(bpm);
      await refreshProject();
    },
    [refreshProject],
  );

  const handleAddTrack = useCallback(async () => {
    const color = TRACK_COLORS[(project?.tracks.length ?? 0) % TRACK_COLORS.length];
    await dawApi.addTrack('New Track', color);
    await refreshProject();
  }, [project?.tracks.length, refreshProject]);

  const handleWheel = useCallback((event: React.WheelEvent) => {
    if (event.ctrlKey || event.metaKey) {
      event.preventDefault();
      const factor = event.deltaY > 0 ? 1.2 : 0.8;
      setViewWidthMs((prev) => Math.max(5000, Math.min(300000, prev * factor)));
    } else {
      setViewStartMs((prev) => Math.max(0, prev + event.deltaY * 10));
    }
  }, []);

  if (error) {
    return (
      <div className="flex items-center justify-center h-full bg-s3 text-s3-text-primary">
        <div className="text-center max-w-sm">
          <p className="text-sm font-medium mb-1">DAW Engine Error</p>
          <p className="text-xs text-s3-text-muted mb-4 leading-relaxed">{error}</p>
          <button
            onClick={() => {
              setError(null);
              dawApi.init().then(refreshProject).catch((err) => setError(err instanceof Error ? err.message : String(err)));
            }}
            className="ew-btn ew-btn--primary"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

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

  return (
    <div className="flex flex-col h-full overflow-hidden bg-s3 text-s3-text-primary">
      <TransportBar
        position={position}
        tempo={tempo}
        snapMode={snapMode}
        onPlay={handlePlay}
        onPause={handlePause}
        onStop={handleStop}
        onSetTempo={handleSetTempo}
        onUndo={() => dawApi.undo().then(refreshProject).catch(() => {})}
        onRedo={() => dawApi.redo().then(refreshProject).catch(() => {})}
        onSnapMode={setSnapMode}
      />

      <div className="flex flex-1 min-h-0 overflow-hidden" onWheel={handleWheel}>
        <div className="w-[220px] flex-shrink-0 overflow-y-auto border-r border-s3-border scrollbar-hide">
          <div className="h-8 border-b border-s3-border bg-s3-panel flex items-center justify-between px-3 sticky top-0 z-10">
            <span className="text-[9px] font-medium uppercase tracking-widest text-s3-text-muted">Tracks</span>
            <button onClick={handleAddTrack} className="flex items-center gap-1 px-1.5 py-0.5 rounded text-accent-500 hover:bg-accent-500/10" title="Add track">
              <Plus size={11} />
              <span className="text-[9px] font-medium">Add</span>
            </button>
          </div>
          {project.tracks.map((track) => (
            <TrackHeader
              key={track.id}
              track={track}
              onMute={() => dawApi.setTrackMute(track.id, !track.mute).then(refreshProject)}
              onSolo={() => dawApi.setTrackSolo(track.id, !track.solo).then(refreshProject)}
              onVolumeChange={(db) => {
                setProject((prev) =>
                  prev ? { ...prev, tracks: prev.tracks.map((item) => (item.id === track.id ? { ...item, volume_db: db } : item)) } : prev,
                );
                dawApi.setTrackVolume(track.id, db).catch(() => {});
              }}
              onPanChange={(pan) => {
                setProject((prev) =>
                  prev ? { ...prev, tracks: prev.tracks.map((item) => (item.id === track.id ? { ...item, pan } : item)) } : prev,
                );
                dawApi.setTrackPan(track.id, pan).catch(() => {});
              }}
              onRemove={() => dawApi.removeTrack(track.id).then(refreshProject)}
            />
          ))}
          {project.tracks.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 gap-4">
              <div className="w-14 h-14 rounded border border-accent-500/10 bg-accent-500/5 flex items-center justify-center">
                <Music2 size={22} className="text-accent-500/60" />
              </div>
              <p className="text-xs text-s3-text-muted/70">Timeline empty</p>
            </div>
          )}
        </div>

        <div ref={timelineRef} className="flex-1 overflow-hidden relative">
          <BarRuler
            tempo={tempo}
            timeSignature={timeSignature}
            viewStartMs={viewStartMs}
            viewWidthMs={viewWidthMs}
            pixelsPerMs={pixelsPerMs}
          />
          <div className="overflow-y-auto" style={{ height: 'calc(100% - 32px)' }}>
            {project.tracks.map((track) => (
              <TimelineLane
                key={track.id}
                track={track}
                pixelsPerMs={pixelsPerMs}
                viewStartMs={viewStartMs}
                laneHeight={laneHeight}
                selectedRegionId={selectedRegionId}
                onSelectRegion={setSelectedRegionId}
              />
            ))}
            {project.tracks.length === 0 && (
              <div className="flex items-center justify-center h-full min-h-[220px]">
                <p className="text-xs text-s3-text-muted/50">No tracks</p>
              </div>
            )}
          </div>
          <Playhead positionMs={position.position_ms} viewStartMs={viewStartMs} pixelsPerMs={pixelsPerMs} />
        </div>
      </div>

      <RiffBankPanel project={project} selectedRegion={selectedRegion} />

      <div className="flex items-center justify-between px-4 h-7 bg-s3-panel border-t border-s3-border text-[9px] font-mono text-s3-text-muted flex-shrink-0 tabular-nums select-none">
        <span className="font-sans font-medium">{project.name}</span>
        <div className="flex items-center gap-4">
          <span>{project.tracks.length} track{project.tracks.length === 1 ? '' : 's'}</span>
          <span className="w-px h-3 bg-s3-border" />
          <span>{tempo.toFixed(0)} BPM</span>
          <span className="w-px h-3 bg-s3-border" />
          <span>{timeSignature[0]}/{timeSignature[1]}</span>
          <span className="w-px h-3 bg-s3-border" />
          <span>View {(viewWidthMs / 1000).toFixed(0)}s</span>
        </div>
      </div>
    </div>
  );
}
