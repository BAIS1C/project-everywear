import React from 'react';

/**
 * IcLoraPanel — P2 Placeholder
 * ─────────────────────────────
 * IC-LoRA (Identity-Consistent LoRA) panel for character conditioning.
 * Would show extracted character conditioning data and IC-LoRA model selection.
 *
 * LTX Desktop routes:
 *   GET  /list-models           -> IC-LoRA model list
 *   POST /extract-conditioning  -> { image_path } -> conditioning data
 *   POST /generate              -> (IC-LoRA variant) -> GenerateVideoResponse
 *
 * P2: Enable when Codex implements IC-LoRA adapter endpoints
 */

export function IcLoraPanel() {
  return (
    <div className="tv-placeholder-panel" style={{ opacity: 0.5 }}>
      <div className="tv-field">
        <label className="tv-field__label">IC-LoRA Character Conditioning</label>
        <div className="tv-placeholder-body">
          <div className="tv-placeholder-body__content">
            <div className="tv-placeholder-body__copy">
              Upload a reference image to extract character conditioning for
              identity-consistent video generation across segments.
            </div>

            {/* Reference image upload placeholder */}
            <div className="tv-dropzone tv-dropzone--empty" aria-disabled="true">
              <div className="tv-dropzone__thumb">REF</div>
              <div className="tv-dropzone__body">
                <div className="tv-dropzone__title">Character reference image</div>
                <div className="tv-dropzone__copy">
                  Used for IC-LoRA identity extraction
                </div>
              </div>
            </div>

            {/* Model selector placeholder */}
            <select className="tv-select" disabled>
              <option>Select IC-LoRA model...</option>
            </select>

            <button className="tv-btn tv-btn--secondary" disabled>
              Extract Conditioning
            </button>
          </div>
          <span className="tv-badge tv-badge--ghost">Coming Soon</span>
        </div>
      </div>
    </div>
  );
}
