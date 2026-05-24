// @ts-nocheck
/**
 * CompletePanel — Track extension/continuation interface.
 *
 * Allows users to extend a track beyond its current duration by generating
 * complementary accompaniment stems.
 */
import React, { useState } from "react";
import { ArrowRight, Loader2, Play } from "lucide-react";
import { studioApi, TRACK_NAMES, type TrackName, type GenerationJob } from "../../services/api";
import { useAuth } from "../../context/AuthContext";

interface CompletePanelProps {
  sourceAudioUrl: string;
  duration: number;
  trackTitle?: string;
  style?: string;
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function CompletePanel(props: CompletePanelProps) {
  const { token } = useAuth();
  const [extendBy, setExtendBy] = useState(30);
  const [style, setStyle] = useState(props.style || "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<GenerationJob | null>(null);

  const newDuration = props.duration + extendBy;

  const handleExtend = async () => {
    if (!token) {
      setError("Not authenticated");
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
      // Use first 8 generic track slots for completion
      const trackClasses = [...TRACK_NAMES.slice(0, 8)] as TrackName[];

      const job = await studioApi.complete(
        {
          sourceAudioUrl: props.sourceAudioUrl,
          trackClasses,
          style: style.trim(),
          duration: newDuration,
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
      const message = err instanceof Error ? err.message : "Failed to extend track";
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col gap-6 p-6 h-full overflow-y-auto bg-zinc-900 text-zinc-50">
      {/* Header */}
      <div className="flex items-center gap-3">
        <ArrowRight className="w-6 h-6 text-blue-400" />
        <h2 className="text-xl font-bold">Extend Track</h2>
      </div>
      <p className="max-w-3xl text-sm text-zinc-400">
        Generate continuation audio in the same musical direction. Set how
        much longer you want the idea to become, describe the continuation
        style, then audition and download the generated continuation.
      </p>

      {/* Current Track Info */}
      <div className="space-y-2 p-4 rounded-lg bg-zinc-800 border border-zinc-700">
        {props.trackTitle && (
          <div className="text-sm text-zinc-400">
            <span className="font-semibold">Title:</span> {props.trackTitle}
          </div>
        )}
        <div className="text-sm text-zinc-400">
          <span className="font-semibold">Currently:</span> {formatTime(props.duration)}
        </div>
      </div>

      {/* Waveform Representation */}
      <div className="space-y-2">
        <label className="block text-sm font-semibold text-zinc-300">Duration Visualization</label>
        <div className="flex items-center gap-2 p-4 rounded-lg bg-zinc-800 border border-zinc-700">
          {/* Current track (filled) */}
          <div
            className="h-8 bg-blue-500 rounded transition-all"
            style={{
              width: `${(props.duration / newDuration) * 100}%`,
              minWidth: "20px",
            }}
            title={`Current: ${formatTime(props.duration)}`}
          />
          {/* Extension (dotted pattern) */}
          <div
            className="h-8 rounded opacity-60 transition-all"
            style={{
              width: `${(extendBy / newDuration) * 100}%`,
              minWidth: "20px",
              background: "repeating-linear-gradient(90deg, #3B82F6 0px, #3B82F6 8px, transparent 8px, transparent 16px)",
            }}
            title={`Extension: ${formatTime(extendBy)}`}
          />
        </div>
      </div>

      {/* Controls */}
      <div className="space-y-4">
        {/* Extend By Input */}
        <div>
          <label className="block text-sm font-semibold text-zinc-300 mb-2">
            Extend by (seconds)
          </label>
          <input
            type="number"
            min="10"
            max="120"
            value={extendBy}
            onChange={(e) => setExtendBy(Math.max(10, Math.min(120, parseInt(e.target.value) || 0)))}
            className="w-full px-4 py-2 bg-zinc-800 border border-zinc-600 rounded-lg text-zinc-50 placeholder-zinc-500 focus:outline-none focus:border-blue-500"
          />
          <span className="text-xs text-zinc-500 mt-1 block">Range: 10–120 seconds</span>
        </div>

        {/* Total Duration Display */}
        <div className="p-3 rounded-lg bg-blue-900 bg-opacity-30 border border-blue-700">
          <div className="text-sm text-blue-300">
            <span className="font-semibold">New total:</span> {formatTime(newDuration)}
          </div>
        </div>

        {/* Style Input */}
        <div>
          <label className="block text-sm font-semibold text-zinc-300 mb-2">Style</label>
          <input
            type="text"
            value={style}
            onChange={(e) => setStyle(e.target.value)}
            placeholder="e.g., 'orchestral', 'electronic', 'acoustic'"
            className="w-full px-4 py-2 bg-zinc-800 border border-zinc-600 rounded-lg text-zinc-50 placeholder-zinc-500 focus:outline-none focus:border-blue-500"
          />
        </div>
      </div>

      {/* Error Display */}
      {error && (
        <div className="p-3 rounded-lg bg-red-900 bg-opacity-30 border border-red-700 text-red-200 text-sm">
          {error}
        </div>
      )}

      {/* Extend Button */}
      <button
        onClick={handleExtend}
        disabled={loading}
        title="Generate a continuation using the current track and style prompt"
        className={`flex items-center justify-center gap-2 px-6 py-3 rounded-lg font-semibold transition-all ${
          loading
            ? "bg-zinc-700 text-zinc-400 cursor-not-allowed"
            : "bg-blue-600 hover:bg-blue-700 text-white"
        }`}
      >
        {loading && <Loader2 className="w-5 h-5 animate-spin" />}
        {loading ? "Extending..." : "Extend"}
      </button>

      {/* Result Section */}
      {result && (
        <div className="space-y-4 p-4 rounded-lg bg-green-900 bg-opacity-20 border border-green-700">
          <h3 className="font-semibold text-green-300">
            {result.status === "succeeded" ? "Extension Complete!" : "Generation Failed"}
          </h3>
          {result.status === "succeeded" && result.result?.audioUrls && (
            <div className="space-y-3">
              {result.result.audioUrls.map((url, idx) => (
                <div key={idx} className="space-y-2">
                  <div className="text-sm text-green-300">
                    Generated continuation {idx + 1}
                    {result.result?.duration && ` · audio ${formatTime(result.result.duration)}`}
                    {` · requested total ${formatTime(newDuration)}`}
                  </div>
                  <div className="flex items-center gap-3">
                    <audio
                      src={url}
                      controls
                      className="flex-1"
                    />
                    <button
                      onClick={() => {
                        const a = document.createElement("a");
                        a.href = url;
                        a.download = `extended-${idx}.mp3`;
                        a.click();
                      }}
                      className="px-3 py-1 bg-green-700 hover:bg-green-600 rounded text-sm text-white whitespace-nowrap"
                    >
                      Download continuation
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
          {result.status === "failed" && (
            <p className="text-red-300 text-sm">{result.error || "Unknown error"}</p>
          )}
        </div>
      )}
    </div>
  );
}
