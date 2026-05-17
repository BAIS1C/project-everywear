/**
 * CreateView — primary generation interface.
 *
 * Ported from S3 Studio's CreatePanel. Contains:
 *   - Prompt input with style patch strip
 *   - Generation parameters (duration, BPM, steps, guidance)
 *   - Model selector (reads available models via Tauri invoke)
 *   - Generate button + progress display
 *   - Recent generations gallery
 *
 * Phase 3.3: structural port. Full invoke wiring in Phase 4.
 */
import React, { useState } from 'react';
import { Sparkles, Upload, Settings2, ChevronDown } from 'lucide-react';

// ── Types (will move to shared types file) ───────────────────────

interface GenerationParams {
  prompt: string;
  duration: number;
  bpm: number;
  steps: number;
  guidanceScale: number;
  seed: number;
  model: string;
}

const DEFAULT_PARAMS: GenerationParams = {
  prompt: '',
  duration: 30,
  bpm: 120,
  steps: 50,
  guidanceScale: 7.0,
  seed: -1,
  model: 'ace-step-v1',
};

// ── Component ────────────────────────────────────────────────────

export default function CreateView() {
  const [params, setParams] = useState<GenerationParams>(DEFAULT_PARAMS);
  const [isGenerating, setIsGenerating] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const handleGenerate = async () => {
    if (!params.prompt.trim() || isGenerating) return;
    setIsGenerating(true);
    try {
      // Phase 4: invoke('generate_music', { ...params })
      // Stub: simulate generation delay
      await new Promise((r) => setTimeout(r, 2000));
    } finally {
      setIsGenerating(false);
    }
  };

  const updateParam = <K extends keyof GenerationParams>(
    key: K,
    value: GenerationParams[K],
  ) => {
    setParams((prev) => ({ ...prev, [key]: value }));
  };

  return (
    <div className="flex flex-col h-full p-6 gap-6 max-w-3xl mx-auto">
      {/* Header */}
      <div>
        <h1 className="font-display text-2xl tracking-wide text-s3-text-primary">
          Create
        </h1>
        <p className="text-s3-text-muted text-sm mt-1">
          Describe the music you want to generate.
        </p>
      </div>

      {/* Prompt input */}
      <div className="ew-field">
        <label className="ew-field-label">Prompt</label>
        <textarea
          className="ew-textarea"
          placeholder="A cinematic orchestral piece with soaring strings and a powerful brass section..."
          value={params.prompt}
          onChange={(e) => updateParam('prompt', e.target.value)}
          rows={3}
        />
      </div>

      {/* Quick params row */}
      <div className="flex gap-4 flex-wrap">
        <div className="ew-field flex-1 min-w-[120px]">
          <label className="ew-field-label">Duration (s)</label>
          <input
            type="number"
            className="ew-input"
            value={params.duration}
            min={5}
            max={300}
            onChange={(e) => updateParam('duration', Number(e.target.value))}
          />
        </div>
        <div className="ew-field flex-1 min-w-[120px]">
          <label className="ew-field-label">BPM</label>
          <input
            type="number"
            className="ew-input"
            value={params.bpm}
            min={40}
            max={240}
            onChange={(e) => updateParam('bpm', Number(e.target.value))}
          />
        </div>
        <div className="ew-field flex-1 min-w-[120px]">
          <label className="ew-field-label">Model</label>
          <select
            className="ew-select"
            value={params.model}
            onChange={(e) => updateParam('model', e.target.value)}
          >
            <option value="ace-step-v1">ACE-Step v1</option>
            <option value="ace-step-v1.5">ACE-Step v1.5</option>
          </select>
        </div>
      </div>

      {/* Advanced toggle */}
      <button
        className="flex items-center gap-2 text-s3-text-muted hover:text-s3-text-primary text-xs uppercase tracking-widest font-mono transition-colors"
        onClick={() => setShowAdvanced((s) => !s)}
      >
        <Settings2 size={14} />
        Advanced
        <ChevronDown
          size={14}
          className={`transition-transform ${showAdvanced ? 'rotate-180' : ''}`}
        />
      </button>

      {showAdvanced && (
        <div className="flex gap-4 flex-wrap p-4 bg-s3-card border border-s3-border rounded-lg">
          <div className="ew-field flex-1 min-w-[140px]">
            <label className="ew-field-label">Inference Steps</label>
            <input
              type="number"
              className="ew-input"
              value={params.steps}
              min={10}
              max={200}
              onChange={(e) => updateParam('steps', Number(e.target.value))}
            />
          </div>
          <div className="ew-field flex-1 min-w-[140px]">
            <label className="ew-field-label">Guidance Scale</label>
            <input
              type="number"
              className="ew-input"
              step={0.5}
              value={params.guidanceScale}
              min={1}
              max={30}
              onChange={(e) => updateParam('guidanceScale', Number(e.target.value))}
            />
          </div>
          <div className="ew-field flex-1 min-w-[140px]">
            <label className="ew-field-label">Seed (-1 = random)</label>
            <input
              type="number"
              className="ew-input"
              value={params.seed}
              onChange={(e) => updateParam('seed', Number(e.target.value))}
            />
          </div>
        </div>
      )}

      {/* Audio upload (reference track) */}
      <div className="flex items-center gap-3">
        <button className="ew-btn ew-btn--ghost ew-btn--sm">
          <Upload size={14} />
          Reference Audio
        </button>
        <span className="ew-small">Optional. Upload a reference track for style guidance.</span>
      </div>

      {/* Generate button */}
      <button
        className="ew-btn ew-btn--primary ew-btn--lg self-start"
        onClick={handleGenerate}
        disabled={!params.prompt.trim() || isGenerating}
      >
        <Sparkles size={16} />
        {isGenerating ? 'Generating...' : 'Generate'}
      </button>

      {/* Generation progress (stub) */}
      {isGenerating && (
        <div className="flex flex-col gap-2">
          <div className="ew-progress">
            <div className="ew-progress-bar" style={{ width: '0%' }} />
          </div>
          <span className="ew-meta">Queued... waiting for engine</span>
        </div>
      )}
    </div>
  );
}
