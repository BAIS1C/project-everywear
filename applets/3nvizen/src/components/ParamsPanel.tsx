import React, { useCallback, useState } from 'react';
import type { GenerationMode } from '../transport';
import { ImageDropzone } from './ImageDropzone';
import { AudioDropzone } from './AudioDropzone';
import { IcLoraPanel } from './placeholders/IcLoraPanel';
import { UpscaleToggle } from './placeholders/UpscaleToggle';

// ── Aspect ratio presets ──

export interface AspectPreset {
  label: string;
  width: number;
  height: number;
}

const ASPECT_PRESETS: AspectPreset[] = [
  { label: "16:9 (768 x 432)", width: 768, height: 432 },
  { label: "9:16 (432 x 768)", width: 432, height: 768 },
  { label: "1:1 (576 x 576)", width: 576, height: 576 },
  { label: "1:1 HD (768 x 768)", width: 768, height: 768 },
];

// ── Params state ──

export interface GenerationParams {
  prompt: string;
  negativePrompt: string;
  showNegative: boolean;
  durationSeconds: number;
  aspectIndex: number;
  seed: string;
  // Advanced
  cfgScale: number;
  steps: number;
  cameraMotion: string;
  frameRate: number;
  // File inputs
  imagePath: string | null;
  audioPath: string | null;
}

export const DEFAULT_PARAMS: GenerationParams = {
  prompt: "",
  negativePrompt: "",
  showNegative: false,
  durationSeconds: 5,
  aspectIndex: 0,
  seed: "",
  cfgScale: 3.0,
  steps: 30,
  cameraMotion: "",
  frameRate: 25,
  imagePath: null,
  audioPath: null,
};

export interface ParamsPanelProps {
  mode: GenerationMode;
  params: GenerationParams;
  onChange: (params: GenerationParams) => void;
  onGenerate: () => void;
  generating: boolean;
  online: boolean;
  onCancel: () => void;
}

