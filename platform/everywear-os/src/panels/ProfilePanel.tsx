import { useEffect, useState, useCallback } from 'react';
import { getProfile, updateProfile, type UserProfile, type ProfileUpdate } from '../lib/transport';

export function ProfilePanel() {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<ProfileUpdate>({});

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
    const updated = await updateProfile(form);
    setProfile(updated);
    setEditing(false);
  }, [form]);

  if (!profile) return <div className="ew-text-muted">Loading profile...</div>;

  const initials = profile.display_name
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
            {profile.display_name}
          </h2>
          {profile.alias && (
            <div style={{ color: 'var(--ew-text-muted)', fontSize: 14, marginTop: 4 }}>
              @{profile.alias}
            </div>
          )}
        </div>
      </div>

      <div className="ew-section">
        <div className="ew-section__title">Identity</div>
        <div className="ew-field">
          <label className="ew-field__label">Display Name</label>
          {editing ? (
            <input
              className="ew-field__input"
              value={form.display_name || ''}
              onChange={(e) => setForm({ ...form, display_name: e.target.value })}
            />
          ) : (
            <div style={{ fontSize: 14 }}>{profile.display_name}</div>
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
            <div style={{ fontSize: 14, color: profile.alias ? 'var(--ew-text)' : 'var(--ew-text-faint)' }}>
              {profile.alias || 'Not set'}
            </div>
          )}
        </div>
        <div className="ew-field">
          <label className="ew-field__label">Email</label>
          {editing ? (
            <input
              className="ew-field__input"
              type="email"
              value={form.email || ''}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
          ) : (
            <div style={{ fontSize: 14, color: profile.email ? 'var(--ew-text)' : 'var(--ew-text-faint)' }}>
              {profile.email || 'Not set'}
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

      <div className="ew-section">
        <div className="ew-section__title">Connected Accounts</div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <span style={{ fontSize: 14 }}>Discourse Forum</span>
          <span style={{ fontSize: 13, color: profile.discourse_session_valid ? 'var(--ew-success)' : 'var(--ew-text-faint)' }}>
            {profile.discourse_session_valid ? `@${profile.discourse_username}` : 'Not connected'}
          </span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 14 }}>Strands Chain Wallet</span>
          <span style={{
            fontSize: 13,
            fontFamily: 'var(--ew-font-mono)',
            color: profile.wallet_connected ? 'var(--ew-primary)' : 'var(--ew-text-faint)',
          }}>
            {profile.wallet_connected
              ? `${profile.wallet_address?.slice(0, 8)}...${profile.wallet_address?.slice(-6)}`
              : 'Not connected'}
          </span>
        </div>
      </div>
    </div>
  );
}
