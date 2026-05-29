// @ts-nocheck
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { CreatePanel } from '@/components/CreatePanel';
import { SongList } from '@/components/SongList';
import { RightSidebar } from '@/components/RightSidebar';
import { LibraryView as VaultLibraryView } from '@/views/LibraryView';
import { PlaylistDetail } from '@/components/PlaylistDetail';
import { UserProfile } from '@/components/UserProfile';
import { SongProfile } from '@/components/SongProfile';
import { SearchPage } from '@/components/SearchPage';
import { UpgradeModal } from '@/components/UpgradeModal';
import { UsernameModal } from '@/components/UsernameModal';
import { SettingsModal } from '@/components/SettingsModal';
import { CreatePlaylistModal, AddToPlaylistModal } from '@/components/PlaylistModals';
import { VideoGeneratorModal } from '@/components/VideoGeneratorModal';
import { showToast as showToastImperative, type ToastKind } from '@/components/ToastHost';
// Local alias kept for the legacy `type` parameter shape; the global
// ToastHost (mounted in App.tsx) renders the actual stack.
type ToastType = 'success' | 'error' | 'info';
import Waveform from '@/components/Waveform';
// Duplicate analyseWaveformCached import (line ~27) collapsed into this single
// import 2026-04-25 SGT during EWDS retheme pass.
import { analyseWaveformCached } from '@/components/studio/waveformAnalyser';
import { Song, GenerationParams, View, Playlist } from '@/types';
import { generateApi, getAudioRequestPath, songsApi, playlistsApi } from '@/services/api';
import { useAuth } from '@/context/AuthContext';
import { useResponsive } from '@/context/ResponsiveContext';
import { useShellAudio } from '@/shell/ShellAudioPlayer';
import { useSongStore } from '@/shell/SongStoreContext';
import { openVidWithSong, sendToStudio, areModelsUnloaded } from '@/shell/intentBus';
import { useWorkspace } from '@/context/WorkspaceContext';
// Lucide subset retained where the sprite alternative reads as a regression
// (mobile drawer chevron). Transport icons swapped to .ew-icon + sprite refs
// during EWDS retheme 2026-04-25 SGT — see Gener8Transport / Gener8Nav.
import { List } from 'lucide-react';
import { seededFauxPeaks } from '@/shell/applets/seededFauxPeaks';

/**
 * Gener8Core — The S³ Gener8 applet content, extracted from App.tsx.
 *
 * This component owns:
 *   - Song creation (CreatePanel + generation API)
 *   - Song list browsing
 *   - Song detail sidebar
 *   - Library, profile, song, playlist, search views
 *   - Like/unlike, delete, reuse, cover flows
 *   - Playlist management
 *   - Video generator modal (non-Everywear mode) / intent dispatch (Everywear mode)
 *
 * It does NOT own:
 *   - Audio playback (<audio> element lives in ShellAudioPlayer)
 *   - Top-level nav sidebar (shell provides window chrome)
 *   - Player bar (shell provides ShellAudioPlayer)
 *   - Theme (shell enforces dark)
 *
 * Audio: uses useShellAudio() for playSong/togglePlay/etc.
 * Songs: syncs with useSongStore() so other applets (Vid, Library) can access.
 */

