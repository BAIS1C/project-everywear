import { useState, useEffect } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import {
  getProfile,
  getGpuStatus,
  listModelAssessments,
  type ModelAssessment,
  type UserProfile,
  type SystemGpuState,
} from '../lib/transport';
import { useAuth } from './AuthContext';
import { LauncherGrid } from '../panels/LauncherGrid';
import { ProfilePanel } from '../panels/ProfilePanel';
import { WalletPanel } from '../panels/WalletPanel';
import { GpuPanel } from '../panels/GpuPanel';
import { DiscoursePanel } from '../panels/DiscoursePanel';
import { SettingsPanel } from '../panels/SettingsPanel';

type View = 'launcher' | 'profile' | 'wallet' | 'gpu' | 'community' | 'settings';

const NAV_ITEMS: { id: View; label: string; icon: string }[] = [
  { id: 'launcher', label: 'Applets', icon: '&#9783;' },
  { id: 'profile', label: 'Profile', icon: '&#9673;' },
  { id: 'wallet', label: 'Wallet', icon: '&#9830;' },
  { id: 'community', label: 'Community', icon: '&#9993;' },
  { id: 'gpu', label: 'Hardware', icon: '&#9881;' },
  { id: 'settings', label: 'Settings', icon: '&#9776;' },
];

export function ShellLayout() {
  const [view, setView] = useState<View>('launcher');
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [gpu, setGpu] = useState<SystemGpuState | null>(null);
  const [assessments, setAssessments] = useState<ModelAssessment[]>([]);
  const { user: authUser, tier, signOut } = useAuth();

  useEffect(() => {
    getProfile().then(setProfile).catch(console.error);
    getGpuStatus().then(setGpu).catch(console.error);
    listModelAssessments().then(setAssessments).catch(console.error);
  }, []);

  // Use Everywear ID handle for display, fall back to profile
  const displayName = authUser?.handle || profile?.display_name || 'Loading...';
  const initials = displayName
    .split(' ')
    .map((w: string) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
  const featuredAssessment = assessments.find((item) => item.applet_id === '1magen');
  const assessmentSummary = featuredAssessment?.recommended_group
    ? `${featuredAssessment.applet_name}: ${featuredAssessment.recommended_group}`
    : featuredAssessment
      ? `${featuredAssessment.applet_name}: ${featuredAssessment.status}`
      : null;

  return (
    <>
      {/* Custom titlebar */}
      <div className="ew-titlebar">
        <span className="ew-titlebar__brand">Everywear OS</span>
        <div className="ew-titlebar__controls">
          <button
            className="ew-titlebar__btn"
            onClick={() => getCurrentWindow().minimize()}
            dangerouslySetInnerHTML={{ __html: '&#9472;' }}
          />
          <button
            className="ew-titlebar__btn"
            onClick={() => getCurrentWindow().toggleMaximize()}
            dangerouslySetInnerHTML={{ __html: '&#9633;' }}
          />
          <button
            className="ew-titlebar__btn ew-titlebar__btn--close"
            onClick={() => getCurrentWindow().close()}
            dangerouslySetInnerHTML={{ __html: '&#10005;' }}
          />
        </div>
      </div>

      <div className="ew-shell">
        {/* Sidebar */}
        <div className="ew-sidebar">
          <div className="ew-sidebar__profile" onClick={() => setView('profile')} style={{ cursor: 'pointer' }}>
            <div className="ew-sidebar__avatar">{initials}</div>
            <div className="ew-sidebar__name">{displayName}</div>
            {authUser?.email && <div className="ew-sidebar__alias">{authUser.email}</div>}
            <div className="ew-sidebar__tier-badge" data-tier={tier}>{tier.replace('_', ' ')}</div>
          </div>

          <nav className="ew-sidebar__nav">
            {NAV_ITEMS.map((item) => (
              <div
                key={item.id}
                className={`ew-nav-item ${view === item.id ? 'ew-nav-item--active' : ''}`}
                onClick={() => setView(item.id)}
              >
                <span
                  className="ew-nav-item__icon"
                  dangerouslySetInnerHTML={{ __html: item.icon }}
                  style={{ fontSize: 16 }}
                />
                {item.label}
              </div>
            ))}
          </nav>

          <div className="ew-sidebar__footer">
            <div className="ew-sidebar__gpu">
              <span className={`ew-sidebar__gpu-dot ${gpu?.backend?.type !== 'Cpu' ? '' : 'ew-sidebar__gpu-dot--off'}`} />
              {gpu?.backend?.type === 'Cuda' ? (
                <span>
                  {gpu.primary_gpu?.replace('NVIDIA ', '').replace('GeForce ', '')} &middot;{' '}
                  {gpu.total_free_mb.toLocaleString()} MB free
                </span>
              ) : gpu?.backend?.type === 'Vulkan' ? (
                <span>
                  Vulkan &middot; {gpu.primary_gpu} &middot;{' '}
                  {gpu.total_free_mb.toLocaleString()} MB
                </span>
              ) : (
                <span>CPU-only mode</span>
              )}
            </div>
            {assessmentSummary && (
              <div className="ew-sidebar__assessment">
                <span>{assessmentSummary}</span>
              </div>
            )}
          </div>
        </div>

        {/* Main content */}
        <main className="ew-main">
          {view === 'launcher' && <LauncherGrid />}
          {view === 'profile' && <ProfilePanel />}
          {view === 'wallet' && <WalletPanel />}
          {view === 'gpu' && <GpuPanel />}
          {view === 'community' && <DiscoursePanel />}
          {view === 'settings' && <SettingsPanel />}
        </main>
      </div>
    </>
  );
}
