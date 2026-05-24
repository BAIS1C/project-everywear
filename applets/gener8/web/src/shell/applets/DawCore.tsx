// @ts-nocheck
/**
 * DawCore — S3 DAW applet for the Everywear shell.
 *
 * Tabbed interface combining:
 *   - Timeline: Multi-track arrangement view (StudioTab) — populated from extracted stems
 *   - Stems: 12-track stem separation + per-stem regen (StemStudio)
 *   - Lego: Visual block editor for stem recombination
 *   - Complete: Track extension/continuation interface
 *
 * Receives songs via the Intent Bus (send-to-studio action).
 * Lifts extracted stem state so Timeline tab can render real tracks.
 * Performs licence check before allowing import; auto-triggers stem separation.
 */
import React, { useState, useCallback, useEffect, useRef } from 'react';
import StudioTab from '@/components/studio/StudioTab';
import StemStudio from '@/components/studio/StemStudio';
import MixAssistantTab from '@/components/studio/MixAssistantTab';
import { LegoPanel } from '@/components/studio/LegoPanel';
import { CompletePanel } from '@/components/studio/CompletePanel';
import { Music, Layers, Flame, Lock, Blocks, ArrowRight, Activity } from 'lucide-react';
import { useSongStore } from '@/shell/SongStoreContext';
import { intentBus, ensureModel } from '@/shell/intentBus';
import { useAuth } from '@/context/AuthContext';
import { useMixer } from '@/components/studio/useMixer';
import type { Song } from '@/types';
import type { TrackName } from '@/services/api';
import { TRACK_NAMES } from '@/services/api';
import { dawApi, type StemUrlEntry } from '@/services/dawApi';

type DawTab = 'timeline' | 'stems' | 'analysis' | 'lego' | 'complete';

