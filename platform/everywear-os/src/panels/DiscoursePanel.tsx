import { useRef } from 'react';

/**
 * DiscoursePanel: embeds the Strands Nation community forum as a web applet.
 *
 * The forum lives at community.strandsnation.xyz (Discourse instance).
 * No IPC transport needed; it renders as a full website in an iframe,
 * same pattern as the Game Codex (game.strandsnation.xyz).
 *
 * Source project: C:\Users\MAG MSI\Project Strands\Discourse Forum
 */

const COMMUNITY_URL = 'https://community.strandsnation.xyz';

export function DiscoursePanel() {
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const handleReload = () => {
    if (iframeRef.current) {
      iframeRef.current.src = iframeRef.current.src;
    }
  };

  const handleOpenExternal = () => {
    window.open(COMMUNITY_URL, '_blank');
  };

  return (
    <div className="dc-panel">
      <div className="dc-webview-toolbar">
        <span className="dc-webview-toolbar__title">Strands Nation Community</span>
        <span className="dc-webview-toolbar__url">{COMMUNITY_URL}</span>
        <div className="dc-webview-toolbar__actions">
          <button className="dc-webview-toolbar__btn" onClick={handleReload} title="Reload">
            &#8635;
          </button>
          <button className="dc-webview-toolbar__btn" onClick={handleOpenExternal} title="Open in browser">
            &#8599;
          </button>
        </div>
      </div>
      <iframe
        ref={iframeRef}
        src={COMMUNITY_URL}
        className="dc-webview-iframe"
        title="Strands Nation Community"
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
      />
    </div>
  );
}
