// @ts-nocheck
import React, { useState } from 'react';
import { Library, Disc, Search, LogIn, LogOut, Sun, Moon, Film, Flame, ChevronLeft, ChevronRight, Zap, AudioLines } from 'lucide-react';
import { View } from '../types';

interface SidebarProps {
  currentView: View;
  onNavigate: (view: View) => void;
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
  user?: { username: string; isAdmin?: boolean; avatar_url?: string } | null;
  onLogin?: () => void;
  onLogout?: () => void;
  onOpenSettings?: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  currentView,
  onNavigate,
  theme,
  onToggleTheme,
  user,
  onLogin,
  onLogout,
  onOpenSettings,
}) => {
  const [expanded, setExpanded] = useState(false);

  const isLocal = typeof window !== 'undefined' && !window.location.pathname.startsWith('/stepstudio') && window.parent === window;

  return (
    <div
      className={`flex flex-col h-full bg-white dark:bg-s3-sidebar border-r border-zinc-200 dark:border-white/5 flex-shrink-0 py-4 z-30 transition-all duration-300 overflow-y-auto scrollbar-hide relative ${
        expanded ? 'w-[200px]' : 'w-[72px]'
      }`}
      onMouseEnter={() => setExpanded(true)}
      onMouseLeave={() => setExpanded(false)}
    >
      {/* Logo + Brand */}
      <div
        className={`flex items-center gap-3 cursor-pointer hover:scale-[1.02] transition-transform overflow-hidden mb-4 ${expanded ? 'px-4' : 'px-3 justify-center'}`}
        onClick={() => onNavigate('create')}
        title="Strands SoundWave"
      >
        <img
          src={typeof window !== 'undefined' && window.location.pathname.startsWith('/stepstudio') ? '/stepstudio/strands-logo.svg' : '/strands-logo.svg'}
          alt="Strands"
          className="w-10 h-10 object-contain flex-shrink-0"
        />
        {expanded && (
          <span className="text-lg font-bold text-black dark:text-white whitespace-nowrap animate-in fade-in duration-200">
            S³ STUDIO
          </span>
        )}
      </div>

      {/* User Profile Card (expanded only) */}
      {user && expanded && (
        <div
          onClick={onOpenSettings}
          className="mx-3 mb-3 px-3 py-2.5 rounded-xl bg-zinc-100 dark:bg-white/5 flex items-center gap-3 cursor-pointer hover:bg-zinc-200 dark:hover:bg-white/10 transition-colors animate-in fade-in duration-200"
        >
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-accent-500 to-purple-600 flex items-center justify-center text-white text-xs font-bold flex-shrink-0 overflow-hidden">
            {user.avatar_url ? (
              <img src={user.avatar_url} alt={user.username} className="w-full h-full object-cover" />
            ) : (
              user.username.charAt(0).toUpperCase()
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-black dark:text-white truncate">{user.username}</div>
            <div className="text-xs text-zinc-500 dark:text-zinc-400 flex items-center gap-1">
              <Zap size={10} className="text-accent-500" /> Infinity Credits
            </div>
          </div>
        </div>
      )}

      {/* Upgrade Button */}
      {expanded ? (
        <div className="mx-3 mb-4">
          <button
            onClick={() => {
              // Link to monetisation / upgrade page
              if (typeof window !== 'undefined') {
                window.open('/upgrade', '_blank');
              }
            }}
            className="w-full px-3 py-2 rounded-xl bg-gradient-to-r from-accent-500 to-purple-600 text-white text-sm font-semibold flex items-center justify-center gap-2 hover:opacity-90 transition-opacity shadow-lg shadow-accent-500/20 animate-in fade-in duration-200"
          >
            <Zap size={14} />
            Upgrade Your Tools
          </button>
        </div>
      ) : (
        <div className="flex justify-center mb-4">
          <button
            onClick={() => {
              if (typeof window !== 'undefined') {
                window.open('/upgrade', '_blank');
              }
            }}
            className="w-10 h-10 rounded-full bg-gradient-to-r from-accent-500 to-purple-600 flex items-center justify-center text-white hover:opacity-90 transition-opacity shadow-lg shadow-accent-500/20"
            title="Upgrade Your Tools"
          >
            <Zap size={18} />
          </button>
        </div>
      )}

      <nav className={`flex-1 flex flex-col gap-1 w-full ${expanded ? 'px-3' : 'px-3'}`}>
        <NavItem icon={<Disc size={22} />} label="Create" active={currentView === 'create'} onClick={() => onNavigate('create')} expanded={expanded} />
        <NavItem icon={<Library size={22} />} label="Library" active={currentView === 'library'} onClick={() => onNavigate('library')} expanded={expanded} />
        <NavItem icon={<Search size={22} />} label="Search" active={currentView === 'search'} onClick={() => onNavigate('search')} expanded={expanded} />

        {/* Videos Library — local use only */}
        {isLocal && (
          <NavItem icon={<Film size={22} />} label="Videos" active={currentView === 'videos'} onClick={() => onNavigate('videos')} expanded={expanded} />
        )}

        {/* Video Studio — local use only */}
        {isLocal && (
          <NavItem icon={<Zap size={22} />} label="Video Studio" active={currentView === 'video-studio'} onClick={() => onNavigate('video-studio')} expanded={expanded} />
        )}

        {/* Style Forge — LoRA training, local only */}
        {isLocal && (
          <NavItem icon={<Flame size={22} />} label="Style Forge" active={currentView === 'style-forge'} onClick={() => onNavigate('style-forge')} expanded={expanded} />
        )}

        {/* DAW — Creator Studio timeline editor, local only */}
        {isLocal && (
          <NavItem icon={<AudioLines size={22} />} label="DAW" active={currentView === 'daw'} onClick={() => onNavigate('daw')} expanded={expanded} />
        )}

        {/* Bottom section */}
        <div className="mt-auto flex flex-col gap-1">
          {/* Theme toggle */}
          {expanded ? (
            <button
              onClick={onToggleTheme}
              className="w-full px-3 py-2.5 rounded-xl hover:bg-zinc-100 dark:hover:bg-white/5 flex items-center gap-3 text-zinc-500 dark:text-zinc-400 hover:text-black dark:hover:text-white transition-colors"
            >
              {theme === 'dark' ? <Sun size={20} /> : <Moon size={20} />}
              <span className="text-sm whitespace-nowrap">{theme === 'dark' ? 'Light Mode' : 'Dark Mode'}</span>
            </button>
          ) : (
            <button
              onClick={onToggleTheme}
              className="w-full aspect-square rounded-xl hover:bg-zinc-100 dark:hover:bg-white/10 flex items-center justify-center text-zinc-500 dark:text-zinc-400 hover:text-black dark:hover:text-white transition-colors"
              title={theme === 'dark' ? 'Light Mode' : 'Dark Mode'}
            >
              {theme === 'dark' ? <Sun size={20} /> : <Moon size={20} />}
            </button>
          )}

          {/* User avatar (collapsed) / Sign out (expanded) */}
          {user ? (
            <>
              {!expanded && (
                <div className="flex justify-center mt-2">
                  <div
                    onClick={onOpenSettings}
                    className="w-8 h-8 rounded-full bg-gradient-to-br from-accent-500 to-purple-600 flex items-center justify-center text-white text-xs font-bold cursor-pointer border border-white/20 hover:scale-110 transition-transform overflow-hidden"
                    title={`${user.username} - Settings`}
                  >
                    {user.avatar_url ? (
                      <img src={user.avatar_url} alt={user.username} className="w-full h-full object-cover" />
                    ) : (
                      user.username.charAt(0).toUpperCase()
                    )}
                  </div>
                </div>
              )}
              {expanded && (
                <button
                  onClick={onLogout}
                  className="w-full px-3 py-2.5 rounded-xl hover:bg-red-500/10 flex items-center gap-3 text-zinc-500 hover:text-red-500 transition-colors"
                >
                  <LogOut size={20} />
                  <span className="text-sm whitespace-nowrap">Sign Out</span>
                </button>
              )}
            </>
          ) : (
            expanded ? (
              <button
                onClick={onLogin}
                className="w-full px-3 py-2.5 rounded-xl hover:bg-zinc-100 dark:hover:bg-white/5 flex items-center gap-3 text-zinc-500 dark:text-zinc-400 hover:text-accent-500 transition-colors"
              >
                <LogIn size={20} />
                <span className="text-sm whitespace-nowrap">Sign In</span>
              </button>
            ) : (
              <button
                onClick={onLogin}
                className="w-full aspect-square rounded-xl hover:bg-zinc-100 dark:hover:bg-white/10 flex items-center justify-center text-zinc-500 dark:text-zinc-400 hover:text-accent-500 transition-colors"
                title="Sign In"
              >
                <LogIn size={20} />
              </button>
            )
          )}
        </div>
      </nav>

      {/* Expand/Collapse toggle button */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="absolute top-1/2 -right-3 w-6 h-6 rounded-full bg-zinc-200 dark:bg-zinc-700 border border-zinc-300 dark:border-zinc-600 flex items-center justify-center text-zinc-500 dark:text-zinc-400 hover:text-black dark:hover:text-white opacity-0 hover:opacity-100 transition-all shadow-sm z-50"
        title={expanded ? 'Collapse' : 'Expand'}
      >
        {expanded ? <ChevronLeft size={14} /> : <ChevronRight size={14} />}
      </button>
    </div>
  );
};

interface NavItemProps {
  icon: React.ReactNode;
  label: string;
  active?: boolean;
  onClick: () => void;
  expanded: boolean;
}

const NavItem: React.FC<NavItemProps> = ({ icon, label, active, onClick, expanded }) => (
  <button
    onClick={onClick}
    className={`
      w-full rounded-xl flex items-center transition-all duration-200 group relative
      ${expanded ? 'px-3 py-2.5 gap-3' : 'aspect-square justify-center'}
      ${active
        ? 'bg-zinc-100 dark:bg-white/10 text-black dark:text-white'
        : 'text-zinc-500 hover:text-black dark:hover:text-white hover:bg-zinc-100 dark:hover:bg-white/5'
      }
    `}
    title={expanded ? undefined : label}
  >
    {active && <div className="absolute left-0 top-1/2 -translate-y-1/2 h-8 w-1 bg-accent-500 rounded-r-full" />}
    <span className="flex-shrink-0">{icon}</span>
    {expanded && (
      <span className="text-sm font-medium whitespace-nowrap animate-in fade-in duration-150">{label}</span>
    )}
  </button>
);
