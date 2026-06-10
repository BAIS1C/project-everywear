/**
 * S3 Vid -- Standalone applet view wrapping the VideoGeneratorModal.
 * Ported from s3studio-web/src/shell/VidApp.tsx into Gener8 as a route view.
 *
 * Handoff-first Vid surface. A song arrives from Gener8 intentBus, or the
 * user opens a Vault picker. No persistent song sidebar in shell.
 */
import React, { useState, useEffect, useRef } from "react";
import { VideoGeneratorModal } from "../components/VideoGeneratorModal";
import { Music, Film, Sparkles, Loader2 } from "lucide-react";
import type { Song } from "../types";
import { intentBus } from "../context/intentBus";
import { useSongStore, readHasSongsHint } from "../context/SongStoreContext";

export default function VidView() {
  const { songs, isLoading, hasLoaded } = useSongStore();
  const [selectedSong, setSelectedSong] = useState<Song | null>(null);
  const [activeTab, setActiveTab] = useState<
    "visualiser" | "ai-video" | "storyboard"
  >("visualiser");
  const [pickerOpen, setPickerOpen] = useState(false);
  const hadSongsHintRef = useRef(readHasSongsHint());

  // Listen for cross-app intents (e.g., camera button from Gener8 Create)
  useEffect(() => {
    const unsub = intentBus.subscribe("vid", (intent) => {
      if (intent.action === "open-with-song" && intent.payload?.songId) {
        const song = songs.find((s) => s.id === intent.payload!.songId);
        if (song) {
          setSelectedSong(song);
          setActiveTab("visualiser");
        }
      }
    });
    return unsub;
  }, [songs]);

  const selectSong = (song: Song) => {
    setSelectedSong(song);
    setActiveTab("visualiser");
    setPickerOpen(false);
  };

  return (
    <div className="s3-family-route flex h-full bg-s3 text-[color:var(--ew-text)]">
      {/* -- Main Content ------------------------------------------------- */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Tab bar */}
        <div className="flex items-center justify-between border-b border-[color:var(--ew-border)] px-4 shrink-0 bg-s3-panel ew-v2-bevel">
          <div className="flex">
            <button
              onClick={() => setActiveTab("visualiser")}
              className={`px-4 py-2.5 text-xs font-semibold border-b-2 transition-colors ${
                activeTab === "visualiser"
                  ? "text-[color:var(--ew-primary)] border-accent-500"
                  : "text-[color:var(--ew-text-muted)] border-transparent hover:text-[color:var(--ew-text)]"
              }`}
            >
              <span className="flex items-center gap-1.5">
                <Film size={12} />
                Visualiser
              </span>
            </button>
            <button
              onClick={() => setActiveTab("ai-video")}
              className={`px-4 py-2.5 text-xs font-semibold border-b-2 transition-colors ${
                activeTab === "ai-video"
                  ? "text-[color:var(--ew-primary)] border-accent-500"
                  : "text-[color:var(--ew-text-muted)] border-transparent hover:text-[color:var(--ew-text)]"
              }`}
            >
              <span className="flex items-center gap-1.5">
                <Sparkles size={12} className="text-accent-400" />
                AI Video
                <span className="text-[8px] bg-accent-500/20 text-accent-400 px-1 rounded font-bold uppercase">
                  Soon
                </span>
              </span>
            </button>
            <button
              onClick={() => setActiveTab("storyboard")}
              className={`px-4 py-2.5 text-xs font-semibold border-b-2 transition-colors ${
                activeTab === "storyboard"
                  ? "text-[color:var(--ew-primary)] border-accent-500"
                  : "text-[color:var(--ew-text-muted)] border-transparent hover:text-[color:var(--ew-text)]"
              }`}
            >
              <span className="flex items-center gap-1.5">
                <Sparkles size={12} className="text-accent-400" />
                Storyboard
                <span className="text-[8px] bg-accent-500/20 text-accent-400 px-1 rounded font-bold uppercase">
                  Soon
                </span>
              </span>
            </button>
          </div>
          <button
            type="button"
            data-tour="vid.vault-picker"
            onClick={() => setPickerOpen(true)}
            className="ew-btn ew-btn--secondary h-8 px-3 text-xs"
          >
            <Music size={13} />
            Load from Vault
          </button>
        </div>

        {/* Content area */}
        <div className="flex-1 overflow-auto">
          {activeTab === "visualiser" &&
            (selectedSong ? (
              <VideoGeneratorModal
                isOpen={true}
                onClose={() => {}}
                song={selectedSong}
                embedded={true}
              />
            ) : (
              <div className="flex items-center justify-center h-full">
                <div className="text-center">
                  <Film
                    size={40}
                    className="mx-auto mb-3 text-[color:var(--ew-text-faint)]"
                  />
                  <p className="text-sm text-[color:var(--ew-text-faint)] font-medium">
                    Open a track to create a video
                  </p>
                  <button
                    type="button"
                    onClick={() => setPickerOpen(true)}
                    className="ew-btn ew-btn--primary mt-4"
                  >
                    <Music size={14} />
                    Load from Vault
                  </button>
                </div>
              </div>
            ))}

          {activeTab === "ai-video" && (
            <div className="flex items-center justify-center h-full px-8">
              <div className="ew-card ew-v2-bevel max-w-md text-center">
                <div className="w-16 h-16 ew-v2-recessed flex items-center justify-center mx-auto mb-4">
                  <Sparkles size={28} className="text-accent-400" />
                </div>
                <h2 className="text-lg font-bold text-[color:var(--ew-text)] mb-2">
                  AI Video Generation
                </h2>
                <p className="text-sm text-[color:var(--ew-text-muted)] leading-relaxed mb-4">
                  Coming with S3 Vid Pro. Generate beat-synced AI video from
                  your tracks using Wan 2.2, AnimateDiff, and CogVideoX, all
                  running on your local GPU.
                </p>
                <div className="space-y-2 text-left mb-6">
                  {[
                    "AI keyframe generation from song style",
                    "Beat-synced motion (drums > camera shake, vocals > face motion)",
                    "Multi-segment video stitching with transitions",
                    "Stem-reactive visual mapping",
                    "720p / 1080p / 4K export",
                  ].map((f, i) => (
                    <div key={i} className="flex items-start gap-2">
                      <div className="w-1.5 h-1.5 rounded-full bg-accent-500/50 mt-1.5 shrink-0" />
                      <span className="text-xs text-[color:var(--ew-text-muted)]">
                        {f}
                      </span>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-accent-400/60">
                  The Visualiser tab is fully functional now. Try it while AI
                  Video is in development.
                </p>
              </div>
            </div>
          )}

          {activeTab === "storyboard" && (
            <div className="flex items-center justify-center h-full px-8">
              <div className="ew-card ew-v2-bevel max-w-md text-center">
                <div className="w-16 h-16 ew-v2-recessed flex items-center justify-center mx-auto mb-4">
                  <Sparkles
                    size={28}
                    className="text-[color:var(--ew-primary)]"
                  />
                </div>
                <h2 className="text-lg font-bold text-[color:var(--ew-text)] mb-2">
                  AI Storyboarding
                </h2>
                <p className="text-sm text-[color:var(--ew-text-muted)] leading-relaxed mb-4">
                  Coming with S3 Vid Pro. Plan your music video scene-by-scene
                  with AI-assisted storyboarding, kanban workflow, and automated
                  shot list generation.
                </p>
                <div className="space-y-2 text-left mb-6">
                  {[
                    "Scene-by-scene kanban workflow",
                    "AI-generated scene descriptions from lyrics",
                    "Drag-and-drop timeline assembly",
                    "Remotion export with transitions and title cards",
                    "Full S3 Vid visualiser integration",
                  ].map((f, i) => (
                    <div key={i} className="flex items-start gap-2">
                      <div className="w-1.5 h-1.5 rounded-full bg-accent-500/50 mt-1.5 shrink-0" />
                      <span className="text-xs text-[color:var(--ew-text-muted)]">
                        {f}
                      </span>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-accent-400/60">
                  Coming soon to Everywear.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      {pickerOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6">
          <div className="ew-card ew-v2-bevel w-full max-w-lg max-h-[70vh] flex flex-col">
            <div className="flex items-center justify-between border-b border-[color:var(--ew-border)] px-4 py-3">
              <div className="flex items-center gap-2 text-sm font-bold">
                <Music size={16} className="text-[color:var(--ew-primary)]" />
                Vault Tracks
              </div>
              <button
                type="button"
                onClick={() => setPickerOpen(false)}
                className="text-[color:var(--ew-text-muted)] hover:text-[color:var(--ew-text)]"
                aria-label="Close Vault picker"
              >
                ×
              </button>
            </div>
            <div className="flex-1 overflow-y-auto">
              {songs.length === 0 ? (
                isLoading || (!hasLoaded && hadSongsHintRef.current) ? (
                  <div className="px-4 py-8 text-center">
                    <Loader2
                      size={22}
                      className="mx-auto mb-2 text-[color:var(--ew-text-faint)] animate-spin"
                    />
                    <p className="text-xs text-[color:var(--ew-text-faint)]">
                      Loading tracks...
                    </p>
                  </div>
                ) : (
                  <div className="px-4 py-8 text-center">
                    <Music
                      size={22}
                      className="mx-auto mb-2 text-[color:var(--ew-text-faint)]"
                    />
                    <p className="text-xs text-[color:var(--ew-text-faint)]">
                      No Vault tracks found
                    </p>
                  </div>
                )
              ) : (
                songs.map((song) => (
                  <button
                    key={song.id}
                    onClick={() => selectSong(song)}
                    className={`w-full text-left px-4 py-3 border-b border-[color:var(--ew-border)] transition-colors ${
                      selectedSong?.id === song.id
                        ? "bg-accent-500/10 border-l-2 border-l-accent-500"
                        : "hover:bg-[color:var(--ew-primary-soft)]"
                    }`}
                  >
                    <p className="text-xs font-medium text-[color:var(--ew-text)] truncate">
                      {song.title}
                    </p>
                    <p className="text-[10px] text-[color:var(--ew-text-faint)] truncate mt-0.5">
                      {song.style} {song.duration && `· ${song.duration}`}
                    </p>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
