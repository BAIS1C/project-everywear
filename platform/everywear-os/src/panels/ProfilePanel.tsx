import { useEffect, useState, useCallback } from 'react';
import { getProfile, updateProfile, type UserProfile, type ProfileUpdate } from '../lib/transport';
import { useAuth } from '../shell/AuthContext';

const TIER_LABELS: Record<string, string> = {
  demo: 'Demo',
  gener8: 'Gener8',
  gener8_pro: 'Gener8 Pro',
  creator_studio: 'Creator Studio',
};

const formatDate = (value?: string | null) => {
  if (!value) return '-';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '-' : date.toLocaleDateString();
};

export function ProfilePanel() {
  const { user: authUser, signOut } = useAuth();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<ProfileUpdate>({});
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    getProfile().then((p) => {
      setProfile(p);
      setForm({
        display_name: p.display_name,
        alias: p.alias || '',
        email: p.email || '',
        bio: p.bio || '',
      });
    });
  }, []);

  const handleSave = useCallback(async () => {
    const update = authUser?.email ? { ...form, email: undefined } : form;
    const updated = await updateProfile(update);
    setProfile(updated);
    setEditing(false);
  }, [authUser?.email, form]);

  const handleSignOut = useCallback(async () => {
    setSigningOut(true);
    try {
      await signOut();
    } finally {
      setSigningOut(false);
    }
  }, [signOut]);

  if (!profile) return <div className="ew-text-muted">Loading profile...</div>;

  const displayProfile: UserProfile = {
    ...profile,
    id: authUser?.id || profile.id,
    display_name: authUser?.displayName || profile.display_name,
    alias: authUser?.rawUsername || authUser?.handle || profile.alias || null,
    email: authUser?.email || profile.email,
  };
  const everywearId = authUser?.everywearId
    || (displayProfile.alias ? `${displayProfile.alias}@everywear.id` : null);
  const tierLabel = TIER_LABELS[authUser?.tier || 'demo'] || authUser?.tier || 'Demo';
  const subscription = authUser?.subscription;
  const hasConnectedAccounts = !!displayProfile.discourse_session_valid || !!displayProfile.wallet_connected;
  const initials = displayProfile.display_name
    .split(' ')
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className="ew-profile-panel">
      <div className="ew-profile-panel__header">
        <div className="ew-profile-panel__avatar-large">{initials}</div>
        <div>
          <h2 style={{ fontFamily: 'var(--ew-font-display)', fontSize: 22 }}>
            {displayProfile.display_name}
          </h2>
          {displayProfile.alias && (
            <div style={{ color: 'var(--ew-text-muted)', fontSize: 14, marginTop: 4 }}>
              @{displayProfile.alias}
            </div>
          )}
        </div>
      </div>

      <div className="ew-section">
        <div className="ew-section__title">Identity</div>
        <div className="ew-field">
          <label className="ew-field__label">Everywear ID</label>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
            <code style={{ fontSize: 14, color: everywearId ? 'var(--ew-text)' : 'var(--ew-text-faint)' }}>
              {everywearId || 'Not set'}
            </code>
            {everywearId && (
              <span style={{ fontSize: 11, color: 'var(--ew-text-faint)' }}>
                immutable
              </span>
            )}
          </div>
        </div>
        <div className="ew-field">
          <label className="ew-field__label">Display Name</label>
          {editing ? (
            <input
              className="ew-field__input"
              value={form.display_name || ''}
              onChange={(e) => setForm({ ...form, display_name: e.target.value })}
            />
          ) : (
            <div style={{ fontSize: 14 }}>{displayProfile.display_name}</div>
          )}
        </div>
        <div className="ew-field">
          <label className="ew-field__label">Alias</label>
          {editing ? (
            <input
              className="ew-field__input"
              value={form.alias || ''}
              onChange={(e) => setForm({ ...form, alias: e.target.value })}
              placeholder="e.g., somo_kasane"
            />
          ) : (
            <div style={{ fontSize: 14, color: displayProfile.alias ? 'var(--ew-text)' : 'var(--ew-text-faint)' }}>
              {displayProfile.alias || 'Not set'}
            </div>
          )}
        </div>
        <div className="ew-field">
          <label className="ew-field__label">Email</label>
          {editing ? (
            <input
              className="ew-field__input"
              type="email"
              value={authUser?.email || form.email || ''}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              readOnly={!!authUser?.email}
            />
          ) : (
            <div style={{ fontSize: 14, color: displayProfile.email ? 'var(--ew-text)' : 'var(--ew-text-faint)' }}>
              {displayProfile.email || 'Not set'}
            </div>
          )}
        </div>
        <div className="ew-field">
          <label className="ew-field__label">Bio</label>
          {editing ? (
            <textarea
              className="ew-field__input"
              rows={3}
              value={form.bio || ''}
              onChange={(e) => setForm({ ...form, bio: e.target.value })}
              style={{ resize: 'vertical' }}
            />
          ) : (
            <div style={{ fontSize: 14, color: profile.bio ? 'var(--ew-text)' : 'var(--ew-text-faint)' }}>
              {profile.bio || 'No bio yet'}
            </div>
          )}
        </div>

        {editing ? (
          <div style={{ display: 'flex', gap: 12 }}>
            <button className="ew-btn" onClick={handleSave}>Save</button>
            <button className="ew-btn ew-btn--ghost" onClick={() => setEditing(false)}>Cancel</button>
          </div>
        ) : (
          <button className="ew-btn ew-btn--ghost" onClick={() => setEditing(true)}>Edit Profile</button>
        )}
      </div>

      {hasConnectedAccounts && (
      <div className="ew-section">
        <div className="ew-section__title">Connected Accounts</div>
        {displayProfile.discourse_session_valid && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: displayProfile.wallet_connected ? 12 : 0 }}>
          <span style={{ fontSize: 14 }}>Discourse Forum</span>
          <span style={{ fontSize: 13, color: 'var(--ew-success)' }}>
            @{displayProfile.discourse_username}
          </span>
        </div>
        )}
        {displayProfile.wallet_connected && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 14 }}>Strands Chain Wallet</span>
          <span style={{
            fontSize: 13,
            fontFamily: 'var(--ew-font-mono)',
            color: 'var(--ew-primary)',
          }}>
            {`${displayProfile.wallet_address?.slice(0, 8)}...${displayProfile.wallet_address?.slice(-6)}`}
          </span>
        </div>
        )}
      </div>
      )}

      <div className="ew-section">
        <div className="ew-section__title">Subscription</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 16 }}>
          <div className="ew-field" style={{ marginBottom: 0 }}>
            <label className="ew-field__label">Tier</label>
            <div style={{ fontSize: 14, color: 'var(--ew-primary)', fontWeight: 700 }}>
              {tierLabel}
            </div>
          </div>
          <div className="ew-field" style={{ marginBottom: 0 }}>
            <label className="ew-field__label">Status</label>
            <div style={{ fontSize: 14 }}>
              {subscription?.status || (authUser?.tier === 'demo' ? 'demo' : 'active')}
            </div>
          </div>
          <div className="ew-field" style={{ marginBottom: 0 }}>
            <label className="ew-field__label">Provider</label>
            <div style={{ fontSize: 14, color: subscription?.provider ? 'var(--ew-text)' : 'var(--ew-text-faint)' }}>
              {subscription?.provider || '-'}
            </div>
          </div>
          <div className="ew-field" style={{ marginBottom: 0 }}>
            <label className="ew-field__label">Next Billing</label>
            <div style={{ fontSize: 14, color: subscription?.current_period_end ? 'var(--ew-text)' : 'var(--ew-text-faint)' }}>
              {formatDate(subscription?.current_period_end)}
            </div>
          </div>
        </div>
      </div>

      <div className="ew-section">
        <div className="ew-section__title">Session</div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16 }}>
          <div>
            <div style={{ fontSize: 14, color: 'var(--ew-text)' }}>
              {displayProfile.email || 'Local profile'}
            </div>
            <div style={{ fontSize: 12, color: 'var(--ew-text-faint)', marginTop: 4 }}>
              Sign out clears the saved 30-day profile on this device.
            </div>
          </div>
          <button
            className="ew-btn ew-btn--ghost"
            onClick={handleSignOut}
            disabled={signingOut}
          >
            {signingOut ? 'Signing Out...' : 'Sign Out'}
          </button>
        </div>
      </div>
    </div>
  );
}
