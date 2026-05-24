// @ts-nocheck
/* ═══════════════════════════════════════════════════════════════════
   TauriOnly — gate web-vs-Tauri access for the studio routes
   ───────────────────────────────────────────────────────────────────
   Authored 2026-05-04 SGT per Sean's call: s3studio.xyz on the open
   web is marketing-only. Login / signup / the Everywear shell exist
   ONLY inside the Tauri studio window (the Gener8 launcher's webview).

   When the SPA is loaded from a regular browser (Chrome, Safari, etc.)
   without the launcher running, hitting /login, /signup, /app, or
   /upgrade/* now renders this gate instead of the live page. The gate
   directs the user to download the Gener8 launcher.

   Detection is identical to the WindowFrame Tauri-context check —
   `window.__TAURI_INTERNALS__ != null || window.__TAURI__ != null`.
   Inside the Tauri studio window both globals are set, the gate
   passes through, the real page renders.

   This is a UX gate, not a security gate. The marketing build is
   public, so the gated routes are still served — they just render the
   download CTA instead of the real chrome. Any actual server-side
   auth (Supabase) still applies once the user is in the launcher.
   ═══════════════════════════════════════════════════════════════════ */

import React, { type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Mail, Lock } from 'lucide-react';

const HEADING: React.CSSProperties = { fontFamily: 'var(--ew-font-display)' };

const isTauriContext = (): boolean =>
  typeof window !== 'undefined' &&
  ((window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ != null ||
    (window as unknown as { __TAURI__?: unknown }).__TAURI__ != null ||
    // 2026-05-13 SGT — allow localhost dev access (vite dev server).
    // Not a security gate; just a UX gate. Local dev bypasses.
    window.location.hostname === 'localhost');

interface TauriOnlyProps {
  children: ReactNode;
  /** Optional override copy, falls back to a generic "open in launcher" message. */
  title?: string;
  message?: string;
}

export const TauriOnly: React.FC<TauriOnlyProps> = ({
  children,
  title = 'Beta Phase 1 is complete',
  message = 'S³ Studio Beta Phase 1 has wrapped. We\'re acting on tester feedback to make the next phase even better. Sign up for the waitlist and we\'ll notify you when the next beta opens.',
}) => {
  if (isTauriContext()) {
    return <>{children}</>;
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center px-4 py-12"
      style={{ background: 'var(--ew-bg)' }}
    >
      <div className="w-full max-w-md">
        <Link to="/" className="block text-center mb-8">
          <span
            className="text-3xl"
            style={{ ...HEADING, color: 'var(--ew-primary)' }}
          >
            S<sup>3</sup>
          </span>
        </Link>

        <div className="ew-card p-8">
          <div
            className="flex items-center gap-2 mb-4"
            style={{ color: 'var(--ew-primary)' }}
          >
            <Lock size={18} />
            <span
              className="text-xs font-semibold uppercase"
              style={{ letterSpacing: '0.18em' }}
            >
              Launcher only
            </span>
          </div>

          <h1
            className="text-2xl mb-3"
            style={{ ...HEADING, color: 'var(--ew-text)' }}
          >
            {title}
          </h1>

          <p
            className="text-sm leading-relaxed mb-6"
            style={{ color: 'var(--ew-text-muted)' }}
          >
            {message}
          </p>

          <Link
            to="/signup"
            className="ew-btn ew-btn--primary w-full justify-center"
          >
            <Mail size={16} />
            <span className="ml-2">Join the Waitlist</span>
          </Link>

          <p
            className="text-xs mt-4 text-center"
            style={{ color: 'var(--ew-text-muted)' }}
          >
            Next beta phase coming soon.{' '}
            <Link
              to="/"
              className="underline"
              style={{ color: 'var(--ew-primary)' }}
            >
              Back to home
            </Link>
          </p>
        </div>

        <div
          className="text-center mt-6 text-[11px]"
          style={{ color: 'var(--ew-text-muted)' }}
        >
          Were you part of Beta Phase 1? Thank you. Your feedback is shaping what comes next.
          We'll be in touch when the next phase opens.
        </div>
      </div>
    </div>
  );
};

export default TauriOnly;
