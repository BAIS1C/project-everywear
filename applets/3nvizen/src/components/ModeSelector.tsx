import React from 'react';
import type { GenerationMode } from '../transport';

export interface ModeSelectorProps {
  mode: GenerationMode;
  onChange: (mode: GenerationMode) => void;
  disabled?: boolean;
}

interface ModeOption {
  value: GenerationMode | "retake";
  label: string;
  shortLabel: string;
  disabled?: boolean;
  comingSoon?: boolean;
}

const MODES: ModeOption[] = [
  { value: "text-to-video", label: "Text to Video", shortLabel: "T2V" },
  { value: "image-to-video", label: "Image to Video", shortLabel: "I2V" },
  { value: "audio-to-video", label: "Audio to Video", shortLabel: "A2V" },
  // P2: Enable when Codex implements retake endpoint adapter
  { value: "retake", label: "Retake", shortLabel: "Retake", disabled: true, comingSoon: true },
];

export function ModeSelector({ mode, onChange, disabled }: ModeSelectorProps) {
  return (
    <div className="tv-mode-selector">
      {MODES.map((opt) => {
        const isActive = opt.value === mode;
        const isDisabled = disabled || opt.disabled;

        return (
          <button
            key={opt.value}
            className={[
              "tv-mode-selector__tab",
              isActive ? "tv-mode-selector__tab--active" : "",
              opt.comingSoon ? "tv-mode-selector__tab--coming-soon" : "",
            ].filter(Boolean).join(" ")}
            onClick={() => {
              if (!isDisabled && opt.value !== "retake") {
                onChange(opt.value as GenerationMode);
              }
            }}
            disabled={isDisabled}
            title={opt.comingSoon ? "Coming Soon" : opt.label}
            aria-pressed={isActive}
          >
            <span className="tv-mode-selector__label">{opt.label}</span>
            <span className="tv-mode-selector__short">{opt.shortLabel}</span>
            {opt.comingSoon && (
              <span className="tv-mode-selector__badge">Soon</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
