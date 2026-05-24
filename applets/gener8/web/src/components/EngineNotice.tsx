// @ts-nocheck
import React, { useState, useEffect, useCallback } from 'react';
import { getApiBase } from '@/services/api';

/**
 * EngineNotice — shows a dismissible modal when the local engine
 * (localhost:3001) is unreachable from the hosted UI. Common cause:
 * ad-blockers or browser extensions blocking cross-origin localhost
 * requests.
 *
 * Only activates in "hosted UI" mode (when getApiBase returns the
 * localhost URL). Checks on mount and retries every 10s. Dismissible,
 * with a "don't show again" session flag so it doesn't nag after the
 * user acknowledges.
 *
 * EWDS port (T2, COWORK-BRIEF v3 §2, 2026-05-02 SGT):
 *   - .ew-dialog-backdrop + .ew-dialog .ew-dialog--md (chamfer in
 *     classic/refined, 0px in terminal).
 *   - Lightning emoji replaced with #i-zap sprite tinted --ew-warning.
 *   - All hex literals removed; everything reads from EWDS tokens so
 *     the alert reskins across all three skins.
 */

const ENGINE_NOTICE_DISMISSED_KEY = '__s3_engine_notice_dismissed';

export function EngineNotice() {
  const [visible, setVisible] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [retrying, setRetrying] = useState(false);

  const apiBase = getApiBase();
  const isHostedMode = apiBase.includes('localhost:3001') || apiBase.includes('127.0.0.1:3001');

  const checkEngine = useCallback(async () => {
    if (!isHostedMode) return;
    try {
      const resp = await fetch(`${apiBase}/api/health`, {
        method: 'GET',
        signal: AbortSignal.timeout(4000),
      });
      if (resp.ok) {
        setVisible(false);
        return;
      }
    } catch {
      // unreachable
    }
    if (!sessionStorage.getItem(ENGINE_NOTICE_DISMISSED_KEY)) {
      setVisible(true);
    }
  }, [apiBase, isHostedMode]);

  useEffect(() => {
    if (!isHostedMode) return;
    const initialTimeout = setTimeout(checkEngine, 2000);
    const interval = setInterval(checkEngine, 10_000);
    return () => { clearTimeout(initialTimeout); clearInterval(interval); };
  }, [isHostedMode, checkEngine]);

  const handleDismiss = () => {
    setVisible(false);
    setDismissed(true);
    sessionStorage.setItem(ENGINE_NOTICE_DISMISSED_KEY, '1');
  };

  const handleRetry = async () => {
    setRetrying(true);
    await checkEngine();
    setRetrying(false);
  };

  if (!visible || dismissed) return null;

  return (
    <div className="ew-dialog-backdrop" role="presentation">
      <div
        className="ew-dialog ew-dialog--md"
        role="dialog"
        aria-labelledby="engine-notice-title"
        aria-describedby="engine-notice-desc"
      >
        <header className="ew-dialog__header">
          <span
            className="ew-icon ew-icon--24"
            style={{ color: 'var(--ew-warning)', flexShrink: 0, marginTop: 2 }}
            aria-hidden="true"
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6}><use href="#i-zap" /></svg>
          </span>
          <div style={{ minWidth: 0 }}>
            <h2 id="engine-notice-title" className="ew-dialog__title">Engine not detected</h2>
            <span className="ew-eyebrow" style={{ display: 'block', marginTop: 4 }}>
              S³ Gener8 can&apos;t reach your local engine
            </span>
          </div>
        </header>

        <div className="ew-dialog__body" id="engine-notice-desc">
          <p style={{ marginTop: 0 }}>
            The S³ Studio UI needs to connect to the Gener8 engine running on your computer
            (<code className="ew-code">localhost:3001</code>). If you&apos;re seeing this,
            the connection is being blocked.
          </p>

          <div className="ew-dialog__steplist">
            <span className="ew-eyebrow">Common fixes</span>
            <ol>
              <li>
                <strong>Disable your ad-blocker</strong> for this site. uBlock Origin,
                AdGuard, and Brave Shields can block localhost requests from hosted pages.
              </li>
              <li>
                <strong>Try Incognito / Private mode</strong> with extensions disabled.
              </li>
              <li>
                <strong>Make sure S³ Gener8 is running.</strong> The desktop app must be
                open before using the web studio.
              </li>
            </ol>
          </div>
        </div>

        <footer className="ew-dialog__footer">
          <button
            type="button"
            className="ew-btn ew-btn--ghost"
            onClick={handleDismiss}
          >
            Dismiss
          </button>
          <button
            type="button"
            className="ew-btn ew-btn--primary"
            onClick={handleRetry}
            disabled={retrying}
          >
            {retrying ? 'Checking…' : 'Retry connection'}
          </button>
        </footer>
      </div>
    </div>
  );
}
