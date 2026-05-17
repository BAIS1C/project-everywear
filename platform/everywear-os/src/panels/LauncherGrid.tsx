import { useEffect, useState } from 'react';
import { listApplets, launchApplet, type AppletEntry } from '../lib/transport';

/** Icon glyph map: first two letters of applet name as placeholder */
function iconGlyph(id: string): string {
  const map: Record<string, string> = {
    '1magen': '1M',
    's3studio': 'S3',
    'strands-game': 'SN',
    'kasai': 'KS',
    '3nvizen': '3N',
    'mymories': 'MY',
  };
  return map[id] || id.slice(0, 2).toUpperCase();
}

export function LauncherGrid() {
  const [applets, setApplets] = useState<AppletEntry[]>([]);

  useEffect(() => {
    listApplets().then(setApplets).catch(console.error);
  }, []);

  const handleLaunch = async (applet: AppletEntry) => {
    if (applet.status === 'Locked') return;
    try {
      await launchApplet(applet.id);
    } catch (err) {
      console.error('Launch failed:', err);
    }
  };

  return (
    <div className="ew-launcher">
      <div className="ew-launcher__header">
        <h1 className="ew-launcher__title">Applets</h1>
        <p className="ew-launcher__subtitle">
          {applets.length} available
        </p>
      </div>
      <div className="ew-launcher__grid">
        {applets.map((applet) => (
          <div
            key={applet.id}
            className={`ew-applet-card ${applet.status === 'Locked' ? 'ew-applet-card--locked' : ''}`}
            onClick={() => handleLaunch(applet)}
          >
            {applet.status === 'Locked' && (
              <span className="ew-applet-card__lock">&#128274;</span>
            )}
            <div className="ew-applet-card__icon">{iconGlyph(applet.id)}</div>
            <div className="ew-applet-card__name">{applet.name}</div>
            <div className="ew-applet-card__desc">{applet.description}</div>
            <div className="ew-applet-card__tags">
              {applet.tags.slice(0, 3).map((tag) => (
                <span key={tag} className="ew-applet-tag">{tag}</span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
