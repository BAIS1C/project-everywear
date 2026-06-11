import React, { useEffect, useMemo, useState } from 'react';
import { Activity, Clapperboard, Film, ListVideo, Lock, Sparkles, Wand2 } from 'lucide-react';
import { findEngineEndpoint, formatEngineLastChecked, readEngineHealth, subscribeEngineHealth, type EngineHealthPayload } from '@everywear/shared';
import { useAuth } from '../context/AuthContext';

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

interface DirectorSeed {
  id?: string;
  title?: string;
  style?: string;
  duration?: number | string;
}

function parseDurationSeconds(duration: DirectorSeed['duration']): number {
  if (typeof duration === 'number' && Number.isFinite(duration)) return Math.max(15, duration);
  if (typeof duration !== 'string') return 180;
  const parts = duration.split(':').map((part) => Number.parseInt(part, 10));
  if (parts.length === 2 && parts.every(Number.isFinite)) return Math.max(15, parts[0] * 60 + parts[1]);
  return 180;
}

function songSeed(song: DirectorSeed | null): number {
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

function makeShotPlan(song: DirectorSeed | null): DirectorShot[] {
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
  const [engineHealth, setEngineHealth] = useState<EngineHealthPayload | null>(() => readEngineHealth());
  const canUseDirector = hasTier('creator_studio');

  useEffect(() => subscribeEngineHealth(setEngineHealth), []);

  const videoEndpoint = findEngineEndpoint(engineHealth, 'video-encoder');
  const musicEndpoint = findEngineEndpoint(engineHealth, 'ace-server');
  const videoReady = Boolean(videoEndpoint?.online);
  const canDraftPlan = canUseDirector && videoReady;
  const shotPlan = useMemo(() => makeShotPlan(null), []);
  const plannerRoute = 'Local planner, External API';
  const lastChecked = formatEngineLastChecked(engineHealth);

  return (
    <div className="s3-family-route h-full bg-s3 text-[color:var(--ew-text)] overflow-hidden flex flex-col">
      <main className="flex-1 min-w-0 overflow-y-auto">
        <div className="px-6 py-5 border-b border-[color:var(--ew-border)] flex items-center justify-between gap-4">
          <div>
            <p className="text-[10px] uppercase tracking-wider text-[color:var(--ew-text-faint)] font-bold">Creator Studio</p>
            <h2 className="text-xl font-semibold text-[color:var(--ew-text)] mt-1">AI Director</h2>
          </div>
          <button
            disabled={!canDraftPlan}
            className={`ew-btn ew-btn--sm inline-flex items-center gap-2 text-xs font-semibold transition-colors ${
              canDraftPlan
                ? 'ew-btn--primary'
                : 'ew-btn--ghost opacity-50'
            }`}
          >
            {canUseDirector ? <Wand2 size={14} /> : <Lock size={14} />}
            Draft Plan
          </button>
        </div>

        <div
          className="mx-6 mt-5 rounded-lg border px-4 py-3 flex flex-wrap items-center gap-3 text-xs"
          style={{
            borderColor: videoReady ? 'color-mix(in oklab, var(--ew-status-green) 35%, var(--ew-border))' : 'color-mix(in oklab, var(--ew-status-amber) 40%, var(--ew-border))',
            background: videoReady ? 'color-mix(in oklab, var(--ew-status-green) 9%, transparent)' : 'color-mix(in oklab, var(--ew-status-amber) 10%, transparent)',
            color: 'var(--ew-text)',
          }}
        >
          <Activity size={15} className={videoReady ? 'text-emerald-300' : 'text-amber-300'} />
          <span className="font-semibold">{videoReady ? 'Video engine ready' : 'Video engine offline'}</span>
          <span style={{ color: 'var(--ew-text-muted)' }}>
            {videoEndpoint
              ? `Video engine ${videoEndpoint.online ? 'online' : 'offline'}${videoEndpoint.port ? `, port ${videoEndpoint.port}` : ''}`
              : 'Video engine not available from the shell'}
          </span>
          <span className="opacity-40">|</span>
          <span style={{ color: 'var(--ew-text-muted)' }}>
            Music engine: {musicEndpoint ? (musicEndpoint.online ? 'online' : 'offline') : 'not available'}
          </span>
          {lastChecked && (
            <>
              <span className="opacity-40">|</span>
              <span style={{ color: 'var(--ew-text-muted)' }}>Checked {lastChecked}</span>
            </>
          )}
        </div>

        {!canUseDirector && (
          <div className="ew-card mx-6 mt-5 px-4 py-3 flex items-center gap-3 text-slate-300">
            <Lock size={16} className="text-accent-300" />
            <div>
              <p className="text-sm font-semibold text-slate-100">Creator Studio required</p>
              <p className="text-xs text-slate-300 mt-0.5">AI Director follows the Everywear shell entitlement state. Local planning is used when available; fallback planning stays on this machine.</p>
            </div>
          </div>
        )}

        <div className="grid grid-cols-[minmax(0,1fr)_280px] gap-5 p-6">
          <section className="ew-card ew-v2-bevel min-w-0 p-0 overflow-hidden">
            <div className="px-4 py-3 border-b border-[color:var(--ew-border)] flex items-center gap-2">
              <ListVideo size={15} className="text-accent-400" />
              <h3 className="text-sm font-semibold text-slate-100">
                Shot Plan
              </h3>
            </div>
            <div className="divide-y divide-[color:var(--ew-border)]">
              {shotPlan.map((shot, index) => (
                <div key={`${shot.time}-${shot.camera}`} className="grid grid-cols-[56px_1fr] gap-3 px-4 py-3">
                  <div className="text-[11px] font-mono text-slate-400 pt-0.5">{shot.time}</div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-semibold text-slate-100">Shot {index + 1}</span>
                      <span className="text-[10px] uppercase tracking-wider text-accent-300/80">{shot.camera}</span>
                    </div>
                    <p className="text-xs text-slate-300 mt-1">
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
              <h3 className="text-sm font-semibold text-slate-100">Package</h3>
            </div>
            <div className="space-y-3">
              {[
                ['Track', 'No song sidebar required'],
                ['Duration', '3:00 storyboard draft'],
                ['Visual Aim', 'Music-led video'],
                ['Planner Route', plannerRoute],
                ['Readiness', canDraftPlan ? 'Shell engine ready' : 'Waiting for shell engine'],
              ].map(([label, value]) => (
                <div key={label}>
                  <p className="text-[10px] uppercase tracking-wider text-slate-400 font-bold">{label}</p>
                  <p className="text-xs text-slate-300 mt-1 break-words">{value}</p>
                </div>
              ))}
            </div>
            <div className="ew-v2-recessed mt-5 p-3">
              <div className="flex items-center gap-2 text-xs text-slate-300">
                <Film size={14} className="text-accent-400" />
                Vid Studio handoff
              </div>
              <p className="text-[11px] text-slate-400 mt-2">
                Plans stay local until the shell video engine reports online.
              </p>
            </div>
          </aside>
        </div>
      </main>
    </div>
  );
}
