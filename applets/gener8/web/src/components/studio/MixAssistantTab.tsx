import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Bot,
  Camera,
  CheckCircle2,
  GitCompare,
  MessageSquareText,
  RefreshCcw,
  Send,
  Settings,
  SlidersHorizontal,
  Sparkles,
  AudioWaveform,
} from "lucide-react";
import type { TrackName } from "../../services/api";
import { TRACK_NAMES } from "../../services/api";
import {
  analyseDawMix,
  type MixAnalysisResult,
  type MixChannelType,
} from "./mixAnalysis";

interface MixAssistantTabProps {
  stems?: Record<TrackName, string | null> | null;
  sourceAudioUrl?: string | null;
  trackTitle?: string;
  bpm?: number;
  keySignature?: string;
}

const CHANNELS: Array<{ value: MixChannelType; label: string }> = [
  { value: "mix_bus", label: "Mix Bus" },
  { value: "lead_vocal", label: "Lead Vocal" },
  { value: "drums", label: "Drums" },
  { value: "bass", label: "Bass" },
  { value: "instruments", label: "Instruments" },
];

const GENRES = ["Pop", "Hip-hop", "R&B", "EDM", "Rock", "Afrobeat", "Drill", "Lo-fi"];

const BAND_LABELS = ["Sub", "Bass", "Low Mid", "Mid", "Presence", "Bite", "Air", "Shine"];

function fmtDb(value: number): string {
  return `${value.toFixed(1)} dB`;
}

function fmtLufs(value: number): string {
  return `${value.toFixed(1)} LUFS`;
}