// ── Gener8 Transport Bar ─────────────────────────────────────────
function fmtTime(s: number): string {
  if (!s || !Number.isFinite(s)) return '0:00';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

function Gener8Transport({ audio }: { audio: import('../ShellAudioPlayer').ShellAudioAPI }) {
  const { currentSong, isPlaying, currentTime, duration, volume, togglePlay, seek, setVolume } = audio;
  const [isMuted, setIsMuted] = useState(false);
  const prevVolume = useRef(volume);
  const progressRef = useRef<HTMLDivElement>(null);

  // Task #60: real waveform peaks for the transport. analyseWaveformCached
  // wraps a memory + localStorage cache; ~800 bins reads as a detailed
  // shape rather than chunky blocks (founder: "too blocky" at lower bin
  // counts). The Waveform component owns its own click-to-seek.
  const [peaks, setPeaks] = useState<number[]>([]);
  useEffect(() => {
    let cancelled = false;
    if (!currentSong?.audioUrl) { setPeaks([]); return; }
    analyseWaveformCached(currentSong.audioUrl, 800)
      .then(d => { if (!cancelled) setPeaks(d.peaks); })
      .catch(() => { if (!cancelled) setPeaks([]); });
    return () => { cancelled = true; };
  }, [currentSong?.audioUrl]);

  if (!currentSong) return null;

  const pct = duration > 0 ? (currentTime / duration) * 100 : 0;

  const handleProgressClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!progressRef.current || !duration) return;
    const rect = progressRef.current.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    seek(ratio * duration);
  };

  const toggleMute = () => {
    if (isMuted) {
      setVolume(prevVolume.current || 0.8);
      setIsMuted(false);
    } else {
      prevVolume.current = volume;
      setVolume(0);
      setIsMuted(true);
    }
  };

  // Minute markers: a faint vertical tick every 60 s along the waveform
  // so users can eyeball "that bit at 2:00" without reading the clock.
  // Drawn as absolutely-positioned divs over the waveform canvas.
  const minuteMarkers: number[] = [];
  if (duration > 60) {
    for (let t = 60; t < duration; t += 60) {
      minuteMarkers.push((t / duration) * 100);
    }
  }

  return (
    <div
      className="h-16 flex-shrink-0 flex items-center gap-3 px-4"
      style={{
        borderTop: '1px solid var(--ew-chrome-border)',
        background: 'var(--ew-chrome-bg)',
      }}
    >
      {/* Track info */}
      <div className="flex items-center gap-2 min-w-0 w-48">
        <div
          className="w-10 h-10 overflow-hidden flex-shrink-0"
          style={{
            background: 'var(--ew-surface-sunken)',
            border: '1px solid var(--ew-border)',
            clipPath: 'var(--ew-clip-button-sm)',
          }}
        >
          <img src={currentSong.coverUrl} alt="" className="w-full h-full object-cover" />
        </div>
        <span className="text-xs truncate" style={{ color: 'var(--ew-text-muted)' }}>{currentSong.title}</span>
      </div>

      {/* Play control — chamfered (TR+BL) primary square via .ew-btn--primary
          padding zeroed so the button is a 36x36 surface that picks up the
          oblique cut + skin glow automatically. */}
      <button
        onClick={togglePlay}
        className="ew-btn ew-btn--primary"
        style={{ padding: 0, width: 36, height: 36, justifyContent: 'center' }}
        aria-label={isPlaying ? 'Pause' : 'Play'}
      >
        <span className="ew-icon ew-icon--16" aria-hidden="true">
          <svg><use href={isPlaying ? '#i-pause' : '#i-play'}/></svg>
        </span>
      </button>

      {/* Time + waveform seekbar (task #60) */}
      <span
        className="text-[10px] w-10 text-right flex-shrink-0 tabular-nums"
        style={{ color: 'var(--ew-text-faint)', fontFamily: 'var(--ew-font-mono)', letterSpacing: '0.08em' }}
      >{fmtTime(currentTime)}</span>
      <div
        ref={progressRef}
        onClick={handleProgressClick}
        className="flex-1 h-12 cursor-pointer group relative"
        title="Click anywhere on the waveform to seek"
      >
        {peaks.length > 0 ? (
          <>
            <Waveform
              peaks={peaks}
              mode="real"
              progressPct={duration ? currentTime / duration : 0}
              playheadPct={duration ? currentTime / duration : undefined}
              height={40}
              barGap={0}
              minBarPx={1}
              aria-label={`${currentSong.title} waveform — click to seek`}
            />
            {/* Minute tick marks overlaid on the waveform */}
            {minuteMarkers.map((leftPct, i) => (
              <div
                key={i}
                className="absolute top-1 bottom-1 w-px pointer-events-none"
                style={{ left: `${leftPct}%`, background: 'var(--ew-border-strong)' }}
              />
            ))}
          </>
        ) : (
          // Fallback thin progress bar while peaks decode, so the
          // transport doesn't flash empty during the ~200–600 ms between
          // audioUrl change and first paint.
          <div
            className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-1.5 overflow-hidden"
            style={{ background: 'var(--ew-surface-sunken)', border: '1px solid var(--ew-border)' }}
          >
            <div
              className="h-full transition-all"
              style={{ width: `${pct}%`, background: 'var(--ew-primary)' }}
            />
          </div>
        )}
      </div>
      <span
        className="text-[10px] w-10 flex-shrink-0 tabular-nums"
        style={{ color: 'var(--ew-text-faint)', fontFamily: 'var(--ew-font-mono)', letterSpacing: '0.08em' }}
      >{fmtTime(duration)}</span>

      {/* Volume — sprite-driven, currentColor follows skin text-muted */}
      <button
        onClick={toggleMute}
        className="transition-colors flex-shrink-0"
        style={{ color: 'var(--ew-text-faint)', background: 'transparent', border: 'none', padding: 4, cursor: 'pointer' }}
        onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--ew-text)')}
        onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--ew-text-faint)')}
        aria-label={isMuted || volume === 0 ? 'Unmute' : 'Mute'}
      >
        <span className="ew-icon ew-icon--14">
          <svg><use href={isMuted || volume === 0 ? '#i-volume-mute' : '#i-volume'}/></svg>
        </span>
      </button>
      <input
        type="range" min="0" max="1" step="0.01" value={isMuted ? 0 : volume}
        onChange={(e) => { setVolume(Number(e.target.value)); setIsMuted(false); }}
        className="w-16 h-1 flex-shrink-0"
        style={{ accentColor: 'var(--ew-primary)' }}
      />

      <span
        className="text-[9px] flex-shrink-0"
        style={{ color: 'var(--ew-text-faint)', fontFamily: 'var(--ew-font-mono)', letterSpacing: '0.18em', textTransform: 'uppercase' }}
      >Gener8</span>
    </div>
  );
}

// Internal navigation views for Gener8
type Gener8View = 'create' | 'library' | 'profile' | 'song' | 'playlist' | 'search';

