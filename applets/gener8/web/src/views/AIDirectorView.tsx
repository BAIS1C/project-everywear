import React, { useMemo, useState } from 'react';
import { Clapperboard, Film, ListVideo, Lock, Music, Sparkles, Wand2 } from 'lucide-react';
import { AI_DIRECTOR_SAPI_PLANNER_CONTRACT } from '@everywear/transport';
import { useAuth } from '../context/AuthContext';
import { useSongStore } from '../context/SongStoreContext';
import type { Song } from '../types';

interface DirectorShot {
  time: string;
  camera: string;
  subject: string;
  motion: string;
  grade: string;
}

const CAMERA_MOVES = ['slow dolly', 'handheld push', 'orbit', 'locked wide', 'macro glide', 'crane lift'];
const SUBJECTS = ['performer silhouette', 'lyric environment', 'abstract stage', 'archive texture', 'crowd energy', 'cover-art motif'];
const MOTION_CUES = ['kick pulses', 'vocal cuts', 'bass swells', 'snare flashes', 'chorus bloom', 'breakdown drift'];
const GRADES = ['neon black', 'warm film', 'chrome cyan', 'deep magenta', 'soft tungsten', 'high contrast'];

function parseDurationSeconds(duration: Song['duration']): number {
  if (typeof duration === 'number' && Number.isFinite(duration)) return Math.max(15, duration);
  if (typeof duration !== 'string') return 180;
  const parts = duration.split(':').map((part) => Number.parseInt(part, 10));
  if (parts.length === 2 && parts.every(Number.isFinite)) return Math.max(15, parts[0] * 60 + parts[1]);
  return 180;
}

