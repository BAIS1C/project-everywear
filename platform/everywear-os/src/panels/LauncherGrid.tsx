import { useEffect, useMemo, useState } from 'react';
import { listApplets, launchApplet, resolveAppletStatus, type AppletEntry } from '../lib/transport';
import { useAuth } from '../shell/AuthContext';

/** Icon glyph map */
function iconGlyph(id: string): string {
  const map: Record<string, string> = {
    '1magen': '1M',
    's3studio': 'S3',
    'strands-game': 'SN',
    'kasai': 'MM',
    'layeru-osint': 'LU',
    '3nvizen': '3N',
    'mymories': 'MY',
    'gener8': 'G8',
    'vid': 'VD',
    'ai-director': 'AD',
  };
  return map[id] || id.slice(0, 2).toUpperCase();
}

// Desktop layout: folder grouping
interface FolderItem {
  type: 'applet';
  applet: AppletEntry;
}

interface Folder {
  type: 'folder';
  id: string;
  name: string;
  icon: string;
  children: (FolderItem | Folder)[];
}

type DesktopItem = FolderItem | Folder;

/** Arrange flat applet list into folder hierarchy */
function buildDesktopLayout(applets: AppletEntry[]): DesktopItem[] {
  const byId = new Map(applets.map((a) => [a.id, a]));

  const s3Children: (FolderItem | Folder)[] = [];

  const s3web = byId.get('s3studio');
  if (s3web) s3Children.push({ type: 'applet', applet: s3web });

  const gener8 = byId.get('gener8');
  if (gener8) s3Children.push({ type: 'applet', applet: gener8 });
  const vid = byId.get('vid');
  if (vid) s3Children.push({ type: 'applet', applet: vid });
  const director = byId.get('ai-director');
  if (director) s3Children.push({ type: 'applet', applet: director });

  const creatorChildren: FolderItem[] = [];
  const onemagen = byId.get('1magen');
  if (onemagen) creatorChildren.push({ type: 'applet', applet: onemagen });
  const envizen = byId.get('3nvizen');
  if (envizen) creatorChildren.push({ type: 'applet', applet: envizen });

  if (creatorChildren.length > 0) {
    s3Children.push({
      type: 'folder',
      id: 'creator-studio',
      name: 'Creator Studio',
      icon: 'CS',
      children: creatorChildren,
    });
  }

  const items: DesktopItem[] = [];

  if (s3Children.length > 0) {
    items.push({
      type: 'folder',
      id: 's3-studio',
      name: 'S3 Studio',
      icon: 'S3',
      children: s3Children,
    });
  }

  const grouped = new Set(['s3studio', 'gener8', 'vid', 'ai-director', '1magen', '3nvizen']);
  for (const applet of applets) {
    if (!grouped.has(applet.id)) {
      items.push({ type: 'applet', applet });
    }
  }

  return items;
}

function AppletCard({ applet, onLaunch }: { applet: AppletEntry; onLaunch: (a: AppletEntry) => void }) {
  return (
    <div
      className={`ew-applet-card ${applet.status === 'Locked' ? 'ew-applet-card--locked' : ''}`}
      onClick={() => onLaunch(applet)}
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
  );
}

function FolderAccordion({
  folder,
  onLaunch,
  expandedFolders,
  toggleFolder,
}: {
  folder: Folder;
  onLaunch: (a: AppletEntry) => void;
  expandedFolders: Set<string>;
  toggleFolder: (id: string) => void;
}) {
  const isOpen = expandedFolders.has(folder.id);

  return (
    <div className="ew-folder">
      <div
        className={`ew-folder__header ${isOpen ? 'ew-folder__header--open' : ''}`}
        onClick={() => toggleFolder(folder.id)}
      >
        <div className="ew-folder__icon">{folder.icon}</div>
        <div className="ew-folder__name">{folder.name}</div>
        <span className="ew-folder__count">{folder.children.length}</span>
        <span className="ew-folder__chevron">{isOpen ? '▴' : '▾'}</span>
      </div>
      {isOpen && (
        <div className="ew-folder__children">
          {folder.children.map((child) =>
            child.type === 'applet' ? (
              <AppletCard key={child.applet.id} applet={child.applet} onLaunch={onLaunch} />
            ) : (
              <FolderAccordion
                key={child.id}
                folder={child}
                onLaunch={onLaunch}
                expandedFolders={expandedFolders}
                toggleFolder={toggleFolder}
              />
            )
          )}
        </div>
      )}
    </div>
  );
}

export function LauncherGrid({ onEmbedApplet }: { onEmbedApplet?: (applet: AppletEntry) => void }) {
  const [applets, setApplets] = useState<AppletEntry[]>([]);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const { user } = useAuth();

  useEffect(() => {
    listApplets().then(setApplets).catch(console.error);
  }, []);

  // Derive lock state from the owner's live entitlement flags rather than the
  // registry's presentation `status`, so the badge matches the launch gate.
  // (WIKI.md v1.1.16)
  const gatedApplets = useMemo(
    () => applets.map((applet) => ({
      ...applet,
      status: resolveAppletStatus(applet, user?.entitlements ?? user?.tiers),
    })),
    [applets, user?.entitlements, user?.tiers],
  );

  const toggleFolder = (id: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleLaunch = async (applet: AppletEntry) => {
    if (applet.status === 'Locked') return;

    if (applet.launch_kind === 'FrontendInline' && onEmbedApplet) {
      onEmbedApplet(applet);
      return;
    }

    try {
      await launchApplet(applet.id);
    } catch (err) {
      console.error('Launch failed:', err);
    }
  };

  const desktopItems = buildDesktopLayout(gatedApplets);

  return (
    <div className="ew-launcher">
      <div className="ew-launcher__header">
        <h1 className="ew-launcher__title">Desktop</h1>
        <p className="ew-launcher__subtitle">
          {applets.length} applets available
        </p>
      </div>
      <div className="ew-launcher__grid">
        {desktopItems.map((item) =>
          item.type === 'applet' ? (
            <AppletCard key={item.applet.id} applet={item.applet} onLaunch={handleLaunch} />
          ) : (
            <FolderAccordion
              key={item.id}
              folder={item}
              onLaunch={handleLaunch}
              expandedFolders={expandedFolders}
              toggleFolder={toggleFolder}
            />
          )
        )}
      </div>
    </div>
  );
}