function stemLabel(trackName: TrackName): string {
  return trackName.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function MetricCell({ label, value, tone }: { label: string; value: string; tone?: "warn" | "good" }) {
  return (
    <div className="min-w-0 border-l px-3 py-2" style={{ borderColor: "rgba(148,163,184,0.16)" }}>
      <div
        className="text-[9px] font-bold uppercase tracking-wider"
        style={{ color: tone === "warn" ? "#fbbf24" : tone === "good" ? "#34d399" : "#6b7280" }}
      >
        {label}
      </div>
      <div className="mt-1 truncate text-[11px] font-mono font-bold text-white">{value}</div>
    </div>
  );
}

function ParticleVisualiser({ analysis }: { analysis: MixAnalysisResult | null }) {
  const particles = useMemo(() => Array.from({ length: 180 }, (_, i) => {
    const angle = i * 2.399963;
    const ring = Math.sqrt((i + 0.5) / 180);
    return { angle, ring, size: 1 + ((i * 17) % 5) * 0.5 };
  }), []);

  const energy = analysis ? Math.max(0.12, Math.min(1, (analysis.integratedLufs + 28) / 22)) : 0.35;
  const width = analysis ? Math.max(0.35, analysis.width) : 0.7;
  const crest = analysis ? Math.max(0.5, Math.min(1.8, analysis.crestDb / 10)) : 1;

  return (
    <div className="relative flex-1 overflow-hidden" style={{ background: "radial-gradient(circle at center, rgba(8,145,178,0.09), transparent 42%)" }}>
      <div className="absolute inset-0 opacity-30" style={{ backgroundImage: "linear-gradient(rgba(34,211,238,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(34,211,238,0.04) 1px, transparent 1px)", backgroundSize: "34px 34px" }} />
      <div className="absolute left-1/2 top-1/2 h-[430px] w-[430px] -translate-x-1/2 -translate-y-1/2">
        {particles.map((p, i) => {
          const wobble = Math.sin(i * 1.71 + energy * 3) * 10;
          const rx = 42 + p.ring * 150 * width + wobble;
          const ry = 38 + p.ring * 138 * crest;
          const x = 215 + Math.cos(p.angle) * rx;
          const y = 215 + Math.sin(p.angle) * ry;
          const opacity = 0.18 + p.ring * 0.65 + energy * 0.18;
          return (
            <span
              key={i}
              className="absolute rounded-full"
              style={{
                left: x,
                top: y,
                width: p.size,
                height: p.size,
                opacity,
                background: i % 7 === 0 ? "#a78bfa" : "#22d3ee",
                boxShadow: "0 0 10px rgba(34,211,238,0.75)",
              }}
            />
          );
        })}
        <div
          className="absolute left-1/2 top-1/2 h-32 w-32 -translate-x-1/2 -translate-y-1/2 rounded-full"
          style={{
            background: "radial-gradient(circle, rgba(45,212,191,0.95), rgba(34,211,238,0.22) 54%, transparent 72%)",
            filter: "blur(0.2px)",
            opacity: 0.35 + energy * 0.45,
          }}
        />
      </div>
      <div className="absolute bottom-4 left-5 right-5">
        <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-wider" style={{ color: "#22d3ee" }}>
          <span>Meters</span>
          <span>{analysis ? `${analysis.activeStems.length} stems analysed` : "Waiting for audio"}</span>
        </div>
      </div>
    </div>
  );
}

function SpectrumCurve({ values }: { values: number[] }) {
  const points = values.length
    ? values.map((value, i) => `${(i / Math.max(1, values.length - 1)) * 100},${52 - value * 42}`).join(" ")
    : "0,44 15,36 30,42 45,28 60,34 75,30 90,38 100,35";

  return (
    <div className="rounded border p-2" style={{ borderColor: "rgba(148,163,184,0.14)", background: "rgba(15,23,42,0.55)" }}>
      <svg viewBox="0 0 100 58" className="h-24 w-full overflow-visible">
        <polyline points={points} fill="none" stroke="#22d3ee" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        <polyline points={`${points} 100,58 0,58`} fill="rgba(34,211,238,0.12)" stroke="none" />
      </svg>
      <div className="grid grid-cols-4 gap-1 text-[9px]" style={{ color: "#64748b" }}>
        {BAND_LABELS.map((label) => <span key={label} className="truncate">{label}</span>)}
      </div>
    </div>
  );
}

function makeSourceStems(sourceAudioUrl: string | null | undefined): Record<TrackName, string | null> | null {
  if (!sourceAudioUrl) return null;
  return TRACK_NAMES.reduce((acc, trackName) => {
    acc[trackName] = trackName === "vocals" ? sourceAudioUrl : null;
    return acc;
  }, {} as Record<TrackName, string | null>);
}

export default function MixAssistantTab({ stems, sourceAudioUrl, trackTitle, bpm, keySignature }: MixAssistantTabProps) {
  const [channelType, setChannelType] = useState<MixChannelType>("mix_bus");
  const [genre, setGenre] = useState("Pop");
  const [analysis, setAnalysis] = useState<MixAnalysisResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [question, setQuestion] = useState("");
  const [extraReplies, setExtraReplies] = useState<string[]>([]);

  const analysisStems = useMemo(() => stems ?? makeSourceStems(sourceAudioUrl), [sourceAudioUrl, stems]);
  const realStemCount = useMemo(() => (
    analysisStems ? TRACK_NAMES.filter((track) => analysisStems[track] && analysisStems[track] !== "simulated").length : 0
  ), [analysisStems]);

  const runAnalysis = useCallback(async () => {
    if (!analysisStems || realStemCount === 0) {
      setError("Load audio first, then this panel can read the real signal.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await analyseDawMix(analysisStems, { channelType, genre });
      setAnalysis(result);
      setExtraReplies([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [analysisStems, channelType, genre, realStemCount]);

  useEffect(() => {
    if (realStemCount > 0) void runAnalysis();
  }, [realStemCount]);

  const askFollowUp = useCallback(() => {
    const prompt = question.trim();
    if (!prompt || !analysis) return;
    const response = prompt.toLowerCase().includes("chain") || prompt.toLowerCase().includes("plugin")
      ? `Try a clean corrective chain: EQ first, 1-2 dB where the spectrum is heavy, then compression catching 1-3 dB, then a limiter ceiling around -1.0 dBTP. Current crest is ${analysis.crestDb.toFixed(1)} dB, so avoid crushing it unless the genre needs density.`
      : `Based on the current meter snapshot, I would prioritise ${analysis.feedback[1] || analysis.summary}`;
    setExtraReplies((prev) => [...prev, response]);
    setQuestion("");
  }, [analysis, question]);

  return (
    <div className="h-full min-h-0 flex flex-col text-white" style={{ background: "#06080d" }}>
      <div className="h-12 shrink-0 flex items-center gap-3 border-b px-4" style={{ borderColor: "rgba(148,163,184,0.14)", background: "rgba(10,13,20,0.94)" }}>
        <div className="flex items-center gap-2">
          <AudioWaveform size={18} className="text-cyan-300" />
          <div>
            <div className="text-lg font-black leading-none tracking-tight">S3 MixLens</div>
            <div className="text-[9px] font-bold uppercase tracking-wider text-cyan-300/70">Metered AI feedback</div>
          </div>
        </div>
        <select className="h-8 rounded border px-3 text-xs font-bold" style={{ background: "#121827", borderColor: "rgba(148,163,184,0.22)" }} value={channelType} onChange={(e) => setChannelType(e.target.value as MixChannelType)}>
          {CHANNELS.map((channel) => <option key={channel.value} value={channel.value}>{channel.label}</option>)}
        </select>
        <select className="h-8 rounded border px-3 text-xs font-bold" style={{ background: "#121827", borderColor: "rgba(148,163,184,0.22)" }} value={genre} onChange={(e) => setGenre(e.target.value)}>
          {GENRES.map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
        <button className="h-8 rounded border px-3 text-xs font-bold text-cyan-200" style={{ borderColor: "rgba(34,211,238,0.28)", background: "rgba(34,211,238,0.08)" }} onClick={() => void runAnalysis()} disabled={loading}>
          <RefreshCcw size={13} className="mr-1 inline" /> {loading ? "Analysing" : "Capture"}
        </button>
        <button className="h-8 rounded border px-3 text-xs font-bold text-white/60" style={{ borderColor: "rgba(148,163,184,0.18)", background: "rgba(15,23,42,0.6)" }}>
          <GitCompare size={13} className="mr-1 inline" /> Compare
        </button>
        <button className="h-8 rounded border px-3 text-xs font-bold text-white/60" style={{ borderColor: "rgba(148,163,184,0.18)", background: "rgba(15,23,42,0.6)" }}>
          <Settings size={13} className="mr-1 inline" /> Settings
        </button>
        <div className="ml-auto min-w-0 text-right">
          <div className="truncate text-xs font-bold text-white/80">{trackTitle || "Untitled mix"}</div>
          <div className="text-[10px] text-white/35">{bpm ? `${bpm} BPM` : "BPM pending"} {keySignature ? `· ${keySignature}` : ""}</div>
        </div>
      </div>

      <div className="flex-1 min-h-0 flex">
        <main className="min-w-0 flex-1 flex flex-col border-r" style={{ borderColor: "rgba(148,163,184,0.14)" }}>
          <ParticleVisualiser analysis={analysis} />
          <div className="grid grid-cols-8 border-t" style={{ borderColor: "rgba(148,163,184,0.14)", background: "rgba(8,11,18,0.96)" }}>
            <MetricCell label="INT" value={analysis ? fmtLufs(analysis.integratedLufs) : "--"} tone={analysis && analysis.integratedLufs > -8 ? "warn" : undefined} />
            <MetricCell label="ST" value={analysis ? fmtLufs(analysis.shortTermLufs) : "--"} />
            <MetricCell label="MOM" value={analysis ? fmtLufs(analysis.momentaryLufs) : "--"} />
            <MetricCell label="LRA" value={analysis ? `${analysis.loudnessRange.toFixed(1)} LU` : "--"} />
            <MetricCell label="TP" value={analysis ? fmtDb(analysis.truePeakDb) : "--"} tone={analysis && analysis.truePeakDb > -1 ? "warn" : undefined} />
            <MetricCell label="CORR" value={analysis ? analysis.correlation.toFixed(2) : "--"} tone={analysis && analysis.correlation > 0.25 ? "good" : "warn"} />
            <MetricCell label="WIDTH" value={analysis ? analysis.width.toFixed(2) : "--"} />
            <MetricCell label="CREST" value={analysis ? fmtDb(analysis.crestDb) : "--"} />
          </div>
        </main>

        <aside className="w-[360px] shrink-0 flex flex-col" style={{ background: "rgba(9,12,22,0.98)" }}>
          <div className="h-10 shrink-0 flex items-center justify-between border-b px-4" style={{ borderColor: "rgba(148,163,184,0.14)" }}>
            <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-white/55">
              <Bot size={14} className="text-cyan-300" /> AI Assistant
            </div>
            <span className="text-[10px] text-white/30">{analysis ? `${analysis.feedback.length}/5` : "0/5"}</span>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-4 space-y-3">
            <div className="rounded-xl border p-3" style={{ borderColor: "rgba(34,211,238,0.16)", background: "rgba(15,23,42,0.72)" }}>
              <div className="flex items-center gap-2 text-xs font-bold text-white">
                <Camera size={14} className="text-cyan-300" /> Analyse this {CHANNELS.find((item) => item.value === channelType)?.label.toLowerCase()}
              </div>
              <div className="mt-2 h-8 rounded bg-black/30 px-2 flex items-center gap-2">
                <span className="h-5 w-5 rounded-full bg-cyan-400/20 flex items-center justify-center text-cyan-200"><Sparkles size={11} /></span>
                <div className="h-px flex-1 bg-cyan-300/50" />
              </div>
            </div>

            {error && (
              <div className="rounded-lg border border-amber-400/25 bg-amber-400/10 p-3 text-xs text-amber-100">{error}</div>
            )}

            {analysis ? (
              <>
                <div className="flex gap-2">
                  <div className="mt-1 h-7 w-7 shrink-0 rounded-full bg-cyan-400/20 flex items-center justify-center text-cyan-200">S3</div>
                  <div className="rounded-xl p-3 text-xs leading-relaxed text-white/72" style={{ background: "rgba(30,41,59,0.78)" }}>
                    {analysis.summary}
                  </div>
                </div>
                {analysis.feedback.slice(1).map((item, index) => (
                  <div key={index} className="flex gap-2">
                    <CheckCircle2 size={16} className="mt-1 shrink-0 text-cyan-300" />
                    <div className="rounded-xl p-3 text-xs leading-relaxed text-white/68" style={{ background: "rgba(15,23,42,0.65)" }}>{item}</div>
                  </div>
                ))}
                {extraReplies.map((item, index) => (
                  <div key={`reply-${index}`} className="flex gap-2">
                    <MessageSquareText size={16} className="mt-1 shrink-0 text-fuchsia-300" />
                    <div className="rounded-xl p-3 text-xs leading-relaxed text-white/68" style={{ background: "rgba(30,20,45,0.65)" }}>{item}</div>
                  </div>
                ))}
                <section>
                  <div className="mb-2 flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-white/45">
                    <SlidersHorizontal size={13} /> Spectrum
                  </div>
                  <SpectrumCurve values={analysis.spectrum} />
                </section>
                <section>
                  <div className="mb-2 text-[10px] font-bold uppercase tracking-wider text-white/45">Active stems</div>
                  <div className="flex flex-wrap gap-1">
                    {analysis.activeStems.map((stem) => (
                      <span key={stem} className="rounded border px-2 py-1 text-[10px] text-white/55" style={{ borderColor: "rgba(148,163,184,0.16)", background: "rgba(255,255,255,0.03)" }}>
                        {stemLabel(stem)}
                      </span>
                    ))}
                  </div>
                </section>
              </>
            ) : (
              <div className="h-full flex items-center justify-center text-center text-xs text-white/35 px-8">
                Load audio, then capture a meter snapshot for AI-style mix feedback.
              </div>
            )}
          </div>

          <div className="shrink-0 border-t p-3" style={{ borderColor: "rgba(148,163,184,0.14)" }}>
            <div className="flex gap-2">
              <input
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") askFollowUp(); }}
                placeholder="Ask about your mix..."
                className="min-w-0 flex-1 rounded-lg border px-3 py-2 text-xs text-white outline-none"
                style={{ background: "#111827", borderColor: "rgba(148,163,184,0.2)" }}
              />
              <button
                className="w-12 rounded-lg border text-cyan-200 disabled:opacity-35"
                style={{ background: "rgba(34,211,238,0.09)", borderColor: "rgba(34,211,238,0.24)" }}
                disabled={!analysis || !question.trim()}
                onClick={askFollowUp}
                title="Ask follow-up"
              >
                <Send size={15} className="mx-auto" />
              </button>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
