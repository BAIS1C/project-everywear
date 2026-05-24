// @ts-nocheck
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Sparkles, ChevronDown, Settings2, Trash2, Music2, Sliders, Dices, Hash, RefreshCw, Plus, Upload, Play, Pause, Cpu, Zap, X, Disc3, AlertTriangle, Layers, Loader2 } from 'lucide-react';
import { GenerationParams, Song } from '@/types';
import { useAuth } from '@/context/AuthContext';
import { generateApi, engineApi, getApiBase, getAudioRequestPath, type ModelInfo, type PatchManifest } from '@/services/api';
import { AlbumCover } from './AlbumCover';
import { PatchSelector } from './PatchSelector';
import { BetterModelsBanner } from './BetterModelsBanner';
import { showToast } from './ToastHost';

interface ReferenceTrack {
  id: string;
  filename: string;
  storage_key: string;
  duration: number | null;
  file_size_bytes: number | null;
  tags: string[] | null;
  created_at: string;
  audio_url: string;
}

interface CreatePanelProps {
  onGenerate: (params: GenerationParams) => void;
  isGenerating: boolean;
  initialData?: { song: Song, timestamp: number, mode?: 'reuse' | 'cover' } | null;
  onOpenUpgrade?: () => void;
}

// 2026-05-04 SGT: audio upload cap. Tightened to 15 MB per Sean's call.
// 15 MB is plenty for everything users actually need: a 30-60 second
// reference clip (~1 MB at 192 kbps) sits comfortably; a 3-5 minute
// full-song cover (~4-8 MB at 192 kbps) fits with headroom. Long /
// hi-bitrate uploads were costing render time without improving output
// quality — the engine samples whatever you give it. Shim mirrors at
// 15 MB (DefaultBodyLimit + handler reject). User-facing copy stays in
// plain English: longer file = longer wait.
const MAX_AUDIO_UPLOAD_BYTES = 15 * 1024 * 1024;
const MAX_AUDIO_UPLOAD_LABEL = '15 MB';
const AUDIO_FORMATS_LABEL = 'MP3, WAV, FLAC, OGG · up to 15 MB';

type StudioModelKind = 'capability' | 'song' | 'fast-song' | 'unknown';
type AudioPresetMode = 'song' | 'reference' | 'cover';

interface GenerationPreset {
  inferenceSteps: number;
  guidanceScale: number;
  shift: number;
  thinking: boolean;
  batchSize: number;
  inferMethod: 'ode' | 'sde';
  cfgIntervalStart: number;
  cfgIntervalEnd: number;
  customTimesteps: string;
  audioCoverStrength?: number;
}

const detectStudioModelKind = (modelName: string): StudioModelKind => {
  const lower = modelName.toLowerCase();
  if (lower.includes('xl-base')) return 'capability';
  if (lower.includes('sftturbo50')) return 'song';
  if (lower.includes('xl-turbo')) return 'fast-song';
  return 'unknown';
};

const generationPresetFor = (modelName: string, mode: AudioPresetMode): GenerationPreset => {
  const kind = detectStudioModelKind(modelName);
  const needsCapabilityPreset = mode === 'reference' || mode === 'cover' || kind === 'capability';

  if (needsCapabilityPreset) {
    return {
      inferenceSteps: 50,
      guidanceScale: 1.0,
      shift: 1.0,
      thinking: true,
      batchSize: 1,
      inferMethod: 'ode',
      cfgIntervalStart: 0.0,
      cfgIntervalEnd: 1.0,
      customTimesteps: '',
      audioCoverStrength: mode === 'cover' ? 1.0 : undefined,
    };
  }

  if (kind === 'fast-song') {
    return {
      inferenceSteps: 8,
      guidanceScale: 1.0,
      shift: 3.0,
      thinking: false,
      batchSize: 2,
      inferMethod: 'ode',
      cfgIntervalStart: 0.0,
      cfgIntervalEnd: 1.0,
      customTimesteps: '',
    };
  }

  return {
    inferenceSteps: 50,
    guidanceScale: 1.0,
    shift: 1.0,
    thinking: true,
    batchSize: 1,
    inferMethod: 'ode',
    cfgIntervalStart: 0.0,
    cfgIntervalEnd: 1.0,
    customTimesteps: '',
  };
};

