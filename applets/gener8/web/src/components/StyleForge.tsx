// @ts-nocheck
/**
 * StyleForge — LoRA Training Workshop
 *
 * Drag-and-drop training bucket UI for creating Style Patches.
 * User drops MP3s into a named bucket, the system auto-analyses them,
 * and trains a LoRA adapter that becomes a reusable Style Patch.
 *
 * Sections:
 *   1. Bucket Creator — name your style, drop files
 *   2. Track List — per-track cards with metadata
 *   3. Training Controls — preset selector, VRAM check, start/stop
 *   4. Training Progress — real-time loss curve via SSE
 *   5. Installed Patches — manage existing style patches
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Flame, Upload, Music, Trash2, Play, Square, Download,
  Zap, Settings, ChevronDown, ChevronUp, Loader2,
  CheckCircle, XCircle, AlertTriangle, FolderOpen, Layers,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import {
  trainingApi, patchesApi, loraApi, engineApi,
  TrainingBucket, PatchManifest, TrainingStatus, TrainingSSEEvent,
  type EngineHealth,
} from '../services/api';

// ─── Training Presets ─────────────────────────────────────────────────────
const TRAINING_PRESETS = [
  {
    id: 'recommended',
    label: 'Recommended',
    description: 'Balanced quality & speed. Rank 64, 100 epochs.',
    params: { lora_rank: 64, lora_alpha: 128, train_epochs: 100, learning_rate: 1e-4 },
  },
  {
    id: 'quick',
    label: 'Quick Test',
    description: 'Fast iteration. Rank 32, 50 epochs. Lower quality.',
    params: { lora_rank: 32, lora_alpha: 64, train_epochs: 50, learning_rate: 2e-4 },
  },
  {
    id: 'high-quality',
    label: 'High Quality',
    description: 'Best results, slow. Rank 128, 300 epochs.',
    params: { lora_rank: 128, lora_alpha: 256, train_epochs: 300, learning_rate: 5e-5 },
  },
  {
    id: 'lokr-fast',
    label: 'LoKR (10x Speed)',
    description: 'LyCORIS LoKR adapter. 10x faster training, slightly different character.',
    params: { training_type: 'lokr', lokr_linear_dim: 64, lokr_factor: 8, train_epochs: 100, learning_rate: 1e-4 },
  },
];

// ─── Helpers ──────────────────────────────────────────────────────────────
function formatBytes(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════════════

// Minimum VRAM for LoRA training (in GB)
const MIN_TRAINING_VRAM_GB = 12;

export const StyleForge: React.FC = () => {
  const { user, token } = useAuth();

  // ─── GPU / engine state ───────────────────────────────────────────────
  const [gpuMemoryGb, setGpuMemoryGb] = useState<number | null>(null);
  const [loadedModel, setLoadedModel] = useState<string>('');
  const [engineOnline, setEngineOnline] = useState<boolean | null>(null);

  useEffect(() => {
    // Check engine health for VRAM info
    engineApi.health().then((h) => {
      setEngineOnline(true);
      setLoadedModel(h.loaded_model || '');
      // gpu_memory_gb might be in the health response depending on API version
      const mem = (h as unknown as Record<string, unknown>).gpu_memory_gb;
      if (typeof mem === 'number') setGpuMemoryGb(mem);
    }).catch(() => setEngineOnline(false));
  }, []);

  const isVramSufficient = gpuMemoryGb === null || gpuMemoryGb >= MIN_TRAINING_VRAM_GB;
  const isBase = loadedModel.includes('base');

  // ─── Bucket state ─────────────────────────────────────────────────────
  const [bucketName, setBucketName] = useState('');
  const [bucketFiles, setBucketFiles] = useState<File[]>([]);
  const [uploadedBuckets, setUploadedBuckets] = useState<TrainingBucket[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ─── Training state ───────────────────────────────────────────────────
  const [selectedPreset, setSelectedPreset] = useState(TRAINING_PRESETS[0]);
  const [showPresets, setShowPresets] = useState(false);
  const [isTraining, setIsTraining] = useState(false);
  const [trainingStatus, setTrainingStatus] = useState<TrainingStatus | null>(null);
  const [trainingLog, setTrainingLog] = useState<string[]>([]);
  const [showLog, setShowLog] = useState(false);
  const [activeBucket, setActiveBucket] = useState<TrainingBucket | null>(null);
  const sseRef = useRef<EventSource | null>(null);

  // ─── Patches state ────────────────────────────────────────────────────
  const [patches, setPatches] = useState<PatchManifest[]>([]);
  const [showPatches, setShowPatches] = useState(true);

  // ─── Error / success feedback ─────────────────────────────────────────
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // ─── Load buckets and patches on mount ────────────────────────────────
  useEffect(() => {
    if (!token) return;
    loadBuckets();
    loadPatches();
    // Check if training is already running
    checkTrainingStatus();
  }, [token]);

  // ─── Cleanup SSE on unmount ───────────────────────────────────────────
  useEffect(() => {
    return () => {
      if (sseRef.current) {
        sseRef.current.close();
        sseRef.current = null;
      }
    };
  }, []);

  const loadBuckets = async () => {
    if (!token) return;
    try {
      const { buckets } = await trainingApi.listBuckets(token);
      setUploadedBuckets(buckets);
    } catch (e) {
      console.error('[StyleForge] Failed to load buckets:', e);
    }
  };

  const loadPatches = async () => {
    if (!token) return;
    try {
      const { patches: p } = await patchesApi.list(token);
      setPatches(p);
    } catch (e) {
      console.error('[StyleForge] Failed to load patches:', e);
    }
  };

  const checkTrainingStatus = async () => {
    if (!token) return;
    try {
      const status = await trainingApi.status(token);
      if (status.status === 'training' || status.status === 'preprocessing') {
        setIsTraining(true);
        setTrainingStatus(status);
        startSSE();
      }
    } catch {
      // Local music engine not running, that's fine
    }
  };

  // ═══════════════════════════════════════════════════════════════════════
  // DRAG & DROP
  // ═══════════════════════════════════════════════════════════════════════

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const droppedFiles = (Array.from(e.dataTransfer.files) as File[]).filter(f => {
      const ext = f.name.toLowerCase().split('.').pop();
      return ['mp3', 'wav', 'flac', 'm4a', 'ogg'].includes(ext || '');
    });

    if (droppedFiles.length === 0) {
      setError('No audio files found. Drop MP3, WAV, FLAC, M4A, or OGG files.');
      return;
    }

    setBucketFiles(prev => [...prev, ...droppedFiles]);
    setError('');
  }, []);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const selected = Array.from(e.target.files);
      setBucketFiles(prev => [...prev, ...selected]);
    }
  };

  const removeFile = (index: number) => {
    setBucketFiles(prev => prev.filter((_, i) => i !== index));
  };

  // ═══════════════════════════════════════════════════════════════════════
  // UPLOAD
  // ═══════════════════════════════════════════════════════════════════════

  const handleUpload = async () => {
    if (!token || !bucketName.trim() || bucketFiles.length === 0) {
      setError('Enter a bucket name and add at least one audio file.');
      return;
    }

    setIsUploading(true);
    setError('');
    try {
      const result = await trainingApi.uploadFiles(bucketFiles, bucketName.trim(), token);
      setSuccess(`${result.files.length} file(s) uploaded to "${bucketName}"`);
      setBucketFiles([]);
      await loadBuckets();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setIsUploading(false);
    }
  };

  // ═══════════════════════════════════════════════════════════════════════
  // TRAINING
  // ═══════════════════════════════════════════════════════════════════════

  const startTraining = async (bucket: TrainingBucket) => {
    if (!token) return;
    setError('');
    setTrainingLog([]);
    setActiveBucket(bucket);

    try {
      // Step 1: Scan the dataset
      setTrainingLog(prev => [...prev, `Scanning dataset: ${bucket.directory}`]);
      await trainingApi.datasetScan(bucket.directory, token);

      // Step 2: Preprocess
      setTrainingLog(prev => [...prev, 'Preprocessing audio to tensors...']);
      await trainingApi.datasetPreprocess({ directory: bucket.directory }, token);

      // Step 3: Auto-label with LLM
      setTrainingLog(prev => [...prev, 'Auto-labelling tracks with LLM analysis...']);
      await trainingApi.datasetAutoLabel({ directory: bucket.directory, custom_tag: bucket.name }, token);

      // Step 4: Start training
      setTrainingLog(prev => [...prev, `Starting ${selectedPreset.label} training...`]);
      const params = {
        tensor_dir: bucket.directory,
        ...selectedPreset.params,
      };
      await trainingApi.start(params, token);

      setIsTraining(true);
      startSSE();
      setTrainingLog(prev => [...prev, 'Training started. Monitoring progress...']);
    } catch (e) {
      setError(`Training failed: ${(e as Error).message}`);
      setIsTraining(false);
      setTrainingLog(prev => [...prev, `ERROR: ${(e as Error).message}`]);
    }
  };

  const stopTraining = async () => {
    if (!token) return;
    try {
      await trainingApi.stop(token);
      setTrainingLog(prev => [...prev, 'Training stopped. Checkpoint saved.']);
    } catch (e) {
      setError(`Failed to stop: ${(e as Error).message}`);
    }
  };

  const startSSE = () => {
    if (!token || sseRef.current) return;

    const es = trainingApi.statusStream(token);
    sseRef.current = es;

    es.onmessage = (event) => {
      try {
        const data: TrainingSSEEvent = JSON.parse(event.data);

        if (data.type === 'progress') {
          setTrainingStatus({
            status: (data.status as TrainingStatus['status']) || 'training',
            current_step: data.current_step,
            total_steps: data.total_steps,
            current_epoch: data.current_epoch,
            total_epochs: data.total_epochs,
            loss: data.loss,
            learning_rate: data.learning_rate,
            elapsed_seconds: data.elapsed_seconds,
            eta_seconds: data.eta_seconds,
          });
        }

        if (data.type === 'done') {
          setIsTraining(false);
          setTrainingLog(prev => [...prev, `Training ${data.status}!`]);
          if (data.status === 'completed') {
            setSuccess('Training complete! Export your Style Patch below.');
            loadPatches();
          }
          es.close();
          sseRef.current = null;
        }

        if (data.type === 'error') {
          setTrainingLog(prev => [...prev, `SSE error: ${data.message}`]);
        }
      } catch {
        // Ignore parse errors
      }
    };

    es.onerror = () => {
      // SSE will auto-reconnect, but if it keeps failing, clean up
      setTrainingLog(prev => [...prev, 'SSE connection lost. Falling back to polling.']);
      es.close();
      sseRef.current = null;
    };
  };

  const exportPatch = async () => {
    if (!token || !activeBucket) return;
    try {
      const exportResult = await trainingApi.exportWeights({}, token);
      // Create the patch manifest
      await patchesApi.create({
        name: activeBucket.name,
        triggerKeyword: activeBucket.name,
        description: `Style trained on ${activeBucket.fileCount} tracks`,
        genreTags: [],
        weightsDir: exportResult.export_path,
        trainingParams: {
          ...selectedPreset.params,
          trackCount: activeBucket.fileCount,
        } as any,
      }, token);
      setSuccess(`Style Patch "${activeBucket.name}" created!`);
      await loadPatches();
    } catch (e) {
      setError(`Export failed: ${(e as Error).message}`);
    }
  };

  // ═══════════════════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════════════════

  const progressPercent = trainingStatus?.total_steps && trainingStatus?.current_step
    ? Math.round((trainingStatus.current_step / trainingStatus.total_steps) * 100)
    : 0;

  return (
    <div className="flex-1 bg-white dark:bg-black overflow-y-auto custom-scrollbar transition-colors duration-300">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-white/80 dark:bg-black/80 backdrop-blur-xl border-b border-zinc-200 dark:border-white/5 px-6 lg:px-10 py-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-orange-500 to-red-600 flex items-center justify-center">
            <Flame size={22} className="text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-zinc-900 dark:text-white font-display">STYLE FORGE</h1>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">Train LoRA Style Patches — Strands Soundwave</p>
          </div>
        </div>
      </div>

      <div className="p-6 lg:p-10 pb-32 space-y-8">
        {/* ──── Feedback Messages ──── */}
        {error && (
          <div className="flex items-center gap-3 p-4 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400">
            <XCircle size={18} />
            <span className="text-sm">{error}</span>
            <button onClick={() => setError('')} className="ml-auto text-red-400 hover:text-red-300">&times;</button>
          </div>
        )}
        {/* GPU / Model Warnings */}
        {engineOnline === false && (
          <div className="flex items-start gap-3 p-4 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400">
            <AlertTriangle size={18} className="mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-sm font-medium">Local music engine offline</p>
              <p className="text-xs text-red-400/70 mt-1">Training requires the local music engine to be running.</p>
            </div>
          </div>
        )}
        {gpuMemoryGb !== null && gpuMemoryGb < MIN_TRAINING_VRAM_GB && (
          <div className="flex items-start gap-3 p-4 bg-amber-500/10 border border-amber-500/20 rounded-xl text-amber-400">
            <AlertTriangle size={18} className="mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-sm font-medium">Low VRAM detected: {gpuMemoryGb.toFixed(1)} GB</p>
              <p className="text-xs text-amber-400/70 mt-1">LoRA training requires at least {MIN_TRAINING_VRAM_GB} GB VRAM. Your GPU may run out of memory during training. Consider using a smaller batch size or rank.</p>
            </div>
          </div>
        )}
        {engineOnline && loadedModel && !isBase && (
          <div className="flex items-start gap-3 p-4 bg-blue-500/10 border border-blue-500/20 rounded-xl text-blue-400">
            <AlertTriangle size={18} className="mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-sm font-medium">Fast song model loaded</p>
              <p className="text-xs text-blue-400/70 mt-1">Training requires the Base model. It will be loaded automatically when you start a training run.</p>
            </div>
          </div>
        )}

        {success && (
          <div className="flex items-center gap-3 p-4 bg-green-500/10 border border-green-500/20 rounded-xl text-green-400">
            <CheckCircle size={18} />
            <span className="text-sm">{success}</span>
            <button onClick={() => setSuccess('')} className="ml-auto text-green-400 hover:text-green-300">&times;</button>
          </div>
        )}

        {/* ──── Section 1: Create Training Bucket ──── */}
        <section>
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-white mb-4 flex items-center gap-2">
            <Upload size={18} className="text-accent-500" />
            Create Training Bucket
          </h2>

          {/* Bucket Name Input */}
          <div className="mb-4">
            <label className="block text-sm text-zinc-500 dark:text-zinc-400 mb-1.5">
              Bucket Name <span className="text-accent-500">(becomes your style trigger keyword)</span>
            </label>
            <input
              type="text"
              value={bucketName}
              onChange={(e) => setBucketName(e.target.value)}
              placeholder="e.g. Progressive Melodic House"
              className="w-full px-4 py-3 bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-white/10 rounded-xl text-zinc-900 dark:text-white placeholder-zinc-400 dark:placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-accent-500 focus:border-transparent transition-all font-medium"
            />
          </div>

          {/* Drop Zone */}
          <div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`
              relative border-2 border-dashed rounded-2xl p-8 text-center cursor-pointer transition-all duration-200
              ${isDragging
                ? 'border-accent-500 bg-accent-500/10 scale-[1.01]'
                : 'border-zinc-300 dark:border-white/10 hover:border-accent-500/50 hover:bg-zinc-50 dark:hover:bg-white/5'}
            `}
          >
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept=".mp3,.wav,.flac,.m4a,.ogg"
              onChange={handleFileSelect}
              className="hidden"
            />
            <div className="flex flex-col items-center gap-3">
              <div className={`w-16 h-16 rounded-2xl flex items-center justify-center transition-colors ${isDragging ? 'bg-accent-500/20' : 'bg-zinc-100 dark:bg-white/5'}`}>
                <Music size={28} className={isDragging ? 'text-accent-500' : 'text-zinc-400'} />
              </div>
              <div>
                <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                  {isDragging ? 'Drop your tracks here' : 'Drag & drop audio files'}
                </p>
                <p className="text-xs text-zinc-500 dark:text-zinc-500 mt-1">
                  MP3, WAV, FLAC, M4A, OGG — up to 50MB each
                </p>
              </div>
            </div>
          </div>

          {/* Staged Files */}
          {bucketFiles.length > 0 && (
            <div className="mt-4 space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-sm text-zinc-500 dark:text-zinc-400">
                  {bucketFiles.length} file{bucketFiles.length !== 1 ? 's' : ''} staged
                </p>
                <button
                  onClick={() => setBucketFiles([])}
                  className="text-xs text-red-400 hover:text-red-300 transition-colors"
                >
                  Clear all
                </button>
              </div>
              <div className="space-y-1.5 max-h-48 overflow-y-auto custom-scrollbar">
                {bucketFiles.map((file, i) => (
                  <div key={i} className="flex items-center gap-3 px-3 py-2 bg-zinc-50 dark:bg-white/5 rounded-lg group">
                    <Music size={14} className="text-accent-500 flex-shrink-0" />
                    <span className="text-sm text-zinc-700 dark:text-zinc-300 truncate flex-1">{file.name}</span>
                    <span className="text-xs text-zinc-400">{formatBytes(file.size)}</span>
                    <button
                      onClick={(e) => { e.stopPropagation(); removeFile(i); }}
                      className="opacity-0 group-hover:opacity-100 text-zinc-400 hover:text-red-400 transition-all"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>

              {/* Upload Button */}
              <button
                onClick={handleUpload}
                disabled={isUploading || !bucketName.trim()}
                className="w-full py-3 mt-2 bg-gradient-to-r from-accent-500 to-purple-600 text-white font-semibold rounded-xl hover:from-accent-600 hover:to-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all transform hover:scale-[1.01] active:scale-[0.99] flex items-center justify-center gap-2"
              >
                {isUploading ? (
                  <>
                    <Loader2 size={18} className="animate-spin" />
                    Uploading...
                  </>
                ) : (
                  <>
                    <Upload size={18} />
                    Upload to "{bucketName || '...'}"
                  </>
                )}
              </button>
            </div>
          )}
        </section>

        {/* ──── Section 2: Existing Buckets ──── */}
        {uploadedBuckets.length > 0 && (
          <section>
            <h2 className="text-lg font-semibold text-zinc-900 dark:text-white mb-4 flex items-center gap-2">
              <FolderOpen size={18} className="text-purple-500" />
              Training Buckets
            </h2>

            <div className="grid gap-3">
              {uploadedBuckets.map((bucket) => (
                <div
                  key={bucket.name}
                  className={`p-4 rounded-xl border transition-all ${
                    activeBucket?.name === bucket.name
                      ? 'border-accent-500 bg-accent-500/5'
                      : 'border-zinc-200 dark:border-white/10 bg-zinc-50 dark:bg-white/5 hover:border-accent-500/50'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="font-semibold text-zinc-900 dark:text-white">{bucket.name}</h3>
                      <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                        {bucket.fileCount} track{bucket.fileCount !== 1 ? 's' : ''}
                        {bucket.files && ` — ${formatBytes(bucket.files.reduce((acc, f) => acc + f.size, 0))} total`}
                      </p>
                    </div>
                    <button
                      onClick={() => startTraining(bucket)}
                      disabled={isTraining}
                      className="px-4 py-2 bg-gradient-to-r from-orange-500 to-red-500 text-white text-sm font-semibold rounded-lg hover:from-orange-600 hover:to-red-600 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center gap-2"
                    >
                      {isTraining && activeBucket?.name === bucket.name ? (
                        <Loader2 size={14} className="animate-spin" />
                      ) : (
                        <Flame size={14} />
                      )}
                      {isTraining && activeBucket?.name === bucket.name ? 'Training...' : 'Train'}
                    </button>
                  </div>

                  {/* File list (expandable) */}
                  {bucket.files && bucket.files.length > 0 && (
                    <div className="mt-3 space-y-1">
                      {bucket.files.slice(0, 5).map((f, i) => (
                        <div key={i} className="flex items-center gap-2 text-xs text-zinc-400">
                          <Music size={10} />
                          <span className="truncate">{f.filename}</span>
                          <span className="ml-auto">{formatBytes(f.size)}</span>
                        </div>
                      ))}
                      {bucket.files.length > 5 && (
                        <p className="text-xs text-zinc-500 pl-4">+{bucket.files.length - 5} more</p>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}

        {/* ──── Section 3: Training Preset Selector ──── */}
        <section>
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-white mb-4 flex items-center gap-2">
            <Settings size={18} className="text-yellow-500" />
            Training Preset
          </h2>

          <button
            onClick={() => setShowPresets(!showPresets)}
            className="w-full flex items-center justify-between p-4 bg-zinc-50 dark:bg-white/5 rounded-xl border border-zinc-200 dark:border-white/10 hover:border-accent-500/50 transition-all"
          >
            <div className="text-left">
              <p className="font-medium text-zinc-900 dark:text-white">{selectedPreset.label}</p>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">{selectedPreset.description}</p>
            </div>
            {showPresets ? <ChevronUp size={18} className="text-zinc-400" /> : <ChevronDown size={18} className="text-zinc-400" />}
          </button>

          {showPresets && (
            <div className="mt-2 space-y-2">
              {TRAINING_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  onClick={() => { setSelectedPreset(preset); setShowPresets(false); }}
                  className={`w-full text-left p-3 rounded-lg border transition-all ${
                    selectedPreset.id === preset.id
                      ? 'border-accent-500 bg-accent-500/10'
                      : 'border-zinc-200 dark:border-white/10 hover:border-accent-500/30 bg-zinc-50 dark:bg-white/5'
                  }`}
                >
                  <p className="text-sm font-medium text-zinc-900 dark:text-white">{preset.label}</p>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">{preset.description}</p>
                </button>
              ))}
            </div>
          )}
        </section>

        {/* ──── Section 4: Training Progress ──── */}
        {(isTraining || trainingStatus) && (
          <section>
            <h2 className="text-lg font-semibold text-zinc-900 dark:text-white mb-4 flex items-center gap-2">
              <Zap size={18} className="text-yellow-400" />
              Training Progress
              {isTraining && <Loader2 size={14} className="animate-spin text-accent-500 ml-2" />}
            </h2>

            <div className="p-4 bg-zinc-50 dark:bg-white/5 rounded-xl border border-zinc-200 dark:border-white/10 space-y-4">
              {/* Progress Bar */}
              <div>
                <div className="flex items-center justify-between text-sm mb-2">
                  <span className="text-zinc-500 dark:text-zinc-400">
                    {trainingStatus?.status === 'completed' ? 'Complete' : trainingStatus?.status || 'Initialising...'}
                  </span>
                  <span className="font-mono text-accent-500">{progressPercent}%</span>
                </div>
                <div className="h-2 bg-zinc-200 dark:bg-white/10 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-accent-500 to-purple-500 rounded-full transition-all duration-500"
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>
              </div>

              {/* Stats Grid */}
              {trainingStatus && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {trainingStatus.current_epoch !== undefined && (
                    <div className="text-center p-2 bg-zinc-100 dark:bg-white/5 rounded-lg">
                      <p className="text-xs text-zinc-500 dark:text-zinc-400">Epoch</p>
                      <p className="text-sm font-mono font-bold text-zinc-900 dark:text-white">
                        {trainingStatus.current_epoch}/{trainingStatus.total_epochs || '?'}
                      </p>
                    </div>
                  )}
                  {trainingStatus.loss !== undefined && (
                    <div className="text-center p-2 bg-zinc-100 dark:bg-white/5 rounded-lg">
                      <p className="text-xs text-zinc-500 dark:text-zinc-400">Loss</p>
                      <p className="text-sm font-mono font-bold text-accent-500">{trainingStatus.loss.toFixed(4)}</p>
                    </div>
                  )}
                  {trainingStatus.elapsed_seconds !== undefined && (
                    <div className="text-center p-2 bg-zinc-100 dark:bg-white/5 rounded-lg">
                      <p className="text-xs text-zinc-500 dark:text-zinc-400">Elapsed</p>
                      <p className="text-sm font-mono font-bold text-zinc-900 dark:text-white">
                        {formatDuration(trainingStatus.elapsed_seconds)}
                      </p>
                    </div>
                  )}
                  {trainingStatus.eta_seconds !== undefined && (
                    <div className="text-center p-2 bg-zinc-100 dark:bg-white/5 rounded-lg">
                      <p className="text-xs text-zinc-500 dark:text-zinc-400">ETA</p>
                      <p className="text-sm font-mono font-bold text-zinc-900 dark:text-white">
                        {formatDuration(trainingStatus.eta_seconds)}
                      </p>
                    </div>
                  )}
                </div>
              )}

              {/* Controls */}
              <div className="flex gap-2">
                {isTraining && (
                  <button
                    onClick={stopTraining}
                    className="px-4 py-2 bg-red-500/20 border border-red-500/30 text-red-400 rounded-lg hover:bg-red-500/30 transition-colors flex items-center gap-2 text-sm font-medium"
                  >
                    <Square size={14} />
                    Stop Training
                  </button>
                )}
                {trainingStatus?.status === 'completed' && (
                  <button
                    onClick={exportPatch}
                    className="px-4 py-2 bg-gradient-to-r from-green-500 to-emerald-600 text-white rounded-lg hover:from-green-600 hover:to-emerald-700 transition-all flex items-center gap-2 text-sm font-semibold"
                  >
                    <Download size={14} />
                    Export Style Patch
                  </button>
                )}
              </div>

              {/* Training Log */}
              {trainingLog.length > 0 && (
                <div>
                  <button
                    onClick={() => setShowLog(!showLog)}
                    className="flex items-center gap-1 text-xs text-zinc-500 dark:text-zinc-400 hover:text-zinc-300 transition-colors"
                  >
                    {showLog ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                    Training Log ({trainingLog.length} entries)
                  </button>
                  {showLog && (
                    <div className="mt-2 max-h-40 overflow-y-auto bg-black/50 rounded-lg p-3 font-mono text-xs text-zinc-400 space-y-0.5">
                      {trainingLog.map((entry, i) => (
                        <div key={i} className={entry.startsWith('ERROR') ? 'text-red-400' : ''}>
                          {entry}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </section>
        )}

        {/* ──── Section 5: Installed Style Patches ──── */}
        <section>
          <button
            onClick={() => setShowPatches(!showPatches)}
            className="flex items-center gap-2 text-lg font-semibold text-zinc-900 dark:text-white mb-4 hover:text-accent-500 transition-colors"
          >
            <Layers size={18} className="text-purple-500" />
            Installed Patches ({patches.length})
            {showPatches ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </button>

          {showPatches && (
            <div className="space-y-3">
              {patches.length === 0 ? (
                <div className="text-center py-12 text-zinc-500 dark:text-zinc-500">
                  <Layers size={32} className="mx-auto mb-3 opacity-40" />
                  <p className="text-sm">No style patches yet.</p>
                  <p className="text-xs mt-1">Train your first one above.</p>
                </div>
              ) : (
                patches.map((patch) => (
                  <PatchCard key={patch.id} patch={patch} token={token} onRefresh={loadPatches} />
                ))
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════
// PATCH CARD SUB-COMPONENT
// ═══════════════════════════════════════════════════════════════════════════

const PatchCard: React.FC<{
  patch: PatchManifest;
  token: string | null;
  onRefresh: () => void;
}> = ({ patch, token, onRefresh }) => {
  const [isLoading, setIsLoading] = useState(false);
  const [strength, setStrength] = useState(0.8);
  const [isLoaded, setIsLoaded] = useState(false);

  const handleLoad = async () => {
    if (!token) return;
    setIsLoading(true);
    try {
      await patchesApi.load(patch.id, strength, token);
      setIsLoaded(true);
    } catch (e) {
      console.error('Failed to load patch:', e);
    } finally {
      setIsLoading(false);
    }
  };

  const handleUnload = async () => {
    if (!token) return;
    setIsLoading(true);
    try {
      await loraApi.unload(patch.id, token);
      setIsLoaded(false);
    } catch (e) {
      console.error('Failed to unload patch:', e);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className={`p-4 rounded-xl border transition-all ${
      isLoaded
        ? 'border-accent-500 bg-accent-500/5 shadow-lg shadow-accent-500/10'
        : 'border-zinc-200 dark:border-white/10 bg-zinc-50 dark:bg-white/5'
    }`}>
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-zinc-900 dark:text-white truncate">{patch.name}</h3>
            {isLoaded && <span className="text-[10px] px-1.5 py-0.5 bg-accent-500/20 text-accent-400 rounded-full font-medium">ACTIVE</span>}
          </div>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
            Trigger: <span className="font-mono text-accent-500">{patch.triggerKeyword}</span>
          </p>
          {patch.description && (
            <p className="text-xs text-zinc-400 dark:text-zinc-500 mt-1">{patch.description}</p>
          )}
          {patch.trainingParams && (
            <p className="text-[10px] text-zinc-400 mt-1">
              {patch.trainingParams.trainingType?.toUpperCase() || 'LoRA'} r{patch.trainingParams.rank} — {patch.trainingParams.trackCount} tracks — {patch.trainingParams.epochs} epochs
            </p>
          )}
        </div>

        <div className="flex items-center gap-2 ml-3 flex-shrink-0">
          {isLoaded ? (
            <button
              onClick={handleUnload}
              disabled={isLoading}
              className="px-3 py-1.5 text-xs font-medium bg-red-500/20 text-red-400 border border-red-500/20 rounded-lg hover:bg-red-500/30 disabled:opacity-50 transition-colors"
            >
              Unload
            </button>
          ) : (
            <button
              onClick={handleLoad}
              disabled={isLoading || !patch.hasWeights}
              className="px-3 py-1.5 text-xs font-medium bg-accent-500/20 text-accent-400 border border-accent-500/20 rounded-lg hover:bg-accent-500/30 disabled:opacity-50 transition-colors"
            >
              {isLoading ? <Loader2 size={12} className="animate-spin" /> : 'Load'}
            </button>
          )}
        </div>
      </div>

      {/* Strength Slider */}
      <div className="mt-3 flex items-center gap-3">
        <span className="text-[10px] text-zinc-500 w-16">Strength</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={strength}
          onChange={(e) => setStrength(parseFloat(e.target.value))}
          className="flex-1 h-1 bg-zinc-200 dark:bg-white/10 rounded-full appearance-none cursor-pointer accent-accent-500"
        />
        <span className="text-xs font-mono text-zinc-400 w-8 text-right">{strength.toFixed(2)}</span>
      </div>
    </div>
  );
};

export default StyleForge;
