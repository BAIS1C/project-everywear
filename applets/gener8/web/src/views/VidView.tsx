/**
 * S3 Vid -- Standalone applet view wrapping the VideoGeneratorModal.
 * Ported from s3studio-web/src/shell/VidApp.tsx into Gener8 as a route view.
 *
 * Song browser sidebar + tab bar (Visualiser, AI Video, Storyboard).
 * Consumes useSongStore() directly for the song library.
 */
import React, { useState, useEffect, useRef } from 'react';
import { VideoGeneratorModal } from '../components/VideoGeneratorModal';
import { Music, Film, Sparkles, Loader2 } from 'lucide-react';
import { LockedFeatureCard } from '@everywear/shared';
import type { Song } from '../types';
import { intentBus } from '../context/intentBus';
import { useSongStore, readHasSongsHint } from '../context/SongStoreContext';

export default function VidView() {
  const { songs, isLoading, hasLoaded } = useSongStore();
  const [selectedSong, setSelectedSong] = useState<Song | null>(null);
  const [activeTab, setActiveTab] = useState<'visualiser' | 'ai-video' | 'storyboard'>('visualiser');
  const hadSongsHintRef = useRef(readHasSongsHint());

  // Listen for cross-app intents (e.g., camera button from Gener8 Create)
  useEffect(() => {
    const unsub = intentBus.subscribe('vid', (intent) => {
      if (intent.action === 'open-with-song' && intent.payload?.songId) {
        const song = songs.find(s => s.id === intent.payload!.songId);
        if (song) {
          setSelectedSong(song);
          setActiveTab('visualiser');
        }
      }
    });
    return unsub;
  }, [songs]);

  return (
    <div className="flex h-full bg-s3 text-white">
      {/* -- Song Browser Sidebar ----------------------------------------- */}
      <div className="w-56 border-r border-white/[0.06] flex flex-col shrink-0">
        <div className="px-3 py-3 border-b border-white/[0.06]">
          <h3 className="text-[10px] font-bold text-white/40 uppercase tracking-wider">Your Songs</h3>
        </div>
        <div className="flex-1 overflow-y-auto">
          {songs.length === 0 ? (
            (isLoading || (!hasLoaded && hadSongsHintRef.current)) ? (
              <div className="px-3 py-6 text-center">
                <Loader2 size={20} className="mx-auto mb-2 text-white/30 animate-spin" />
                <p className="text-xs text-white/30">Loading your songs...</p>
              </div>
            ) : (
              <div className="px-3 py-6 text-center">
                <Music size={20} className="mx-auto mb-2 text-white/20" />
                <p className="text-xs text-white/30">No songs yet</p>
                <p className="text-[10px] text-white/20 mt-1">Generate music in Gener8 first</p>
              </div>
            )
          ) : (
            songs.map(song => (
              <button
                key={song.id}
                onClick={() => setSelectedSong(song)}
                className={`w-full text-left px-3 py-2.5 border-b border-white/[0.03] transition-colors ${
                  selectedSong?.id === song.id
                    ? 'bg-accent-500/10 border-l-2 border-l-accent-500'
                    : 'hover:bg-white/[0.04]'
                }`}
              >
                <p className="text-xs font-medium text-white/80 truncate">{song.title}</p>
                <p className="text-[10px] text-white/30 truncate mt-0.5">
                  {song.style} {song.duration && `· ${song.duration}`}
                </p>
              </button>
            ))
          )}
        </div>
      </div>

      {/* -- Main Content ------------------------------------------------- */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Tab bar */}
        <div className="flex border-b border-white/[0.06] px-4 shrink-0">
          <button
            onClick={() => setActiveTab('visualiser')}
            className={`px-4 py-2.5 text-xs font-semibold border-b-2 transition-colors ${
              activeTab === 'visualiser'
                ? 'text-white border-accent-500'
                : 'text-white/40 border-transparent hover:text-white/60'
            }`}
          >
            <span className="flex items-center gap-1.5">
              <Film size={12} />
              Visualiser
            </span>
          </button>
          <button
            onClick={() => setActiveTab('ai-video')}
            className={`px-4 py-2.5 text-xs font-semibold border-b-2 transition-colors ${
              activeTab === 'ai-video'
                ? 'text-white border-accent-500'
                : 'text-white/40 border-transparent hover:text-white/60'
            }`}
          >
            <span className="flex items-center gap-1.5">
              <Sparkles size={12} className="text-accent-400" />
              AI Video
              <span className="text-[8px] bg-accent-500/20 text-accent-400 px-1 rounded font-bold uppercase">Soon</span>
            </span>
          </button>
          <button
            onClick={() => setActiveTab('storyboard')}
            className={`px-4 py-2.5 text-xs font-semibold border-b-2 transition-colors ${
              activeTab === 'storyboard'
                ? 'text-white border-accent-500'
                : 'text-white/40 border-transparent hover:text-white/60'
            }`}
          >
            <span className="flex items-center gap-1.5">
              <Sparkles size={12} className="text-accent-400" />
              Storyboard
              <span className="text-[8px] bg-accent-500/20 text-accent-400 px-1 rounded font-bold uppercase">Soon</span>
            </span>
          </button>
        </div>

        {/* Content area */}
        <div className="flex-1 overflow-auto">
          {activeTab === 'visualiser' && (
            selectedSong ? (
              <VideoGeneratorModal
                isOpen={true}
                onClose={() => {}}
                song={selectedSong}
                embedded={true}
              />
            ) : (
              <div className="flex items-center justify-center h-full">
                <div className="text-center">
                  <Film size={40} className="mx-auto mb-3 text-white/10" />
                  <p className="text-sm text-white/30 font-medium">Select a song to create a video</p>
                  <p className="text-xs text-white/20 mt-1">Choose from your library on the left</p>
                </div>
              </div>
            )
          )}

          {activeTab === 'ai-video' && (
            <div className="flex items-center justify-center h-full px-8">
              <div className="max-w-md w-full flex flex-col gap-4">
                <LockedFeatureCard
                  title="AI Video Generation"
                  description="Generate beat-synced AI video from your tracks using Wan 2.2, AnimateDiff, and CogVideoX, all running on your local GPU."
                  icon="🎬"
                  tier="creator-studio"
                  progress="in-development"
                />
                <LockedFeatureCard
                  title="Stem-Reactive Visuals"
                  description="Map isolated stems to visual channels: drums drive camera shake, vocals drive face motion, bass drives color grading."
                  icon="🎛"
                  tier="creator-studio"
                  progress="planned"
                />
                <p className="text-xs text-s3-text-muted opacity-60 text-center">
                  The Visualiser tab is fully functional now.
                </p>
              </div>
            </div>
          )}

          {activeTab === 'storyboard' && (
            <div className="flex items-center justify-center h-full px-8">
              <div className="max-w-md w-full flex flex-col gap-4">
                <LockedFeatureCard
                  title="AI Storyboarding"
                  description="Plan your music video scene-by-scene with AI-assisted storyboarding, kanban workflow, and automated shot list generation."
                  icon="📋"
                  tier="creator-studio"
                  progress="planned"
                />
                <LockedFeatureCard
                  title="Remotion Export"
                  description="Export storyboard to Remotion with transitions, title cards, and full S3 Vid visualiser integration."
                  icon="🎞"
                  tier="creator-studio"
                  progress="planned"
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
