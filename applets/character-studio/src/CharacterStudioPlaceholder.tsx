/**
 * CharacterStudioPlaceholder — Structural shell for Character Studio.
 *
 * Renders a "coming soon" view with feature preview cards.
 * Uses EWDS tokens only; zero hardcoded colors.
 *
 * CODEX_NEEDED: Replace this entire file with real CharacterStudioCore
 * once the applet is ported from the external Strands repo.
 */

import React from 'react';

export interface CharacterStudioPlaceholderProps {
  skin?: string;
  mode?: string;
}

const PLANNED_FEATURES = [
  {
    icon: '\u{1F9D1}',
    title: 'Blank Customizer',
    desc: 'Full-body avatar editor with procedural mesh generation.',
  },
  {
    icon: '\u{1F3A8}',
    title: 'Skin & Texture',
    desc: 'AI-assisted texture painting with style transfer.',
  },
  {
    icon: '\u{1F4A0}',
    title: 'Animation Rig',
    desc: 'Auto-rigging with Mixamo-compatible skeleton export.',
  },
  {
    icon: '\u{1F9E9}',
    title: 'Blank Export Kit',
    desc: 'Export-ready Blank manifests, Look Shards, and runtime-safe avatar files.',
  },
];

export default function CharacterStudioPlaceholder({ skin }: CharacterStudioPlaceholderProps) {
  return (
    <div className="csp-root" data-skin={skin}>
      <div className="csp-hero ew-card">
        <div className="csp-hero__icon">{'\u{1F9D1}'}</div>
        <h2 className="csp-hero__title">Character Studio</h2>
        <p className="csp-hero__sub">
          Blank avatar creation and customization.
          <br />
          Coming soon to Everywear OS.
        </p>
        <span className="csp-badge ew-v2-recessed">Port Scaffold</span>
      </div>

      <div className="csp-features">
        {PLANNED_FEATURES.map((f) => (
          <div key={f.title} className="csp-feature-card ew-card">
            <span className="csp-feature-card__icon">{f.icon}</span>
            <div className="csp-feature-card__text">
              <div className="csp-feature-card__title">{f.title}</div>
              <div className="csp-feature-card__desc">{f.desc}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
