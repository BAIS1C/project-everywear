import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Loader2, Music2, Pause, Play, Upload, X } from 'lucide-react';
import { vaultFileUrl, type VaultAssetKind } from '@everywear/transport';
import { engineApi, generateApi, getAudioRequestPath, type ModelInfo } from '@/services/api';
import type { Song } from '@/types';
import { BetterModelsBanner } from '@/components/BetterModelsBanner';
import { showToast } from '@/components/ToastHost';
import {
  buildCoverPayload,
  buildReferencePayload,
  type BaseCreateFields,
  type CreatePayload,
} from './proPayloadBuilder';
import { resolveProCapabilityModel } from './proModelResolver';
import { ProVaultPicker, type ProVaultTrack } from './ProVaultPicker';
import { useProAudioMode, type ProAudioMode } from './useProAudioMode';

const MAX_AUDIO_UPLOAD_BYTES = 15 * 1024 * 1024;
const MAX_AUDIO_UPLOAD_LABEL = '15 MB';
const AUDIO_FORMATS_LABEL = 'MP3, WAV, FLAC, OGG, up to 15 MB';

type ProCreateMode = ProAudioMode;

interface BuildBaseFieldsOptions {
  mode: ProCreateMode;
  synthModel: string;
  sourceTag: ProCreateMode;
  index: number;
  audioCoverStrength?: number;
}

interface ProAudioModePanelProps {
  token: string | null;
  isGenerating: boolean;
  bulkCount: number;
  initialData?: { song: Song; timestamp: number; mode?: 'reuse' | 'cover' } | null;
  ditModels: ModelInfo[];
  loadedModel: string;
  onModelsRefresh: (models: ModelInfo[]) => void;
  onUseCapabilityModel: (model: string) => void | Promise<void>;
  buildBaseFields: (options: BuildBaseFieldsOptions) => BaseCreateFields;
  onGenerate: (params: CreatePayload) => void;
  onBulkReset: () => void;
}

