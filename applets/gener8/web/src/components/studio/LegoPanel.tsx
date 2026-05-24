// @ts-nocheck
/**
 * LegoPanel — Visual block editor for stem recombination.
 *
 * Allows users to select which stems to include in a remix and regenerate
 * them with a new style prompt.
 */
import React, { useState } from "react";
import { Blocks, Loader2 } from "lucide-react";
import { studioApi, TRACK_NAMES, type TrackName, type GenerationJob } from "../../services/api";
import { useAuth } from "../../context/AuthContext";

interface LegoPanelProps {
  stems: Record<TrackName, string | null>;
  sourceAudioUrl: string;
  duration: number;
  trackTitle?: string;
}

// Color + label mapping for ACE-Step's 12 canonical stem classes.
const _LEGO_COLORS = [
  "#F472B6", "#FB923C", "#A78BFA", "#34D399",
  "#60A5FA", "#FBBF24", "#F87171", "#2DD4BF",
  "#C084FC", "#FB7185", "#E879F9", "#94A3B8",
];

const _LEGO_LABELS: Record<TrackName, string> = {
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

const STEM_COLORS: Record<TrackName, string> = Object.fromEntries(
  TRACK_NAMES.map((id, i) => [id, _LEGO_COLORS[i] || '#94A3B8'])
) as Record<TrackName, string>;

const STEM_LABELS: Record<TrackName, string> = Object.fromEntries(
  TRACK_NAMES.map((id) => [id, _LEGO_LABELS[id]])
) as Record<TrackName, string>;

export function LegoPanel(props: LegoPanelProps) {
  const { token } = useAuth();
  const [selectedStems, setSelectedStems] = useState<Set<TrackName>>(
    new Set(TRACK_NAMES.filter(t => props.stems[t] !== null))
  );
  const [style, setStyle] = useState("");
  const [duration, setDuration] = useState(props.duration);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<GenerationJob | null>(null);

  const handleToggleStem = (trackName: TrackName) => {
    const newSelected = new Set(selectedStems);
    if (newSelected.has(trackName)) {
      newSelected.delete(trackName);
    } else {
      newSelected.add(trackName);
    }
    setSelectedStems(newSelected);
  };

  const handleRemix = async () => {
    if (!token) {
      setError("Not authenticated");
      return;
    }

    if (selectedStems.size === 0) {
      setError("Please select at least one stem");
      return;
    }

    if (!style.trim()) {
      setError("Please enter a style");
      return;
    }

    setError(null);
    setLoading(true);
    setResult(null);

    try {
      // Generate remix for the first selected stem as proof of concept
      // In a full implementation, you might handle multiple stems differently
      const firstTrack = Array.from(selectedStems)[0];

      const job = await studioApi.legoRegenerate(
        {
          sourceAudioUrl: props.sourceAudioUrl,
          trackName: firstTrack,
          style: style.trim(),
          duration,
        },
        token
      );

      // Poll for completion
      const finalJob = await studioApi.pollJob(job.jobId, token);
      setResult(finalJob);

      if (finalJob.status === "failed") {
        setError(finalJob.error || "Generation failed");
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to generate remix";
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col gap-6 p-6 h-full overflow-y-auto bg-zinc-900 text-zinc-50">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Blocks className="w-6 h-6 text-purple-400" />
        <h2 className="text-xl font-bold">Lego Remix</h2>
      </div>
      <p className="max-w-3xl text-sm text-zinc-400">
        Pick the extracted stem slots you want to keep, describe the new style,
        then Remix to regenerate a new variation from the selected stem set.
      </p>

      {/* Stem Grid */}
      <div className="space-y-4">
        <label className="block text-sm font-semibold text-zinc-300">Select Stems</label>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {TRACK_NAMES.map((trackName) => {
            const hasAudio = props.stems[trackName] !== null;
            const isSelected = selectedStems.has(trackName);
            const color = STEM_COLORS[trackName];

            return (
              <button
                key={trackName}
                onClick={() => hasAudio && handleToggleStem(trackName)}
                disabled={!hasAudio}
                title={hasAudio ? `${STEM_LABELS[trackName]} included in the remix` : `${STEM_LABELS[trackName]} has no extracted audio yet`}
                aria-label={`${STEM_LABELS[trackName]} ${hasAudio ? (isSelected ? 'selected' : 'not selected') : 'unavailable'}`}
                className={`relative p-4 rounded-lg border-2 transition-all ${
                  !hasAudio
                    ? "border-zinc-700 bg-zinc-800 opacity-50 cursor-not-allowed"
                    : isSelected
                      ? "border-purple-500 bg-purple-900 bg-opacity-30"
                      : "border-zinc-600 bg-zinc-800 hover:border-zinc-500"
                }`}
              >
                {/* Color indicator */}
                <div
                  className="absolute top-2 right-2 w-3 h-3 rounded-full"
                  style={{ backgroundColor: color }}
                />

                {/* Checkbox */}
                <div className="mb-2 flex items-center">
                  <input
                    type="checkbox"
                    checked={isSelected && hasAudio}
                    onChange={() => handleToggleStem(trackName)}
                    disabled={!hasAudio}
                    className="w-4 h-4 accent-purple-500"
                  />
                </div>

                {/* Label */}
                <div className="text-sm font-medium text-left">{STEM_LABELS[trackName]}</div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Controls */}
      <div className="space-y-4">
        {/* Style Input */}
        <div>
          <label className="block text-sm font-semibold text-zinc-300 mb-2">New Style</label>
          <input
            type="text"
            value={style}
            onChange={(e) => setStyle(e.target.value)}
            placeholder="e.g., 'jazz fusion', 'ambient', 'hip-hop'"
            className="w-full px-4 py-2 bg-zinc-800 border border-zinc-600 rounded-lg text-zinc-50 placeholder-zinc-500 focus:outline-none focus:border-purple-500"
          />
        </div>

        {/* Duration Slider */}
        <div>
          <label className="block text-sm font-semibold text-zinc-300 mb-2">
            Duration: {duration}s (Range: 10-300s)
          </label>
          <input
            type="range"
            min="10"
            max="300"
            value={duration}
            onChange={(e) => setDuration(parseInt(e.target.value))}
            className="w-full accent-purple-500"
          />
        </div>
      </div>

      {/* Error Display */}
      {error && (
        <div className="p-3 rounded-lg bg-red-900 bg-opacity-30 border border-red-700 text-red-200 text-sm">
          {error}
        </div>
      )}

      {/* Remix Button */}
      <button
        onClick={handleRemix}
        disabled={loading || selectedStems.size === 0}
        title="Regenerate a remix using the selected stems and the style prompt"
        className={`flex items-center justify-center gap-2 px-6 py-3 rounded-lg font-semibold transition-all ${
          loading || selectedStems.size === 0
            ? "bg-zinc-700 text-zinc-400 cursor-not-allowed"
            : "bg-purple-600 hover:bg-purple-700 text-white"
        }`}
      >
        {loading && <Loader2 className="w-5 h-5 animate-spin" />}
        {loading ? "Remixing..." : "Remix"}
      </button>

      {/* Result Section */}
      {result && (
        <div className="space-y-4 p-4 rounded-lg bg-green-900 bg-opacity-20 border border-green-700">
          <h3 className="font-semibold text-green-300">Remix Complete!</h3>
          {result.status === "succeeded" && result.result?.audioUrls && (
            <div className="space-y-3">
              {result.result.audioUrls.map((url, idx) => (
                <div key={idx} className="flex items-center gap-3">
                  <audio
                    src={url}
                    controls
                    className="flex-1"
                  />
                  <button
                    onClick={() => {
                      const a = document.createElement("a");
                      a.href = url;
                      a.download = `remix-${idx}.mp3`;
                      a.click();
                    }}
                    className="px-3 py-1 bg-green-700 hover:bg-green-600 rounded text-sm text-white"
                  >
                    Download
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