export function ParamsPanel({
  mode,
  params,
  onChange,
  onGenerate,
  generating,
  online,
  onCancel,
}: ParamsPanelProps) {
  const [showAdvanced, setShowAdvanced] = useState(false);

  const update = useCallback(
    (patch: Partial<GenerationParams>) => {
      onChange({ ...params, ...patch });
    },
    [params, onChange],
  );

  const randomSeed = useCallback(() => {
    update({ seed: String(Math.floor(Math.random() * 2147483647)) });
  }, [update]);

  const aspect = ASPECT_PRESETS[params.aspectIndex] ?? ASPECT_PRESETS[0];
  const canGenerate = online && params.prompt.trim().length > 0;

  return (
    <div className="tv-params">
      {/* Prompt */}
      <div className="tv-field">
        <label className="tv-field__label">Prompt</label>
        <textarea
          className="tv-textarea"
          value={params.prompt}
          onChange={(e) => update({ prompt: e.target.value })}
          placeholder="Describe the video you want to create..."
          disabled={generating}
          rows={4}
        />
        {/* P2: Gap prompt suggestion button */}
        {/* P2: Enable when Codex implements gap prompt suggestion adapter
        <button
          className="tv-btn tv-btn--sm tv-btn--ghost"
          disabled
          title="Coming Soon"
        >
          Suggest
        </button>
        */}
      </div>

      {/* Negative Prompt (collapsible) */}
      <div className="tv-field">
        <button
          className="tv-toggle-link"
          onClick={() => update({ showNegative: !params.showNegative })}
          type="button"
        >
          {params.showNegative ? "Hide" : "Show"} negative prompt
        </button>
        {params.showNegative && (
          <textarea
            className="tv-textarea tv-textarea--compact"
            value={params.negativePrompt}
            onChange={(e) => update({ negativePrompt: e.target.value })}
            placeholder="Things to avoid in the video..."
            disabled={generating}
            rows={2}
          />
        )}
      </div>

      {/* Duration */}
      <div className="tv-field">
        <label className="tv-field__label">
          Duration: {params.durationSeconds.toFixed(1)}s
        </label>
        <input
          type="range"
          className="tv-range"
          min={2}
          max={10}
          step={0.5}
          value={params.durationSeconds}
          onChange={(e) => update({ durationSeconds: parseFloat(e.target.value) })}
          disabled={generating}
        />
      </div>

      {/* Aspect Ratio */}
      <div className="tv-field">
        <label className="tv-field__label">Aspect Ratio</label>
        <select
          className="tv-select"
          value={params.aspectIndex}
          onChange={(e) => update({ aspectIndex: parseInt(e.target.value, 10) })}
          disabled={generating}
        >
          {ASPECT_PRESETS.map((preset, i) => (
            <option key={preset.label} value={i}>{preset.label}</option>
          ))}
        </select>
      </div>

      {/* Seed */}
      <div className="tv-field">
        <label className="tv-field__label">Seed</label>
        <div className="tv-field__row">
          <input
            type="text"
            className="tv-input"
            value={params.seed}
            onChange={(e) => update({ seed: e.target.value })}
            placeholder="Random"
            disabled={generating}
          />
          <button
            className="tv-btn tv-btn--secondary tv-btn--icon"
            onClick={randomSeed}
            disabled={generating}
            title="Random seed"
            aria-label="Random seed"
          >
            &#x1F3B2;
          </button>
        </div>
      </div>

      {/* Advanced Settings (collapsible) */}
      <div className="tv-field">
        <button
          className="tv-toggle-link"
          onClick={() => setShowAdvanced(!showAdvanced)}
          type="button"
        >
          {showAdvanced ? "Hide" : "Show"} advanced settings
        </button>
        {showAdvanced && (
          <div className="tv-advanced-group">
            {/* CFG Scale */}
            <div className="tv-field">
              <label className="tv-field__label">
                CFG Scale: {params.cfgScale.toFixed(1)}
              </label>
              <input
                type="range"
                className="tv-range"
                min={1.0}
                max={5.0}
                step={0.1}
                value={params.cfgScale}
                onChange={(e) => update({ cfgScale: parseFloat(e.target.value) })}
                disabled={generating}
              />
            </div>

            {/* Steps */}
            <div className="tv-field">
              <label className="tv-field__label">
                Steps: {params.steps}
              </label>
              <input
                type="range"
                className="tv-range"
                min={10}
                max={50}
                step={1}
                value={params.steps}
                onChange={(e) => update({ steps: parseInt(e.target.value, 10) })}
                disabled={generating}
              />
            </div>

            {/* Camera Motion */}
            <div className="tv-field">
              <label className="tv-field__label">Camera Motion</label>
              <input
                type="text"
                className="tv-input"
                value={params.cameraMotion}
                onChange={(e) => update({ cameraMotion: e.target.value })}
                placeholder="e.g. slow pan right, gentle zoom in"
                disabled={generating}
              />
            </div>

            {/* Frame Rate */}
            <div className="tv-field">
              <label className="tv-field__label">Frame Rate</label>
              <select
                className="tv-select"
                value={params.frameRate}
                onChange={(e) => update({ frameRate: parseInt(e.target.value, 10) })}
                disabled={generating}
              >
                <option value={24}>24 fps</option>
                <option value={25}>25 fps</option>
                <option value={30}>30 fps</option>
              </select>
            </div>
          </div>
        )}
      </div>

      {/* P2 Placeholders */}
      <IcLoraPanel />
      <UpscaleToggle />

      {/* Conditional file inputs */}
      {mode === "image-to-video" && (
        <div className="tv-field">
          <label className="tv-field__label">Source Image</label>
          <ImageDropzone
            imagePath={params.imagePath}
            onChange={(path) => update({ imagePath: path })}
            disabled={generating}
          />
        </div>
      )}

      {mode === "audio-to-video" && (
        <div className="tv-field">
          <label className="tv-field__label">Audio Track</label>
          <AudioDropzone
            audioPath={params.audioPath}
            onChange={(path) => update({ audioPath: path })}
            disabled={generating}
          />
        </div>
      )}

      {/* Generate / Cancel button */}
      <div className="tv-action-bar">
        {generating ? (
          <button
            className="tv-btn tv-btn--danger tv-btn--hero"
            onClick={onCancel}
          >
            Cancel
          </button>
        ) : (
          <button
            className="tv-btn tv-btn--primary tv-btn--hero"
            onClick={onGenerate}
            disabled={!canGenerate}
            title={!online ? "Engine offline" : !params.prompt.trim() ? "Enter a prompt" : "Generate video"}
          >
            Generate
          </button>
        )}
      </div>
    </div>
  );
}

export { ASPECT_PRESETS };