const formatFileSize = (bytes: number): string => {
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${bytes} B`;
};

const KEY_SIGNATURES = [
  '',
  'C major', 'C minor',
  'C# major', 'C# minor',
  'Db major', 'Db minor',
  'D major', 'D minor',
  'D# major', 'D# minor',
  'Eb major', 'Eb minor',
  'E major', 'E minor',
  'F major', 'F minor',
  'F# major', 'F# minor',
  'Gb major', 'Gb minor',
  'G major', 'G minor',
  'G# major', 'G# minor',
  'Ab major', 'Ab minor',
  'A major', 'A minor',
  'A# major', 'A# minor',
  'Bb major', 'Bb minor',
  'B major', 'B minor'
];

const TIME_SIGNATURES = ['', '2/4', '3/4', '4/4', '6/8'];

const VOCAL_LANGUAGES = [
  { value: 'unknown', label: 'Auto / Instrumental' },
  { value: 'ar', label: 'Arabic' },
  { value: 'az', label: 'Azerbaijani' },
  { value: 'bg', label: 'Bulgarian' },
  { value: 'bn', label: 'Bengali' },
  { value: 'ca', label: 'Catalan' },
  { value: 'cs', label: 'Czech' },
  { value: 'da', label: 'Danish' },
  { value: 'de', label: 'German' },
  { value: 'el', label: 'Greek' },
  { value: 'en', label: 'English' },
  { value: 'es', label: 'Spanish' },
  { value: 'fa', label: 'Persian' },
  { value: 'fi', label: 'Finnish' },
  { value: 'fr', label: 'French' },
  { value: 'he', label: 'Hebrew' },
  { value: 'hi', label: 'Hindi' },
  { value: 'hr', label: 'Croatian' },
  { value: 'ht', label: 'Haitian Creole' },
  { value: 'hu', label: 'Hungarian' },
  { value: 'id', label: 'Indonesian' },
  { value: 'is', label: 'Icelandic' },
  { value: 'it', label: 'Italian' },
  { value: 'ja', label: 'Japanese' },
  { value: 'ko', label: 'Korean' },
  { value: 'la', label: 'Latin' },
  { value: 'lt', label: 'Lithuanian' },
  { value: 'ms', label: 'Malay' },
  { value: 'ne', label: 'Nepali' },
  { value: 'nl', label: 'Dutch' },
  { value: 'no', label: 'Norwegian' },
  { value: 'pa', label: 'Punjabi' },
  { value: 'pl', label: 'Polish' },
  { value: 'pt', label: 'Portuguese' },
  { value: 'ro', label: 'Romanian' },
  { value: 'ru', label: 'Russian' },
  { value: 'sa', label: 'Sanskrit' },
  { value: 'sk', label: 'Slovak' },
  { value: 'sr', label: 'Serbian' },
  { value: 'sv', label: 'Swedish' },
  { value: 'sw', label: 'Swahili' },
  { value: 'ta', label: 'Tamil' },
  { value: 'te', label: 'Telugu' },
  { value: 'th', label: 'Thai' },
  { value: 'tl', label: 'Tagalog' },
  { value: 'tr', label: 'Turkish' },
  { value: 'uk', label: 'Ukrainian' },
  { value: 'ur', label: 'Urdu' },
  { value: 'vi', label: 'Vietnamese' },
  { value: 'yue', label: 'Cantonese' },
  { value: 'zh', label: 'Chinese (Mandarin)' },
];

// ─── RepaintRangeSlider (must be before CreatePanel) ───────────────
interface RepaintRangeSliderProps {
  start: number;
  end: number;
  duration: number;
  onStartChange: (value: number) => void;
  onEndChange: (value: number) => void;
}

const RepaintRangeSlider: React.FC<RepaintRangeSliderProps> = ({
  start,
  end,
  duration,
  onStartChange,
  onEndChange,
}) => {
  const [dragging, setDragging] = React.useState<'start' | 'end' | null>(null);
  const barRef = React.useRef<HTMLDivElement>(null);

  const totalDuration = duration > 0 ? duration : 100;
  const actualEnd = end === -1 ? totalDuration : end;
  const selectedDuration = Math.max(0, actualEnd - start);

  const handleMouseDown = (handle: 'start' | 'end') => (e: React.MouseEvent) => {
    e.preventDefault();
    setDragging(handle);
  };

  const handleMouseMove = React.useCallback(
    (e: MouseEvent) => {
      if (!dragging || !barRef.current) return;

      const rect = barRef.current.getBoundingClientRect();
      const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
      const percent = x / rect.width;
      const newValue = percent * totalDuration;

      if (dragging === 'start') {
        onStartChange(Math.max(0, Math.min(newValue, actualEnd - 0.1)));
      } else {
        onEndChange(Math.max(start + 0.1, newValue));
      }
    },
    [dragging, totalDuration, start, actualEnd, onStartChange, onEndChange]
  );

  const handleMouseUp = () => {
    setDragging(null);
  };

  React.useEffect(() => {
    if (dragging) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      return () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [dragging, handleMouseMove]);

  const startPercent = (start / totalDuration) * 100;
  const endPercent = (actualEnd / totalDuration) * 100;
  const widthPercent = endPercent - startPercent;

  return (
    <div className="space-y-2">
      <div
        ref={barRef}
        className="relative w-full h-8 rounded-lg bg-zinc-200 dark:bg-black/30 cursor-pointer overflow-hidden"
      >
        <div
          className="absolute h-full bg-accent-500/30 border-l border-r border-accent-500"
          style={{ left: `${startPercent}%`, width: `${widthPercent}%` }}
        />
        <div
          className="absolute top-0 h-full w-1.5 bg-accent-500 cursor-col-resize hover:bg-accent-400 transition-colors"
          style={{ left: `${startPercent}%`, transform: 'translateX(-50%)' }}
          onMouseDown={handleMouseDown('start')}
        />
        <div
          className="absolute top-0 h-full w-1.5 bg-accent-500 cursor-col-resize hover:bg-accent-400 transition-colors"
          style={{ left: `${endPercent}%`, transform: 'translateX(-50%)' }}
          onMouseDown={handleMouseDown('end')}
        />
      </div>
      <div className="flex justify-between items-center text-xs text-zinc-500">
        <span>{start.toFixed(1)}s</span>
        <span className="text-accent-500 font-medium">{selectedDuration.toFixed(1)}s selected</span>
        <span>{actualEnd === totalDuration ? `${actualEnd.toFixed(1)}s (end)` : `${actualEnd.toFixed(1)}s`}</span>
      </div>
    </div>
  );
};

export const CreatePanel: React.FC<CreatePanelProps> = ({ onGenerate, isGenerating, initialData, onOpenUpgrade }) => {
  const { isAuthenticated, token, hasTier, isTrialActive } = useAuth();

  // Generation UX feedback (LOCKED 2026-04-18 in CONTEXT, wired 2026-04-26 SGT).
  // While isGenerating, the Create button transforms into a non-clickable
  // progress state with a spinner and a rotating witty tooltip cycled at ~5s.
  // The six tooltip strings are the canonical set from CONTEXT.md L292.
  const GEN_TOOLTIPS = [
    'Fans whirring? We\'re working…',
    'Teaching robots to feel the beat…',
    'Your GPU is earning its keep…',
    'Synthesising something unreasonable…',
    'Warming up the oscillators…',
    'Almost there, don\'t touch that dial…',
  ];
  const [genTooltipIdx, setGenTooltipIdx] = useState(0);
  useEffect(() => {
    if (!isGenerating) {
      setGenTooltipIdx(0);
      return;
    }
    const interval = setInterval(() => {
      setGenTooltipIdx((i) => (i + 1) % GEN_TOOLTIPS.length);
    }, 5000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isGenerating]);
  // Developer Mode is gated to Creator Studio tier (task #57 follow-up).
  // Raw engine parameters (shift, LM params, CFG interval, custom timesteps)
  // are not useful at Gener8 / Gener8 Pro levels; exposing them invites
  // users to break their own output. Creator Studio subscribers are
  // power-users by definition.
  const isCreatorStudio = hasTier('creator_studio');
  // Licence-gated controls must flow through AuthContext. Demo is an
  // authenticated base tier; Pro capability paths require paid Pro+ because
  // the native shim now enforces the same boundary.
  const canUseGener8Pro = hasTier('gener8_pro');
  const canUseProFeatures = canUseGener8Pro;
  const canUseReferenceCover = canUseGener8Pro;
  const canUseAdvancedControls = canUseGener8Pro;

  // Model selector state
  const [ditModels, setDitModels] = useState<ModelInfo[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>('');
  const [loadedModel, setLoadedModel] = useState<string>('');
  const [isSwitchingModel, setIsSwitchingModel] = useState(false);

  const modelKind = useCallback(detectStudioModelKind, []);

  const modelDisplayLabel = useCallback(
    (modelName: string) => {
      switch (modelKind(modelName)) {
        case 'capability':
          return 'PRO';
        case 'song':
          return 'SONG';
        case 'fast-song':
          return 'SONG';
        default:
          return 'MODEL';
      }
    },
    [modelKind],
  );

  const isFastTurboModel = useCallback(
    (modelName: string) => modelKind(modelName) === 'fast-song',
    [modelKind],
  );

  const getCapabilityModel = useCallback(
    () => ditModels.find((m) => m.name.toLowerCase().includes('xl-base'))?.name || '',
    [ditModels],
  );

  const getSongModel = useCallback(
    () =>
      ditModels.find((m) => m.name.toLowerCase().includes('sftturbo50'))?.name ||
      ditModels.find((m) => m.name.toLowerCase().includes('xl-turbo'))?.name ||
      loadedModel ||
      selectedModel,
    [ditModels, loadedModel, selectedModel],
  );

  const applyModelSwitch = useCallback(async (model: string) => {
    if (!token || !model || isSwitchingModel) return;
    setSelectedModel(model);
    if (model === loadedModel) return;
    setIsSwitchingModel(true);
    try {
      const result = await engineApi.init({ model }, token);
      const newModel = result.loaded_model || model;
      setLoadedModel(newModel);
      engineApi.models(token).then((inv) => {
        setDitModels(inv.models || []);
      }).catch(() => {});
    } catch (err) {
      console.error('Model switch failed:', err);
    } finally {
      setIsSwitchingModel(false);
    }
  }, [token, isSwitchingModel, loadedModel]);

  // Fetch available models on mount
  useEffect(() => {
    if (!token) return;
    engineApi.models(token).then((inv) => {
      setDitModels(inv.models || []);
      const current = inv.models?.find(m => m.is_loaded)?.name || inv.default_model || '';
      setLoadedModel(current);
      setSelectedModel(current);
    }).catch(() => { /* engine offline — selector stays hidden */ });
  }, [token]);

  const handleModelSwitch = async () => {
    if (!token || selectedModel === loadedModel || isSwitchingModel) return;
    await applyModelSwitch(selectedModel);

    try {
      const mode: AudioPresetMode =
        taskType === 'cover' ? 'cover' : audioTab === 'reference' ? 'reference' : 'song';
      const preset = generationPresetFor(selectedModel, mode);
      setInferenceSteps(preset.inferenceSteps);
      setShift(preset.shift);
      setGuidanceScale(preset.guidanceScale);
      setThinking(preset.thinking);
      setBatchSize(preset.batchSize);
      setInferMethod(preset.inferMethod);
      setCfgIntervalStart(preset.cfgIntervalStart);
      setCfgIntervalEnd(preset.cfgIntervalEnd);
      setCustomTimesteps(preset.customTimesteps);
      if (preset.audioCoverStrength != null) setAudioCoverStrength(preset.audioCoverStrength);

      // 2026-05-05 SGT: CoT auto-snap per model capability.
      // All current LMs (0.6B Qwen3) support CoT. Future models without
      // CoT (e.g. older 1B non-thinking LMs) would get false here.
      const modelSupportsCot = true; // All shipped LMs have CoT
      setUseCotMetas(modelSupportsCot);
      setUseCotCaption(modelSupportsCot);
      setUseCotLanguage(modelSupportsCot);
    } catch (err) {
      console.error('Model switch failed:', err);
    }
  };

  // 2026-05-04 SGT (#36): customMode + songDescription state killed.
  // Custom is the only mode; tier governs panel surface.

  // Lyrics + Style + Title
  const [lyrics, setLyrics] = useState('');
  const [style, setStyle] = useState('');
  const [title, setTitle] = useState('');

  // Common
  const [instrumental, setInstrumental] = useState(false);
  const [vocalLanguage, setVocalLanguage] = useState('en');

  // Music Parameters
  const [bpm, setBpm] = useState(0);
  const [keyScale, setKeyScale] = useState('');
  const [timeSignature, setTimeSignature] = useState('');

  // Advanced Settings
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showDevMode, setShowDevMode] = useState(false);
  const [duration, setDuration] = useState(-1);
  const [batchSize, setBatchSize] = useState(2);
  const [bulkCount, setBulkCount] = useState(1); // Number of independent generation jobs to queue
  const [guidanceScale, setGuidanceScale] = useState(7.5); // ~50% style influence
  const [randomSeed, setRandomSeed] = useState(true);
  const [seed, setSeed] = useState(-1);
  const [thinking, setThinking] = useState(false); // Default false for GPU compatibility
  const [audioFormat, setAudioFormat] = useState<'mp3' | 'flac'>('mp3');
  const [inferenceSteps, setInferenceSteps] = useState(8);
  const [inferMethod, setInferMethod] = useState<'ode' | 'sde'>('ode');
  const [shift, setShift] = useState(2.0); // ~25% weirdness

  // LM Parameters (under Expert Controls, collapsible)
  const [showLmParams, setShowLmParams] = useState(true); // Default expanded so all tiers see features
  const [lmTemperature, setLmTemperature] = useState(0.85);
  const [lmCfgScale, setLmCfgScale] = useState(2.0);
  const [lmTopK, setLmTopK] = useState(0);
  const [lmTopP, setLmTopP] = useState(0.9);
  const [lmNegativePrompt, setLmNegativePrompt] = useState('NO USER INPUT');

  // Expert Parameters (now in Advanced section)
  const [referenceAudioUrl, setReferenceAudioUrl] = useState('');
  const [sourceAudioUrl, setSourceAudioUrl] = useState('');
  const [referenceAudioLabel, setReferenceAudioLabel] = useState('');
  const [sourceAudioLabel, setSourceAudioLabel] = useState('');
  const [audioCodes, setAudioCodes] = useState('');
  const [repaintingStart, setRepaintingStart] = useState(0);
  const [repaintingEnd, setRepaintingEnd] = useState(-1);
  const [instruction, setInstruction] = useState('Fill the audio semantic mask based on the given conditions:');
  const [audioCoverStrength, setAudioCoverStrength] = useState(1.0);
  const [taskType, setTaskType] = useState('text2music');
  const [useAdg, setUseAdg] = useState(false);
  const [cfgIntervalStart, setCfgIntervalStart] = useState(0.0);
  const [cfgIntervalEnd, setCfgIntervalEnd] = useState(1.0);
  const [customTimesteps, setCustomTimesteps] = useState('');
  const [useCotMetas, setUseCotMetas] = useState(true);
  const [useCotCaption, setUseCotCaption] = useState(true);
  const [useCotLanguage, setUseCotLanguage] = useState(true);
  const [autogen, setAutogen] = useState(false);
  const [constrainedDecodingDebug, setConstrainedDecodingDebug] = useState(false);
  const [allowLmBatch, setAllowLmBatch] = useState(true);
  const [getScores, setGetScores] = useState(false);
  const [getLrc, setGetLrc] = useState(true);
  const [scoreScale, setScoreScale] = useState(0.5);
  const [lmBatchChunkSize, setLmBatchChunkSize] = useState(8);
  const [trackName, setTrackName] = useState('');
  const [completeTrackClasses, setCompleteTrackClasses] = useState('');
  // Style Assist: optional AI caption/style enhancement via local /lm endpoint.
  // Sparkle button and Advanced toggle share this single source of truth.
  const [styleAssistEnabled, setStyleAssistEnabled] = useState(false);
  const [enhancedStyle, setEnhancedStyle] = useState<string | null>(null);
  const [isEnhancing, setIsEnhancing] = useState(false);

  // Vocal Gender
  const [vocalGender, setVocalGender] = useState<'auto' | 'male' | 'female'>('auto');

  // Cover source track display
  const [coverSong, setCoverSong] = useState<Song | null>(null);

  // Patch (Style) selection
  const [activePatchKeyword, setActivePatchKeyword] = useState<string | null>(null);
  const [activePatchName, setActivePatchName] = useState<string | null>(null);

  const [isUploadingReference, setIsUploadingReference] = useState(false);
  const [isUploadingSource, setIsUploadingSource] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const referenceInputRef = useRef<HTMLInputElement>(null);
  const sourceInputRef = useRef<HTMLInputElement>(null);
  const [showAudioModal, setShowAudioModal] = useState(false);
  const [audioModalTarget, setAudioModalTarget] = useState<'reference' | 'source'>('reference');
  const [tempAudioUrl, setTempAudioUrl] = useState('');
  // Three-mode input rail (added 2026-05-01 SGT): 'song' = pure
  // text-to-song, no audio reference; 'reference' = style inspiration
  // from uploaded audio; 'source' = full Cover restyle. Default lands on
  // 'song' so a fresh customMode panel opens with no audio chrome and
  // the user has an explicit pill for the prompt-only path. Body
  // content (explanation, drop zone, players, From-Library / Upload
  // pair) is gated on audioTab !== 'song' below.
  const [audioTab, setAudioTab] = useState<'song' | 'reference' | 'source'>('song');
  const referenceAudioRef = useRef<HTMLAudioElement>(null);
  const sourceAudioRef = useRef<HTMLAudioElement>(null);
  const [referencePlaying, setReferencePlaying] = useState(false);
  const [sourcePlaying, setSourcePlaying] = useState(false);
  const [referenceTime, setReferenceTime] = useState(0);
  const [sourceTime, setSourceTime] = useState(0);
  const [referenceDuration, setReferenceDuration] = useState(0);
  const [sourceDuration, setSourceDuration] = useState(0);

  const applyGenerationPreset = useCallback((preset: GenerationPreset, options?: { snapCoverStrength?: boolean }) => {
    setInferenceSteps(preset.inferenceSteps);
    setGuidanceScale(preset.guidanceScale);
    setShift(preset.shift);
    setThinking(preset.thinking);
    setBatchSize(preset.batchSize);
    setInferMethod(preset.inferMethod);
    setCfgIntervalStart(preset.cfgIntervalStart);
    setCfgIntervalEnd(preset.cfgIntervalEnd);
    setCustomTimesteps(preset.customTimesteps);
    if (options?.snapCoverStrength && preset.audioCoverStrength != null) {
      setAudioCoverStrength(preset.audioCoverStrength);
    }
  }, []);

  // Reference tracks modal state
  const [referenceTracks, setReferenceTracks] = useState<ReferenceTrack[]>([]);
  const [isLoadingTracks, setIsLoadingTracks] = useState(false);
  const [playingTrackId, setPlayingTrackId] = useState<string | null>(null);
  const modalAudioRef = useRef<HTMLAudioElement>(null);
  const [modalTrackTime, setModalTrackTime] = useState(0);
  const [modalTrackDuration, setModalTrackDuration] = useState(0);

  const uploadedAudioLabels = useMemo(
    () => new Map([
      [referenceAudioUrl, referenceAudioLabel],
      [sourceAudioUrl, sourceAudioLabel],
    ].filter((entry): entry is [string, string] => Boolean(entry[0] && entry[1]))),
    [referenceAudioUrl, referenceAudioLabel, sourceAudioUrl, sourceAudioLabel],
  );

  const filenameToTitle = (name: string) => {
    const withoutExt = name.replace(/\.[^.]+$/, '');
    return withoutExt.replace(/\s+/g, ' ').trim();
  };

  const getAudioLabel = (url: string) => {
    const uploadedLabel = uploadedAudioLabels.get(url);
    if (uploadedLabel) return uploadedLabel;
    try {
      const parsed = new URL(url);
      return decodeURIComponent(parsed.pathname.split('/').pop() || parsed.hostname);
    } catch {
      const parts = url.split('/');
      return decodeURIComponent(parts[parts.length - 1] || url);
    }
  };

  // Resize Logic
  const [lyricsHeight, setLyricsHeight] = useState(() => {
    const saved = localStorage.getItem('acestep_lyrics_height');
    return saved ? parseInt(saved, 10) : 144; // Default h-36 is 144px (9rem * 16)
  });
  const [isResizing, setIsResizing] = useState(false);
  const lyricsRef = useRef<HTMLDivElement>(null);

  // Reuse / Cover Effect - must be after all state declarations
  useEffect(() => {
    if (!initialData) return;
    const { song, mode } = initialData;

    // Always populate base fields
    // 2026-05-04 SGT (#36): setCustomMode call dropped; Custom is the
    // only mode now.
    setLyrics(song.lyrics || '');
    setStyle(song.style || '');
    // 2026-05-05 SGT: Strip baked-in source tags from reused titles.
    // Previous generations append " (reference)" or " (cover)" to titles;
    // reusing that title without stripping causes double-tagging or stale
    // tags when the user switches to a different pill (e.g. SONG).
    setTitle((song.title || '').replace(/\s*\((reference|cover)\)/gi, '').replace(/\s*\(\d+\)\s*$/, '').trim());
    setInstrumental((song.lyrics || '').length === 0);

    if (mode === 'cover') {
      // Cover mode: set task to cover, load the source audio URL, store song for display.
      // IMPORTANT: shim expects /audio/<key> format, NOT full http:// URLs.
      // mapWireSong resolves /audio/ paths to full URLs for playback; normalize
      // through the same request-path helper the generate API uses.
      setTaskType('cover');
      setAudioTab('source');
      const rawAudioUrl =
        (song as any).audio_key
          ? `/audio/${(song as any).audio_key}`
          : (song as any).audio_url || song.audioUrl || '';
      const audioUrl = getAudioRequestPath(rawAudioUrl) || '';
      setSourceAudioUrl(audioUrl);
      setSourceAudioLabel(song.title || '');
      setCoverSong(song);
      if (canUseAdvancedControls) setShowAdvanced(true);
      if (song.duration) {
        setDuration(Math.round(Number(song.duration)));
      }
      applyGenerationPreset(
        generationPresetFor(getCapabilityModel() || loadedModel || selectedModel, 'cover'),
        { snapCoverStrength: true },
      );
    } else {
      // Reuse mode: default text2music, clear source audio, land on
      // Song pill so the input rail matches the empty-audio default.
      setTaskType('text2music');
      setAudioTab('song');
      setSourceAudioUrl('');
      setReferenceAudioUrl('');
      setSourceAudioLabel('');
      setReferenceAudioLabel('');
      setCoverSong(null);
    }

    // 2026-05-04 SGT (Sean directive): Reuse Prompt scope is now strictly
    // PROMPT + LYRICS + STYLE + TITLE only — explicitly NEVER inference
    // params. The lyrics / style / title are set above (lines 421-423);
    // they're the creative payload users actually want to "reuse." All
    // other fields (steps, CFG, shift, inferMethod, batchSize, seed,
    // thinking, duration, bpm, keyScale, timeSignature, audioFormat, LM
    // params) are MODEL-SPECIFIC and cross-model corruption is the bug
    // that produced noise output this morning. They MUST come from the
    // current model's auto-snap (loadedModel useEffect at L485+), not
    // from an old song's persisted DNA. The DNA modal still SHOWS those
    // historical values for inspection / debugging; Reuse just doesn't
    // copy them into the form anymore.
    //
    // What this means for users: clicking Reuse on an old song gives
    // you the same words and vibe to riff on, while the inference
    // settings stay tuned to whatever model is currently loaded. No
    // more "8 steps + CFG 1.0 sent to Base = noise" cross-pollution.
    //
    // The Cover branch at L426 still bumps inferenceSteps to 32 if
    // currently below 16 because Cover physically requires base-quality
    // step count regardless of which model is loaded. That's a Cover-
    // specific clamp, not a DNA reuse.
    if (song.generation_params) {
      // Intentionally not parsing or applying gp — see comment above.
      // Keep this block here as a marker so future contributors don't
      // re-add inference-param copying. The DNA modal at
      // RightSidebar.tsx still reads gp directly from the song object
      // for display purposes; that path is unchanged.
      if (canUseAdvancedControls) setShowAdvanced(true);
      // eslint-disable-next-line no-console
      console.log(
        '[CreatePanel] Reuse Prompt: copied lyrics + style + title only (inference params left to current model auto-snap). Source song:',
        song.id,
      );
    }
  }, [initialData, canUseAdvancedControls, applyGenerationPreset, getCapabilityModel, loadedModel, selectedModel]);

  // ── Auto-set generation parameters based on currently loaded model ──
  // Fetches recommended defaults (steps, CFG, COT, batch) from the backend
  // so users don't need to know the correct settings for each model type.
  // Re-runs whenever loadedModel changes (model switch) to keep UI in sync.
  const [modelType, setModelType] = useState<string>('');
  useEffect(() => {
    let cancelled = false;
    engineApi.modelDefaults()
      .then((defaults) => {
        if (cancelled) return;
        // Trust the shim's model-defaults output. The shim pins canonical
        // values per model. Fallback to filename-derived only when shim
        // returns 'unknown' (boot race).
        const reportedUnknown = defaults.model_type === 'unknown';
        const lm = loadedModel.toLowerCase();
        const derivedTurbo = lm.includes('turbo');
        const derivedSftTurbo50 = lm.includes('sftturbo50');
        const derivedTrueBase = lm.includes('xl-base');
        const derivedBase = !!lm && !derivedTurbo;

        if (reportedUnknown && (derivedTurbo || derivedBase)) {
          const derivedType = derivedTrueBase ? 'base' : derivedSftTurbo50 ? 'sftturbo50' : 'turbo';
          const derivedSteps = derivedTrueBase ? 50 : derivedSftTurbo50 ? 50 : 8;
          const derivedCfg = 1.0;
          const derivedShift = derivedTrueBase ? 1.0 : derivedSftTurbo50 ? 1.0 : 3.0;
          const derivedThinking = derivedTrueBase || derivedSftTurbo50;
          const derivedBatch = derivedTurbo && !derivedSftTurbo50 ? 2 : 1;
          setModelType(derivedType);
          setInferenceSteps(derivedSteps);
          setGuidanceScale(derivedCfg);
          setShift(derivedShift);
          setThinking(derivedThinking);
          setBatchSize(derivedBatch);
          setInferMethod('ode');
          return;
        }

        setModelType(defaults.model_type);
        setInferenceSteps(defaults.inference_steps);
        if (defaults.guidance_scale != null) setGuidanceScale(defaults.guidance_scale);
        if (defaults.shift != null) setShift(defaults.shift);
        setThinking(defaults.thinking);
        setBatchSize(defaults.batch_size);
        setInferMethod(defaults.infer_method as 'ode' | 'sde');
      })
      .catch(() => {
        if (!cancelled) {
          const lower = loadedModel.toLowerCase();
          const isTrueBase = lower.includes('xl-base');
          const isSftTurbo50 = lower.includes('sftturbo50');
          const isTurboModel = lower.includes('turbo') && !isSftTurbo50;
          if (isTurboModel) {
            setModelType('turbo');
            setInferenceSteps(8);
            setShift(3.0);
            setBatchSize(2);
            setThinking(false);
          } else if (isTrueBase) {
            setModelType('base');
            setInferenceSteps(50);
            setShift(1.0);
            setGuidanceScale(1.0);
            setBatchSize(1);
            setThinking(true);
          } else if (isSftTurbo50) {
            setModelType('sftturbo50');
            setInferenceSteps(50);
            setShift(1.0);
            setGuidanceScale(1.0);
            setBatchSize(1);
            setThinking(true);
          } else if (loadedModel) {
            setModelType('unknown');
            setInferenceSteps(50);
            setShift(1.0);
            setBatchSize(1);
            setThinking(true);
          }
        }
      });
    return () => { cancelled = true; };
  }, [loadedModel]);

  useEffect(() => {
    const mode: AudioPresetMode =
      taskType === 'cover' ? 'cover' : audioTab === 'reference' ? 'reference' : 'song';
    const targetModel =
      mode === 'song'
        ? (loadedModel || selectedModel || getSongModel())
        : (getCapabilityModel() || loadedModel || selectedModel);

    if (!targetModel) return;
    applyGenerationPreset(generationPresetFor(targetModel, mode), {
      snapCoverStrength: mode === 'cover',
    });
  }, [
    taskType,
    audioTab,
    loadedModel,
    selectedModel,
    getSongModel,
    getCapabilityModel,
    applyGenerationPreset,
  ]);

  useEffect(() => {
    if (!ditModels.length || isSwitchingModel) return;
    const wantsCapabilityModel =
      canUseReferenceCover &&
      (taskType === 'cover' || audioTab === 'reference');
    const desired = wantsCapabilityModel ? getCapabilityModel() : getSongModel();
    if (!desired) return;
    setSelectedModel(desired);
    if (wantsCapabilityModel && desired !== loadedModel) {
      void applyModelSwitch(desired);
    }
  }, [
    ditModels,
    taskType,
    audioTab,
    canUseReferenceCover,
    getCapabilityModel,
    getSongModel,
    loadedModel,
    isSwitchingModel,
    applyModelSwitch,
  ]);

  useEffect(() => {
    if (canUseReferenceCover) return;
    if (audioTab !== 'song' || taskType !== 'text2music') {
      setAudioTab('song');
      setTaskType('text2music');
      setReferenceAudioUrl('');
      setSourceAudioUrl('');
      setCoverSong(null);
      setShowAdvanced(false);
    }
  }, [canUseReferenceCover, audioTab, taskType]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing) return;

      // Calculate new height based on mouse position relative to the lyrics container top
      // We can't easily get the container top here without a ref to it, 
      // but we can use dy (delta y) from the previous position if we tracked it,
      // OR simpler: just update based on movement if we track the start.
      //
      // Better approach for absolute sizing: 
      // 1. Get the bounding rect of the textarea wrapper on mount/resize start? 
      //    We can just rely on the fact that we are dragging the bottom.
      //    So new height = currentMouseY - topOfElement.

      if (lyricsRef.current) {
        const rect = lyricsRef.current.getBoundingClientRect();
        const newHeight = e.clientY - rect.top;
        // detailed limits: min 96px (h-24), max 600px
        if (newHeight > 96 && newHeight < 600) {
          setLyricsHeight(newHeight);
        }
      }
    };

    const handleMouseUp = () => {
      setIsResizing(false);
      document.body.style.cursor = 'default';
      document.body.style.userSelect = 'auto';
      // Save height to localStorage
      localStorage.setItem('acestep_lyrics_height', String(lyricsHeight));
    };

    if (isResizing) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 'ns-resize';
      document.body.style.userSelect = 'none'; // Prevent text selection while dragging
    }

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 'default';
      document.body.style.userSelect = 'auto';
    };
  }, [isResizing]);

  useEffect(() => {
    if (taskType !== 'cover') return;
    const sourceSeconds = Number(coverSong?.duration || sourceDuration || 0);
    if (sourceSeconds > 0) {
      setDuration(Math.round(sourceSeconds));
    }
  }, [taskType, coverSong?.duration, sourceDuration]);

  const startResizing = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
  };

  const uploadAudio = async (file: File, target: 'reference' | 'source') => {
    if (!token) {
      setUploadError('Please sign in to upload audio.');
      return;
    }
    // Client-side size reject. Skips the network round-trip for files
    // we know the shim will reject, avoiding a multi-second upload
    // progress and then a 413.
    if (file.size > MAX_AUDIO_UPLOAD_BYTES) {
      setUploadError(
        `Your file is ${formatFileSize(file.size)}. The max is ${MAX_AUDIO_UPLOAD_LABEL}. ` +
          `Try a shorter clip, or save your file at a smaller quality (a 5-minute song at 192 kbps mp3 is under 10 MB).`,
      );
      return;
    }
    setUploadError(null);
    const setUploading = target === 'reference' ? setIsUploadingReference : setIsUploadingSource;
    const setUrl = target === 'reference' ? setReferenceAudioUrl : setSourceAudioUrl;
    const setLabel = target === 'reference' ? setReferenceAudioLabel : setSourceAudioLabel;
    const setAudioDuration = target === 'reference' ? setReferenceDuration : setSourceDuration;
    setUploading(true);
    try {
      const result = await generateApi.uploadAudio(file, token);
      const displayName = result.original_filename || result.filename || file.name;
      setUrl(result.url);
      setLabel(displayName);
      if (target === 'source') {
        setTitle(filenameToTitle(displayName));
      }
      // 2026-05-04 SGT (Bug E fix): consume server-probed duration if
      // available. WebView2 returns Infinity for VBR / chunked MP3 so the
      // browser fallback at <audio onLoadedMetadata> can't be trusted.
      // Symphonia probe in shim's upload_audio handler is authoritative.
      // Falls through to onLoadedMetadata if the server probe failed.
      if (typeof result.duration_seconds === 'number' && result.duration_seconds > 0) {
        setAudioDuration(result.duration_seconds);
        if (target === 'source') {
          setDuration(Math.round(result.duration_seconds));
        }
      }
      setShowAudioModal(false);
      setTempAudioUrl('');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Upload failed';
      setUploadError(message);
    } finally {
      setUploading(false);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>, target: 'reference' | 'source') => {
    const file = e.target.files?.[0];
    if (file) {
      void uploadAudio(file, target);
    }
    e.target.value = '';
  };

  // Style Assist: hit the local /lm endpoint via /api/generate/format to
  // enhance caption/style tags. Lyrics pass through unchanged; any returned
  // lyric changes are ignored. Only the enhanced caption is applied.
  const handleEnhanceStyle = useCallback(async () => {
    if (!token || !style.trim()) {
      showToast({ message: 'Enter a style first', kind: 'warning' });
      return;
    }
    setIsEnhancing(true);
    try {
      const result = await generateApi.formatInput({
        caption: style.trim(),
        lyrics: lyrics || undefined,
        bpm: bpm || undefined,
        duration: duration || undefined,
        keyScale: keyScale || undefined,
        timeSignature: timeSignature || undefined,
        temperature: lmTemperature,
        topK: lmTopK,
        topP: lmTopP,
      }, token);
      if (result.success && result.caption) {
        setEnhancedStyle(result.caption);
        setStyleAssistEnabled(false);
        // Auto-fill metadata from LM response if user hasn't set them
        if (result.bpm && !bpm) setBpm(result.bpm);
        if (result.key_scale && !keyScale) setKeyScale(result.key_scale);
        if (result.time_signature && !timeSignature) setTimeSignature(result.time_signature);
      } else {
        showToast({ message: result.error || 'Style enhancement failed', kind: 'error' });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Enhancement failed';
      showToast({ message: msg, kind: 'error' });
    } finally {
      setIsEnhancing(false);
    }
  }, [token, style, lyrics, bpm, duration, keyScale, timeSignature, lmTemperature, lmTopK, lmTopP]);

  const openAudioModal = (target: 'reference' | 'source') => {
    setAudioModalTarget(target);
    setTempAudioUrl('');
    setShowAudioModal(true);
    void fetchReferenceTracks();
  };

  const fetchReferenceTracks = useCallback(async () => {
    if (!token) return;
    setIsLoadingTracks(true);
    try {
      const response = await fetch(`${getApiBase()}/api/reference-tracks`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (response.ok) {
        const data = await response.json();
        setReferenceTracks(data.tracks || []);
      }
    } catch (err) {
      console.error('Failed to fetch reference tracks:', err);
    } finally {
      setIsLoadingTracks(false);
    }
  }, [token]);

  const handlePatchChange = useCallback((patch: PatchManifest | null, keyword: string | null) => {
    setActivePatchKeyword(keyword);
    setActivePatchName(patch?.name || null);
  }, []);

  const uploadReferenceTrack = async (file: File) => {
    if (!token) {
      setUploadError('Please sign in to upload audio.');
      return;
    }
    if (file.size > MAX_AUDIO_UPLOAD_BYTES) {
      setUploadError(
        `Your file is ${formatFileSize(file.size)}. The max is ${MAX_AUDIO_UPLOAD_LABEL}. ` +
          `Try a shorter clip, or save your file at a smaller quality (a 5-minute song at 192 kbps mp3 is under 10 MB).`,
      );
      return;
    }
    setUploadError(null);
    setIsUploadingReference(true);
    try {
      const formData = new FormData();
      formData.append('audio', file);

      const response = await fetch(`${getApiBase()}/api/reference-tracks`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || 'Upload failed');
      }

      const data = await response.json();
      setReferenceTracks(prev => [data.track, ...prev]);

      // Also set as current reference/source
      if (audioModalTarget === 'reference') {
        setReferenceAudioUrl(data.track.audio_url);
        setReferenceAudioLabel(data.track.filename || file.name);
      } else {
        setSourceAudioUrl(data.track.audio_url);
        setSourceAudioLabel(data.track.filename || file.name);
        setTitle(filenameToTitle(data.track.filename || file.name));
      }
      setShowAudioModal(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Upload failed';
      setUploadError(message);
    } finally {
      setIsUploadingReference(false);
    }
  };

  const deleteReferenceTrack = async (trackId: string) => {
    if (!token) return;
    try {
      const response = await fetch(`${getApiBase()}/api/reference-tracks/${trackId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });
      if (response.ok) {
        setReferenceTracks(prev => prev.filter(t => t.id !== trackId));
        if (playingTrackId === trackId) {
          setPlayingTrackId(null);
          if (modalAudioRef.current) {
            modalAudioRef.current.pause();
          }
        }
      }
    } catch (err) {
      console.error('Failed to delete track:', err);
    }
  };

  const useReferenceTrack = (track: ReferenceTrack) => {
    if (audioModalTarget === 'reference') {
      setReferenceAudioUrl(track.audio_url);
      setReferenceAudioLabel(track.filename);
    } else {
      setSourceAudioUrl(track.audio_url);
      setSourceAudioLabel(track.filename);
      setTitle(filenameToTitle(track.filename));
    }
    setShowAudioModal(false);
    setPlayingTrackId(null);
  };

  const toggleModalTrack = (track: ReferenceTrack) => {
    if (playingTrackId === track.id) {
      if (modalAudioRef.current) {
        modalAudioRef.current.pause();
      }
      setPlayingTrackId(null);
    } else {
      setPlayingTrackId(track.id);
      if (modalAudioRef.current) {
        modalAudioRef.current.src = track.audio_url;
        modalAudioRef.current.play().catch(() => undefined);
      }
    }
  };

  const applyAudioUrl = () => {
    if (!tempAudioUrl.trim()) return;
    if (audioModalTarget === 'reference') {
      setReferenceAudioUrl(tempAudioUrl.trim());
      setReferenceAudioLabel('');
      setReferenceTime(0);
      setReferenceDuration(0);
    } else {
      setSourceAudioUrl(tempAudioUrl.trim());
      setSourceAudioLabel('');
      setSourceTime(0);
      setSourceDuration(0);
    }
    setShowAudioModal(false);
    setTempAudioUrl('');
  };

  const formatTime = (time: number) => {
    if (!Number.isFinite(time) || time <= 0) return '0:00';
    const minutes = Math.floor(time / 60);
    const seconds = Math.floor(time % 60);
    return `${minutes}:${String(seconds).padStart(2, '0')}`;
  };

  const toggleAudio = (target: 'reference' | 'source') => {
    const audio = target === 'reference' ? referenceAudioRef.current : sourceAudioRef.current;
    if (!audio) return;
    if (audio.paused) {
      audio.play().catch(() => undefined);
    } else {
      audio.pause();
    }
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>, target: 'reference' | 'source') => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file) {
      void uploadAudio(file, target);
    }
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
  };

  // Auto-title: extract first chorus line, or first lyric line, when title is empty
  const deriveTitle = (lyricsText: string): string => {
    const lines = lyricsText.split('\n').map(l => l.trim()).filter(Boolean);
    // Find [Chorus] section and grab the first non-tag line after it
    let inChorus = false;
    for (const line of lines) {
      if (/^\[chorus\]/i.test(line)) {
        inChorus = true;
        continue;
      }
      if (inChorus && !line.startsWith('[')) {
        return line.slice(0, 60);
      }
      // If we hit another section tag after [Chorus], stop looking
      if (inChorus && line.startsWith('[')) break;
    }
    // Fallback: first non-tag line from the entire lyrics
    for (const line of lines) {
      if (!line.startsWith('[')) {
        return line.slice(0, 60);
      }
    }
    return '';
  };

  const handleGenerate = () => {
    if ((taskType === 'cover' || audioTab === 'reference') && !canUseReferenceCover) {
      showToast({ message: 'Reference and Cover require Gener8 Pro', kind: 'warning' });
      return;
    }
    if (taskType === 'cover' && !sourceAudioUrl.trim()) {
      showToast({ message: 'Choose a source track before creating an AI Cover', kind: 'warning' });
      setAudioTab('source');
      openAudioModal('source');
      return;
    }
    if ((taskType === 'cover' || audioTab === 'reference') && !getCapabilityModel()) {
      showToast({ message: 'Download Pro Model before using Reference or Cover', kind: 'warning' });
      return;
    }

    // Auto-populate title field if empty
    if (!title.trim() && lyrics.trim()) {
      const derived = deriveTitle(lyrics);
      if (derived) setTitle(derived);
    }

    // Bulk generation: loop bulkCount times
    for (let i = 0; i < bulkCount; i++) {
      // Seed handling: first job uses user's seed, rest get random seeds
      let jobSeed = -1;
      if (!randomSeed && i === 0) {
        jobSeed = seed;
      } else if (!randomSeed && i > 0) {
        // Subsequent jobs get random seeds for variety
        jobSeed = Math.floor(Math.random() * 4294967295);
      }

      // Inject vocal gender into style if set
      const baseStyle = (styleAssistEnabled && enhancedStyle) ? enhancedStyle : style;
      const effectiveStyle = (() => {
        if (vocalGender === 'auto' || instrumental) return baseStyle;
        const genderTag = vocalGender === 'male' ? 'male vocal' : 'female vocal';
        if (baseStyle.toLowerCase().includes(genderTag)) return baseStyle;
        return baseStyle.trim() ? `${baseStyle.trim()}, ${genderTag}` : genderTag;
      })();
      const wantsCapabilityModel =
        taskType === 'cover' || audioTab === 'reference';
      const effectiveSynthModel = wantsCapabilityModel
        ? getCapabilityModel()
        : (selectedModel || loadedModel || getSongModel());
      const effectivePreset = generationPresetFor(
        effectiveSynthModel || loadedModel || selectedModel,
        taskType === 'cover' ? 'cover' : audioTab === 'reference' ? 'reference' : 'song',
      );
      const effectiveInferenceSteps =
        wantsCapabilityModel && inferenceSteps < 32 ? effectivePreset.inferenceSteps : inferenceSteps;
      const effectiveGuidanceScale =
        wantsCapabilityModel && guidanceScale < 5 ? effectivePreset.guidanceScale : guidanceScale;
      const effectiveShift =
        wantsCapabilityModel && (shift < 1 || shift > 5) ? effectivePreset.shift : shift;

      onGenerate({
        // 2026-05-04 SGT (#36): customMode + songDescription dropped from
        // the contract. Custom is the only mode. Legacy state still
        // exists locally but is no longer sent.
        //
        // 2026-05-04 SGT (engine-detected model swap): synth_model is
        // forwarded to ace-server's ServerFields.synth_model so the
        // engine swaps DiTs at request time. selectedModel is the
        // user's most recent dropdown pick; loadedModel is the
        // optimistic post-swap value. If neither is set, ace-server
        // falls back to whichever DiT it has cached.
        synth_model: effectiveSynthModel || undefined,
        prompt: lyrics,
        lyrics,
        style: activePatchKeyword ? `${effectiveStyle}, ${activePatchKeyword}` : effectiveStyle,
        rawStyle: (styleAssistEnabled && enhancedStyle) ? style : undefined,
        title: (() => {
          // 2026-05-05 SGT: Strip any pre-existing source/bulk tags before
          // re-appending, preventing double-tagging from Reuse Prompt flow.
          const rawTitle = title.trim() || deriveTitle(lyrics);
          const effectiveTitle = rawTitle
            .replace(/\s*\((reference|cover)\)/gi, '')
            .replace(/\s*\(\d+\)\s*$/, '')
            .trim();
          // Annotate the generation source so Reference and Cover renders
          // are distinguishable in the library and Generation DNA panel.
          const sourceTag =
            taskType === 'cover'
              ? ' (cover)'
              : audioTab === 'reference' && referenceAudioUrl.trim()
              ? ' (reference)'
              : '';
          const bulkTag = bulkCount > 1 ? ` (${i + 1})` : '';
          return `${effectiveTitle}${sourceTag}${bulkTag}`;
        })(),
        instrumental,
        vocalLanguage,
        bpm,
        keyScale,
        timeSignature,
        duration,
        inferenceSteps: effectiveInferenceSteps,
        guidanceScale: effectiveGuidanceScale,
        batchSize: 1, // task #57: single ace-server job per call; UI loop produces multiple tracks via bulkCount. See Variations control above.
        randomSeed: randomSeed || i > 0, // Force random for subsequent bulk jobs
        seed: jobSeed,
        thinking: wantsCapabilityModel ? effectivePreset.thinking : thinking,
        audioFormat,
        inferMethod,
        shift: effectiveShift,
        lmTemperature,
        lmCfgScale,
        lmTopK,
        lmTopP,
        lmNegativePrompt,
        referenceAudioUrl: referenceAudioUrl.trim() || undefined,
        sourceAudioUrl: sourceAudioUrl.trim() || undefined,
        audioCodes: audioCodes.trim() || undefined,
        repaintingStart,
        repaintingEnd,
        instruction,
        audioCoverStrength,
        taskType,
        useAdg,
        cfgIntervalStart: wantsCapabilityModel ? effectivePreset.cfgIntervalStart : cfgIntervalStart,
        cfgIntervalEnd: wantsCapabilityModel ? effectivePreset.cfgIntervalEnd : cfgIntervalEnd,
        customTimesteps: wantsCapabilityModel
          ? undefined
          : customTimesteps.trim() || undefined,
        useCotMetas,
        useCotCaption,
        useCotLanguage,
        autogen,
        constrainedDecodingDebug,
        allowLmBatch,
        getScores,
        getLrc,
        scoreScale,
        lmBatchChunkSize,
        trackName: trackName.trim() || undefined,
        completeTrackClasses: (() => {
          const parsed = completeTrackClasses
            .split(',')
            .map((item) => item.trim())
            .filter(Boolean);
          return parsed.length ? parsed : undefined;
        })(),
      });
    }

    // Reset bulk count after generation
    if (bulkCount > 1) {
      setBulkCount(1);
    }
  };

  return (
    <div
      className="flex flex-col h-full bg-zinc-50 dark:bg-s3-panel w-full overflow-y-auto custom-scrollbar transition-colors duration-300"
      data-tour="gener8-create-panel"
    >
      <div className="p-4 pt-14 md:pt-4 space-y-5">
        <input
          ref={referenceInputRef}
          type="file"
          accept="audio/*"
          onChange={(e) => handleFileSelect(e, 'reference')}
          className="hidden"
        />
        <input
          ref={sourceInputRef}
          type="file"
          accept="audio/*"
          onChange={(e) => handleFileSelect(e, 'source')}
          className="hidden"
        />
        <audio
          ref={referenceAudioRef}
          src={referenceAudioUrl || undefined}
          onPlay={() => setReferencePlaying(true)}
          onPause={() => setReferencePlaying(false)}
          onEnded={() => setReferencePlaying(false)}
          onTimeUpdate={(e) => setReferenceTime(e.currentTarget.currentTime)}
          onLoadedMetadata={(e) => setReferenceDuration(e.currentTarget.duration || 0)}
        />
        <audio
          ref={sourceAudioRef}
          src={sourceAudioUrl || undefined}
          onPlay={() => setSourcePlaying(true)}
          onPause={() => setSourcePlaying(false)}
          onEnded={() => setSourcePlaying(false)}
          onTimeUpdate={(e) => setSourceTime(e.currentTarget.currentTime)}
          onLoadedMetadata={(e) => setSourceDuration(e.currentTarget.duration || 0)}
        />

        {/* Header - Branding + Mode Toggle */}
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <img
              src={typeof window !== 'undefined' && window.location.pathname.startsWith('/stepstudio') ? '/stepstudio/strands-logo.svg' : '/strands-logo.svg'}
              alt="Strands"
              className="w-5 h-5"
            />
            <span className="text-sm font-display font-bold tracking-wider text-zinc-900 dark:text-white">S³ SOUND STUDIO</span>
            <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse ml-auto"></div>
          </div>

          {/* 2026-05-04 SGT (#36): Simple/Custom toggle killed. Custom is
              the only mode; tier-gating governs panel surface. */}
          <div className="flex items-center">
            <span className="text-[10px] text-zinc-400 dark:text-zinc-500 tracking-wide">Strands Sound Studio</span>
          </div>
        </div>

        {/* Model Selector — compact inline */}
        {canUseProFeatures && ditModels.length > 0 && (
          <div className="flex items-center gap-2 px-1">
            <Cpu size={12} className="text-zinc-400 flex-shrink-0" />
            <select
              value={selectedModel}
              onChange={(e) => {
                setSelectedModel(e.target.value);
              }}
              disabled={isSwitchingModel}
              className="flex-1 bg-transparent text-[11px] font-medium text-zinc-600 dark:text-zinc-400 border-none focus:outline-none cursor-pointer appearance-none"
              style={{ backgroundImage: 'none' }}
            >
              {ditModels.map(m => {
                return (
                  <option key={m.name} value={m.name}>
                    {modelDisplayLabel(m.name)}
                    {m.is_loaded ? ' ●' : ''}
                  </option>
                );
              })}
            </select>
            {selectedModel !== loadedModel && (
              <button
                onClick={handleModelSwitch}
                disabled={isSwitchingModel}
                className="flex items-center gap-1 px-2 py-1 bg-indigo-600 text-white rounded text-[10px] font-semibold hover:bg-indigo-700 transition-colors disabled:opacity-50"
              >
                {isSwitchingModel ? <RefreshCw size={10} className="animate-spin" /> : <Zap size={10} />}
                {isSwitchingModel ? 'Swapping...' : 'Swap'}
              </button>
            )}
            {selectedModel === loadedModel && (
              <span className="text-[10px] text-emerald-500 font-medium">Active</span>
            )}
          </div>
        )}

        {/* Task Mode Banner — visible outside Creative Controls for non-text2music modes */}
        {taskType !== 'text2music' && !coverSong && (
          <div
            className="ew-card flex items-center justify-between px-3 py-2.5"
            style={{
              background: 'var(--ew-primary-soft)',
              borderColor: 'var(--ew-primary)',
            }}
          >
            <div className="flex items-center gap-2">
              <Disc3 size={14} className="text-accent-500" />
              <span className="text-xs font-bold text-accent-400 uppercase">
                {taskType === 'cover' ? 'AI Cover' : taskType === 'repaint' ? 'Repaint' : taskType === 'extract' ? 'Extract Stems' : taskType === 'lego' ? 'Lego Remix' : taskType === 'complete' ? 'Auto-Complete' : taskType}
              </span>
              {!getCapabilityModel() && ['extract', 'lego', 'complete'].includes(taskType) && (
                <span className="text-[10px] text-amber-400 bg-amber-500/10 px-1.5 py-0.5 rounded">Requires Pro Model</span>
              )}
            </div>
            <button
              onClick={() => { setTaskType('text2music'); setSourceAudioUrl(''); setSourceAudioLabel(''); setCoverSong(null); }}
              className="p-1 text-zinc-400 hover:text-zinc-300"
              title="Switch back to Text to Music"
            >
              <X size={14} />
            </button>
          </div>
        )}

        {/* Cover Source Track Card */}
        {coverSong && taskType === 'cover' && (
          <div
            className="ew-card overflow-hidden"
            style={{
              background: 'var(--ew-primary-soft)',
              borderColor: 'var(--ew-primary)',
            }}
          >
            <div className="px-3 py-2 flex items-center justify-between bg-accent-500/5 dark:bg-accent-500/5 border-b border-accent-500/10">
              <div className="flex items-center gap-2">
                <Disc3 size={14} className="text-accent-500" />
                <span className="text-[11px] font-bold uppercase tracking-wide text-accent-600 dark:text-accent-400">Covering</span>
              </div>
              <button
                onClick={() => {
                  setCoverSong(null);
                  setTaskType('text2music');
                  setSourceAudioUrl('');
                  setSourceAudioLabel('');
                }}
                className="p-1 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
                title="Remove cover source"
              >
                <X size={14} />
              </button>
            </div>
            <div className="px-3 py-3 flex items-center gap-3">
              <div className="w-12 h-12 rounded-lg overflow-hidden flex-shrink-0 bg-zinc-200 dark:bg-zinc-800 shadow-sm">
                {coverSong.coverUrl ? (
                  <img src={coverSong.coverUrl} alt={coverSong.title} className="w-full h-full object-cover" />
                ) : (
                  <AlbumCover seed={coverSong.id || coverSong.title} size="full" className="w-full h-full" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-zinc-900 dark:text-white truncate">{coverSong.title}</div>
                <div className="text-xs text-zinc-500 dark:text-zinc-400 truncate mt-0.5">
                  {coverSong.style ? (
                    <>{coverSong.style.slice(0, 60)}{coverSong.style.length > 60 ? '...' : ''}</>
                  ) : (
                    'No style tags'
                  )}
                </div>
                {coverSong.duration && (
                  <div className="text-[10px] text-zinc-400 dark:text-zinc-500 mt-1">
                    {Math.floor(Number(coverSong.duration) / 60)}:{String(Math.floor(Number(coverSong.duration) % 60)).padStart(2, '0')} · Source Influence: {(audioCoverStrength * 100).toFixed(0)}%
                  </div>
                )}
              </div>
            </div>

            {/* Inline Source Influence slider + Pro Model guidance */}
            <div className="px-3 py-3 border-t border-accent-500/10 space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-[10px] font-bold uppercase tracking-wide text-accent-600 dark:text-accent-400">Source Influence</label>
                <span className="text-xs font-mono text-zinc-900 dark:text-white bg-zinc-100 dark:bg-black/20 px-2 py-0.5 rounded">{(audioCoverStrength * 100).toFixed(0)}%</span>
              </div>
              <input
                type="range" min="0" max="1" step="0.05" value={audioCoverStrength}
                onChange={(e) => setAudioCoverStrength(Number(e.target.value))}
                className="w-full h-1.5 bg-zinc-200 dark:bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-accent-500"
              />
              <p className="text-[10px] text-zinc-500">
                {audioCoverStrength >= 0.85
                  ? 'Very high: stays close to original, minimal style/lyric changes. Lower to 60-75% for restyling.'
                  : audioCoverStrength >= 0.6
                  ? 'Good balance: recognizable source with room for style and lyric changes.'
                  : audioCoverStrength >= 0.3
                  ? 'Loose inspiration: keeps structure hints, mostly regenerates from your text.'
                  : 'Minimal influence: source audio nearly ignored.'}
              </p>
              {isFastTurboModel(loadedModel) && (
                <div
                  className="ew-card flex items-center gap-2 p-2"
                  style={{
                    background: 'color-mix(in srgb, var(--ew-warning) 12%, transparent)',
                    borderColor: 'color-mix(in srgb, var(--ew-warning) 35%, transparent)',
                  }}
                >
                  <AlertTriangle size={12} className="text-amber-500 shrink-0" />
                  <p className="text-[10px] text-amber-400">
                    Cover needs the Pro Model for full fidelity.
                  </p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* 2026-05-04 SGT (#36): Simple Mode JSX killed. Custom is the
            only mode now; tier-gating handled inline at Reference/Cover
            pills and Show Advanced toggle. */}
        <div className="space-y-5">
            {/* Audio Section */}
            <div
              onDrop={(e) => { if (audioTab !== 'song') handleDrop(e, audioTab); }}
              onDragOver={handleDragOver}
              className="ew-card overflow-hidden"
            >
              {/* Header with Audio label and tabs */}
              <div className="px-3 py-2.5 border-b border-zinc-100 dark:border-white/5 bg-zinc-50 dark:bg-white/[0.02]">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-wide">Audio</span>
                  {/* Reference / Cover mode toggle — ghost rail same as
                      Simple/Custom above. Active state inverts to primary. */}
                  <div
                    className="flex items-center gap-0 p-0.5"
                    style={{
                      background: 'var(--ew-surface-raised)',
                      border: '1px solid var(--ew-border)',
                    }}
                  >
                    {/* Song pill (added 2026-05-01 SGT). Pure
                        text-to-song: lyrics + style tags drive the
                        output, no audio reference required. Selecting
                        this pill clears any uploaded reference/source
                        audio and any cover-reuse song so the payload
                        cleanly omits referenceAudioUrl / sourceAudioUrl
                        / coverSong on the next CREATE. */}
                    <button
                      type="button"
                      onClick={() => {
                        setAudioTab('song');
                        setTaskType('text2music');
                        setReferenceAudioUrl('');
                        setSourceAudioUrl('');
                        setReferenceAudioLabel('');
                        setSourceAudioLabel('');
                        setCoverSong(null);
                        applyGenerationPreset(
                          generationPresetFor(loadedModel || selectedModel || getSongModel(), 'song'),
                        );
                      }}
                      className={`ew-btn ew-btn--sm ${audioTab === 'song' ? 'ew-btn--primary' : 'ew-btn--ghost'}`}
                    >
                      Song
                    </button>
                    {canUseReferenceCover && (
                      <>
                        <button
                          type="button"
                          onClick={() => {
                            setAudioTab('reference');
                            if (taskType === 'cover') {
                              setTaskType('text2music');
                            }
                            applyGenerationPreset(
                              generationPresetFor(getCapabilityModel() || loadedModel || selectedModel, 'reference'),
                            );
                          }}
                          className={`ew-btn ew-btn--sm ${audioTab === 'reference' ? 'ew-btn--primary' : 'ew-btn--ghost'}`}
                        >
                          Reference
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setAudioTab('source');
                            setTaskType('cover');
                            applyGenerationPreset(
                              generationPresetFor(getCapabilityModel() || loadedModel || selectedModel, 'cover'),
                              { snapCoverStrength: true },
                            );
                            if (canUseAdvancedControls) setShowAdvanced(true);
                            if (!sourceAudioUrl.trim()) {
                              openAudioModal('source');
                            }
                          }}
                          className={`ew-btn ew-btn--sm ${audioTab === 'source' ? 'ew-btn--primary' : 'ew-btn--ghost'}`}
                        >
                          Cover
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>

              {/* Audio body (added gate 2026-05-01 SGT): everything from
                  the explanation paragraph through the From-Library /
                  Upload pair is hidden when audioTab === 'song'. The
                  card collapses to header + pill rail in pure
                  text-to-song mode so the user sees no audio chrome
                  unless they explicitly opt in via the Reference or
                  Cover pill. */}
              {audioTab !== 'song' && (
                <>
              {/* Mode explanation. Both Reference and Cover ride better on
                  the Pro capability model. Keep this copy product-facing;
                  raw GGUF filenames and quant names belong in diagnostics,
                  not the generation panel. */}
              <div className="px-3 pt-2">
                <p className="text-[10px] text-zinc-500 dark:text-zinc-400">
                  {audioTab === 'reference'
                    ? 'Style inspiration only. The AI listens to this track for vibe, genre, and energy, then generates something new. Reference needs the Pro Model for full fidelity.'
                    : 'Full restyle. The AI reconstructs this track with your new style and lyrics painted over the original structure. Cover needs the Pro Model for quality results.'}
                </p>
              </div>

              {/* Reference + Turbo warning — kept as fallback context for
                  trial / base / anonymous tiers. Paid Pro users get a
                  more actionable BetterModelsBanner just below with a
                  Download Pro Model CTA wired to /api/engine/install-pack.
                  2026-05-03 LATE NIGHT SGT (handover P3.3). */}
              {audioTab === 'reference' && isFastTurboModel(loadedModel) && (
                <div className="px-3 pt-2">
                  <div
                    className="ew-card flex items-center gap-2 p-2"
                    style={{
                      background: 'color-mix(in srgb, var(--ew-warning) 12%, transparent)',
                      borderColor: 'color-mix(in srgb, var(--ew-warning) 35%, transparent)',
                    }}
                  >
                    <AlertTriangle size={12} className="text-amber-500 shrink-0" />
                    <p className="text-[10px] text-amber-400">
                      Reference and Cover need the Pro Model for full fidelity.
                    </p>
                  </div>
                </div>
              )}

              {/* BetterModelsBanner — paid Pro / Creator Studio users see
                  an actionable download CTA when the better_models pack
                  isn't on disk. Internally checks /api/engine/pack-status
                  on mount + tier change; renders nothing for trial users,
                  base users, or when the pack is already present.
                  2026-05-03 LATE NIGHT SGT (handover P3.3-P3.5).

                  onInstalled: 2026-05-04 SGT — after the pack lands the
                  engine still has Turbo loaded. Auto-fetch the refreshed
                  model list, find the XL Base entry, and trigger a
                  model switch to it. The existing auto-snap useEffect
                  watches loadedModel, so once the switch completes the
                  inference settings (steps / CFG / shift / thinking /
                  batch) auto-set to Base defaults. User-friendly: one
                  click "Download Pro Model" delivers a tuned capability
                  setup without manual model-selector hunting. */}
              <BetterModelsBanner
                show={audioTab === 'reference' || audioTab === 'source'}
                onInstalled={() => {
                  if (!token) return;
                  engineApi
                    .models(token)
                    .then((inv) => {
                      setDitModels(inv.models || []);
                      const baseEntry = inv.models?.find(
                        (m) =>
                          m.name.includes('base') ||
                          !m.name.includes('turbo'),
                      );
                      if (baseEntry && baseEntry.name !== loadedModel) {
                        setSelectedModel(baseEntry.name);
                        // Trigger the same path the model-selector click uses,
                        // but inline so we don't depend on selectedModel state
                        // having committed before handleModelSwitch reads it.
                        setIsSwitchingModel(true);
                        engineApi
                          .init({ model: baseEntry.name }, token)
                          .then((result) => {
                            setLoadedModel(result.loaded_model || baseEntry.name);
                          })
                          .catch((err) => {
                            console.warn(
                              '[CreatePanel] auto-switch to Base after install failed',
                              err,
                            );
                          })
                          .finally(() => setIsSwitchingModel(false));
                      }
                    })
                    .catch((err) => {
                      console.warn(
                        '[CreatePanel] could not refresh model list after install',
                        err,
                      );
                    });
                }}
              />

              {/* Audio Content */}
              <div className="p-3 space-y-2">
                {/* Reference Audio Player. Reference uses --ew-primary
                    so it tracks the active skin. Source (below) uses
                    --ew-warm for visual distinction between the two
                    audio inputs in Cover mode. EWDS retheme polish
                    2026-04-25 SGT. */}
                {audioTab === 'reference' && referenceAudioUrl && (
                  <div
                    className="flex items-center gap-3 p-2"
                    style={{
                      background: 'var(--ew-surface-sunken)',
                      border: '1px solid var(--ew-border)',
                      clipPath: 'var(--ew-clip-button-sm)',
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => toggleAudio('reference')}
                      className="relative flex-shrink-0 w-10 h-10 flex items-center justify-center transition-transform hover:scale-105"
                      style={{
                        background: 'var(--ew-primary)',
                        color: 'var(--ew-primary-fg)',
                        clipPath: 'var(--ew-clip-button-sm)',
                        boxShadow: 'var(--ew-shadow-glow)',
                      }}
                    >
                      {referencePlaying ? (
                        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z"/></svg>
                      ) : (
                        <svg className="w-4 h-4 ml-0.5" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
                      )}
                      <span
                        className="absolute -bottom-1 -right-1 px-1 py-0.5 tabular-nums"
                        style={{
                          fontFamily: 'var(--ew-font-mono)',
                          fontSize: 8,
                          fontWeight: 600,
                          background: 'var(--ew-bg)',
                          color: 'var(--ew-text)',
                          border: '1px solid var(--ew-border-strong)',
                        }}
                      >
                        {formatTime(referenceDuration)}
                      </span>
                    </button>
                    <div className="flex-1 min-w-0">
                      <div
                        className="truncate mb-1.5"
                        style={{ fontSize: 12, fontWeight: 500, color: 'var(--ew-text)' }}
                      >
                        {getAudioLabel(referenceAudioUrl)}
                      </div>
                      <div className="flex items-center gap-2">
                        <span
                          className="tabular-nums"
                          style={{ fontSize: 10, color: 'var(--ew-text-faint)', fontFamily: 'var(--ew-font-mono)' }}
                        >{formatTime(referenceTime)}</span>
                        <div
                          className="flex-1 h-1.5 cursor-pointer group/seek"
                          style={{ background: 'var(--ew-surface-sunken)', border: '1px solid var(--ew-border)' }}
                          onClick={(e) => {
                            if (referenceAudioRef.current && referenceDuration > 0) {
                              const rect = e.currentTarget.getBoundingClientRect();
                              const percent = (e.clientX - rect.left) / rect.width;
                              referenceAudioRef.current.currentTime = percent * referenceDuration;
                            }
                          }}
                        >
                          <div
                            className="h-full transition-all relative"
                            style={{
                              width: referenceDuration ? `${Math.min(100, (referenceTime / referenceDuration) * 100)}%` : '0%',
                              background: 'var(--ew-primary)',
                            }}
                          />
                        </div>
                        <span
                          className="tabular-nums"
                          style={{ fontSize: 10, color: 'var(--ew-text-faint)', fontFamily: 'var(--ew-font-mono)' }}
                        >{formatTime(referenceDuration)}</span>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => { setReferenceAudioUrl(''); setReferenceAudioLabel(''); setReferencePlaying(false); setReferenceTime(0); setReferenceDuration(0); }}
                      className="p-1.5 transition-colors"
                      style={{ color: 'var(--ew-text-faint)', background: 'transparent', border: 'none', cursor: 'pointer' }}
                      onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--ew-danger)')}
                      onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--ew-text-faint)')}
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/></svg>
                    </button>
                  </div>
                )}

                {/* Source/Cover Audio Player. Uses --ew-warm so it reads
                    distinctly from the reference player above (which
                    uses --ew-primary). Helps users tell at a glance
                    which slot they are filling in Cover mode. */}
                {audioTab === 'source' && sourceAudioUrl && (
                  <div
                    className="flex items-center gap-3 p-2"
                    style={{
                      background: 'var(--ew-surface-sunken)',
                      border: '1px solid var(--ew-border)',
                      clipPath: 'var(--ew-clip-button-sm)',
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => toggleAudio('source')}
                      className="relative flex-shrink-0 w-10 h-10 flex items-center justify-center transition-transform hover:scale-105"
                      style={{
                        background: 'var(--ew-warm)',
                        color: 'var(--ew-text-inverse)',
                        clipPath: 'var(--ew-clip-button-sm)',
                      }}
                    >
                      {sourcePlaying ? (
                        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z"/></svg>
                      ) : (
                        <svg className="w-4 h-4 ml-0.5" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
                      )}
                      <span
                        className="absolute -bottom-1 -right-1 px-1 py-0.5 tabular-nums"
                        style={{
                          fontFamily: 'var(--ew-font-mono)',
                          fontSize: 8,
                          fontWeight: 600,
                          background: 'var(--ew-bg)',
                          color: 'var(--ew-text)',
                          border: '1px solid var(--ew-border-strong)',
                        }}
                      >
                        {formatTime(sourceDuration)}
                      </span>
                    </button>
                    <div className="flex-1 min-w-0">
                      <div
                        className="truncate mb-1.5"
                        style={{ fontSize: 12, fontWeight: 500, color: 'var(--ew-text)' }}
                      >
                        {getAudioLabel(sourceAudioUrl)}
                      </div>
                      <div className="flex items-center gap-2">
                        <span
                          className="tabular-nums"
                          style={{ fontSize: 10, color: 'var(--ew-text-faint)', fontFamily: 'var(--ew-font-mono)' }}
                        >{formatTime(sourceTime)}</span>
                        <div
                          className="flex-1 h-1.5 cursor-pointer group/seek"
                          style={{ background: 'var(--ew-surface-sunken)', border: '1px solid var(--ew-border)' }}
                          onClick={(e) => {
                            if (sourceAudioRef.current && sourceDuration > 0) {
                              const rect = e.currentTarget.getBoundingClientRect();
                              const percent = (e.clientX - rect.left) / rect.width;
                              sourceAudioRef.current.currentTime = percent * sourceDuration;
                            }
                          }}
                        >
                          <div
                            className="h-full transition-all relative"
                            style={{
                              width: sourceDuration ? `${Math.min(100, (sourceTime / sourceDuration) * 100)}%` : '0%',
                              background: 'var(--ew-warm)',
                            }}
                          />
                        </div>
                        <span
                          className="tabular-nums"
                          style={{ fontSize: 10, color: 'var(--ew-text-faint)', fontFamily: 'var(--ew-font-mono)' }}
                        >{formatTime(sourceDuration)}</span>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => { setSourceAudioUrl(''); setSourceAudioLabel(''); setSourcePlaying(false); setSourceTime(0); setSourceDuration(0); }}
                      className="p-1.5 transition-colors"
                      style={{ color: 'var(--ew-text-faint)', background: 'transparent', border: 'none', cursor: 'pointer' }}
                      onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--ew-danger)')}
                      onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--ew-text-faint)')}
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/></svg>
                    </button>
                  </div>
                )}

                {/* Inline Source Influence — visible in Cover tab when source audio is loaded */}
                {audioTab === 'source' && sourceAudioUrl && (
                  <div
                    className="ew-card p-2.5 space-y-1.5"
                    style={{ background: 'var(--ew-surface-raised)' }}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-bold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Source Influence</span>
                      <span className="text-[11px] font-mono text-zinc-900 dark:text-white">{(audioCoverStrength * 100).toFixed(0)}%</span>
                    </div>
                    <input
                      type="range" min="0" max="1" step="0.05" value={audioCoverStrength}
                      onChange={(e) => setAudioCoverStrength(Number(e.target.value))}
                      className="w-full h-1.5 bg-zinc-200 dark:bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-accent-500"
                    />
                    <p className="text-[9px] text-zinc-400">
                      {audioCoverStrength >= 0.85 ? 'Very faithful to original. Lower to 60-75% if lyrics/style should change.'
                        : audioCoverStrength >= 0.6 ? 'Good balance: recognizable source + your style/lyric changes.'
                        : audioCoverStrength >= 0.3 ? 'Loose inspiration. Keeps structure, mostly regenerates.'
                        : 'Minimal. Source nearly ignored.'}
                    </p>
                    {isFastTurboModel(loadedModel) && (
                      <div className="flex items-center gap-1.5 mt-1">
                        <AlertTriangle size={10} className="text-amber-500 shrink-0" />
                        <span className="text-[9px] text-amber-400">Cover needs the Pro Model for full fidelity.</span>
                      </div>
                    )}
                  </div>
                )}

                {/* Action buttons. From-library + Upload pair routed
                    through .ew-btn ghost so they pick up the chamfer per
                    skin and the hover state shifts to --ew-primary.
                    flex:1 + justifyContent:center kept inline since
                    .ew-btn defaults to inline-flex without flex-grow. */}
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => openAudioModal(audioTab)}
                    className="ew-btn ew-btn--ghost ew-btn--sm"
                    style={{ flex: 1, justifyContent: 'center' }}
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3"/>
                    </svg>
                    From library
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (audioTab === 'reference') {
                        referenceInputRef.current?.click();
                      } else {
                        sourceInputRef.current?.click();
                      }
                    }}
                    className="ew-btn ew-btn--ghost ew-btn--sm"
                    style={{ flex: 1, justifyContent: 'center' }}
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"/>
                    </svg>
                    Upload
                  </button>
                </div>

                {/* Upload size + speed guidance, plain-English. Sean's
                    call 2026-05-04 SGT: dummies-language, no "VRAM" /
                    "conditioning". The longer your audio, the longer
                    you wait — that's the whole story the user needs. */}
                <p className="text-[10px] text-zinc-500 dark:text-zinc-400 mt-1.5">
                  {AUDIO_FORMATS_LABEL}.{' '}
                  {audioTab === 'reference'
                    ? 'A 30 to 60 second clip works best. The longer your file, the longer your song takes to make.'
                    : 'A 3 to 5 minute song works best. The longer your file, the longer your song takes to make.'}
                </p>

                {uploadError && (
                  <div
                    className="mt-2 text-[11px]"
                    style={{ color: 'var(--ew-warning, #ef4444)' }}
                  >
                    {uploadError}
                  </div>
                )}
              </div>
                </>
              )}
            </div>

            {/* Title Input — first field in creation flow (2026-05-05 SGT).
                Sits above Lyrics so users name their track before writing. */}
            <div>
              <label
                className="ew-eyebrow block mb-1.5"
                style={{ color: 'var(--ew-text-muted)' }}
              >
                Title
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Name your song"
                className="ew-input w-full text-sm"
                data-tour="gener8-title"
              />
            </div>

            {/* Lyrics Input. Chamfered card via --ew-clip-card so the
                TR+BL bevel reads in Classic/Refined and snaps to 0px in
                Terminal. Header and body inherit ew-* tokens; focus state
                drops the rounded-xl Tailwind override. EWDS retheme polish
                2026-04-25 SGT. */}
            <div
              ref={lyricsRef}
              className="overflow-hidden transition-colors group relative flex flex-col"
              style={{
                height: 'auto',
                background: 'var(--ew-surface)',
                border: '1px solid var(--ew-border)',
                clipPath: 'var(--ew-clip-card)',
              }}
            >
              <div
                className="flex items-center justify-between px-3 py-2.5 flex-shrink-0"
                style={{
                  background: 'var(--ew-surface-sunken)',
                  borderBottom: '1px solid var(--ew-border)',
                }}
              >
                <div>
                  <span
                    style={{
                      fontFamily: 'var(--ew-font-mono)',
                      fontSize: 10,
                      fontWeight: 600,
                      letterSpacing: '0.22em',
                      textTransform: 'uppercase',
                      color: 'var(--ew-text-faint)',
                    }}
                  >
                    Lyrics
                  </span>
                  <p
                    className="mt-0.5"
                    style={{ fontSize: 11, color: 'var(--ew-text-faint)' }}
                  >
                    Leave empty for instrumental or toggle below
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {/* Vocal / Instrumental toggle. .ew-chip with --on
                      modifier so it picks up the active skin primary
                      when toggled. EWDS retheme polish 2026-04-25 SGT. */}
                  <button
                    onClick={() => setInstrumental(!instrumental)}
                    className={`ew-chip ${instrumental ? 'ew-chip--on' : ''}`}
                  >
                    {instrumental ? 'Instrumental' : 'Vocal'}
                  </button>
                  <button
                    className="p-1.5 hover:bg-zinc-200 dark:hover:bg-white/10 rounded text-zinc-500 hover:text-black dark:hover:text-white transition-colors"
                    onClick={() => setLyrics('')}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
              <textarea
                disabled={instrumental}
                value={lyrics}
                onChange={(e) => setLyrics(e.target.value)}
                placeholder={instrumental ? "Instrumental mode - no lyrics needed" : "[Verse]\nYour lyrics here...\n\n[Chorus]\nThe catchy part..."}
                className={`w-full bg-transparent p-3 text-sm text-zinc-900 dark:text-white placeholder-zinc-400 dark:placeholder-zinc-600 focus:outline-none resize-none font-mono leading-relaxed ${instrumental ? 'opacity-30 cursor-not-allowed' : ''}`}
                style={{ height: `${lyricsHeight}px` }}
                data-tour="gener8-lyrics"
              />
              {/* Resize Handle */}
              <div
                onMouseDown={startResizing}
                className="h-3 w-full cursor-ns-resize flex items-center justify-center hover:bg-zinc-100 dark:hover:bg-white/5 transition-colors absolute bottom-0 left-0 z-10"
              >
                <div className="w-8 h-1 rounded-full bg-zinc-300 dark:bg-zinc-700"></div>
              </div>
            </div>

            {/* Style Input. Same chamfered card treatment as Lyrics so
                the two CreatePanel surfaces read as a matched pair. */}
            <div
              className="overflow-hidden transition-colors group"
              style={{
                background: 'var(--ew-surface)',
                border: '1px solid var(--ew-border)',
                clipPath: 'var(--ew-clip-card)',
              }}
            >
              <div
                className="flex items-center justify-between px-3 py-2.5"
                style={{
                  background: 'var(--ew-surface-sunken)',
                  borderBottom: '1px solid var(--ew-border)',
                }}
              >
                <div>
                  <span
                    style={{
                      fontFamily: 'var(--ew-font-mono)',
                      fontSize: 10,
                      fontWeight: 600,
                      letterSpacing: '0.22em',
                      textTransform: 'uppercase',
                      color: 'var(--ew-text-faint)',
                    }}
                  >
                    Style of Music
                  </span>
                  <p
                    className="mt-0.5"
                    style={{ fontSize: 11, color: 'var(--ew-text-faint)' }}
                  >
                    Genre, mood, instruments, vibe
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={handleEnhanceStyle}
                    disabled={isEnhancing || !style.trim()}
                    className={`p-1.5 rounded transition-colors ${
                      styleAssistEnabled && enhancedStyle
                        ? 'bg-indigo-500/20 text-indigo-400 hover:bg-indigo-500/30'
                        : 'hover:bg-zinc-200 dark:hover:bg-white/10 text-zinc-500 hover:text-black dark:hover:text-white'
                    } ${isEnhancing ? 'animate-pulse' : ''} ${!style.trim() ? 'opacity-30 cursor-not-allowed' : ''}`}
                    title={styleAssistEnabled ? 'Re-enhance style' : 'Enhance style with AI'}
                  >
                    {isEnhancing ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                  </button>
                </div>
              </div>
              <textarea
                value={style}
                onChange={(e) => {
                  setStyle(e.target.value);
                  // Invalidate enhanced style when user edits raw input
                  if (enhancedStyle) setEnhancedStyle(null);
                }}
                placeholder="e.g. upbeat pop rock, emotional ballad, 90s hip hop"
                className="w-full h-20 bg-transparent p-3 text-sm text-zinc-900 dark:text-white placeholder-zinc-400 dark:placeholder-zinc-600 focus:outline-none resize-none"
                data-tour="gener8-style"
              />

              {/* Enhanced style preview: explicit accept flow. */}
              {enhancedStyle && (
                <div
                  className="mx-3 mb-2 p-2.5 rounded-lg text-xs leading-relaxed"
                  style={{
                    background: 'var(--ew-surface-sunken)',
                    border: '1px solid color-mix(in srgb, var(--ew-accent) 25%, transparent)',
                  }}
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-1.5">
                      <Sparkles size={10} className="text-indigo-400" />
                      <span
                        style={{
                          fontFamily: 'var(--ew-font-mono)',
                          fontSize: 9,
                          fontWeight: 600,
                          letterSpacing: '0.15em',
                          textTransform: 'uppercase',
                          color: 'var(--ew-text-faint)',
                        }}
                      >
                        {styleAssistEnabled ? 'Enhanced Style (will be used)' : 'Suggested prompt ready'}
                      </span>
                    </div>
                    <div className="flex items-center gap-1">
                      {!styleAssistEnabled && (
                        <button
                          onClick={() => setStyleAssistEnabled(true)}
                          className="px-2 py-1 rounded text-[10px] font-semibold bg-indigo-500/20 text-indigo-300 hover:bg-indigo-500/30 transition-colors"
                          title="Use this prompt for generation"
                        >
                          Use prompt
                        </button>
                      )}
                      <button
                        onClick={handleEnhanceStyle}
                        disabled={isEnhancing}
                        className="p-1 hover:bg-white/10 rounded text-zinc-500 hover:text-white transition-colors"
                        title="Re-enhance"
                      >
                        <RefreshCw size={10} className={isEnhancing ? 'animate-spin' : ''} />
                      </button>
                      <button
                        onClick={() => { setStyleAssistEnabled(false); setEnhancedStyle(null); }}
                        className="p-1 hover:bg-white/10 rounded text-zinc-500 hover:text-white transition-colors"
                        title="Dismiss enhancement"
                      >
                        <X size={10} />
                      </button>
                    </div>
                  </div>
                  <p className="text-zinc-300 whitespace-pre-wrap">{enhancedStyle}</p>
                </div>
              )}

              {/* Genre quick-add chips */}
              <div className="px-3 pb-3 flex flex-wrap gap-2">
                {['Pop', 'Rock', 'Electronic', 'Hip Hop', 'Jazz', 'Classical'].map(tag => (
                  <button
                    key={tag}
                    onClick={() => setStyle(prev => prev ? `${prev}, ${tag}` : tag)}
                    className="ew-chip"
                  >
                    {tag}
                  </button>
                ))}
              </div>
            </div>

            {/* Patch Selector
                Hidden at launch (2026-05-03 SGT). The 2026-04-26 SGT
                reconciliation placed Apply Style Patches on Pro
                (GGUF-compatible inference) with the assumption that a
                community patch library would exist via Creator Studio's
                StyleForge training stack. Creator Studio is parked
                pending model-swap verification + API credit work, so
                no patches exist to apply at launch and rendering an
                empty picker (or an upsell to a tier that doesn't ship
                a patch source) is dishonest UX.
                The whole Style Patch lifecycle (train + apply) now
                gates on creator_studio. When Creator Studio ships with
                StyleForge, this surface lights up automatically for
                those subscribers. No code removal needed; the gate
                just doesn't grant under current entitlements. */}
            {hasTier('creator_studio') && (
              <PatchSelector
                onPatchChange={handlePatchChange}
              />
            )}

          </div>

        {/* COMMON SETTINGS */}
        <div className="space-y-4">
          {/* 2026-05-04 SGT (#36): Simple-mode-only Instrumental toggle
              killed (the Custom-mode Instrumental toggle lives next to
              the Lyrics textarea above). */}

          {/* Vocal Language (shown when not instrumental) */}
          {!instrumental && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-wide px-1">
                  Vocal Language
                </label>
                <select
                  value={vocalLanguage}
                  onChange={(e) => setVocalLanguage(e.target.value)}
                  className="w-full ew-input px-3 py-2 text-sm text-zinc-900 dark:text-white focus:outline-none"
                >
                  {VOCAL_LANGUAGES.map(lang => (
                    <option key={lang.value} value={lang.value}>{lang.label}</option>
                  ))}
                </select>
              </div>
            </div>
          )}
        </div>

        {/* MUSIC PARAMETERS */}
        <div className="ew-card p-4 space-y-4">
          <h3 className="text-xs font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-wide flex items-center gap-2">
            <Sliders size={14} />
            Music Parameters
          </h3>

          {/* BPM */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-zinc-600 dark:text-zinc-400">BPM</label>
              <span className="text-xs font-mono text-zinc-900 dark:text-white bg-zinc-100 dark:bg-black/20 px-2 py-0.5 rounded">
                {bpm === 0 ? 'Auto' : bpm}
              </span>
            </div>
            <input
              type="range"
              min="0"
              max="300"
              step="5"
              value={bpm}
              onChange={(e) => setBpm(Number(e.target.value))}
              className="w-full h-2 bg-zinc-200 dark:bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-accent-500"
            />
            <div className="flex justify-between text-[10px] text-zinc-500">
              <span>Auto</span>
              <span>300</span>
            </div>
          </div>

          {/* Key & Time Signature */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-zinc-600 dark:text-zinc-400">Key</label>
              <select
                value={keyScale}
                onChange={(e) => setKeyScale(e.target.value)}
                className="w-full ew-input px-2 py-1.5 text-xs text-zinc-900 dark:text-white focus:outline-none"
              >
                <option value="">Auto</option>
                {KEY_SIGNATURES.filter(k => k).map(key => (
                  <option key={key} value={key}>{key}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-zinc-600 dark:text-zinc-400">Time</label>
              <select
                value={timeSignature}
                onChange={(e) => setTimeSignature(e.target.value)}
                className="w-full ew-input px-2 py-1.5 text-xs text-zinc-900 dark:text-white focus:outline-none"
              >
                <option value="">Auto</option>
                {TIME_SIGNATURES.filter(t => t).map(time => (
                  <option key={time} value={time}>{time}</option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* CREATIVE CONTROLS — Pro+ only. Gener8 4ever stays prompt-first. */}
        {canUseAdvancedControls && (
          <button
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="w-full flex items-center justify-between px-4 py-3 ew-card text-sm font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-white/5 transition-colors"
            data-tour="gener8-advanced-toggle"
          >
            <div className="flex items-center gap-2">
              <Settings2 size={16} className="text-zinc-500" />
              <span>Creative Controls</span>
              {modelType && (
                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full uppercase ${
                  modelType === 'turbo' ? 'bg-emerald-500/20 text-emerald-400' :
                  modelType === 'base' ? 'bg-amber-500/20 text-amber-400' :
                  'bg-zinc-500/20 text-zinc-400'
                }`}>
                  {modelType === 'base'
                    ? 'pro'
                    : modelType === 'sftturbo50'
                    ? 'song'
                    : modelType === 'turbo'
                    ? 'fast'
                    : 'auto'}
                </span>
              )}
            </div>
            <ChevronDown size={16} className={`text-zinc-500 transition-transform ${showAdvanced ? 'rotate-180' : ''}`} />
          </button>
        )}

        {canUseAdvancedControls && showAdvanced && (
          <div className="ew-card p-4 space-y-4">

            {/* Duration */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-zinc-600 dark:text-zinc-400">Duration</label>
                <span className="text-xs font-mono text-zinc-900 dark:text-white bg-zinc-100 dark:bg-black/20 px-2 py-0.5 rounded">
                  {duration === -1 ? 'Auto' : `${duration}s`}
                </span>
              </div>
              <input
                type="range"
                min="-1"
                max="600"
                step="5"
                value={duration}
                onChange={(e) => setDuration(Number(e.target.value))}
                className="w-full h-2 bg-zinc-200 dark:bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-accent-500"
              />
              <div className="flex justify-between text-[10px] text-zinc-500">
                <span>Auto</span>
                <span>10 min</span>
              </div>
              {/* Fixed sweet-spot advisory (added 2026-05-01 SGT).
                  Mirrored from Quick Settings duration block. Visible
                  in both Simple and Custom advanced views so users
                  can't miss the guidance regardless of how they
                  navigate to the duration control. */}
              <div
                className="ew-card flex items-start gap-2 p-2"
                style={{
                  background: 'color-mix(in srgb, var(--ew-warning) 12%, transparent)',
                  borderColor: 'color-mix(in srgb, var(--ew-warning) 35%, transparent)',
                }}
              >
                <AlertTriangle size={12} className="text-amber-500 shrink-0 mt-0.5" />
                <p className="text-[10px] text-amber-400">
                  <span className="font-bold">~3:30 is the sweet spot.</span> Sparse lyrics over long durations (5+ min) introduce artifacts as the model fills empty time. If your lyric block is brief, target 2:00–3:30 for cleanest output.
                </p>
              </div>
            </div>

            {/* Variations — single collapsed control (task #57).
                Previously: two separate sliders ("Variations per Run"
                drove ace-server's synth_batch_size, "Batch Queue" drove
                a UI-side loop). ace-server's in-process batching was
                inconsistent (task #54); the UI loop reliably produced
                N distinct outputs with per-call random seeds. Dropped
                the flaky control, kept the reliable loop. `batchSize`
                is hardcoded to 1 in the payload so ace-server gets
                synth_batch_size: 1 and we stay on the single-track
                result path. */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-zinc-600 dark:text-zinc-400">Variations</label>
                <span className="text-xs font-mono text-zinc-900 dark:text-white bg-zinc-100 dark:bg-black/20 px-2 py-0.5 rounded">
                  {bulkCount} {bulkCount === 1 ? 'track' : 'tracks'}
                </span>
              </div>
              <div className="flex items-center gap-1">
                {[1, 2, 3, 5, 10].map((count) => (
                  <button
                    key={count}
                    onClick={() => setBulkCount(count)}
                    className={`flex-1 ew-btn ew-btn--sm ${
                      bulkCount === count
                        ? 'ew-btn--primary'
                        : 'ew-btn--ghost'
                    }`}
                  >
                    {count}
                  </button>
                ))}
              </div>
              <p className="text-[10px] text-zinc-500">
                Generate multiple takes back-to-back. Each gets its own random seed for genuinely different output. Great for A/B comparing.
              </p>
            </div>

            {/* Quality — model-aware presets */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-zinc-600 dark:text-zinc-400">Quality</label>
                <span className="text-xs font-mono text-zinc-900 dark:text-white bg-zinc-100 dark:bg-black/20 px-2 py-0.5 rounded">
                  {(() => {
                    const capabilityMode = taskType === 'cover' || audioTab === 'reference' || modelKind(loadedModel) === 'capability';
                    if (isFastTurboModel(loadedModel) && !capabilityMode) {
                      return `${inferenceSteps <= 4 ? 'Draft' : inferenceSteps <= 8 ? 'Standard' : 'High'} (${inferenceSteps})`;
                    }
                    if (capabilityMode) {
                      return `${inferenceSteps <= 25 ? 'Fast' : inferenceSteps <= 50 ? 'Standard' : 'High'} (${inferenceSteps})`;
                    }
                    return `${inferenceSteps <= 25 ? 'Fast' : inferenceSteps <= 50 ? 'Standard' : 'High'} (${inferenceSteps})`;
                  })()}
                </span>
              </div>
              {(() => {
                const capabilityMode = taskType === 'cover' || audioTab === 'reference' || modelKind(loadedModel) === 'capability';
                const isTurbo = isFastTurboModel(loadedModel) && !capabilityMode;

                const presets = capabilityMode
                  ? [{ label: 'Fast', steps: 25 }, { label: 'Standard', steps: 50 }, { label: 'High', steps: 75 }]
                  : isTurbo
                  ? [{ label: 'Draft', steps: 4 }, { label: 'Standard', steps: 8 }, { label: 'High', steps: 12 }]
                  : [{ label: 'Fast', steps: 25 }, { label: 'Standard', steps: 50 }, { label: 'High', steps: 75 }];

                return (
                  <>
                    <div className="flex items-center gap-1">
                      {presets.map(({ label, steps }) => (
                        <button
                          key={label}
                          onClick={() => {
                            setInferenceSteps(steps);
                            if (capabilityMode) {
                              setGuidanceScale(1.0);
                              setShift(1.0);
                              setInferMethod('ode');
                            } else if (!isTurbo) {
                              setShift(1.0);
                            }
                          }}
                          className={`flex-1 ew-btn ew-btn--sm ${
                            inferenceSteps === steps
                              ? 'ew-btn--primary'
                              : 'ew-btn--ghost'
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    {isTurbo && inferenceSteps > 12 && (
                      <p className="text-[10px] text-amber-500 font-medium">Turbo models are optimised for 4-12 steps. Higher values will produce garbled audio.</p>
                    )}
                    {!isTurbo && inferenceSteps < 8 && (
                      <p className="text-[10px] text-amber-500 font-medium">This model needs 8+ steps for coherent output. Increase quality or switch to Fast.</p>
                    )}
                    <p className="text-[10px] text-zinc-500">
                      {capabilityMode
                        ? 'Pro Model Reference and Cover use ACE-Step Base/SFT defaults. Standard is the clean 50-step path; High is only for difficult source audio.'
                        : isTurbo
                        ? 'Turbo models are fast — 8 steps is the sweet spot. Going higher won\'t help.'
                        : '50 steps is the sweet spot for the Song Model. Fast is a preview; High spends more time exploring.'}
                    </p>
                    {['cover', 'extract', 'lego', 'complete'].includes(taskType) && isTurbo && (
                      <p className="text-[10px] text-amber-500 font-medium mt-0.5">
                        {taskType === 'cover'
                          ? 'Cover needs the Pro Model for faithful results.'
                          : `${taskType.charAt(0).toUpperCase() + taskType.slice(1)} needs the Pro Model for clean results.`}
                      </p>
                    )}
                  </>
                );
              })()}
            </div>

            {/* Vocal Gender */}
            {!instrumental && (
              <div className="space-y-2">
                <label className="text-xs font-medium text-zinc-600 dark:text-zinc-400">Vocal Gender</label>
                <div className="flex items-center gap-1">
                  {(['auto', 'male', 'female'] as const).map((gender) => (
                    <button
                      key={gender}
                      onClick={() => setVocalGender(gender)}
                      className={`flex-1 ew-btn ew-btn--sm ${
                        vocalGender === gender
                          ? 'ew-btn--primary'
                          : 'ew-btn--ghost'
                      }`}
                    >
                      {gender === 'auto' ? 'Auto' : gender === 'male' ? 'Male' : 'Female'}
                    </button>
                  ))}
                </div>
                <p className="text-[10px] text-zinc-500">Auto lets the AI decide based on your style tags. Male/Female injects a vocal direction hint.</p>
              </div>
            )}

            {/*
              Style Influence + Weirdness sliders are MODEL-AWARE.
              Turbo/song defaults stay narrow, while Reference/Cover on
              the Pro Model uses ACE-Step's real APG/CFG range. Per-model
              ranges keep each model's canonical defaults in a sensible
              place instead of making users tune raw engine numbers.
            */}

            {/* Style Influence — maps to guidance_scale, range is per-model */}
            {(() => {
              const capabilityMode = taskType === 'cover' || audioTab === 'reference' || modelKind(loadedModel) === 'capability';
              const cfgMin = capabilityMode ? 1.0 : 0.5;
              const cfgMax = capabilityMode ? 15.0 : 1.5;
              const cfgStep = capabilityMode ? 0.5 : 0.1;
              const clamped = Math.max(cfgMin, Math.min(cfgMax, guidanceScale));
              const pct = Math.round(((clamped - cfgMin) / (cfgMax - cfgMin)) * 100);
              const valueLabel = capabilityMode ? clamped.toFixed(1) : `${pct}%`;
              return (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-medium text-zinc-600 dark:text-zinc-400">Style Influence</label>
                    <span className="text-xs font-mono text-zinc-900 dark:text-white bg-zinc-100 dark:bg-black/20 px-2 py-0.5 rounded">{valueLabel}</span>
                  </div>
                  <input
                    type="range" min={cfgMin} max={cfgMax} step={cfgStep} value={clamped}
                    onChange={(e) => setGuidanceScale(Number(e.target.value))}
                    className="w-full h-2 bg-zinc-200 dark:bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-accent-500"
                  />
                  <p className="text-[10px] text-zinc-500">
                    {capabilityMode
                      ? 'Pro Model clean default is 1. Raise only when the prompt is drifting; high guidance can add harshness.'
                      : 'Distilled song model; the middle of the scale is the trained sweet spot. Pushing toward either edge reduces quality.'}
                  </p>
                </div>
              );
            })()}

            {/* Weirdness — maps to shift (noise schedule), range is per-model */}
            {(() => {
              const capabilityMode = taskType === 'cover' || audioTab === 'reference' || modelKind(loadedModel) === 'capability';
              const isTurbo = isFastTurboModel(loadedModel) && !capabilityMode;
              const shiftMin = capabilityMode ? 1.0 : isTurbo ? 2.0 : 0.5;
              const shiftMax = capabilityMode ? 5.0 : isTurbo ? 4.0 : 2.5;
              const shiftStep = 0.1;
              const clamped = Math.max(shiftMin, Math.min(shiftMax, shift));
              const pct = Math.round(((clamped - shiftMin) / (shiftMax - shiftMin)) * 100);
              const valueLabel = capabilityMode ? clamped.toFixed(1) : `${pct}%`;
              return (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-medium text-zinc-600 dark:text-zinc-400">Weirdness</label>
                    <span className="text-xs font-mono text-zinc-900 dark:text-white bg-zinc-100 dark:bg-black/20 px-2 py-0.5 rounded">{valueLabel}</span>
                  </div>
                  <input
                    type="range" min={shiftMin} max={shiftMax} step={shiftStep} value={clamped}
                    onChange={(e) => {
                      setShift(Number(e.target.value));
                      // Auto-switch to stochastic mode for high weirdness
                      if (Number(e.target.value) > 3.5) {
                        setInferMethod('sde');
                      }
                    }}
                    className="w-full h-2 bg-zinc-200 dark:bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-purple-500"
                  />
                  <p className="text-[10px] text-zinc-500">
                    Low = conventional, predictable. High = experimental, surprising directions.
                    {shift > (capabilityMode ? 4.2 : isTurbo ? 3.5 : 2.2) && <span className="text-purple-500 font-medium"> Stochastic mode auto-enabled for extra variety.</span>}
                  </p>
                </div>
              );
            })()}

            {/* Output & Generation Mode */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-zinc-600 dark:text-zinc-400">Output Format</label>
                <select
                  value={audioFormat}
                  onChange={(e) => setAudioFormat(e.target.value as 'mp3' | 'flac')}
                  className="w-full ew-input px-2 py-1.5 text-xs text-zinc-900 dark:text-white focus:outline-none"
                >
                  <option value="mp3">MP3 (fast, smaller files)</option>
                  <option value="flac">WAV (lossless, studio grade)</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-zinc-600 dark:text-zinc-400">Reproducibility</label>
                <select
                  value={inferMethod}
                  onChange={(e) => setInferMethod(e.target.value as 'ode' | 'sde')}
                  className="w-full ew-input px-2 py-1.5 text-xs text-zinc-900 dark:text-white focus:outline-none"
                >
                  <option value="ode">Deterministic (repeatable)</option>
                  <option value="sde">Stochastic (more variety)</option>
                </select>
              </div>
            </div>

            {/* Seed */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Dices size={14} className="text-zinc-500" />
                  <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">Random Seed</span>
                </div>
                <button
                  onClick={() => setRandomSeed(!randomSeed)}
                  className={`w-10 h-5 rounded-full flex items-center transition-colors duration-200 px-0.5 border border-zinc-200 dark:border-white/5 ${randomSeed ? 'bg-accent-600' : 'bg-zinc-300 dark:bg-black/40'}`}
                >
                  <div className={`w-4 h-4 rounded-full bg-white transform transition-transform duration-200 shadow-sm ${randomSeed ? 'translate-x-5' : 'translate-x-0'}`} />
                </button>
              </div>
              {!randomSeed && (
                <div className="flex items-center gap-2">
                  <Hash size={14} className="text-zinc-500" />
                  <input
                    type="number" value={seed}
                    onChange={(e) => setSeed(Number(e.target.value))}
                    placeholder="Enter fixed seed"
                    className="flex-1 ew-input px-3 py-1.5 text-xs text-zinc-900 dark:text-white focus:outline-none"
                  />
                </div>
              )}
              <p className="text-[10px] text-zinc-500">{randomSeed ? 'Every generation is unique' : 'Same seed + same settings = same output. Useful for iterating on a track you like.'}</p>
            </div>

            {/* AI Intelligence section */}
            <div className="border-t border-zinc-200 dark:border-white/10 pt-3">
              <p className="text-[10px] text-zinc-500 uppercase tracking-wide font-bold mb-3">AI Intelligence</p>
              <p className="text-[10px] text-zinc-500 mb-3">These let the AI's built-in music brain make smarter decisions about your track. Recommended ON for best results.</p>
            </div>

            {/* AI Reasoning (CoT) */}
            <div className="flex items-center justify-between py-1">
              <div className="flex-1">
                <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">AI Reasoning</span>
                <p className="text-[10px] text-zinc-500">AI plans the song structure, key changes, and arrangement before generating. Slower but smarter.</p>
              </div>
              <button
                onClick={() => setThinking(!thinking)}
                className={`w-10 h-5 rounded-full flex items-center transition-colors duration-200 px-0.5 border border-zinc-200 dark:border-white/5 flex-shrink-0 ml-3 ${thinking ? 'bg-accent-600' : 'bg-zinc-300 dark:bg-black/40'}`}
              >
                <div className={`w-4 h-4 rounded-full bg-white transform transition-transform duration-200 shadow-sm ${thinking ? 'translate-x-5' : 'translate-x-0'}`} />
              </button>
            </div>

            {/* CoT toggles auto-snapped per model; not shown in UI. */}

            {/* Style Assist — linked to sparkle button on Style header */}
            <div className="flex items-center justify-between py-1">
              <div className="flex-1">
                <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">Style Assist</span>
                <p className="text-[10px] text-zinc-500">
                  {styleAssistEnabled && enhancedStyle
                    ? 'AI-enhanced style active. Generation uses the enhanced text shown below the style field.'
                    : 'Use the local LM to expand and enhance your style tags before generation. Click the sparkle on the style field or enable here.'}
                </p>
              </div>
              <button
                onClick={() => {
                  const next = !styleAssistEnabled;
                  setStyleAssistEnabled(next);
                  if (!next) {
                    setEnhancedStyle(null);
                  } else if (next && !enhancedStyle && style.trim()) {
                    handleEnhanceStyle();
                  }
                }}
                className={`w-10 h-5 rounded-full flex items-center transition-colors duration-200 px-0.5 border border-zinc-200 dark:border-white/5 flex-shrink-0 ml-3 ${styleAssistEnabled ? 'bg-indigo-600' : 'bg-zinc-300 dark:bg-black/40'}`}
              >
                <div className={`w-4 h-4 rounded-full bg-white transform transition-transform duration-200 shadow-sm ${styleAssistEnabled ? 'translate-x-5' : 'translate-x-0'}`} />
              </button>
            </div>

            {/* Sync Lyrics — Pro tier. Generates time-synced LRC
                data alongside audio for SRT/ASS subtitle export + Vid
                Studio overlay. ON by default for Pro users. */}
            <div className={`flex items-center justify-between py-1 ${!canUseGener8Pro ? 'opacity-50 pointer-events-none' : ''}`}>
              <div className="flex-1">
                <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">Sync Lyrics</span>
                {!canUseGener8Pro ? (
                  <p className="text-[10px] text-accent-500 font-medium">Upgrade to Gener8 Pro for time-synced lyrics</p>
                ) : (
                  <p className="text-[10px] text-zinc-500">Time-synced lyrics for SRT subtitle export and Vid Studio overlay.</p>
                )}
              </div>
              <button
                onClick={() => setGetLrc(!getLrc)}
                className={`w-10 h-5 rounded-full flex items-center transition-colors duration-200 px-0.5 border border-zinc-200 dark:border-white/5 flex-shrink-0 ml-3 ${getLrc ? 'bg-accent-600' : 'bg-zinc-300 dark:bg-black/40'}`}
              >
                <div className={`w-4 h-4 rounded-full bg-white transform transition-transform duration-200 shadow-sm ${getLrc ? 'translate-x-5' : 'translate-x-0'}`} />
              </button>
            </div>

            {/* Creation Mode — contextual, only show when relevant */}
            {(taskType !== 'text2music' || coverSong) && (
              <div className="border-t border-zinc-200 dark:border-white/10 pt-3">
                <p className="text-[10px] text-zinc-500 uppercase tracking-wide font-bold mb-3">Source Audio Settings</p>
              </div>
            )}

            {/* Creation Mode dropdown removed — text2music / cover /
                reference are already reachable via the Reference/Cover
                toggles at the top of the panel. Repaint / Extract / Lego
                are Creator Studio tier features; Complete/Extend deserves
                its own per-track "Extend this" affordance in the library
                rather than a buried dropdown. */}

            {/* Source Influence — only show for cover/repaint modes */}
            {(taskType === 'cover' || taskType === 'repaint') && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium text-zinc-600 dark:text-zinc-400">Source Influence</label>
                  <span className="text-xs font-mono text-zinc-900 dark:text-white bg-zinc-100 dark:bg-black/20 px-2 py-0.5 rounded">{(audioCoverStrength * 100).toFixed(0)}%</span>
                </div>
                <input
                  type="range" min="0" max="1" step="0.05" value={audioCoverStrength}
                  onChange={(e) => setAudioCoverStrength(Number(e.target.value))}
                  className="w-full h-2 bg-zinc-200 dark:bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-accent-500"
                />
                <p className="text-[10px] text-zinc-500">
                  {audioCoverStrength >= 0.85
                    ? 'Very high: close to original but leaves little room for lyric/style changes. Try 60-75% if you want the AI to restyle.'
                    : audioCoverStrength >= 0.6
                    ? 'Good balance: recognizable source with room for your style and lyric changes to take effect.'
                    : audioCoverStrength >= 0.3
                    ? 'Loose inspiration: keeps structure hints but mostly regenerates from your text description.'
                    : 'Minimal influence: the source audio is almost ignored. Essentially a new generation.'}
                </p>
                {taskType === 'cover' && isFastTurboModel(loadedModel) && (
                  <p className="text-[10px] text-amber-500 font-medium mt-1">
                    Cover needs the Pro Model for faithful results.
                  </p>
                )}
              </div>
            )}

            {/* Repainting range — only for repaint mode */}
            {taskType === 'repaint' && (
              <div className="space-y-3">
                {/* Visual range bar */}
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-zinc-600 dark:text-zinc-400">Select Range</label>
                  <RepaintRangeSlider
                    start={repaintingStart}
                    end={repaintingEnd}
                    duration={sourceAudioUrl ? duration : duration}
                    onStartChange={setRepaintingStart}
                    onEndChange={setRepaintingEnd}
                  />
                </div>

                {/* Number inputs for precise entry */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-zinc-600 dark:text-zinc-400">Replace From (sec)</label>
                    <input
                      type="number" step="0.1" value={repaintingStart}
                      onChange={(e) => setRepaintingStart(Math.max(0, Number(e.target.value)))}
                      className="w-full ew-input px-3 py-2 text-xs text-zinc-900 dark:text-white focus:outline-none"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-zinc-600 dark:text-zinc-400">Replace To (sec)</label>
                    <input
                      type="number" step="0.1" value={repaintingEnd}
                      onChange={(e) => {
                        const val = Number(e.target.value);
                        if (val === -1 || val > repaintingStart) {
                          setRepaintingEnd(val);
                        }
                      }}
                      className="w-full ew-input px-3 py-2 text-xs text-zinc-900 dark:text-white focus:outline-none"
                    />
                    <p className="text-[10px] text-zinc-500">-1 = end of track</p>
                  </div>
                </div>
              </div>
            )}

            {uploadError && (
              <div className="text-[11px] text-rose-500">{uploadError}</div>
            )}

            {/* LM Generation Settings — controls for the 5Hz LM during generation */}
            <div className="border-t border-zinc-200 dark:border-white/10 pt-3 space-y-1">
              <button
                onClick={() => setShowLmParams(!showLmParams)}
                className="flex items-center gap-2 w-full"
              >
                <Cpu size={12} className="text-indigo-500" />
                <h4 className="text-xs font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-wide">LM Settings</h4>
                <ChevronDown size={12} className={`text-zinc-400 transition-transform ${showLmParams ? 'rotate-180' : ''}`} />
              </button>
              <p className="text-[10px] text-zinc-500">Controls how the AI interprets your style and lyrics during generation</p>
            </div>
            {showLmParams && (
              <div className={`space-y-3 pl-1 ${!canUseGener8Pro ? 'opacity-50 pointer-events-none' : ''}`}>
                {!canUseGener8Pro && (
                  <p className="text-[10px] text-accent-500 font-medium">Upgrade to Gener8 Pro to customise AI enhancement settings</p>
                )}
                <div className="space-y-1.5">
                  <div className="flex justify-between">
                    <label className="text-xs font-medium text-zinc-600 dark:text-zinc-400">Creativity</label>
                    <span className="text-xs text-zinc-400">{lmTemperature.toFixed(2)}</span>
                  </div>
                  <input
                    type="range" min="0" max="2" step="0.05" value={lmTemperature}
                    onChange={(e) => setLmTemperature(Number(e.target.value))}
                    className="w-full h-2 bg-zinc-200 dark:bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                  />
                  <p className="text-[10px] text-zinc-500">How inventive the AI gets with your style and lyrics. Low = safe, high = experimental.</p>
                </div>
                <div className="space-y-1.5">
                  <div className="flex justify-between">
                    <label className="text-xs font-medium text-zinc-600 dark:text-zinc-400">Focus</label>
                    <span className="text-xs text-zinc-400">{lmCfgScale.toFixed(1)}</span>
                  </div>
                  <input
                    type="range" min="0" max="10" step="0.5" value={lmCfgScale}
                    onChange={(e) => setLmCfgScale(Number(e.target.value))}
                    className="w-full h-2 bg-zinc-200 dark:bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                  />
                  <p className="text-[10px] text-zinc-500">How strictly the AI follows your prompt. High = faithful to your words, low = takes creative liberties.</p>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-zinc-600 dark:text-zinc-400">Avoid These Themes</label>
                  <textarea
                    value={lmNegativePrompt}
                    onChange={(e) => setLmNegativePrompt(e.target.value)}
                    placeholder="e.g. cliche love metaphors, explicit content..."
                    className="w-full h-16 ew-input p-2 text-xs text-zinc-900 dark:text-white focus:outline-none resize-none"
                  />
                </div>
              </div>
            )}

            {/* DEVELOPER MODE — HIDDEN from all users (2026-05-05 SGT).
                Raw engine parameters are internal-only; exposed values
                (shift, LM temp/cfg/top-p) are already covered by the
                user-friendly sliders above. The state variables remain
                wired so they still feed the generation payload; only
                the UI toggle + panel are removed. To re-enable for
                internal testing, uncomment the block below. */}
            {false && isCreatorStudio && (
            <div className="border-t border-zinc-200 dark:border-white/10 pt-3">
              <button
                onClick={() => setShowDevMode(!showDevMode)}
                className="flex items-center gap-2 w-full text-left"
              >
                <span className="text-[10px] text-zinc-400 uppercase tracking-wide font-bold">Developer Mode</span>
                <ChevronDown size={10} className={`text-zinc-400 transition-transform ${showDevMode ? 'rotate-180' : ''}`} />
              </button>
              <p className="text-[10px] text-zinc-500 mt-1">Raw engine parameters. Only touch these if you know what you're doing.</p>
            </div>
            )}
            {false && isCreatorStudio && showDevMode && (
              <div className="space-y-3 bg-zinc-50 dark:bg-black/20 rounded-lg p-3 border border-zinc-200 dark:border-white/10">
                {/* Noise Shift (raw override — also exposed as "Weirdness" above) */}
                <div className="space-y-1.5">
                  <div className="flex justify-between">
                    <label className="text-[11px] font-mono text-zinc-500">shift (noise schedule) — see Weirdness</label>
                    <span className="text-[11px] font-mono text-zinc-400">{shift.toFixed(1)}</span>
                  </div>
                  <input
                    type="range" min="1" max="5" step="0.1" value={shift}
                    onChange={(e) => setShift(Number(e.target.value))}
                    className="w-full h-1.5 bg-zinc-300 dark:bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-zinc-500"
                  />
                </div>

                {/* ADG */}
                <label className="flex items-center gap-2 text-[11px] font-mono text-zinc-500">
                  <input type="checkbox" checked={useAdg} onChange={() => setUseAdg(!useAdg)} className="rounded" />
                  use_adg (adaptive denoising guidance)
                </label>

                {/* Autogen */}
                <label className="flex items-center gap-2 text-[11px] font-mono text-zinc-500">
                  <input type="checkbox" checked={autogen} onChange={() => setAutogen(!autogen)} className="rounded" />
                  autogen (auto-generate missing params)
                </label>

                {/* Get Scores */}
                <label className="flex items-center gap-2 text-[11px] font-mono text-zinc-500">
                  <input type="checkbox" checked={getScores} onChange={() => setGetScores(!getScores)} className="rounded" />
                  get_scores (return quality scores)
                </label>

                {/* Constrained Decoding Debug */}
                <label className="flex items-center gap-2 text-[11px] font-mono text-zinc-500">
                  <input type="checkbox" checked={constrainedDecodingDebug} onChange={() => setConstrainedDecodingDebug(!constrainedDecodingDebug)} className="rounded" />
                  constrained_decoding_debug
                </label>

                {/* LM Top-K / Top-P */}
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <label className="text-[11px] font-mono text-zinc-500">lm_top_k</label>
                    <input
                      type="number" min="0" max="100" value={lmTopK}
                      onChange={(e) => setLmTopK(Number(e.target.value))}
                      className="w-full bg-white dark:bg-black/30 border border-zinc-200 dark:border-white/10 rounded px-2 py-1 text-[11px] font-mono text-zinc-700 dark:text-zinc-300 focus:outline-none"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[11px] font-mono text-zinc-500">lm_top_p</label>
                    <input
                      type="number" min="0" max="1" step="0.05" value={lmTopP}
                      onChange={(e) => setLmTopP(Number(e.target.value))}
                      className="w-full bg-white dark:bg-black/30 border border-zinc-200 dark:border-white/10 rounded px-2 py-1 text-[11px] font-mono text-zinc-700 dark:text-zinc-300 focus:outline-none"
                    />
                  </div>
                </div>

                {/* CFG Interval */}
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <label className="text-[11px] font-mono text-zinc-500">cfg_interval_start</label>
                    <input
                      type="number" step="0.05" min="0" max="1" value={cfgIntervalStart}
                      onChange={(e) => setCfgIntervalStart(Number(e.target.value))}
                      className="w-full bg-white dark:bg-black/30 border border-zinc-200 dark:border-white/10 rounded px-2 py-1 text-[11px] font-mono text-zinc-700 dark:text-zinc-300 focus:outline-none"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[11px] font-mono text-zinc-500">cfg_interval_end</label>
                    <input
                      type="number" step="0.05" min="0" max="1" value={cfgIntervalEnd}
                      onChange={(e) => setCfgIntervalEnd(Number(e.target.value))}
                      className="w-full bg-white dark:bg-black/30 border border-zinc-200 dark:border-white/10 rounded px-2 py-1 text-[11px] font-mono text-zinc-700 dark:text-zinc-300 focus:outline-none"
                    />
                  </div>
                </div>

                {/* Custom Timesteps */}
                <div className="space-y-1">
                  <label className="text-[11px] font-mono text-zinc-500">custom_timesteps</label>
                  <input
                    type="text" value={customTimesteps}
                    onChange={(e) => setCustomTimesteps(e.target.value)}
                    placeholder="e.g. 1,3,5,7"
                    className="w-full bg-white dark:bg-black/30 border border-zinc-200 dark:border-white/10 rounded px-2 py-1 text-[11px] font-mono text-zinc-700 dark:text-zinc-300 focus:outline-none"
                  />
                </div>

                {/* Score Scale */}
                <div className="space-y-1">
                  <label className="text-[11px] font-mono text-zinc-500">score_scale</label>
                  <input
                    type="number" step="0.05" value={scoreScale}
                    onChange={(e) => setScoreScale(Number(e.target.value))}
                    className="w-full bg-white dark:bg-black/30 border border-zinc-200 dark:border-white/10 rounded px-2 py-1 text-[11px] font-mono text-zinc-700 dark:text-zinc-300 focus:outline-none"
                  />
                </div>

                {/* Audio Tokens */}
                <div className="space-y-1">
                  <label className="text-[11px] font-mono text-zinc-500">audio_codes (raw tokens)</label>
                  <textarea
                    value={audioCodes}
                    onChange={(e) => setAudioCodes(e.target.value)}
                    placeholder="Encoded audio tokens for reconstruction"
                    className="w-full h-12 bg-white dark:bg-black/30 border border-zinc-200 dark:border-white/10 rounded p-2 text-[11px] font-mono text-zinc-700 dark:text-zinc-300 focus:outline-none resize-none"
                  />
                </div>

                {/* Instruction */}
                <div className="space-y-1">
                  <label className="text-[11px] font-mono text-zinc-500">instruction</label>
                  <textarea
                    value={instruction}
                    onChange={(e) => setInstruction(e.target.value)}
                    className="w-full h-12 bg-white dark:bg-black/30 border border-zinc-200 dark:border-white/10 rounded p-2 text-[11px] font-mono text-zinc-700 dark:text-zinc-300 focus:outline-none resize-none"
                  />
                </div>

                {/* Track Name / Complete Track Classes */}
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <label className="text-[11px] font-mono text-zinc-500">track_name</label>
                    <input
                      type="text" value={trackName}
                      onChange={(e) => setTrackName(e.target.value)}
                      className="w-full bg-white dark:bg-black/30 border border-zinc-200 dark:border-white/10 rounded px-2 py-1 text-[11px] font-mono text-zinc-700 dark:text-zinc-300 focus:outline-none"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[11px] font-mono text-zinc-500">complete_track_classes</label>
                    <input
                      type="text" value={completeTrackClasses}
                      onChange={(e) => setCompleteTrackClasses(e.target.value)}
                      className="w-full bg-white dark:bg-black/30 border border-zinc-200 dark:border-white/10 rounded px-2 py-1 text-[11px] font-mono text-zinc-700 dark:text-zinc-300 focus:outline-none"
                    />
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {showAudioModal && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => { setShowAudioModal(false); setPlayingTrackId(null); }}
          />
          <div className="relative w-[92%] max-w-lg rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-white/10 shadow-2xl overflow-hidden">
            {/* Header */}
            <div className="p-5 pb-4">
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="text-xl font-semibold text-zinc-900 dark:text-white">
                    {audioModalTarget === 'reference' ? 'Reference' : 'Cover'}
                  </h3>
                  <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
                    {audioModalTarget === 'reference'
                      ? 'Create songs inspired by a reference track'
                      : 'Transform an existing track into a new version'}
                  </p>
                </div>
                <button
                  onClick={() => { setShowAudioModal(false); setPlayingTrackId(null); }}
                  className="p-1.5 rounded-lg hover:bg-zinc-100 dark:hover:bg-white/10 text-zinc-400 hover:text-zinc-900 dark:hover:text-white transition-colors"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/>
                  </svg>
                </button>
              </div>

              {/* Upload Button */}
              <button
                type="button"
                onClick={() => {
                  const input = document.createElement('input');
                  input.type = 'file';
                  input.accept = '.mp3,.wav,.flac,audio/*';
                  input.onchange = (e) => {
                    const file = (e.target as HTMLInputElement).files?.[0];
                    if (file) void uploadReferenceTrack(file);
                  };
                  input.click();
                }}
                disabled={isUploadingReference}
                className="mt-4 w-full flex items-center justify-center gap-2 rounded-xl border border-dashed border-zinc-300 dark:border-white/20 bg-zinc-50 dark:bg-white/5 px-4 py-3 text-sm font-medium text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-white/10 hover:border-zinc-400 dark:hover:border-white/30 transition-all"
              >
                {isUploadingReference ? (
                  <>
                    <RefreshCw size={16} className="animate-spin" />
                    Uploading...
                  </>
                ) : (
                  <>
                    <Upload size={16} />
                    Upload audio
                    <span className="text-xs text-zinc-400 ml-1">{AUDIO_FORMATS_LABEL}</span>
                  </>
                )}
              </button>

              {uploadError && (
                <div className="mt-2 text-xs text-rose-500">{uploadError}</div>
              )}
              {typeof window !== 'undefined' && (window.location.pathname.startsWith('/stepstudio') || window.parent !== window) && (
                <div className="mt-2 text-[10px] text-amber-500/70 flex items-center gap-1">
                  <span>⚠</span> Demo: uploaded files are cleared after generation
                </div>
              )}
            </div>

            {/* Mine Section */}
            <div className="border-t border-zinc-100 dark:border-white/5">
              <div className="px-5 py-3 flex items-center gap-2">
                <span className="px-3 py-1 rounded-full bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 text-xs font-semibold">
                  Mine
                </span>
              </div>

              {/* Track List */}
              <div className="max-h-[280px] overflow-y-auto">
                {isLoadingTracks ? (
                  <div className="px-5 py-8 text-center">
                    <RefreshCw size={20} className="animate-spin mx-auto text-zinc-400" />
                    <p className="text-xs text-zinc-400 mt-2">Loading tracks...</p>
                  </div>
                ) : referenceTracks.length === 0 ? (
                  <div className="px-5 py-8 text-center">
                    <Music2 size={24} className="mx-auto text-zinc-300 dark:text-zinc-600" />
                    <p className="text-sm text-zinc-400 mt-2">No tracks yet</p>
                    <p className="text-xs text-zinc-400 mt-1">Upload audio files to use them as references</p>
                  </div>
                ) : (
                  <div className="divide-y divide-zinc-100 dark:divide-white/5">
                    {referenceTracks.map((track) => (
                      <div
                        key={track.id}
                        className="px-5 py-3 flex items-center gap-3 hover:bg-zinc-50 dark:hover:bg-white/[0.02] transition-colors group"
                      >
                        {/* Play Button */}
                        <button
                          type="button"
                          onClick={() => toggleModalTrack(track)}
                          className="flex-shrink-0 w-9 h-9 rounded-full bg-zinc-100 dark:bg-white/10 text-zinc-600 dark:text-zinc-300 flex items-center justify-center hover:bg-zinc-200 dark:hover:bg-white/20 transition-colors"
                        >
                          {playingTrackId === track.id ? (
                            <Pause size={14} fill="currentColor" />
                          ) : (
                            <Play size={14} fill="currentColor" className="ml-0.5" />
                          )}
                        </button>

                        {/* Track Info */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-zinc-800 dark:text-zinc-200 truncate">
                              {track.filename.replace(/\.[^/.]+$/, '')}
                            </span>
                            {track.tags && track.tags.length > 0 && (
                              <div className="flex gap-1">
                                {track.tags.slice(0, 2).map((tag, i) => (
                                  <span key={i} className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-zinc-200 dark:bg-white/10 text-zinc-600 dark:text-zinc-400">
                                    {tag}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                          {/* Progress bar with seek - show when this track is playing */}
                          {playingTrackId === track.id ? (
                            <div className="flex items-center gap-2 mt-1.5">
                              <span className="text-[10px] text-zinc-400 tabular-nums w-8">
                                {formatTime(modalTrackTime)}
                              </span>
                              <div
                                className="flex-1 h-1.5 rounded-full bg-zinc-200 dark:bg-white/10 cursor-pointer group/seek"
                                onClick={(e) => {
                                  if (modalAudioRef.current && modalTrackDuration > 0) {
                                    const rect = e.currentTarget.getBoundingClientRect();
                                    const percent = (e.clientX - rect.left) / rect.width;
                                    modalAudioRef.current.currentTime = percent * modalTrackDuration;
                                  }
                                }}
                              >
                                <div
                                  className="h-full bg-gradient-to-r from-accent-500 to-purple-500 rounded-full relative"
                                  style={{ width: modalTrackDuration > 0 ? `${(modalTrackTime / modalTrackDuration) * 100}%` : '0%' }}
                                >
                                  <div className="absolute right-0 top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full bg-white shadow-md opacity-0 group-hover/seek:opacity-100 transition-opacity" />
                                </div>
                              </div>
                              <span className="text-[10px] text-zinc-400 tabular-nums w-8 text-right">
                                {formatTime(modalTrackDuration)}
                              </span>
                            </div>
                          ) : (
                            <div className="text-xs text-zinc-400 mt-0.5">
                              {track.duration ? formatTime(track.duration) : '--:--'}
                            </div>
                          )}
                        </div>

                        {/* Actions */}
                        <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            type="button"
                            onClick={() => useReferenceTrack(track)}
                            className="px-3 py-1.5 rounded-lg bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 text-xs font-semibold hover:bg-zinc-800 dark:hover:bg-zinc-100 transition-colors"
                          >
                            Use
                          </button>
                          <button
                            type="button"
                            onClick={() => void deleteReferenceTrack(track.id)}
                            className="p-1.5 rounded-lg hover:bg-zinc-200 dark:hover:bg-white/10 text-zinc-400 hover:text-rose-500 transition-colors"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Hidden audio element for modal playback */}
            <audio
              ref={modalAudioRef}
              onTimeUpdate={() => {
                if (modalAudioRef.current) {
                  setModalTrackTime(modalAudioRef.current.currentTime);
                }
              }}
              onLoadedMetadata={() => {
                if (modalAudioRef.current) {
                  setModalTrackDuration(modalAudioRef.current.duration);
                  // Update track duration in database if not set
                  const track = referenceTracks.find(t => t.id === playingTrackId);
                  if (track && !track.duration && token) {
                    fetch(`${getApiBase()}/api/reference-tracks/${track.id}`, {
                      method: 'PATCH',
                      headers: {
                        'Content-Type': 'application/json',
                        Authorization: `Bearer ${token}`
                      },
                      body: JSON.stringify({ duration: Math.round(modalAudioRef.current.duration) })
                    }).then(() => {
                      setReferenceTracks(prev => prev.map(t =>
                        t.id === track.id ? { ...t, duration: Math.round(modalAudioRef.current?.duration || 0) } : t
                      ));
                    }).catch(() => undefined);
                  }
                }
              }}
              onEnded={() => setPlayingTrackId(null)}
            />
          </div>
        </div>
      )}

      {/* Footer: Usage Tier + Create Button */}
      <div className="p-4 mt-auto sticky bottom-0 backdrop-blur-sm z-10 border-t space-y-3" style={{ background: 'var(--s3-panel, #14151C)', borderColor: 'var(--s3-border, rgba(255,255,255,0.05))' }}>

        {/* Usage tier strip. Compact mono-cap pill that reads as a system
            badge, not a marketing pill. Hover paints in --ew-primary so it
            follows the active skin (cyan/steel-blue/amber). EWDS retheme
            polish 2026-04-25 SGT.

            2026-05-04 SGT (tier-gate fix): label + upgrade CTA now reflect
            the user's active tier. Creator Studio is the top tier — no
            upgrade above it, so the CTA is suppressed there. Pre-fix this
            was hardcoded "TRIAL" + "Upgrade →" for everyone, including
            paying Creator Studio users. */}
        {(() => {
          const tierLabel = hasTier('creator_studio') ? 'CREATOR STUDIO'
            : hasTier('gener8_pro') ? 'GENER8 PRO'
            : hasTier('gener8_base') ? 'GENER8'
            : isTrialActive ? 'TRIAL'
            : 'DEMO';
          const canUpgrade = !hasTier('creator_studio');
          return (
            <div
              onClick={canUpgrade ? onOpenUpgrade : undefined}
              className={`flex items-center justify-between transition-all group ${canUpgrade ? 'cursor-pointer' : ''}`}
              style={{
                padding: '8px 12px',
                border: '1px solid var(--ew-border)',
                background: 'var(--ew-surface-sunken)',
                clipPath: 'var(--ew-clip-button-sm)',
              }}
              onMouseEnter={canUpgrade ? (e) => {
                e.currentTarget.style.background = 'var(--ew-primary-soft)';
                e.currentTarget.style.borderColor = 'var(--ew-primary)';
              } : undefined}
              onMouseLeave={canUpgrade ? (e) => {
                e.currentTarget.style.background = 'var(--ew-surface-sunken)';
                e.currentTarget.style.borderColor = 'var(--ew-border)';
              } : undefined}
            >
              <span
                className="flex items-center gap-1.5"
                style={{
                  fontFamily: 'var(--ew-font-mono)',
                  fontSize: 10,
                  fontWeight: 600,
                  letterSpacing: '0.22em',
                  textTransform: 'uppercase',
                  color: 'var(--ew-primary)',
                }}
              >
                <Zap size={10} />
                {tierLabel}
              </span>
              {canUpgrade && (
                <span
                  style={{
                    fontFamily: 'var(--ew-font-mono)',
                    fontSize: 9,
                    letterSpacing: '0.2em',
                    textTransform: 'uppercase',
                    color: 'var(--ew-text-faint)',
                  }}
                >
                  Upgrade →
                </span>
              )}
            </div>
          );
        })()}

        {/* Primary CTA. Routes through .ew-btn--primary so the TR+BL
            chamfer reads per skin (Classic 16px, Refined 12px, Terminal
            0px sharp). The hardcoded cyan/purple gradient was dropped
            during the EWDS retheme 2026-04-25 SGT; it was overriding the
            skin primary in Refined and Terminal. Width + height kept via
            inline style so the button still spans the panel. */}
        <button
          onClick={(e) => {
            // Guard against double-click during generation. Per CONTEXT
            // 2026-04-18 lock the button is "non-clickable" during
            // generation, not "disabled" — using the HTML disabled
            // attribute mutes the spinner via .ew-btn:disabled. We use
            // pointer-events:none + a click guard so the spinner stays
            // crisp while the button can't double-trigger. Sean
            // 2026-04-26 SGT.
            if (isGenerating) { e.preventDefault(); return; }
            handleGenerate();
          }}
          aria-busy={isGenerating}
          aria-disabled={isGenerating}
          tabIndex={isGenerating ? -1 : 0}
          data-tour="gener8-generate"
          className="ew-btn ew-btn--primary"
          style={{
            width: '100%',
            height: 48,
            justifyContent: 'center',
            fontSize: 14,
            letterSpacing: '0.12em',
            cursor: isGenerating ? 'progress' : 'pointer',
            pointerEvents: isGenerating ? 'none' : 'auto',
          }}
        >
          {isGenerating ? (
            <>
              <Loader2 size={18} className="animate-spin" />
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <span style={{ textTransform: 'none', letterSpacing: 'normal', fontStyle: 'italic' }}>
                  {GEN_TOOLTIPS[genTooltipIdx]}
                </span>
              </span>
            </>
          ) : (
            <>
              <Sparkles size={18} />
              <span>
                {bulkCount > 1 ? `Create ${bulkCount} Variations` : 'Create'}
              </span>
            </>
          )}
        </button>
      </div>
    </div>
  );
};
