import React from 'react';

/**
 * RetakePanel — P2 Placeholder
 * ────────────────────────────
 * The retake flow needs a video timeline with in/out point selection,
 * which is complex. This component is the structural shell; Codex
 * enables it by removing `disabled` and wiring submitRetake() from transport.
 *
 * P2: Enable when Codex implements retake endpoint adapter
 */

export interface RetakePanelProps {
  videoPath?: string;
}

export function RetakePanel({ videoPath }: RetakePanelProps) {
  return (
    <div className="tv-placeholder-panel" style={{ opacity: 0.5 }}>
      <div className="tv-field">
        <label className="tv-field__label">Retake</label>
        <div className="tv-placeholder-body">
          <div className="tv-placeholder-body__content">
            <div className="tv-placeholder-body__title">Retake Mode</div>
            <div className="tv-placeholder-body__copy">
              Select a segment of a generated video to regenerate with a new prompt.
              Requires video timeline with in/out point selection.
            </div>

            {/* Timeline placeholder */}
            <div className="tv-retake-timeline" aria-disabled="true">
              <div className="tv-retake-timeline__track">
                <div className="tv-retake-timeline__handle tv-retake-timeline__handle--start" />
                <div className="tv-retake-timeline__selection" />
                <div className="tv-retake-timeline__handle tv-retake-timeline__handle--end" />
              </div>
              <div className="tv-retake-timeline__labels">
                <span>0:00</span>
                <span>--:--</span>
              </div>
            </div>

            <textarea
              className="tv-textarea tv-textarea--compact"
              placeholder="Retake prompt for selected segment..."
              disabled
              rows={2}
            />

            <button className="tv-btn tv-btn--primary" disabled>
              Retake Segment
            </button>
          </div>
          <span className="tv-badge tv-badge--ghost">Coming Soon</span>
        </div>
      </div>
    </div>
  );
}