export default function DawCore() {
  const [activeTab, setActiveTab] = useState<DawTab>('stems');
  const [pendingSong, setPendingSong] = useState<Song | null>(null);
  const [showUpgrade, setShowUpgrade] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const { songs } = useSongStore();
  const { hasTier } = useAuth();

  // Lifted stem state: shared between StemStudio (producer) and other tabs (consumers)
  const [extractedStems, setExtractedStems] = useState<Record<TrackName, string | null> | null>(null);
  const [sourceAudioUrl, setSourceAudioUrl] = useState<string | null>(null);
  const [trackTitle, setTrackTitle] = useState<string>('');
  const [trackDuration, setTrackDuration] = useState<number>(0);
  const [trackBpm, setTrackBpm] = useState<number | undefined>(undefined);
  const [trackKey, setTrackKey] = useState<string | undefined>(undefined);

  // Whether we've synced stems to the Rust DAW engine
  const [engineSynced, setEngineSynced] = useState(false);
  const [engineError, setEngineError] = useState<string | null>(null);

  // Shared AudioMixer: lives at DawCore level so all tabs share one instance
  const mixer = useMixer(extractedStems);

  const switchTab = useCallback((tab: DawTab) => setActiveTab(tab), []);

  // DAW is a Creator Studio surface. The UI gate references AuthContext;
  // the Rust /api/daw/* routes enforce the same reconciled tier.
  const hasLicence = hasTier('creator_studio');

  // Ensure xl-base model is loaded before any DAW operations
  useEffect(() => {
    if (!hasLicence) return;
    ensureModel('base').then(ok => {
      if (!ok) console.warn('[DAW] Failed to ensure base model on startup');
    });
  }, [hasLicence]);

  // Listen for cross-app intents (send-to-studio from Gener8, RightSidebar, etc.)
  useEffect(() => {
    const unsub = intentBus.subscribe('daw-pro', (intent) => {
      if (intent.action === 'send-to-studio' && intent.payload?.songId) {
        const song = songs.find(s => s.id === intent.payload!.songId);
        if (song) {
          if (!hasLicence) {
            setPendingSong(song);
            setShowUpgrade(true);
          } else {
            setPendingSong(song);
            setActiveTab('stems');
            setShowUpgrade(false);
            // Store track metadata
            setTrackTitle(song.title || 'Untitled');
            if (song.bpm) setTrackBpm(song.bpm);
            if (song.key_scale) setTrackKey(song.key_scale);
          }
        }
      }
    });
    return unsub;
  }, [songs, hasLicence]);

  const handleDismissUpgrade = useCallback(() => {
    setShowUpgrade(false);
    setPendingSong(null);
  }, []);

  const handleOpenUpgrade = useCallback(() => {
    window.dispatchEvent(new CustomEvent('s3:request-upgrade'));
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    // Only set dragOver to false if leaving the main container
    if (e.currentTarget === e.target) {
      setDragOver(false);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(false);

    const data = e.dataTransfer.getData('application/s3-song');
    if (!data) return;

    try {
      const draggedSong = JSON.parse(data) as Partial<Song>;
      if (draggedSong.id && draggedSong.audioUrl) {
        const fullSong = songs.find(s => s.id === draggedSong.id) || (draggedSong as Song);
        if (!hasLicence) {
          setPendingSong(fullSong);
          setShowUpgrade(true);
        } else {
          setPendingSong(fullSong);
          setActiveTab('stems');
          setShowUpgrade(false);
          setTrackTitle(fullSong.title || 'Untitled');
          if (fullSong.bpm) setTrackBpm(fullSong.bpm);
          if (fullSong.key_scale) setTrackKey(fullSong.key_scale);
        }
      }
    } catch (err) {
      console.error('[DawCore] Failed to parse dropped song:', err);
    }
  }, [songs, hasLicence]);

  // Callback from StemStudio when extraction completes.
  // Updates local state AND syncs to Rust DAW engine.
  const handleStemsExtracted = useCallback(async (stems: Record<TrackName, string | null>) => {
    const populated = Object.values(stems).filter(v => v && v !== 'simulated').length;
    console.log(`[DawCore] handleStemsExtracted received: ${populated} real stems`);
    setExtractedStems(stems);
    setEngineError(null);

    // Sync to Rust DAW engine
    if (populated === 0) {
      console.warn('[DawCore] No real stems to sync to engine');
      return;
    }

    try {
      // Ensure engine is initialised
      const engineUp = await dawApi.ensureInit();
      if (!engineUp) {
        console.warn('[DawCore] Rust DAW engine not reachable, skipping sync');
        setEngineError('DAW engine not reachable');
        return;
      }

      // Build stem URL entries for the engine
      const durationMs = Math.round((trackDuration || 240) * 1000);
      const stemEntries: StemUrlEntry[] = TRACK_NAMES
        .filter(tn => stems[tn] && stems[tn] !== 'simulated')
        .map(tn => ({
          track_name: tn,
          audio_url: stems[tn]!,
          duration_ms: durationMs,
        }));

      const result = await dawApi.importStemUrls(
        stemEntries,
        trackTitle || 'Untitled',
        trackBpm,
      );
      console.log(`[DawCore] Synced ${result.track_ids.length} stems to Rust engine`);
      setEngineSynced(true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[DawCore] Failed to sync stems to Rust engine: ${msg}`);
      setEngineError(msg);
      // Not fatal: Web Audio mixer still works for playback
    }
  }, [trackDuration, trackTitle, trackBpm]);

  // Callback from StemStudio when source audio URL is available
  const handleSourceAudioUrl = useCallback((url: string) => {
    setSourceAudioUrl(url);
  }, []);

  return (
    <div
      data-tour="daw.root"
      className="relative h-full flex flex-col bg-[#0A0B0D] text-white overflow-hidden transition-all"
      style={{
        borderWidth: dragOver ? '2px' : '0px',
        borderStyle: 'dashed',
        borderColor: dragOver ? '#00C2FF' : 'transparent',
        boxShadow: dragOver ? '0 0 20px rgba(0, 194, 255, 0.3) inset' : 'none',
      }}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Upgrade Modal Overlay */}
      {showUpgrade && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-[#14151C] border border-white/[0.08] rounded-2xl p-6 max-w-sm mx-4 shadow-2xl">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center">
                <Lock size={18} className="text-cyan-400" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-white">DAW Pro Licence Required</h3>
                <p className="text-[10px] text-white/40">Stem separation + generative DAW</p>
              </div>
            </div>
            <p className="text-xs text-white/50 leading-relaxed mb-4">
              DAW Pro requires a licence for stem separation, multi-track editing,
              and per-stem regeneration. Upgrade to unlock the full production suite.
            </p>
            {pendingSong && (
              <div className="bg-white/[0.03] rounded-lg px-3 py-2 mb-4 border border-white/[0.06]">
                <p className="text-[10px] text-white/30 uppercase tracking-wider">Queued Track</p>
                <p className="text-xs text-white/70 font-medium truncate">{pendingSong.title}</p>
              </div>
            )}
            <div className="flex gap-2">
              <button
                onClick={handleDismissUpgrade}
                className="flex-1 px-3 py-2 text-xs font-medium text-white/50 hover:text-white/70 border border-white/[0.08] rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleOpenUpgrade}
                className="flex-1 px-3 py-2 text-xs font-bold text-black bg-cyan-400 hover:bg-cyan-300 rounded-lg transition-colors"
              >
                Upgrade
              </button>
            </div>
          </div>
        </div>
      )}

      {!hasLicence && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/70 backdrop-blur-sm">
          <div className="bg-[#14151C] border border-white/[0.08] rounded-2xl p-6 max-w-sm mx-4 shadow-2xl">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center">
                <Lock size={18} className="text-cyan-400" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-white">Creator Studio Required</h3>
                <p className="text-[10px] text-white/40">DAW, stems, Lego, Complete</p>
              </div>
            </div>
            <p className="text-xs text-white/50 leading-relaxed mb-4">
              S3 DAW is a Creator Studio surface. Sign in with an active Creator
              Studio licence to use stem separation, timeline editing, and
              generative arrangement tools.
            </p>
            <button
              onClick={handleOpenUpgrade}
              className="w-full px-3 py-2 text-xs font-bold text-black bg-cyan-400 hover:bg-cyan-300 rounded-lg transition-colors"
            >
              View Upgrade Options
            </button>
          </div>
        </div>
      )}

      {/* Tab Bar */}
      <div className="flex items-center gap-0 border-b border-white/[0.06] bg-[#0F1219] shrink-0">
        <TabButton
          tourId="daw.tab.stems"
          active={activeTab === 'stems'}
          onClick={() => switchTab('stems')}
          icon={<Layers size={13} />}
          label="Stems"
        />
        <TabButton
          tourId="daw.tab.timeline"
          active={activeTab === 'timeline'}
          onClick={() => switchTab('timeline')}
          icon={<Music size={13} />}
          label="Timeline"
          disabled={!extractedStems}
          badge={extractedStems ? `${Object.values(extractedStems).filter(Boolean).length}` : undefined}
        />
        <TabButton
          tourId="daw.tab.analysis"
          active={activeTab === 'analysis'}
          onClick={() => switchTab('analysis')}
          icon={<Activity size={13} />}
          label="MixLens"
          disabled={!extractedStems && !sourceAudioUrl}
        />
        <TabButton
          tourId="daw.tab.lego"
          active={activeTab === 'lego'}
          onClick={() => switchTab('lego')}
          icon={<Blocks size={13} />}
          label="Lego"
          disabled={!extractedStems}
        />
        <TabButton
          tourId="daw.tab.complete"
          active={activeTab === 'complete'}
          onClick={() => switchTab('complete')}
          icon={<ArrowRight size={13} />}
          label="Complete"
          disabled={!extractedStems}
        />

        {/* Spacer + DAW badge */}
        <div className="flex-1" />
        {!hasLicence && (
          <div className="px-2 py-1 mr-1 flex items-center gap-1 bg-amber-500/10 border border-amber-500/20 rounded-full">
            <Lock size={9} className="text-amber-400" />
            <span className="text-[8px] font-bold text-amber-400 uppercase tracking-wider">Trial</span>
          </div>
        )}
        {engineSynced && (
          <div className="px-2 py-1 mr-1 flex items-center gap-1 bg-emerald-500/10 border border-emerald-500/20 rounded-full">
            <span className="text-[8px] font-bold text-emerald-400 uppercase tracking-wider">Engine</span>
          </div>
        )}
        {engineError && (
          <div className="px-2 py-1 mr-1 flex items-center gap-1 bg-amber-500/10 border border-amber-500/20 rounded-full" title={engineError}>
            <span className="text-[8px] font-bold text-amber-400 uppercase tracking-wider">Offline</span>
          </div>
        )}
        <div className="px-3 py-1.5 flex items-center gap-1.5">
          <Flame size={11} className="text-cyan-400" />
          <span className="text-[10px] font-bold text-white/30 tracking-wider">
            S3 DAW Pro
          </span>
        </div>
      </div>

      {/* Tab Content — CSS visibility keeps components mounted across tab switches */}
      <div className="flex-1 overflow-hidden relative">
        <div data-tour="daw.stems-panel" className={`absolute inset-0 ${activeTab === 'stems' ? '' : 'hidden'}`}>
          <StemStudio
            initialSong={pendingSong}
            autoExtract={pendingSong !== null && !showUpgrade}
            onStemsExtracted={handleStemsExtracted}
            onSourceAudioUrl={handleSourceAudioUrl}
            onTrackDuration={setTrackDuration}
            mixer={mixer}
          />
        </div>
        <div data-tour="daw.timeline-panel" className={`absolute inset-0 ${activeTab === 'timeline' ? '' : 'hidden'}`}>
          <StudioTab
            stems={extractedStems ?? undefined}
            duration={trackDuration || undefined}
            bpm={trackBpm}
            keySignature={trackKey}
            trackTitle={trackTitle}
            mixer={mixer}
            engineSynced={engineSynced}
          />
        </div>
        <div data-tour="daw.analysis-panel" className={`absolute inset-0 ${activeTab === 'analysis' ? '' : 'hidden'}`}>
          <MixAssistantTab
            stems={extractedStems}
            sourceAudioUrl={sourceAudioUrl}
            trackTitle={trackTitle}
            bpm={trackBpm}
            keySignature={trackKey}
          />
        </div>
        {activeTab === 'lego' && extractedStems && sourceAudioUrl && (
          <div data-tour="daw.lego-panel" className="absolute inset-0">
            <LegoPanel
              stems={extractedStems}
              sourceAudioUrl={sourceAudioUrl}
              duration={trackDuration}
              trackTitle={trackTitle}
            />
          </div>
        )}
        {activeTab === 'complete' && sourceAudioUrl && (
          <div data-tour="daw.complete-panel" className="absolute inset-0">
            <CompletePanel
              sourceAudioUrl={sourceAudioUrl}
              duration={trackDuration}
              trackTitle={trackTitle}
            />
          </div>
        )}
      </div>
    </div>
  );
}

// ── TabButton ──────────────────────────────────────────────────────

function TabButton({
  active,
  onClick,
  icon,
  label,
  badge,
  tourId,
  disabled = false,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  badge?: string;
  tourId?: string;
  disabled?: boolean;
}) {
  return (
    <button
      data-tour={tourId}
      onClick={onClick}
      disabled={disabled}
      className={`
        flex items-center gap-1.5 px-4 py-2.5 text-xs font-semibold transition-all
        border-b-2 -mb-px
        ${disabled
          ? 'text-white/20 border-transparent cursor-not-allowed opacity-50'
          : active
          ? 'text-cyan-400 border-cyan-400 bg-cyan-400/[0.06]'
          : 'text-white/40 border-transparent hover:text-white/60 hover:bg-white/[0.02]'
        }
      `}
    >
      {icon}
      {label}
      {badge && (
        <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-bold ${
          active ? 'bg-cyan-400/20 text-cyan-300' : 'bg-white/[0.06] text-white/30'
        }`}>
          {badge}
        </span>
      )}
    </button>
  );
}
