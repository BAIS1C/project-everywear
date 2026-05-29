// @ts-nocheck
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Sparkles, ChevronDown, Settings2, Trash2, Music2, Sliders, Dices, Hash, RefreshCw, Plus, Cpu, Zap, AlertTriangle, Layers, Loader2 } from 'lucide-react';
import { GenerationParams, Song } from '@/types';
import { useAuth } from '@/context/AuthContext';
import { generateApi, engineApi, type ModelInfo, type PatchManifest } from '@/services/api';
import { PatchSelector } from './PatchSelector';
import { showToast } from './ToastHost';
import { ProAudioModePanel } from '@/pro/ProAudioModePanel';
import { shouldMountProAudioModule } from '@/pro/entitlementGate';
import { buildSongPayload, type BaseCreateFields, type CreateMode } from '@/pro/proPayloadBuilder';

interface CreatePanelProps {
  onGenerate: (params: GenerationParams) => void;
  isGenerating: boolean;
  initialData?: { song: Song, timestamp: number, mode?: 'reuse' | 'cover' } | null;
  onOpenUpgrade?: () => void;
}

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
  const { isAuthenticated, token, hasTier, isTrialActive, entitlementResolved } = useAuth();

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
  const canUseAdvancedControls = hasTier('gener8_pro');

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
      const preset = generationPresetFor(selectedModel, 'song');
      setInferenceSteps(preset.inferenceSteps);
      setShift(preset.shift);
      setGuidanceScale(preset.guidanceScale);
      setThinking(preset.thinking);
      setBatchSize(preset.batchSize);
      setInferMethod(preset.inferMethod);
      setCfgIntervalStart(preset.cfgIntervalStart);
      setCfgIntervalEnd(preset.cfgIntervalEnd);
      setCustomTimesteps(preset.customTimesteps);

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
  const [audioCodes, setAudioCodes] = useState('');
  const [repaintingStart, setRepaintingStart] = useState(0);
  const [repaintingEnd, setRepaintingEnd] = useState(-1);
  const [instruction, setInstruction] = useState('Fill the audio semantic mask based on the given conditions:');
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

  // Patch (Style) selection
  const [activePatchKeyword, setActivePatchKeyword] = useState<string | null>(null);
  const [activePatchName, setActivePatchName] = useState<string | null>(null);

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
  }, []);

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
      if (canUseAdvancedControls) setShowAdvanced(true);
      if (song.duration) {
        setDuration(Math.round(Number(song.duration)));
      }
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
    const targetModel = loadedModel || selectedModel || getSongModel();
    if (!targetModel) return;
    applyGenerationPreset(generationPresetFor(targetModel, 'song'));
  }, [loadedModel, selectedModel, getSongModel, applyGenerationPreset]);

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

  const startResizing = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
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

  const handlePatchChange = useCallback((patch: PatchManifest | null, keyword: string | null) => {
    setActivePatchKeyword(keyword);
    setActivePatchName(patch?.name || null);
  }, []);

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

  const buildBaseCreateFields = useCallback(({
    mode = 'song',
    synthModel,
    sourceTag,
    index,
    audioCoverStrength,
  }: {
    mode?: CreateMode;
    synthModel?: string;
    sourceTag?: 'reference' | 'cover';
    index: number;
    audioCoverStrength?: number;
  }): BaseCreateFields => {
      // Seed handling: first job uses user's seed, rest get random seeds
      let jobSeed = -1;
      if (!randomSeed && index === 0) {
        jobSeed = seed;
      } else if (!randomSeed && index > 0) {
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
      const wantsCapabilityModel = mode === 'reference' || mode === 'cover';
      const effectiveSynthModel = synthModel || selectedModel || loadedModel || getSongModel();
      const effectivePreset = generationPresetFor(
        effectiveSynthModel || loadedModel || selectedModel,
        mode,
      );
      const effectiveInferenceSteps =
        wantsCapabilityModel && inferenceSteps < 32 ? effectivePreset.inferenceSteps : inferenceSteps;
      const effectiveGuidanceScale =
        wantsCapabilityModel && guidanceScale < 5 ? effectivePreset.guidanceScale : guidanceScale;
      const effectiveShift =
        wantsCapabilityModel && (shift < 1 || shift > 5) ? effectivePreset.shift : shift;

      return {
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
          const labelTag = sourceTag ? ` (${sourceTag})` : '';
          const bulkTag = bulkCount > 1 ? ` (${index + 1})` : '';
          return `${effectiveTitle}${labelTag}${bulkTag}`;
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
        randomSeed: randomSeed || index > 0, // Force random for subsequent bulk jobs
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
        audioCodes: audioCodes.trim() || undefined,
        repaintingStart,
        repaintingEnd,
        instruction,
        audioCoverStrength,
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
      };
  }, [
    randomSeed,
    seed,
    styleAssistEnabled,
    enhancedStyle,
    style,
    vocalGender,
    instrumental,
    selectedModel,
    loadedModel,
    getSongModel,
    inferenceSteps,
    guidanceScale,
    shift,
    activePatchKeyword,
    title,
    lyrics,
    bulkCount,
    vocalLanguage,
    bpm,
    keyScale,
    timeSignature,
    duration,
    thinking,
    audioFormat,
    inferMethod,
    lmTemperature,
    lmCfgScale,
    lmTopK,
    lmTopP,
    lmNegativePrompt,
    audioCodes,
    repaintingStart,
    repaintingEnd,
    instruction,
    useAdg,
    cfgIntervalStart,
    cfgIntervalEnd,
    customTimesteps,
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
    trackName,
    completeTrackClasses,
  ]);

  const handleGenerate = () => {
    // Auto-populate title field if empty
    if (!title.trim() && lyrics.trim()) {
      const derived = deriveTitle(lyrics);
      if (derived) setTitle(derived);
    }

    // Bulk generation: loop bulkCount times
    for (let i = 0; i < bulkCount; i++) {
      onGenerate(buildSongPayload(buildBaseCreateFields({ mode: 'song', index: i })));
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
        {ditModels.length > 0 && (
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

        {/* 2026-05-04 SGT (#36): Simple Mode JSX killed. Custom is the
            only mode now; tier-gating handled inline at Reference/Cover
            pills and Show Advanced toggle. */}
        <div className="space-y-5">
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

            {shouldMountProAudioModule(entitlementResolved, hasTier('gener8_pro')) && (
              <ProAudioModePanel
                token={token}
                isGenerating={isGenerating}
                bulkCount={bulkCount}
                initialData={initialData}
                ditModels={ditModels}
                loadedModel={loadedModel}
                onModelsRefresh={setDitModels}
                onUseCapabilityModel={applyModelSwitch}
                buildBaseFields={buildBaseCreateFields}
                onGenerate={onGenerate}
                onBulkReset={() => setBulkCount(1)}
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
                    const capabilityMode = modelKind(loadedModel) === 'capability';
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
                const capabilityMode = modelKind(loadedModel) === 'capability';
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
                        ? 'Pro Model Reference and Cover use the high-fidelity path. Standard is the clean 50-step path; High is only for difficult source audio.'
                        : isTurbo
                        ? 'Turbo models are fast — 8 steps is the sweet spot. Going higher won\'t help.'
                        : '50 steps is the sweet spot for the Song Model. Fast is a preview; High spends more time exploring.'}
                    </p>
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
              the Pro Model uses the wider guidance range. Per-model
              ranges keep each model's canonical defaults in a sensible
              place instead of making users tune raw engine numbers.
            */}

            {/* Style Influence — maps to guidance_scale, range is per-model */}
            {(() => {
              const capabilityMode = modelKind(loadedModel) === 'capability';
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
              const capabilityMode = modelKind(loadedModel) === 'capability';
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
            <div className={`flex items-center justify-between py-1 ${!hasTier('gener8_pro') ? 'opacity-50 pointer-events-none' : ''}`}>
              <div className="flex-1">
                <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">Sync Lyrics</span>
                {!hasTier('gener8_pro') ? (
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
              <div className={`space-y-3 pl-1 ${!hasTier('gener8_pro') ? 'opacity-50 pointer-events-none' : ''}`}>
                {!hasTier('gener8_pro') && (
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
