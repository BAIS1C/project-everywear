/**
 * EmptyState — token-driven empty surface with primary/secondary CTAs.
 *
 * T7, COWORK-BRIEF v3 §7 (2026-05-02 SGT). Empty states were dead-ends
 * before this; now every empty surface that uses this primitive gets:
 *   - Optional sprite glyph (#g-* / #i-*) tinted via --ew-text-faint
 *   - Mono-caps eyebrow
 *   - Display-font title
 *   - Optional body
 *   - Up to two CTAs (primary uses .ew-btn--primary, secondary ghost)
 *
 * All styling reads from EWDS tokens — works in classic, refined, and
 * terminal without conditional CSS.
 *
 * Migrated out of @ts-nocheck on 2026-05-27 (seed file for Track C
 * Gener8 web type-bridge migration). Local types (CTA, EmptyStateProps)
 * already covered the surface; the pragma was port-time blanket noise.
 */
import React from 'react';

type CTA = {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  /** Hover tooltip — useful for "why is this disabled?" explainer. */
  tooltip?: string;
};

export interface EmptyStateProps {
  /** Sprite id from index.html (e.g. 'g-library', 'i-music', 'i-heart').
   *  Pass without the leading '#'. Omit to skip the glyph block. */
  glyph?: string;
  /** Optional small mono caps line above the title. */
  eyebrow?: string;
  title: string;
  body?: React.ReactNode;
  primary?: CTA;
  secondary?: CTA;
  /** Additional class names on the outer container. */
  className?: string;
  /** Use a smaller .ew-icon (line glyph) instead of the chunky filled
   *  .ew-glyph for the icon block. Defaults to false (use .ew-glyph). */
  inlineIcon?: boolean;
}

export function EmptyState({
  glyph,
  eyebrow,
  title,
  body,
  primary,
  secondary,
  className = '',
  inlineIcon = false,
}: EmptyStateProps) {
  return (
    <div className={`ew-empty ${className}`.trim()}>
      {glyph && (
        inlineIcon ? (
          <span
            className="ew-icon ew-icon--32"
            aria-hidden="true"
            style={{ color: 'var(--ew-text-faint)' }}
          >
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
              <use href={`#${glyph}`} />
            </svg>
          </span>
        ) : (
          <span
            className="ew-glyph ew-glyph--64"
            aria-hidden="true"
            style={{ color: 'var(--ew-text-faint)' }}
          >
            <svg width="64" height="64" viewBox="0 0 32 32">
              <use href={`#${glyph}`} />
            </svg>
          </span>
        )
      )}
      {eyebrow && <span className="ew-eyebrow">{eyebrow}</span>}
      <h3 className="ew-empty__title">{title}</h3>
      {body && <p className="ew-empty__body">{body}</p>}
      {(primary || secondary) && (
        <div className="ew-empty__actions">
          {primary && (
            <button
              type="button"
              className="ew-btn ew-btn--primary"
              onClick={primary.onClick}
              disabled={primary.disabled}
              title={primary.tooltip}
            >
              {primary.label}
            </button>
          )}
          {secondary && (
            <button
              type="button"
              className="ew-btn ew-btn--ghost"
              onClick={secondary.onClick}
              disabled={secondary.disabled}
              title={secondary.tooltip}
            >
              {secondary.label}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export default EmptyState;