function songSeed(song: Song | null): number {
  const text = `${song?.id || 'director'}:${song?.title || ''}:${song?.style || ''}`;
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

function makeShotPlan(song: Song | null): DirectorShot[] {
  const seed = songSeed(song);
  const duration = parseDurationSeconds(song?.duration);
  const shotCount = 6;
  return Array.from({ length: shotCount }, (_, index) => {
    const offset = Math.floor((duration / shotCount) * index);
    const pick = (items: string[], salt: number) => items[(seed + index * 7 + salt) % items.length];
    return {
      time: formatTime(offset),
      camera: pick(CAMERA_MOVES, 1),
      subject: pick(SUBJECTS, 3),
      motion: pick(MOTION_CUES, 5),
      grade: pick(GRADES, 9),
    };
  });
}

export default function AIDirectorView() {
  const { hasTier } = useAuth();
  const { songs } = useSongStore();
  const [selectedSongId, setSelectedSongId] = useState<string | null>(songs[0]?.id ?? null);
  const canUseDirector = hasTier('creator_studio');

  const selectedSong = useMemo(
    () => songs.find((song) => song.id === selectedSongId) ?? songs[0] ?? null,
    [selectedSongId, songs],
  );
  const shotPlan = useMemo(() => makeShotPlan(selectedSong), [selectedSong]);
  const plannerProviders = AI_DIRECTOR_SAPI_PLANNER_CONTRACT.providers
    .map((provider) => provider === 'external_api' ? 'external API' : provider.replace('_', ' '))
    .join(', ');

  return (
    <div className="s3-family-route h-full bg-s3 text-[color:var(--ew-text)] overflow-hidden flex">
      <aside className="w-64 shrink-0 border-r border-[color:var(--ew-border)] ew-v2-bevel flex flex-col">
        <div className="px-3 py-3 border-b border-[color:var(--ew-border)]">
          <div className="flex items-center gap-2">
            <Clapperboard size={15} className="text-accent-400" />
            <h3 className="text-[10px] font-bold text-[color:var(--ew-text-muted)] uppercase tracking-wider">AI Director</h3>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {songs.length === 0 ? (
            <div className="px-4 py-8 text-center">
              <Music size={22} className="mx-auto mb-3 text-[color:var(--ew-text-faint)]" />
              <p className="text-xs text-[color:var(--ew-text-faint)]">No tracks in the vault yet</p>
            </div>
          ) : (
            songs.map((song) => (
              <button
                key={song.id}
                onClick={() => setSelectedSongId(song.id)}
                className={`w-full text-left px-3 py-2.5 border-b border-[color:var(--ew-border)] transition-colors ${
                  selectedSong?.id === song.id
                    ? 'bg-accent-500/10 border-l-2 border-l-accent-500'
                    : 'hover:bg-[color:var(--ew-primary-soft)]'
                }`}
              >
                <p className="text-xs font-medium text-[color:var(--ew-text)] truncate">{song.title}</p>
                <p className="text-[10px] text-[color:var(--ew-text-faint)] truncate mt-0.5">{song.style || 'Generated track'}</p>
              </button>
            ))
          )}
        </div>
      </aside>

      <main className="flex-1 min-w-0 overflow-y-auto">
        <div className="px-6 py-5 border-b border-[color:var(--ew-border)] flex items-center justify-between gap-4">
          <div>
            <p className="text-[10px] uppercase tracking-wider text-[color:var(--ew-text-faint)] font-bold">Creator Studio</p>
            <h2 className="text-xl font-semibold text-[color:var(--ew-text)] mt-1">AI Director</h2>
          </div>
          <button
            disabled={!canUseDirector || !selectedSong}
            className={`ew-btn ew-btn--sm inline-flex items-center gap-2 text-xs font-semibold transition-colors ${
              canUseDirector && selectedSong
                ? 'ew-btn--primary'
                : 'ew-btn--ghost opacity-50'
            }`}
          >
            {canUseDirector ? <Wand2 size={14} /> : <Lock size={14} />}
            Draft Plan
          </button>
        </div>

        {!canUseDirector && (
          <div className="ew-card mx-6 mt-5 px-4 py-3 flex items-center gap-3">
            <Lock size={16} className="text-accent-300" />
            <div>
              <p className="text-sm font-semibold text-[color:var(--ew-text)]">Creator Studio required</p>
              <p className="text-xs text-[color:var(--ew-text-muted)] mt-0.5">AI Director follows the Everywear shell entitlement state and routes planner reasoning through SAPI.</p>
            </div>
          </div>
        )}

        <div className="grid grid-cols-[minmax(0,1fr)_280px] gap-5 p-6">
          <section className="ew-card ew-v2-bevel min-w-0 p-0 overflow-hidden">
            <div className="px-4 py-3 border-b border-[color:var(--ew-border)] flex items-center gap-2">
              <ListVideo size={15} className="text-accent-400" />
              <h3 className="text-sm font-semibold text-[color:var(--ew-text)]">
                {selectedSong?.title || 'Shot Plan'}
              </h3>
            </div>
            <div className="divide-y divide-[color:var(--ew-border)]">
              {shotPlan.map((shot, index) => (
                <div key={`${shot.time}-${shot.camera}`} className="grid grid-cols-[56px_1fr] gap-3 px-4 py-3">
                  <div className="text-[11px] font-mono text-[color:var(--ew-text-faint)] pt-0.5">{shot.time}</div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-semibold text-[color:var(--ew-text)]">Shot {index + 1}</span>
                      <span className="text-[10px] uppercase tracking-wider text-accent-300/80">{shot.camera}</span>
                    </div>
                    <p className="text-xs text-[color:var(--ew-text-muted)] mt-1">
                      {shot.subject} with {shot.motion}, graded {shot.grade}.
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <aside className="ew-card ew-v2-bevel p-4 h-max">
            <div className="flex items-center gap-2 mb-4">
              <Sparkles size={15} className="text-accent-400" />
              <h3 className="text-sm font-semibold text-[color:var(--ew-text)]">Package</h3>
            </div>
            <div className="space-y-3">
              {[
                ['Track', selectedSong?.title || 'No track selected'],
                ['Duration', String(selectedSong?.duration || '0:00')],
                ['Visual Aim', selectedSong?.style || 'Music-led video'],
                ['Planner', `SAPI: ${plannerProviders}`],
                ['Export', canUseDirector ? 'Storyboard ready' : 'Locked'],
              ].map(([label, value]) => (
                <div key={label}>
                  <p className="text-[10px] uppercase tracking-wider text-[color:var(--ew-text-faint)] font-bold">{label}</p>
                  <p className="text-xs text-[color:var(--ew-text-muted)] mt-1 break-words">{value}</p>
                </div>
              ))}
            </div>
            <div className="ew-v2-recessed mt-5 p-3">
              <div className="flex items-center gap-2 text-xs text-[color:var(--ew-text-muted)]">
                <Film size={14} className="text-accent-400" />
                Vid Studio handoff
              </div>
              <p className="text-[11px] text-[color:var(--ew-text-faint)] mt-2">
                Plans stay local until the shell video engine is connected.
              </p>
            </div>
          </aside>
        </div>
      </main>
    </div>
  );
}
