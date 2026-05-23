/**
 * Gener8 Sidebar — navigation between Create / Library / Settings.
 * Ported from S3 Studio's left navigation, stripped of shell chrome.
 * Uses EWDS classes (.ew-list-item, .ew-eyebrow) for skin-aware styling.
 */
import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Library, Music, PanelLeft, PanelLeftClose, Settings, SlidersHorizontal } from 'lucide-react';

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
}

const NAV_ITEMS = [
  { path: '/',         label: 'Create',   icon: Music },
  { path: '/daw',      label: 'DAW',      icon: SlidersHorizontal },
  { path: '/library',  label: 'Library',  icon: Library },
  { path: '/settings', label: 'Settings', icon: Settings },
] as const;

export function Sidebar({ collapsed, onToggle }: SidebarProps) {
  const location = useLocation();
  const navigate = useNavigate();

  return (
    <aside
      className={`
        flex flex-col h-full bg-s3-sidebar border-r border-s3-border
        transition-[width] duration-200 ease-out
        ${collapsed ? 'w-[52px]' : 'w-[200px]'}
      `}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 h-10 border-b border-s3-border">
        {!collapsed && (
          <span className="ew-eyebrow text-accent-500">GENER8</span>
        )}
        <button
          onClick={onToggle}
          className="p-1 text-s3-text-muted hover:text-s3-text-primary transition-colors"
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? <PanelLeft size={16} /> : <PanelLeftClose size={16} />}
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 py-2">
        {NAV_ITEMS.map(({ path, label, icon: Icon }) => {
          const active = location.pathname === path;
          return (
            <button
              key={path}
              onClick={() => navigate(path)}
              className={`
                w-full flex items-center gap-3 px-4 py-2 text-left text-[13px]
                transition-colors duration-100
                ${active
                  ? 'text-accent-500 bg-accent-50 border-l-2 border-accent-500'
                  : 'text-s3-text-muted hover:text-s3-text-primary hover:bg-s3-hover border-l-2 border-transparent'
                }
              `}
            >
              <Icon size={16} />
              {!collapsed && <span>{label}</span>}
            </button>
          );
        })}
      </nav>
    </aside>
  );
}