// Sidebar nav icons (vertical strip on left).
//
// EWDS retheme 2026-04-25: emoji icons replaced with sprite refs so the
// glyphs follow the skin (Classic = thicker stroke, Terminal = mono caps).
// Tiles inherit chamfer from the active skin via clip-path on hover/active
// surfaces. No more rounded-lg, no more raw bg-s3-panel — chrome reads from
// --ew-chrome-bg / --ew-chrome-border.
function Gener8Nav({
  currentView, onNavigate,
}: {
  currentView: Gener8View;
  onNavigate: (v: Gener8View) => void;
}) {
  const items: { view: Gener8View; iconId: string; label: string }[] = [
    { view: 'create',  iconId: 'i-zap',    label: 'Create'  },
    { view: 'library', iconId: 'i-music',  label: 'Library' },
    { view: 'search',  iconId: 'i-search', label: 'Search'  },
  ];

  return (
    <div
      className="w-12 flex-shrink-0 flex flex-col items-center gap-1 py-3"
      style={{
        background: 'var(--ew-chrome-bg)',
        borderRight: '1px solid var(--ew-chrome-border)',
      }}
    >
      {/* S³ Logo — chamfered glyph tile, primary-tinted */}
      <button
        onClick={() => onNavigate('create')}
        title="S³ Gener8"
        className="w-8 h-8 flex items-center justify-center mb-3 cursor-pointer transition-colors"
        style={{
          background: 'var(--ew-primary-soft)',
          border: '1px solid var(--ew-border-strong)',
          clipPath: 'var(--ew-clip-button-sm)',
          color: 'var(--ew-primary)',
          fontFamily: 'var(--ew-font-display)',
          fontSize: 11,
          fontWeight: 800,
          letterSpacing: '0.04em',
        }}
      >
        S³
      </button>

      {items.map(item => {
        const active = currentView === item.view;
        return (
          <button
            key={item.view}
            onClick={() => onNavigate(item.view)}
            title={item.label}
            className="w-10 h-10 flex items-center justify-center transition-colors"
            style={{
              background: active ? 'var(--ew-primary-soft)' : 'transparent',
              color: active ? 'var(--ew-primary)' : 'var(--ew-text-faint)',
              border: '1px solid transparent',
              borderColor: active ? 'var(--ew-primary)' : 'transparent',
              clipPath: 'var(--ew-clip-button-sm)',
            }}
            onMouseEnter={(e) => {
              if (!active) {
                e.currentTarget.style.color = 'var(--ew-text-muted)';
                e.currentTarget.style.background = 'var(--ew-surface)';
              }
            }}
            onMouseLeave={(e) => {
              if (!active) {
                e.currentTarget.style.color = 'var(--ew-text-faint)';
                e.currentTarget.style.background = 'transparent';
              }
            }}
          >
            <span className="ew-icon ew-icon--16" aria-hidden="true">
              <svg><use href={`#${item.iconId}`}/></svg>
            </span>
          </button>
        );
      })}
    </div>
  );
}

