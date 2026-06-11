import React from 'react';

/**
 * UpscaleToggle — P2 Placeholder
 * ───────────────────────────────
 * Checkbox to enable spatial upscaling (2x) as a post-processing step.
 * Would trigger the `ltxv-spatial-upscaler-0.9.8` model (~0.47 GB).
 *
 * P2: Enable when Codex implements upscaler pipeline in the adapter layer.
 * The upscaler model needs to be downloaded and loaded separately from
 * the main generation model.
 */

export function UpscaleToggle() {
  return (
    <div className="tv-placeholder-panel" style={{ opacity: 0.5 }}>
      <div className="tv-field">
        <label className="tv-field__checkbox-row">
          <input
            type="checkbox"
            className="tv-checkbox"
            disabled
            checked={false}
            readOnly
          />
          <span className="tv-field__label">
            Upscale 2x (Spatial Upscaler)
          </span>
          <span className="tv-badge tv-badge--ghost">Coming Soon</span>
        </label>
        <div className="tv-field__hint">
          Post-process with ltxv-spatial-upscaler-0.9.8 (~0.47 GB).
          Doubles output resolution after generation.
        </div>
      </div>
    </div>
  );
}