function formatFileSize(bytes: number): string {
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${bytes} B`;
}

function filenameToTitle(name: string): string {
  return name.replace(/\.[^.]+$/, '').replace(/\s+/g, ' ').trim();
}

function playbackUrl(url: string): string {
  if (/^(https?:|blob:|\/audio\/)/i.test(url)) return url;
  return vaultFileUrl(url);
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0:00';
  const minutes = Math.floor(seconds / 60);
  const rest = Math.floor(seconds % 60);
  return `${minutes}:${String(rest).padStart(2, '0')}`;
}

function sourceFromSong(song: Song): string {
  const rawAudioUrl =
    (song as any).audio_key
      ? `/audio/${(song as any).audio_key}`
      : (song as any).audio_url || song.audioUrl || '';
  return getAudioRequestPath(rawAudioUrl) || '';
}

export function ProAudioModePanel({
  token,
  isGenerating,
  bulkCount,
  initialData,
  ditModels,
  loadedModel,
  onModelsRefresh,
  onUseCapabilityModel,
  buildBaseFields,
  onGenerate,
  onBulkReset,
}: ProAudioModePanelProps) {
  const { state, dispatch, setMode } = useProAudioMode();
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [showVaultPicker, setShowVaultPicker] = useState(false);
  const [playingSlot, setPlayingSlot] = useState<ProCreateMode | null>(null);
  const referenceInputRef = useRef<HTMLInputElement>(null);
  const sourceInputRef = useRef<HTMLInputElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    if (!initialData || initialData.mode !== 'cover') return;
    const sourceUrl = sourceFromSong(initialData.song);
    if (!sourceUrl) return;
    dispatch({
      type: 'setSource',
      url: sourceUrl,
      label: initialData.song.title || 'Cover source',
      duration: Number(initialData.song.duration || 0),
    });
  }, [dispatch, initialData]);

  const capabilityModel = resolveProCapabilityModel(ditModels, true);
  const mode = state.mode === 'cover' ? 'cover' : 'reference';
  const selectedUrl = mode === 'reference' ? state.referenceAudioUrl : state.sourceAudioUrl;
  const selectedLabel = mode === 'reference' ? state.referenceAudioLabel : state.sourceAudioLabel;
  const selectedDuration = mode === 'reference' ? state.referenceDuration : state.sourceDuration;

  const setPickedTrack = (track: ProVaultTrack) => {
    if (mode === 'reference') {
      dispatch({
        type: 'setReference',
        url: track.storageKey,
        label: track.filename,
        duration: track.duration || undefined,
      });
      return;
    }
    dispatch({
      type: 'setSource',
      url: track.storageKey,
      label: track.filename,
      duration: track.duration || undefined,
    });
  };

  const uploadAudio = async (file: File, target: ProCreateMode) => {
    if (!token) {
      setUploadError('Please sign in to upload audio.');
      return;
    }
    if (file.size > MAX_AUDIO_UPLOAD_BYTES) {
      setUploadError(
        `Your file is ${formatFileSize(file.size)}. The max is ${MAX_AUDIO_UPLOAD_LABEL}. Try a shorter clip or export a smaller MP3.`,
      );
      return;
    }
    setUploadError(null);
    setIsUploading(true);
    try {
      const assetKind: VaultAssetKind = target === 'reference' ? 'reference' : 'cover_source';
      const result = await generateApi.uploadAudio(file, token, assetKind);
      const displayName = result.original_filename || result.filename || file.name;
      const duration = typeof result.duration_seconds === 'number' ? result.duration_seconds : undefined;
      if (target === 'reference') {
        dispatch({ type: 'setReference', url: result.url, label: displayName, duration });
      } else {
        dispatch({ type: 'setSource', url: result.url, label: displayName, duration });
      }
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : String(err || 'Upload failed.'));
    } finally {
      setIsUploading(false);
    }
  };

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>, target: ProCreateMode) => {
    const file = event.target.files?.[0];
    if (file) void uploadAudio(file, target);
    event.target.value = '';
  };

  const handleGenerate = async () => {
    if (!capabilityModel) {
      showToast({ message: 'Download the Pro model before using Reference or Cover', kind: 'warning' });
      return;
    }
    if (!selectedUrl.trim()) {
      showToast({
        message: mode === 'reference' ? 'Choose a reference clip first' : 'Choose a cover source first',
        kind: 'warning',
      });
      setShowVaultPicker(true);
      return;
    }

    await onUseCapabilityModel(capabilityModel);
    for (let i = 0; i < bulkCount; i++) {
      const baseFields = buildBaseFields({
        mode,
        synthModel: capabilityModel,
        sourceTag: mode,
        index: i,
        audioCoverStrength: state.audioCoverStrength,
      });
      onGenerate(
        mode === 'reference'
          ? buildReferencePayload(baseFields, selectedUrl)
          : buildCoverPayload(baseFields, selectedUrl),
      );
    }
    if (bulkCount > 1) onBulkReset();
  };

  const togglePlayback = () => {
    if (!selectedUrl || !audioRef.current) return;
    if (playingSlot === mode) {
      audioRef.current.pause();
      setPlayingSlot(null);
      return;
    }
    audioRef.current.src = playbackUrl(selectedUrl);
    audioRef.current.play().then(() => setPlayingSlot(mode)).catch(() => undefined);
  };

  return (
    <div className="ew-card overflow-hidden">
      <input
        ref={referenceInputRef}
        type="file"
        accept="audio/*"
        onChange={(event) => handleFileSelect(event, 'reference')}
        className="hidden"
      />
      <input
        ref={sourceInputRef}
        type="file"
        accept="audio/*"
        onChange={(event) => handleFileSelect(event, 'cover')}
        className="hidden"
      />

      <div className="px-3 py-2.5 border-b border-zinc-100 dark:border-white/5 bg-zinc-50 dark:bg-white/[0.02]">
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-wide">Gener8 Pro</span>
          <div className="flex items-center gap-0 p-0.5" style={{ background: 'var(--ew-surface-raised)', border: '1px solid var(--ew-border)' }}>
            <button
              type="button"
              onClick={() => setMode('reference')}
              className={`ew-btn ew-btn--sm ${mode === 'reference' ? 'ew-btn--primary' : 'ew-btn--ghost'}`}
            >
              Reference
            </button>
            <button
              type="button"
              onClick={() => setMode('cover')}
              className={`ew-btn ew-btn--sm ${mode === 'cover' ? 'ew-btn--primary' : 'ew-btn--ghost'}`}
            >
              Cover
            </button>
          </div>
        </div>
      </div>

      <div className="p-3 space-y-3">
        <p className="text-[10px] text-zinc-500 dark:text-zinc-400">
          {mode === 'reference'
            ? 'Reference listens for vibe, genre, and energy, then makes a new song from your prompt.'
            : 'Cover restyles a source track with your lyrics and style on the Pro capability model.'}
        </p>

        {!capabilityModel && (
          <div className="ew-card flex items-center gap-2 p-2" style={{ background: 'color-mix(in srgb, var(--ew-warning) 12%, transparent)', borderColor: 'color-mix(in srgb, var(--ew-warning) 35%, transparent)' }}>
            <AlertTriangle size={12} className="text-amber-500 shrink-0" />
            <p className="text-[10px] text-amber-400">Reference and Cover require the true Pro capability model.</p>
          </div>
        )}

        <BetterModelsBanner
          show={!capabilityModel}
          onInstalled={() => {
            if (!token) return;
            engineApi
              .models(token)
              .then((inventory) => {
                onModelsRefresh(inventory.models || []);
                const nextCapabilityModel = resolveProCapabilityModel(inventory.models || [], true);
                if (nextCapabilityModel) void onUseCapabilityModel(nextCapabilityModel);
              })
              .catch(() => undefined);
          }}
        />

        {selectedUrl ? (
          <div className="flex items-center gap-3 p-2" style={{ background: 'var(--ew-surface-sunken)', border: '1px solid var(--ew-border)', clipPath: 'var(--ew-clip-button-sm)' }}>
            <button
              type="button"
              onClick={togglePlayback}
              className="relative flex-shrink-0 w-10 h-10 flex items-center justify-center transition-transform hover:scale-105"
              style={{ background: mode === 'reference' ? 'var(--ew-primary)' : 'var(--ew-warm)', color: mode === 'reference' ? 'var(--ew-primary-fg)' : 'var(--ew-text-inverse)', clipPath: 'var(--ew-clip-button-sm)' }}
            >
              {playingSlot === mode ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" />}
            </button>
            <div className="flex-1 min-w-0">
              <div className="truncate text-xs font-medium text-zinc-800 dark:text-zinc-200">
                {selectedLabel || filenameToTitle(selectedUrl)}
              </div>
              <div className="text-[10px] text-zinc-500">{formatTime(selectedDuration)}</div>
            </div>
            <button
              type="button"
              onClick={() => dispatch({ type: mode === 'reference' ? 'clearReference' : 'clearSource' })}
              className="p-1.5 text-zinc-400 hover:text-rose-500"
            >
              <X size={14} />
            </button>
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-zinc-300 dark:border-white/20 bg-zinc-50 dark:bg-white/[0.03] px-3 py-4 text-center">
            <Music2 size={22} className="mx-auto text-zinc-300 dark:text-zinc-600" />
            <p className="mt-2 text-xs text-zinc-500">
              {mode === 'reference' ? 'No reference clip selected' : 'No cover source selected'}
            </p>
          </div>
        )}

        {mode === 'cover' && selectedUrl && (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Source Influence</span>
              <span className="text-[11px] font-mono text-zinc-900 dark:text-white">{(state.audioCoverStrength * 100).toFixed(0)}%</span>
            </div>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={state.audioCoverStrength}
              onChange={(event) => dispatch({ type: 'setCoverStrength', value: Number(event.target.value) })}
              className="w-full h-1.5 bg-zinc-200 dark:bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-accent-500"
            />
          </div>
        )}

        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setShowVaultPicker(true)}
            className="ew-btn ew-btn--ghost ew-btn--sm"
            style={{ flex: 1, justifyContent: 'center' }}
          >
            <Music2 size={14} />
            From Vault
          </button>
          <button
            type="button"
            onClick={() => (mode === 'reference' ? referenceInputRef.current : sourceInputRef.current)?.click()}
            disabled={isUploading}
            className="ew-btn ew-btn--ghost ew-btn--sm"
            style={{ flex: 1, justifyContent: 'center' }}
          >
            {isUploading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
            Upload
          </button>
        </div>

        <p className="text-[10px] text-zinc-500 dark:text-zinc-400">
          {AUDIO_FORMATS_LABEL}. {mode === 'reference' ? 'A 30 to 60 second clip works best.' : 'A 3 to 5 minute song works best.'}
        </p>
        {uploadError && <div className="text-[11px] text-rose-500">{uploadError}</div>}

        <button
          type="button"
          onClick={handleGenerate}
          disabled={isGenerating}
          className="ew-btn ew-btn--primary w-full justify-center"
        >
          {isGenerating ? <Loader2 size={14} className="animate-spin" /> : <Music2 size={14} />}
          {mode === 'reference' ? 'Create With Reference' : 'Create Cover'}
        </button>
      </div>

      <audio ref={audioRef} onEnded={() => setPlayingSlot(null)} />
      <ProVaultPicker
        mode={mode}
        open={showVaultPicker}
        onClose={() => setShowVaultPicker(false)}
        onPick={setPickedTrack}
      />
    </div>
  );
}
