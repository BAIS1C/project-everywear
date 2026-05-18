/**
 * LockedFeatureCard — Canonical "Coming Soon" component for all applets.
 *
 * Replaces ad-hoc disabled states, greyed tabs, and raw "Coming Soon" text
 * with a consistent visual treatment across the entire Everywear ecosystem.
 *
 * Uses EWDS tokens only; zero hardcoded colors.
 */

import React from 'react';

export type FeatureProgress = 'planned' | 'in-development' | 'beta' | 'coming-soon';
export type FeatureTier = 'pro' | 'creator-studio' | 'free';

export interface LockedFeatureCardProps {
  title: string;
  description: string;
  icon?: string;
  tier?: FeatureTier;
  progress?: FeatureProgress;
  learnMoreHref?: string;
  className?: string;
}

const PROGRESS_LABELS: Record<FeatureProgress, string> = {
  'planned': 'Planned',
  'in-development': 'In Development',
  'beta': 'Beta',
  'coming-soon': 'Coming Soon',
};

const TIER_LABELS: Record<FeatureTier, string> = {
  'pro': 'Requires Pro',
  'creator-studio': 'Requires Creator Studio',
  'free': 'Free Tier',
};

export function LockedFeatureCard({
  title,
  description,
  icon,
  tier,
  progress = 'coming-soon',
  learnMoreHref,
  className,
}: LockedFeatureCardProps) {
  return (
    <div
      className={`lfc-card ${className ?? ''}`}
      style={{ pointerEvents: 'none', opacity: 0.7 }}
    >
      {/* Top row: icon + title + tier badge */}
      <div className="lfc-card__header">
        {icon && <span className="lfc-card__icon">{icon}</span>}
        <span className="lfc-card__title">{title}</span>
        {tier && tier !== 'free' && (
          <span className="lfc-card__tier">
            <span className="lfc-card__lock">{'\u{1F512}'}</span>
            {TIER_LABELS[tier]}
          </span>
        )}
      </div>

      {/* Description */}
      <p className="lfc-card__desc">{description}</p>

      {/* Bottom row: status pill + learn more */}
      <div className="lfc-card__footer">
        <span className={`lfc-card__status lfc-card__status--${progress}`}>
          {PROGRESS_LABELS[progress]}
        </span>
        {learnMoreHref && (
          <a
            className="lfc-card__link"
            href={learnMoreHref}
            target="_blank"
            rel="noopener noreferrer"
            style={{ pointerEvents: 'auto' }}
          >
            Learn more {'→'}
          </a>
        )}
      </div>
    </div>
  );
}
