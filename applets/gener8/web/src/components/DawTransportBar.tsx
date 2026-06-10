// @ts-nocheck
/**
 * DawTransportBar — play/pause/stop transport for Gener8 DAW shell bridge.
 *
 * The legacy private shim route is retired. Until ShellLayout exposes DAW
 * transport commands, this bar reports the bridge gap through toast/status.
 *
 * Mounted at the bottom of the Gener8 App layout, always visible.
 * Uses EWDS tokens via Tailwind utility classes matching the Gener8 convention.
 */
import React, { useState, useCallback, useEffect, useRef } from 'react';
import { Play, Pause, Square, SkipBack, SkipForward, Volume2 } from 'lucide-react';
import { useSongStore } from '../context/SongStoreContext';
import { showToast } from './ToastHost';
import { dawApi } from '../services/dawApi';

type TransportState = 'stopped' | 'playing' | 'paused';

async function dawCommand(action: 'play' | 'pause' | 'stop'): Promise<boolean> {
  try {
    if (action === 'play') await dawApi.play();
    if (action === 'pause') await dawApi.pause();
    if (action === 'stop') await dawApi.stop();
    return true;
  } catch (error) {
    showToast({
      kind: 'error',
      eyebrow: 'Gener8 DAW',
      message: error instanceof Error ? error.message : `Cannot ${action}: DAW bridge failed.`,
      durationMs: 6000,
    });
    return false;
  }
}

export function DawTransportBar() {
  const { currentlyPlaying } = useSongStore();
  const [state, setState] = useState<TransportState>('stopped');
  const [elapsed, setElapsed] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Timer for elapsed display
  useEffect(() => {
    if (state === 'playing') {
      timerRef.current = setInterval(() => setElapsed((e) => e + 1), 1000);
    } else {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [state]);

  const handlePlay = useCallback(async () => {
    if (await dawCommand('play')) {
      setState('playing');
    }
  }, []);

  const handlePause = useCallback(async () => {
    if (await dawCommand('pause')) {
      setState('paused');
    }
  }, []);

  const handleStop = useCallback(async () => {
    if (await dawCommand('stop')) {
      setState('stopped');
      setElapsed(0);
    }
  }, []);

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  };

  // Parse duration string "M:SS" to seconds
  const totalSeconds = (() => {
    if (!currentlyPlaying?.duration) return 0;
    const d = currentlyPlaying.duration;
    if (typeof d === 'number') return d;
    const parts = String(d).split(':');
    if (parts.length === 2) return parseInt(parts[0]) * 60 + parseInt(parts[1]);
    return 0;
  })();

  const progress = totalSeconds > 0 ? Math.min(elapsed / totalSeconds, 1) : 0;

  return (
    <div className="flex items-center gap-3 px-4 py-2 border-t border-white/5 bg-black/20 flex-shrink-0">
      {/* Track info */}
      <div className="flex items-center gap-3 w-48 min-w-0">
        {currentlyPlaying ? (
          <>
            <div className="w-8 h-8 rounded overflow-hidden flex-shrink-0 bg-white/5">
              {currentlyPlaying.coverUrl ? (
                <img src={currentlyPlaying.coverUrl} alt="" className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-s3-text-muted">
                  <Volume2 size={12} />
                </div>
              )}
            </div>
            <div className="min-w-0">
              <div className="text-xs font-medium text-s3-text-primary truncate">
                {currentlyPlaying.title}
              </div>
              <div className="text-[10px] text-s3-text-muted truncate">
                {currentlyPlaying.style || 'Untitled'}
              </div>
            </div>
          </>
        ) : (
          <div className="text-xs text-s3-text-muted opacity-50">No track loaded</div>
        )}
      </div>

      {/* Transport controls */}
      <div className="flex items-center gap-1 flex-shrink-0">
        <button
          className="p-1.5 rounded hover:bg-white/5 text-s3-text-muted transition-colors"
          title="Previous"
          disabled
        >
          <SkipBack size={14} />
        </button>

        {state === 'playing' ? (
          <button
            onClick={handlePause}
            className="p-2 rounded-full bg-white/10 hover:bg-white/15 text-s3-text-primary transition-colors"
            title="Pause"
          >
            <Pause size={16} />
          </button>
        ) : (
          <button
            onClick={handlePlay}
            className="p-2 rounded-full bg-white/10 hover:bg-white/15 text-s3-text-primary transition-colors"
            title="Play"
            disabled={!currentlyPlaying}
          >
            <Play size={16} />
          </button>
        )}

        <button
          onClick={handleStop}
          className="p-1.5 rounded hover:bg-white/5 text-s3-text-muted transition-colors"
          title="Stop"
          disabled={state === 'stopped'}
        >
          <Square size={14} />
        </button>

        <button
          className="p-1.5 rounded hover:bg-white/5 text-s3-text-muted transition-colors"
          title="Next"
          disabled
        >
          <SkipForward size={14} />
        </button>
      </div>

      {/* Progress bar */}
      <div className="flex-1 flex items-center gap-2 min-w-0">
        <span className="text-[10px] text-s3-text-muted tabular-nums w-8 text-right flex-shrink-0">
          {formatTime(elapsed)}
        </span>
        <div className="flex-1 h-1 rounded-full bg-white/5 overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-1000 ease-linear"
            style={{
              width: `${progress * 100}%`,
              backgroundColor: 'var(--ew-primary, #6366f1)',
            }}
          />
        </div>
        <span className="text-[10px] text-s3-text-muted tabular-nums w-8 flex-shrink-0">
          {totalSeconds > 0 ? formatTime(totalSeconds) : '--:--'}
        </span>
      </div>
    </div>
  );
}