export default function Gener8Core() {
  const { isMobile } = useResponsive();
  const { user, token, isAuthenticated, isLoading: authLoading, setupUser, logout, hasTier } = useAuth();
  const audio = useShellAudio();
  const songStore = useSongStore();
  const { activeWorkspaceId, addSongToWorkspace } = useWorkspace();

  // ── Internal state ──────────────────────────────────────────
  const [currentView, setCurrentView] = useState<Gener8View>('create');
  // 2026-05-02 SGT real-refactor: songs + likedSongIds are now owned by
  // SongStoreProvider. Read via songStore. All mutations go through the
  // store (addSong / updateSong / removeSong / toggleLike). Local state
  // for `songs` / `likedSongIds` is gone — single source of truth.
  const songs = songStore.songs;
  const likedSongIds = songStore.likedSongIds;
  const [playlists, setPlaylists] = useState<Playlist[]>([]);

  const [selectedSong, setSelectedSong] = useState<Song | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [showRightSidebar, setShowRightSidebar] = useState(false);
  const [mobileShowList, setMobileShowList] = useState(false);

  // Resizable CreatePanel
  const [createPanelWidth, setCreatePanelWidth] = useState(420);
  const [isResizing, setIsResizing] = useState(false);
  const resizeRef = useRef<{ startX: number; startWidth: number } | null>(null);

  // Modals
  const [isCreatePlaylistModalOpen, setIsCreatePlaylistModalOpen] = useState(false);
  const [isAddToPlaylistModalOpen, setIsAddToPlaylistModalOpen] = useState(false);
  const [songToAddToPlaylist, setSongToAddToPlaylist] = useState<Song | null>(null);
  const [isVideoModalOpen, setIsVideoModalOpen] = useState(false);
  const [songForVideo, setSongForVideo] = useState<Song | null>(null);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [showUsernameModal, setShowUsernameModal] = useState(false);

  // Sub-views
  const [viewingUsername, setViewingUsername] = useState<string | null>(null);
  const [viewingSongId, setViewingSongId] = useState<string | null>(null);
  const [viewingPlaylistId, setViewingPlaylistId] = useState<string | null>(null);

  const [reuseData, setReuseData] = useState<{ song: Song; timestamp: number; mode?: 'reuse' | 'cover' } | null>(null);

  // ── Open UpgradeModal from shell (trial expiry CTA) ──────────
  // 2026-05-06 SGT, launch day. The TrialExpiredScreen dispatches
  // 's3:open-upgrade' → shell opens Gener8 → this listener opens
  // the modal inside Gener8.
  useEffect(() => {
    const handler = () => setShowUpgradeModal(true);
    window.addEventListener('s3:open-upgrade', handler);
    return () => window.removeEventListener('s3:open-upgrade', handler);
  }, []);

  // Generation tracking
  const activeJobsRef = useRef<Map<string, { tempId: string; pollInterval: ReturnType<typeof setInterval> }>>(new Map());
  const [activeJobCount, setActiveJobCount] = useState(0);

  // Toast pipe — pushes through the global ToastHost mounted in App.tsx.
  // Local stateful Toast was removed 2026-05-02 (T1, COWORK-BRIEF v3 §1).
  const showToast = useCallback((message: string, type: ToastType = 'success') => {
    const kind: ToastKind = type === 'error' ? 'error' : type === 'info' ? 'info' : 'success';
    showToastImperative({ kind, message });
  }, []);

  // ── Resize drag handlers for CreatePanel ──────────────────
  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    resizeRef.current = { startX: e.clientX, startWidth: createPanelWidth };
    setIsResizing(true);
  }, [createPanelWidth]);

  useEffect(() => {
    if (!isResizing) return;
    const handleMouseMove = (e: MouseEvent) => {
      if (!resizeRef.current) return;
      const delta = e.clientX - resizeRef.current.startX;
      const newWidth = Math.max(320, Math.min(700, resizeRef.current.startWidth + delta));
      setCreatePanelWidth(newWidth);
    };
    const handleMouseUp = () => {
      setIsResizing(false);
      resizeRef.current = null;
    };
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing]);

  // Auth prompt removed — login is now handled at the Everywear shell level
  // by LockScreen.tsx. Gener8Core only renders when authenticated.

  // ── Songs are loaded by SongStoreProvider ──────────────────
  // The provider fetches getMySongs + getLikedSongs once when auth becomes
  // available, exposes them via useSongStore(). Library / Vid applets read
  // from the same store, so the store hydrates regardless of which applet
  // mounts first. The previous "Load songs" useEffect that lived here only
  // fired when Gener8 was open — that was the bug Sean hit on 2026-05-02.

  // ── Load playlists ──────────────────────────────────────────
  useEffect(() => {
    if (token) {
      playlistsApi.getMyPlaylists(token)
        .then(res => setPlaylists(res.playlists))
        .catch(err => console.error('Failed to load playlists', err));
    }
  }, [token]);

  // ── Cleanup jobs on unmount ─────────────────────────────────
  useEffect(() => {
    return () => {
      activeJobsRef.current.forEach(({ pollInterval }) => clearInterval(pollInterval));
      activeJobsRef.current.clear();
    };
  }, []);

  // ── Lazy waveform peaks analysis for just-generated songs ───
  //
  // When a song arrives with audioUrl but no real peaks yet, kick off
  // analyseWaveformCached. Scoped to "recent" songs only so we don't
  // storm the network on library load. Marks peaksAttempted to prevent
  // retry loops on failure.
  //
  // RECENT_MS calibration (2026-04-19): was 60_000, which silently skipped
  // every cold-start generation (~165s end-to-end) — the song arrives in
  // the list with a createdAt that's already >60s old, so the guard bails
  // before the analyser fires. Bumped to 10 minutes so just-finished
  // tracks always get their real waveform analysed; library backfills
  // remain gated out by this same guard.
  const peaksInFlightRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const now = Date.now();
    const RECENT_MS = 600_000;

    for (const song of songs) {
      if (!song.audioUrl) continue;
      if (song.peaksReady || song.peaksAttempted) continue;
      if (peaksInFlightRef.current.has(song.id)) continue;
      const createdAtMs = song.createdAt instanceof Date
        ? song.createdAt.getTime()
        : song.createdAt ? new Date(song.createdAt).getTime() : 0;
      if (!createdAtMs || now - createdAtMs > RECENT_MS) continue;

      // Claim, mark analysing, fire analyser.
      peaksInFlightRef.current.add(song.id);
      songStore.updateSong(song.id, { isAnalysing: true });

      (async () => {
        try {
          // 400-bin analysis to match fauxPeaks density and the visual
          // smoothness of the bottom transport (800 bins). Cache key in
          // analyseWaveformCached is `${url}|${bins}` so this re-analyses
          // on first hit but doesn't conflict with prior 120-bin entries.
          const data = await analyseWaveformCached(song.audioUrl!, 400);
          songStore.updateSong(song.id, {
            peaks: data.peaks,
            peaksReady: true,
            peaksAttempted: true,
            isAnalysing: false,
          });
        } catch (err) {
          console.warn('Waveform analysis failed for', song.id, err);
          songStore.updateSong(song.id, { peaksAttempted: true, isAnalysing: false });
        } finally {
          peaksInFlightRef.current.delete(song.id);
        }
      })();
    }
  }, [songs]);

  // ── Handlers ────────────────────────────────────────────────
  const handleReuse = (song: Song) => {
    setReuseData({ song, timestamp: Date.now(), mode: 'reuse' });
    setCurrentView('create');
    setMobileShowList(false);
  };

  const handleCover = (song: Song) => {
    const hasGener8ProForCoverAction = hasTier('gener8_pro');
    if (!hasGener8ProForCoverAction) {
      showToast('Reference and Cover require Gener8 Pro.', 'info');
      setShowUpgradeModal(true);
      return;
    }

    const sourceAudioUrl = getAudioRequestPath(
      song.audio_key ? `/audio/${song.audio_key}` : (song.audioUrl || song.audio_url),
    );
    if (!sourceAudioUrl) {
      showToast('This track has no local audio file to use as a Cover source.', 'error');
      return;
    }

    setReuseData({
      song: {
        ...song,
        audioUrl: sourceAudioUrl,
        audio_url: sourceAudioUrl,
      },
      timestamp: Date.now(),
      mode: 'cover',
    });
    setCurrentView('create');
    setMobileShowList(false);
    showToast('Loaded source track for AI Cover.', 'info');
  };

  const handleSongUpdate = (updatedSong: Song) => {
    songStore.updateSong(updatedSong.id, updatedSong);
    if (selectedSong?.id === updatedSong.id) setSelectedSong(updatedSong);
  };

  const handleNavigateToProfile = (username: string) => {
    setViewingUsername(username);
    setCurrentView('profile');
  };

  const handleNavigateToSong = (songId: string) => {
    setViewingSongId(songId);
    setCurrentView('song');
  };

  const handleNavigateToPlaylist = (playlistId: string) => {
    setViewingPlaylistId(playlistId);
    setCurrentView('playlist');
  };

  const cleanupJob = useCallback((jobId: string, tempId: string) => {
    const jobData = activeJobsRef.current.get(jobId);
    if (jobData) {
      clearInterval(jobData.pollInterval);
      activeJobsRef.current.delete(jobId);
    }
    songStore.removeSong(tempId);
    setActiveJobCount(activeJobsRef.current.size);
    if (activeJobsRef.current.size === 0) setIsGenerating(false);
  }, [songStore]);

  const finishJob = useCallback((jobId: string) => {
    const jobData = activeJobsRef.current.get(jobId);
    if (jobData) {
      clearInterval(jobData.pollInterval);
      activeJobsRef.current.delete(jobId);
    }
    setActiveJobCount(activeJobsRef.current.size);
    if (activeJobsRef.current.size === 0) setIsGenerating(false);
  }, []);

  // Trigger a refresh from the shim through the shared store. Replaces
  // the previous duplicated mapper + sort pass; the store now owns the
  // canonical fetch + dedupe logic so we just fire its refetch.
  const refreshSongsList = useCallback(async () => {
    await songStore.refetch();
  }, [songStore]);

  const handleGenerate = async (params: GenerationParams) => {
    if (!isAuthenticated || !token) {
      setShowUsernameModal(true);
      return;
    }

    // 2026-05-05 SGT — If models were unloaded (e.g. for Video export),
    // bail early with an actionable toast instead of failing silently.
    if (areModelsUnloaded()) {
      showToast('Models unloaded (Video used GPU). Go to Settings → System and click Reload Models.', 'error');
      return;
    }

    setIsGenerating(true);
    setCurrentView('create');
    setMobileShowList(false);

    const tempId = `temp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const tempSong: Song = {
      id: tempId,
      title: params.title || 'Generating...',
      lyrics: '', style: params.style,
      coverUrl: 'https://picsum.photos/200/200?blur=10',
      duration: '--:--',
      createdAt: new Date(),
      isGenerating: true,
      // 2026-05-04 SGT (#36): Simple/Custom toggle killed; tag stays
      // "custom" for all new generations.
      tags: ['custom'],
      isPublic: true,
      // Deterministic faux waveform + timer anchor so the progress strip
      // can animate from the real job start.
      // Temp/generating song. 400-bin density to match the post-generation
      // analyser output, so the waveform doesn't visibly re-grain when the
      // real peaks land. (2026-04-25 SGT, Sean.)
      fauxPeaks: seededFauxPeaks(tempId, { bins: 400 }),
      generationStartedAt: Date.now(),
    };

    songStore.addSong(tempSong);
    setSelectedSong(tempSong);
    setShowRightSidebar(true);

    try {
      const job = await generateApi.startGeneration(params, token);

      const pollInterval = setInterval(async () => {
        try {
          const status = await generateApi.getStatus(job.jobId, token);

          // 2026-05-16 SGT: Reset consecutive failure counter on any
          // successful poll (even if status is still "loading").
          const jobEntry = activeJobsRef.current.get(job.jobId);
          if (jobEntry) (jobEntry as any)._pollFailures = 0;

          songStore.updateSong(tempId, {
            queuePosition: status.status === 'queued' ? status.queuePosition : undefined,
          });

          if (status.status === 'succeeded' && status.result) {
            finishJob(job.jobId);

            // Persist generation result into Everywear Vault.
            // Shim already wrote audio to the Vault-backed music path and
            // returned audioUrls + audioKey in the status envelope. Without
            // this POST the Vault-backed song list has nothing to show.
            let persisted = false;
            try {
              const audioRef =
                status.result.audioKey
                  ? `/audio/${status.result.audioKey}`
                  : (status.result.audioUrls && status.result.audioUrls[0]) || '';
              if (audioRef) {
                const persistResult = await songsApi.createSong({
                  title: params.title || 'Untitled',
                  style: params.style || '',
                  lyrics: params.lyrics || '',
                  audio_url: audioRef,
                  duration: typeof status.result.duration === 'number'
                    ? status.result.duration
                    : undefined,
                  bpm: (status.result as any).bpm ?? undefined,
                  key_scale: (status.result as any).keyScale ?? undefined,
                  time_signature: (status.result as any).timeSignature ?? undefined,
                  tags: ['custom'],
                  is_public: false,
                  generation_params: params as unknown as Record<string, unknown>,
                }, token);
                if (persistResult?.song) {
                  songStore.removeSong(tempId);
                  songStore.addSong({
                    ...persistResult.song,
                    fauxPeaks: (persistResult.song as any).fauxPeaks ?? seededFauxPeaks(persistResult.song.id, { bins: 400 }),
                    peaksAttempted: false,
                  } as any);
                  setSelectedSong(persistResult.song);
                  persisted = true;
                }
                // 2026-05-05 SGT: Auto-tag new generation into active workspace
                if (activeWorkspaceId && persistResult?.song?.id) {
                  addSongToWorkspace(persistResult.song.id, activeWorkspaceId);
                }
              } else {
                console.warn(`Job ${job.jobId} succeeded but no audio reference; skipping library write`);
              }
            } catch (persistErr) {
              console.error(`Failed to persist track for job ${job.jobId}:`, persistErr);
            } finally {
              if (!persisted) {
                songStore.updateSong(tempId, {
                  isGenerating: false,
                  statusMessage: 'Generation finished, but Vault registration did not complete.',
                } as Partial<Song>);
                showToast('Generation finished, but Vault registration failed. Check logs before retrying.', 'error');
              }
            }

            await refreshSongsList();
          } else if (status.status === 'loading') {
            // 2026-05-16 SGT: Engine is loading model into CUDA VRAM.
            // Non-terminal; keep polling. Update temp song so user sees feedback.
            songStore.updateSong(tempId, {
              queuePosition: undefined,
              ...(status.message ? { statusMessage: status.message } : {}),
            } as Partial<Song>);
          } else if (status.status === 'failed') {
            cleanupJob(job.jobId, tempId);
            showToast(`Generation failed: ${status.error || 'Unknown error'}`, 'error');
          }
        } catch (pollErr) {
          // 2026-05-16 SGT: Transient network errors during GPU model load
          // should not kill the job. Only abort after 3 consecutive poll
          // failures, giving the engine time to finish CUDA init.
          const jobEntry = activeJobsRef.current.get(job.jobId);
          if (jobEntry) {
            const failures = ((jobEntry as any)._pollFailures ?? 0) + 1;
            (jobEntry as any)._pollFailures = failures;
            if (failures >= 3) {
              console.error(`Job ${job.jobId}: ${failures} consecutive poll failures, aborting`, pollErr);
              cleanupJob(job.jobId, tempId);
            } else {
              console.warn(`Job ${job.jobId}: poll failure ${failures}/3, retrying...`, pollErr);
            }
          } else {
            // Job already cleaned up elsewhere
            cleanupJob(job.jobId, tempId);
          }
        }
      }, 2000);

      activeJobsRef.current.set(job.jobId, { tempId, pollInterval });
      setActiveJobCount(activeJobsRef.current.size);

      setTimeout(() => {
        if (activeJobsRef.current.has(job.jobId)) {
          cleanupJob(job.jobId, tempId);
          showToast('Generation timed out', 'error');
        }
      }, 600000);
    } catch (e: any) {
      console.error('Generation error:', e);
      songStore.removeSong(tempId);
      if (activeJobsRef.current.size === 0) setIsGenerating(false);
      // Detect engine-down (fetch refused / network error) vs other failures
      const isNetworkErr = e?.message?.includes('fetch') || e?.message?.includes('network') || e?.name === 'TypeError';
      if (isNetworkErr || areModelsUnloaded()) {
        showToast('Engine offline. Go to Settings → System and click Reload Models.', 'error');
      } else {
        showToast('Generation failed. Please try again.', 'error');
      }
    }
  };

  const playSong = (song: Song, list?: Song[]) => {
    audio.playSong(song, list || songs);
    setSelectedSong(song);
    setShowRightSidebar(true);
  };

  const openVideoGenerator = (song: Song) => {
    // In Everywear mode, dispatch intent to open Vid applet
    try {
      openVidWithSong('gener8', song.id, song.title);
      return;
    } catch { /* fall through */ }

    setSongForVideo(song);
    setIsVideoModalOpen(true);
  };

  const openDaw = (song: Song) => {
    try {
      sendToStudio('gener8', song.id, song.title);
    } catch { /* fallback: no-op outside Everywear */ }
  };

  const toggleLike = async (songId: string) => {
    if (!token) return;
    const isLiked = likedSongIds.has(songId);
    const currentSong = songs.find(s => s.id === songId);
    const baseCount = currentSong?.likeCount || 0;

    // Optimistic update via the store. Both like-set and likeCount mutate
    // through songStore so other applets see the change immediately.
    songStore.toggleLike(songId);
    songStore.updateSong(songId, {
      likeCount: Math.max(0, baseCount + (isLiked ? -1 : 1)),
    });

    try {
      await songsApi.toggleLike(songId, token);
    } catch {
      // Revert: toggle the set back, restore the count.
      songStore.toggleLike(songId);
      songStore.updateSong(songId, { likeCount: baseCount });
    }
  };

  const handleDeleteSong = async (song: Song) => {
    if (!token) return;
    const directConfirmed = (window as any).__s3DeleteConfirmedSongId === song.id;
    if (directConfirmed) {
      delete (window as any).__s3DeleteConfirmedSongId;
    }
    const skipConfirm = localStorage.getItem('s3studio:skip_delete_confirm') === '1';
    const confirmed =
      directConfirmed ||
      skipConfirm ||
      window.confirm(`Are you sure you want to delete "${song.title}"?`);
    if (!confirmed) return;

    try {
      await songsApi.deleteSong(song.id, token);
      // Store's removeSong cascades the like / dislike set cleanup, so a
      // single call covers both the songs list and the liked filter view.
      songStore.removeSong(song.id);
      if (selectedSong?.id === song.id) setSelectedSong(null);
      if (audio.currentSong?.id === song.id) {
        // Can't stop shell audio from here — just clear selection
      }
      showToast('Song deleted successfully');
    } catch {
      showToast('Failed to delete song', 'error');
    }
  };

  const createPlaylist = async (name: string, description: string) => {
    if (!token) return;
    try {
      const res = await playlistsApi.create(name, description, true, token);
      setPlaylists(prev => [res.playlist, ...prev]);
      if (songToAddToPlaylist) {
        await playlistsApi.addSong(res.playlist.id, songToAddToPlaylist.id, token);
        setSongToAddToPlaylist(null);
        playlistsApi.getMyPlaylists(token).then(r => setPlaylists(r.playlists));
      }
      showToast('Playlist created!');
    } catch {
      showToast('Failed to create playlist', 'error');
    }
  };

  const addSongToPlaylist = async (playlistId: string) => {
    if (!songToAddToPlaylist || !token) return;
    try {
      await playlistsApi.addSong(playlistId, songToAddToPlaylist.id, token);
      setSongToAddToPlaylist(null);
      showToast('Song added to playlist');
      playlistsApi.getMyPlaylists(token).then(r => setPlaylists(r.playlists));
    } catch {
      showToast('Failed to add song', 'error');
    }
  };

  const handleUsernameSubmit = async (username: string) => {
    await setupUser(username);
    setShowUsernameModal(false);
  };

  // ── Render ──────────────────────────────────────────────────
  const renderContent = () => {
    switch (currentView) {
      case 'library':
        return <VaultLibraryView />;

      case 'profile':
        if (!viewingUsername) return null;
        return (
          <UserProfile
            username={viewingUsername}
            onBack={() => { setViewingUsername(null); setCurrentView('create'); }}
            onPlaySong={playSong}
            onNavigateToProfile={handleNavigateToProfile}
            onNavigateToPlaylist={handleNavigateToPlaylist}
            currentSong={audio.currentSong}
            isPlaying={audio.isPlaying}
            likedSongIds={likedSongIds}
            onToggleLike={toggleLike}
          />
        );

      case 'playlist':
        if (!viewingPlaylistId) return null;
        return (
          <PlaylistDetail
            playlistId={viewingPlaylistId}
            onBack={() => { setViewingPlaylistId(null); setCurrentView('library'); }}
            onPlaySong={playSong}
            onSelect={(s) => { setSelectedSong(s); setShowRightSidebar(true); }}
            onNavigateToProfile={handleNavigateToProfile}
          />
        );

      case 'song':
        if (!viewingSongId) return null;
        return (
          <SongProfile
            songId={viewingSongId}
            onBack={() => { setViewingSongId(null); setCurrentView('create'); }}
            onPlay={playSong}
            onNavigateToProfile={handleNavigateToProfile}
            currentSong={audio.currentSong}
            isPlaying={audio.isPlaying}
            likedSongIds={likedSongIds}
            onToggleLike={toggleLike}
          />
        );

      case 'search':
        return (
          <SearchPage
            onPlaySong={playSong}
            currentSong={audio.currentSong}
            isPlaying={audio.isPlaying}
            onNavigateToProfile={handleNavigateToProfile}
            onNavigateToSong={handleNavigateToSong}
            onNavigateToPlaylist={handleNavigateToPlaylist}
          />
        );

      case 'create':
      default:
        return (
          <div className={`flex h-full overflow-hidden relative w-full ${isResizing ? 'select-none cursor-col-resize' : ''}`}>
            {/* Create Panel — resizable */}
            <div
              className={`
                ${mobileShowList ? 'hidden md:flex' : 'flex'}
                flex-shrink-0 h-full bg-s3-panel relative z-10
              `}
              style={{ width: mobileShowList ? undefined : `${createPanelWidth}px` }}
            >
              <div className="flex-1 h-full overflow-hidden">
                <CreatePanel
                  onGenerate={handleGenerate}
                  isGenerating={isGenerating}
                  initialData={reuseData}
                  onOpenUpgrade={() => setShowUpgradeModal(true)}
                />
              </div>
              {/* Resize handle */}
              <div
                onMouseDown={handleResizeStart}
                className="s3-family-resize-handle w-[5px] h-full cursor-col-resize flex-shrink-0 relative transition-colors duration-150"
                data-active={isResizing ? 'true' : 'false'}
                title="Drag to resize"
              >
                <div className="absolute inset-y-0 -left-1 -right-1" />
              </div>
            </div>

            {/* Song List */}
            <div className={`
              ${!mobileShowList ? 'hidden md:flex' : 'flex'}
              flex-1 flex-col h-full overflow-hidden bg-s3
            `}>
              <SongList
                songs={songs}
                currentSong={audio.currentSong}
                selectedSong={selectedSong}
                likedSongIds={likedSongIds}
                isPlaying={audio.isPlaying}
                onPlay={playSong}
                onSelect={(s) => { setSelectedSong(s); setShowRightSidebar(true); }}
                onToggleLike={toggleLike}
                onAddToPlaylist={(song) => { setSongToAddToPlaylist(song); setIsAddToPlaylistModalOpen(true); }}
                onOpenVideo={openVideoGenerator}
                onShowDetails={(song) => { setSelectedSong(song); }}
                onNavigateToProfile={handleNavigateToProfile}
                onReusePrompt={handleReuse}
                onCover={handleCover}
                onDelete={handleDeleteSong}
              />
            </div>

            {/* Right Sidebar */}
            {showRightSidebar && selectedSong && (
              <div className="hidden xl:block w-[360px] flex-shrink-0 h-full bg-s3-panel ew-v2-bevel relative z-10 border-l border-[color:var(--ew-border)]">
                <RightSidebar
                  song={selectedSong}
                  onClose={() => setShowRightSidebar(false)}
                  onOpenVideo={() => selectedSong && openVideoGenerator(selectedSong)}
                  onSendToDaw={(song) => openDaw(song)}
                  onReuse={handleReuse}
                  onCover={handleCover}
                  onSongUpdate={handleSongUpdate}
                  onNavigateToProfile={handleNavigateToProfile}
                  onNavigateToSong={handleNavigateToSong}
                  isLiked={likedSongIds.has(selectedSong.id)}
                  onToggleLike={toggleLike}
                  onPlay={playSong}
                  isPlaying={audio.isPlaying}
                  currentSong={audio.currentSong}
                  onDelete={handleDeleteSong}
                />
              </div>
            )}

            {/* Mobile Toggle */}
            {isMobile && (
              <div className="absolute top-4 right-4 z-50">
                <button
                  onClick={() => setMobileShowList(!mobileShowList)}
                  className="ew-btn ew-btn--primary flex items-center gap-2 text-sm font-bold"
                >
                  {mobileShowList ? 'Create Song' : 'View List'}
                  <List size={16} />
                </button>
              </div>
            )}
          </div>
        );
    }
  };

  return (
    <div className="s3-family-route flex flex-col h-full bg-s3 text-[color:var(--ew-text)] font-sans antialiased overflow-hidden">
      <div className="flex flex-1 overflow-hidden">
        {/* Internal nav strip */}
        <Gener8Nav currentView={currentView} onNavigate={setCurrentView} />

        {/* Main content area */}
        <main className="flex-1 flex overflow-hidden relative">
          {renderContent()}
        </main>
      </div>

      {/* Gener8 Transport — own player bar */}
      <Gener8Transport audio={audio} />

      {/* Modals — scoped to Gener8 */}
      <CreatePlaylistModal
        isOpen={isCreatePlaylistModalOpen}
        onClose={() => setIsCreatePlaylistModalOpen(false)}
        onCreate={createPlaylist}
      />
      <AddToPlaylistModal
        isOpen={isAddToPlaylistModalOpen}
        onClose={() => setIsAddToPlaylistModalOpen(false)}
        playlists={playlists}
        onSelect={addSongToPlaylist}
        onCreateNew={() => { setIsAddToPlaylistModalOpen(false); setIsCreatePlaylistModalOpen(true); }}
      />
      <VideoGeneratorModal
        isOpen={isVideoModalOpen}
        onClose={() => setIsVideoModalOpen(false)}
        song={songForVideo}
      />
      <UsernameModal
        isOpen={showUsernameModal}
        onSubmit={handleUsernameSubmit}
      />
      <SettingsModal
        isOpen={showSettingsModal}
        onClose={() => setShowSettingsModal(false)}
        theme="dark"
        onToggleTheme={() => {}}
        onNavigateToProfile={handleNavigateToProfile}
      />
      <UpgradeModal
        isOpen={showUpgradeModal}
        onClose={() => setShowUpgradeModal(false)}
      />
      {/* Global EWDS ToastHost (mounted in App.tsx) renders this applet's
          toasts. No local stack needed — see showToast above. */}
    </div>
  );
}
