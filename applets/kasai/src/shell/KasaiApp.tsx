/**
 * KasaiApp — Root shell for the Kasai applet inside Everywear OS.
 *
 * Unlike Kasai-Local (standalone Tauri binary with its own window chrome),
 * this version renders directly inside the Everywear OS Window component.
 * No custom titlebar, no traffic lights; those come from the shell.
 *
 * Mounts KasaiCore which is the portable three-pane agent hub.
 */

import { useState } from 'react';
import { KasaiCore } from './KasaiCore';
import { MyMaitSettings } from './MyMaitSettings';

export function KasaiApp() {
  const [view, setView] = useState<'hub' | 'settings'>('hub');

  return (
    <div className="mm-app-root ew">
      <div className="mm-app-toolbar ew-v2-bevel">
        <div className="mm-app-title">
          <span>My Mait</span>
          <b>{view === 'hub' ? 'Agent Hub' : 'Settings'}</b>
        </div>
        <div className="mm-app-tabs ew-tabs ew-v2-recessed" role="tablist" aria-label="My Mait views">
          <button
            type="button"
            role="tab"
            aria-selected={view === 'hub'}
            className={`ew-tab ${view === 'hub' ? 'ew-tab--active active' : ''}`}
            onClick={() => setView('hub')}
          >
            Hub
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={view === 'settings'}
            className={`ew-tab ${view === 'settings' ? 'ew-tab--active active' : ''}`}
            onClick={() => setView('settings')}
          >
            Settings
          </button>
        </div>
      </div>
      <div className="mm-app-body">
        {view === 'hub' ? <KasaiCore /> : <MyMaitSettings />}
      </div>
    </div>
  );
}
