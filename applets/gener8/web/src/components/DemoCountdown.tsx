// @ts-nocheck
// ═══════════════════════════════════════════════════════════════════════════
// DemoCountdown.tsx — Trial countdown timer + expiry screens
// ═══════════════════════════════════════════════════════════════════════════
// Demo v2 (2026-05-06 SGT): 1 hour per day for 7 days, no carry-over.
// TODO (2026-05-18): Demo v3 spec is 7-day unlimited. Timer budget in
// AuthContext still enforces 1h/day; needs updating to match.
//
// DemoCountdownPill: calls demo_tick RPC every 30s as a heartbeat.
//   The RPC accumulates usage server-side and returns remaining seconds.
//   The pill displays a countdown based on the server response.
//
// TrialExpiredScreen: shows when today's hour is used OR 7-day window ended.
//   Two variants: "come back tomorrow" vs "trial week over".
// ═══════════════════════════════════════════════════════════════════════════

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useSongStore } from '@/shell/SongStoreContext';
import { supabase } from '@/lib/supabase';

// ── Countdown pill (inline in taskbar or header) ─────────────────────────

function formatTimeLeft(seconds: number): string {
  if (seconds <= 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

interface TickResult {
  active: boolean;
  reason?: string;
  seconds_remaining?: number;
  seconds_used?: number;
  days_left?: number;
  day?: number;
}

export function DemoCountdownPill() {
  const { isTrialActive, user, refresh } = useAuth();
  const [remaining, setRemaining] = useState<number | null>(null);
  const [daysLeft, setDaysLeft] = useState<number | null>(null);
  const [dayNum, setDayNum] = useState<number | null>(null);
  const hasExpiredRef = useRef(false);
  const tickTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const localTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const doTick = useCallback(async () => {
    if (!user?.id) return;
    const { data, error } = await supabase.rpc('demo_tick', {
      p_user: user.id,
      p_elapsed_seconds: 30,
    });
    if (error) {
      console.error('[demo_tick]', error.message);
      return;
    }
    const result = data as TickResult;

    if (result.seconds_remaining !== undefined) {
      setRemaining(result.seconds_remaining);
    }
    if (result.days_left !== undefined) setDaysLeft(result.days_left);
    if (result.day !== undefined) setDayNum(result.day);

    if (!result.active && !hasExpiredRef.current) {
      hasExpiredRef.current = true;
      setRemaining(0);
      void refresh();
    }
  }, [user?.id, refresh]);

  useEffect(() => {
    if (!isTrialActive || !user?.trial) {
      setRemaining(null);
      return;
    }

    hasExpiredRef.current = false;

    // Initial tick (with 0 elapsed to just read state)
    (async () => {
      if (!user?.id) return;
      const { data } = await supabase.rpc('demo_tick', {
        p_user: user.id,
        p_elapsed_seconds: 0,
      });
      if (data) {
        const r = data as TickResult;
        if (r.seconds_remaining !== undefined) setRemaining(r.seconds_remaining);
        if (r.days_left !== undefined) setDaysLeft(r.days_left);
        if (r.day !== undefined) setDayNum(r.day);
      }
    })();

    // Server heartbeat every 30s
    tickTimerRef.current = setInterval(doTick, 30_000);

    // Local countdown every 1s for smooth display
    localTimerRef.current = setInterval(() => {
      setRemaining(prev => (prev !== null && prev > 0 ? prev - 1 : prev));
    }, 1000);

    return () => {
      if (tickTimerRef.current) clearInterval(tickTimerRef.current);
      if (localTimerRef.current) clearInterval(localTimerRef.current);
    };
  }, [isTrialActive, user?.trial, user?.id, doTick]);

  // Trigger expiry when local countdown hits 0
  useEffect(() => {
    if (remaining === 0 && !hasExpiredRef.current) {
      hasExpiredRef.current = true;
      void refresh();
    }
  }, [remaining, refresh]);

  if (!isTrialActive || remaining === null) return null;

  const isUrgent = remaining < 10 * 60; // < 10 min
  const isCritical = remaining < 2 * 60; // < 2 min

  return (
    <div
      className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-mono"
      style={{
        background: isCritical
          ? 'color-mix(in oklab, var(--ew-danger) 15%, transparent)'
          : isUrgent
            ? 'color-mix(in oklab, var(--ew-warning, #f59e0b) 15%, transparent)'
            : 'var(--ew-primary-soft)',
        color: isCritical
          ? 'var(--ew-danger)'
          : isUrgent
            ? 'var(--ew-warning, #f59e0b)'
            : 'var(--ew-primary)',
        borderRadius: 'var(--ew-radius, 6px)',
        border: `1px solid ${isCritical ? 'var(--ew-danger)' : isUrgent ? 'var(--ew-warning, #f59e0b)' : 'var(--ew-border)'}`,
      }}
      title={`Free trial: ${formatTimeLeft(remaining)} left today${dayNum ? ` (Day ${dayNum}/7)` : ''}`}
    >
      <span style={{ fontSize: 10, opacity: 0.7 }}>
        TRIAL{dayNum ? ` D${dayNum}` : ''}
      </span>
      <span>{formatTimeLeft(remaining)}</span>
    </div>
  );
}

// ── Expiry screen (full overlay) ────────────────────────────────────────

interface TrialExpiredScreenProps {
  onUpgrade: (tier?: string) => void;
}

export function TrialExpiredScreen({ onUpgrade }: TrialExpiredScreenProps) {
  const { demoStartedAt, isTrialActive, user } = useAuth();
  const { songs, likedSongIds } = useSongStore();

  const [visible, setVisible] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  // Determine if the 7-day window is completely over
  const trialWeekOver = demoStartedAt
    ? (Date.now() - new Date(demoStartedAt).getTime()) > 7 * 24 * 60 * 60 * 1000
    : false;

  useEffect(() => {
    if (demoStartedAt && !isTrialActive && !dismissed) {
      setVisible(true);
    } else {
      setVisible(false);
    }
  }, [demoStartedAt, isTrialActive, dismissed]);

  const handleUpgrade = useCallback(() => {
    setDismissed(true);
    onUpgrade('gener8');
  }, [onUpgrade]);

  const handleDismiss = useCallback(() => {
    setDismissed(true);
  }, []);

  if (!visible) return null;

  const trackCount = songs.length;
  const likedCount = likedSongIds.size;

  return (
    <div
      className="fixed inset-0 z-[99998] flex items-center justify-center"
      style={{
        background: 'rgba(5, 5, 8, 0.92)',
        backdropFilter: 'blur(12px)',
      }}
    >
      <div
        className="ew-card flex flex-col items-center text-center max-w-md w-full mx-6"
        style={{
          padding: '40px 32px',
          background: 'var(--ew-surface)',
          border: '1px solid var(--ew-border)',
        }}
      >
        {/* Glyph */}
        <div
          className="flex items-center justify-center mb-6"
          style={{
            width: 64,
            height: 64,
            borderRadius: 'var(--ew-radius, 6px)',
            background: 'var(--ew-primary-soft)',
            border: '1px solid var(--ew-primary)',
          }}
        >
          <span
            style={{
              fontSize: 24,
              fontWeight: 700,
              color: 'var(--ew-primary)',
              fontFamily: 'var(--ew-font-display)',
            }}
          >
            S3
          </span>
        </div>

        {/* Heading */}
        <h2
          className="text-lg font-bold mb-2"
          style={{
            color: 'var(--ew-text)',
            fontFamily: 'var(--ew-font-display)',
          }}
        >
          {trialWeekOver
            ? 'Your free trial week has ended'
            : "Today's free hour is up"}
        </h2>

        <p
          className="text-sm mb-6"
          style={{ color: 'var(--ew-text-muted)', lineHeight: 1.6 }}
        >
          {trialWeekOver
            ? "Here's what you created during your trial:"
            : 'Come back tomorrow for another free hour, or upgrade now to keep creating.'}
        </p>

        {/* Stats grid */}
        <div
          className="grid grid-cols-2 gap-3 w-full mb-8"
          style={{ maxWidth: 280 }}
        >
          <StatCard label="Tracks Created" value={trackCount} />
          <StatCard label="Favourites" value={likedCount} />
        </div>

        {/* CTA */}
        <button
          onClick={handleUpgrade}
          className="ew-btn ew-btn--primary ew-btn--lg w-full justify-center mb-3"
        >
          Own Gener8 4ever for $20
        </button>

        <button
          onClick={handleDismiss}
          className="text-xs"
          style={{
            color: 'var(--ew-text-faint)',
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            padding: '8px',
          }}
        >
          {trialWeekOver ? 'Maybe later' : "I'll come back tomorrow"}
        </button>

        {user?.raw_username && (
          <p
            className="text-[10px] mt-4"
            style={{ color: 'var(--ew-text-faint)' }}
          >
            {user.raw_username}@everywear.id
          </p>
        )}
      </div>
    </div>
  );
}

// ── Stat card sub-component ──────────────────────────────────────────────

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div
      className="flex flex-col items-center py-3 px-2"
      style={{
        background: 'var(--ew-primary-soft)',
        borderRadius: 'var(--ew-radius, 6px)',
        border: '1px solid var(--ew-border)',
      }}
    >
      <span
        className="text-2xl font-bold"
        style={{
          color: 'var(--ew-primary)',
          fontFamily: 'var(--ew-font-display)',
        }}
      >
        {value}
      </span>
      <span
        className="text-[10px] mt-1"
        style={{ color: 'var(--ew-text-muted)' }}
      >
        {label}
      </span>
    </div>
  );
}

// Combined gate component
export default function DemoTrialGate({ onUpgrade }: { onUpgrade: (tier?: string) => void }) {
  return (
    <>
      <TrialExpiredScreen onUpgrade={onUpgrade} />
    </>
  );
}
