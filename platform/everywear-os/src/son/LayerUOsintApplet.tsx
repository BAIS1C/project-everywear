import { useEffect, useState } from 'react';
import { layerUWorldviewUrl } from './sonBridge';
import { useLayerUOsint } from './useLayerUOsint';
import './styles/layer-u-osint.css';

type LayerUTab = 'map' | 'feeds' | 'sources';
const UI_STORAGE_KEY = 'everywear.layeru-osint.ui.v1';

function formatSweepTime(value: string | null | undefined) {
  if (!value) return 'pending';
  return new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function restoreTab(): LayerUTab {
  if (typeof window === 'undefined') return 'map';
  try {
    const value = window.localStorage.getItem(UI_STORAGE_KEY);
    return value === 'feeds' || value === 'sources' || value === 'map' ? value : 'map';
  } catch {
    return 'map';
  }
}

export function LayerUOsintApplet() {
  const [tab, setTab] = useState<LayerUTab>(() => restoreTab());
  const [iframeKey, setIframeKey] = useState(0);
  const { snapshot, isRefreshing, refresh, pullLive } = useLayerUOsint();
  const { posture, sourceRollup, feeds, health } = snapshot;

  const statusLabel = snapshot.online
    ? health?.sweepInProgress ? 'sweeping' : 'online'
    : 'offline';

  // Report real readiness to the shell so the window chrome cannot show
  // READY while the SON dependency is offline. (Handoff 2026-06-07.)
  useEffect(() => {
    window.dispatchEvent(new CustomEvent('everywear:applet-status', {
      detail: { appletId: 'layeru-osint', status: snapshot.online ? 'online' : 'offline' },
    }));
  }, [snapshot.online]);

  useEffect(() => {
    try {
      window.localStorage.setItem(UI_STORAGE_KEY, tab);
    } catch {
      // Tab restore is convenience state only.
    }
  }, [tab]);

  const handlePullLive = async () => {
    try {
      await pullLive();
    } catch {
      await refresh();
    }
  };

  return (
    <div className="lu-shell">
      <aside className="lu-rail" aria-label="Layer U OSINT controls">
        <header className="lu-rail__header">
          <span className={`lu-status lu-status--${statusLabel}`}>{statusLabel}</span>
          <h2>Layer U OSINT</h2>
          <p>Free-tier OSINT information layer powered by Project SON.</p>
        </header>

        <div className="lu-tabs" role="tablist" aria-label="Layer U views">
          {(['map', 'feeds', 'sources'] as LayerUTab[]).map((item) => (
            <button
              key={item}
              type="button"
              className={`lu-tabs__button ${tab === item ? 'lu-tabs__button--active' : ''}`}
              aria-selected={tab === item}
              onClick={() => setTab(item)}
            >
              {item}
            </button>
          ))}
        </div>

        <section className="lu-panel" aria-label="Live posture">
          <div className="lu-panel__label">Posture</div>
          <div className="lu-posture">
            <strong>{posture.direction}</strong>
            <span>{posture.totalChanges ?? '--'} changes</span>
            <span>{posture.criticalChanges} critical</span>
          </div>
          <div className="lu-markets">
            <span>VIX {posture.vix}</span>
            <span>WTI {posture.wti}</span>
            <span>Brent {posture.brent}</span>
          </div>
        </section>

        {tab === 'feeds' && (
          <section className="lu-panel lu-panel--feeds" aria-label="RSS and video feeds">
            <div className="lu-panel__label">RSS + video</div>
            {feeds.length > 0 ? feeds.map((item) => (
              <a key={`${item.source}-${item.title}`} className="lu-feed" href={item.url} target="_blank" rel="noreferrer">
                <span>{item.source}</span>
                <strong>{item.title}</strong>
              </a>
            )) : (
              <p className="lu-empty">No served feeds yet.</p>
            )}
          </section>
        )}

        {tab === 'sources' && (
          <section className="lu-panel" aria-label="Source health">
            <div className="lu-panel__label">Sources</div>
            <div className="lu-source-grid">
              <span><strong>{sourceRollup.ok}</strong> ok</span>
              <span><strong>{sourceRollup.failed}</strong> failed</span>
              <span><strong>{sourceRollup.total}</strong> total</span>
            </div>
            <p className="lu-empty">Last sweep {formatSweepTime(health?.lastSweep)}.</p>
          </section>
        )}

        {tab === 'map' && (
          <section className="lu-panel" aria-label="Map layer notes">
            <div className="lu-panel__label">Worldview</div>
            <p className="lu-empty">The Project SON worldview, map overlays, feeds, and source posture stay inside this window.</p>
          </section>
        )}

        <footer className="lu-actions">
          <button type="button" onClick={refresh} disabled={isRefreshing}>Refresh</button>
          <button type="button" onClick={handlePullLive} disabled={isRefreshing || health?.sweepInProgress}>Pull live</button>
          <button type="button" onClick={() => setIframeKey((value) => value + 1)}>Reload map</button>
        </footer>
      </aside>

      <main className="lu-worldview" aria-label="Layer U OSINT worldview">
        {!snapshot.online && (
          <div className="lu-worldview__offline">
            <h3>Project SON service offline</h3>
            <p>Start the local SON server on port 3117 to serve the worldview and live OSINT panes.</p>
            {snapshot.restoredFromSession && (
              <p>Restored last session. Live data resumes after SON reconnects.</p>
            )}
            {snapshot.lastOnlineAt && (
              <p>Last live session {formatSweepTime(snapshot.lastOnlineAt)}.</p>
            )}
            <button type="button" onClick={refresh} disabled={isRefreshing}>
              {isRefreshing ? 'Checking...' : 'Retry connection'}
            </button>
          </div>
        )}
        <iframe
          key={iframeKey}
          title="Layer U OSINT Worldview"
          src={layerUWorldviewUrl()}
          className={`lu-worldview__frame ${snapshot.online ? '' : 'lu-worldview__frame--offline'}`}
        />
      </main>
    </div>
  );
}
