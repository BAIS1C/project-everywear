import { useState, useRef, useEffect } from 'react';
import { type AppletEntry } from '../lib/transport';

interface Props {
  applet: AppletEntry;
  onClose: () => void;
}

/**
 * HeadlessAppletView: mounts a headless applet's frontend inside the shell.
 *
 * Instead of spawning a separate Tauri WebviewWindow, headless applets
 * (those with frontend_port but no separate window chrome) render inline
 * via an iframe pointing to http://127.0.0.1:{frontend_port}{frontend_route}.
 *
 * This gives the shell full control over the applet lifecycle while the
 * applet frontend remains a standard Vite dev server or built static site.
 */
export function HeadlessAppletView({ applet, onClose }: Props) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const port = applet.frontend_port;
  const route = applet.frontend_route || '';
  const url = port ? `http://127.0.0.1:${port}${route}` : applet.launch_url ?? null;
  const isRemoteUrl = !!url
    && /^https?:\/\//i.test(url)
    && !url.startsWith('http://127.0.0.1')
    && !url.startsWith('http://localhost');

  useEffect(() => {
    if (!url) {
      setError('No frontend port configured for this applet');
      setLoading(false);
      return;
    }
    if (isRemoteUrl) {
      setLoading(false);
      setError(null);
      return;
    }

    // Poll until the dev server is ready (max 15 seconds)
    let cancelled = false;
    let attempts = 0;
    const maxAttempts = 30;

    const check = async () => {
      while (!cancelled && attempts < maxAttempts) {
        try {
          await fetch(url, { mode: 'no-cors' });
          if (!cancelled) {
            setLoading(false);
            setError(null);
          }
          return;
        } catch {
          attempts++;
          await new Promise((r) => setTimeout(r, 500));
        }
      }
      if (!cancelled) {
        setLoading(false);
        setError(`Frontend not responding on port ${port} after 15s`);
      }
    };

    check();
    return () => { cancelled = true; };
  }, [url, port, isRemoteUrl]);

  const handleReload = () => {
    if (iframeRef.current) {
      iframeRef.current.src = iframeRef.current.src;
    }
  };

  if (!url) {
    return (
      <div className="hav-panel">
        <div className="hav-error">
          This applet has no frontend port configured.
        </div>
      </div>
    );
  }

  return (
    <div className="hav-panel">
      <div className="hav-toolbar">
        <button className="hav-toolbar__back" onClick={onClose}>
          &#8592; Back to Launcher
        </button>
        <span className="hav-toolbar__name">{applet.name}</span>
        <span className="hav-toolbar__port">:{port}</span>
        <div className="hav-toolbar__actions">
          <button className="hav-toolbar__btn" onClick={handleReload} title="Reload">
            &#8635;
          </button>
          <button className="hav-toolbar__btn hav-toolbar__btn--close" onClick={onClose} title="Close">
            &#10005;
          </button>
        </div>
      </div>

      <div className="hav-content">
        {loading && (
          <div className="hav-loading">
            <div className="hav-loading__spinner" />
            <span>Waiting for {applet.name} frontend...</span>
          </div>
        )}
        {error && (
          <div className="hav-error">
            <p>{error}</p>
            <button className="ew-btn ew-btn--sm" onClick={() => { setLoading(true); setError(null); }}>
              Retry
            </button>
          </div>
        )}
        {!loading && !error && (
          <iframe
            ref={iframeRef}
            src={url}
            className="hav-iframe"
            title={applet.name}
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
            referrerPolicy="strict-origin-when-cross-origin"
          />
        )}
      </div>
    </div>
  );
}
