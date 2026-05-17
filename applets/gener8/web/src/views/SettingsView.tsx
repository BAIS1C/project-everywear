/**
 * SettingsView — appearance (skin/accent) + account + engine settings.
 *
 * Ported from S3 Studio's SettingsModal, promoted to a full view.
 * Uses @everywear/ewds ThemeContext for skin/accent switching.
 * Phase 3.3: appearance section live. Account + engine sections stubbed.
 */
import React from 'react';
import { useTheme } from '@everywear/ewds';
import { useAuth } from '../context/AuthContext';

export default function SettingsView() {
  const { skin, setSkin, skins, accent, setAccent, accents } = useTheme();
  const { user, tier } = useAuth();

  return (
    <div className="flex flex-col h-full p-6 gap-8 max-w-2xl mx-auto">
      <h1 className="font-display text-2xl tracking-wide text-s3-text-primary">
        Settings
      </h1>

      {/* Appearance */}
      <section className="flex flex-col gap-4">
        <h2 className="ew-eyebrow">Appearance</h2>

        {/* Skin selector */}
        <div className="flex flex-col gap-2">
          <span className="ew-field-label">Skin</span>
          <div className="ew-skin-toggle">
            {skins.map((s) => (
              <button
                key={s.id}
                data-active={skin === s.id}
                onClick={() => setSkin(s.id)}
                title={s.description}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        {/* Accent selector */}
        <div className="flex flex-col gap-2">
          <span className="ew-field-label">Accent</span>
          <div className="flex gap-2">
            {accents.map((a) => (
              <button
                key={a.id}
                onClick={() => setAccent(a.id)}
                className={`
                  ew-chip
                  ${accent === a.id ? 'ew-chip--on' : ''}
                `}
                title={a.description}
              >
                {a.label}
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* Account (stub) */}
      <section className="flex flex-col gap-4">
        <h2 className="ew-eyebrow">Account</h2>
        <div className="p-4 bg-s3-card border border-s3-border rounded-lg">
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 rounded-full bg-accent-500/20 flex items-center justify-center">
              <span className="text-accent-500 font-display text-sm">
                {user?.username?.[0]?.toUpperCase() ?? '?'}
              </span>
            </div>
            <div>
              <div className="text-sm font-medium">{user?.username ?? 'Not signed in'}</div>
              <div className="ew-small">{user?.email ?? ''}</div>
            </div>
            <div className="ml-auto">
              <span className="ew-badge ew-badge--success">
                <span className="ew-badge-dot" />
                {tier.toUpperCase().replace('_', ' ')}
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* Engine (stub) */}
      <section className="flex flex-col gap-4">
        <h2 className="ew-eyebrow">Engine</h2>
        <p className="ew-small">
          Engine configuration and model management will be available here.
          The Everywear shell handles GPU detection, VRAM scheduling, and
          model provisioning for all applets.
        </p>
      </section>
    </div>
  );
}
