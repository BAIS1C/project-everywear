import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  getTransport,
  type MyMaitModelGroup,
  type MyMaitResidencyPolicy,
  type MyMaitSettingsState,
} from '../lib/transport';
import { MmSettingRow, MmSettingsSection } from './MmSettingRow';
import { MyMaitVramBadge } from './MyMaitVramBadge';

interface SettingsError {
  title: string;
  cause: string;
  detail?: string;
}

function gb(valueMb: number): string {
  return `${(valueMb / 1024).toFixed(valueMb >= 10_240 ? 0 : 1)} GB`;
}

function bytes(value?: number | null): string {
  if (!value) return 'Unknown';
  return `${(value / 1_073_741_824).toFixed(1)} GB`;
}

function statusLabel(value: string): string {
  return value.replaceAll('_', ' ').toUpperCase();
}

function settingError(title: string, err: unknown): SettingsError {
  const detail = err instanceof Error ? err.message : typeof err === 'string' ? err : undefined;
  return {
    title,
    cause: 'Likely cause: the My Mait transport is offline or the host rejected the settings command.',
    detail,
  };
}

function SettingsErrorBox({ error, onRetry }: { error: SettingsError; onRetry: () => void }) {
  return (
    <div className="mm-settings-error">
      <div className="mm-settings-error-copy">
        <b>{error.title}</b>
        <p>{error.cause}</p>
        {error.detail && <p>Detail: {error.detail}</p>}
      </div>
      <button type="button" className="ew-btn ew-btn--primary ew-btn--sm" onClick={onRetry}>
        Retry
      </button>
    </div>
  );
}

export function MyMaitSettings() {
  const transport = getTransport();
  const [settings, setSettings] = useState<MyMaitSettingsState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<SettingsError | null>(null);
  const [saving, setSaving] = useState(false);
  const [policy, setPolicy] = useState<MyMaitResidencyPolicy>('auto');

  const refresh = useCallback(async () => {
    try {
      setError(null);
      const next = await transport.invoke<MyMaitSettingsState>('get_my_mait_settings');
      setSettings(next);
      setPolicy(next.residency.policy);
    } catch (err) {
      setError(settingError('Loading My Mait settings failed.', err));
    } finally {
      setLoading(false);
    }
  }, [transport]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const resolutionByKey = useMemo(() => {
    const map = new Map<string, string>();
    settings?.model_resolution.forEach(result => {
      map.set(result.everywear_model_id, statusLabel(result.status));
    });
    return map;
  }, [settings]);

  const selectedGroup = useMemo(() => {
    if (!settings) return null;
    const preferred = settings.model_preference.preferred_group_id;
    return (
      settings.model_groups.find(group => preferred && group.id === preferred)
      || settings.model_groups.find(group => group.recommended)
      || settings.model_groups[0]
      || null
    );
  }, [settings]);

  const saveModelGroup = useCallback(async (group: MyMaitModelGroup) => {
    if (saving) return;
    setSaving(true);
    try {
      const next = await transport.invoke<MyMaitSettingsState>('set_my_mait_model_preference', {
        input: {
          group_id: group.id,
          model_keys: group.models.map(model => model.key),
        },
      });
      setSettings(next);
      setPolicy(next.residency.policy);
    } catch (err) {
      setError(settingError('Saving the model group failed.', err));
    } finally {
      setSaving(false);
    }
  }, [saving, transport]);

  const clearModelGroup = useCallback(async () => {
    if (saving) return;
    setSaving(true);
    try {
      const next = await transport.invoke<MyMaitSettingsState>('clear_my_mait_model_preference');
      setSettings(next);
      setPolicy(next.residency.policy);
    } catch (err) {
      setError(settingError('Clearing the model override failed.', err));
    } finally {
      setSaving(false);
    }
  }, [saving, transport]);

  const savePolicy = useCallback(async () => {
    if (saving) return;
    setSaving(true);
    try {
      const next = await transport.invoke<MyMaitSettingsState>('set_my_mait_residency_policy', {
        // TODO: Add max_vram_mb to this input when the Max VRAM control lands; its label must render the live value, e.g. "Max VRAM (18 GB)".
        input: { policy },
      });
      setSettings(next);
      setPolicy(next.residency.policy);
    } catch (err) {
      setError(settingError('Saving the residency policy failed.', err));
    } finally {
      setSaving(false);
    }
  }, [policy, saving, transport]);

  const savePresence = useCallback(async (presence_tier: string) => {
    if (saving) return;
    setSaving(true);
    try {
      const next = await transport.invoke<MyMaitSettingsState>('set_my_mait_companion_state', {
        input: { presence_tier },
      });
      setSettings(next);
      setPolicy(next.residency.policy);
    } catch (err) {
      setError(settingError('Saving the presence setting failed.', err));
    } finally {
      setSaving(false);
    }
  }, [saving, transport]);

  if (loading) {
    return <div className="mm-settings-empty">Loading My Mait settings</div>;
  }

  if (!settings) {
    return (
      <div className="mm-settings-empty">
        <b>Settings unavailable</b>
        <p>My Mait could not load the settings surface from the local Everywear host.</p>
        {error && <SettingsErrorBox error={error} onRetry={refresh} />}
      </div>
    );
  }

  const residencyDescription = 'This decides what happens to your Mait model when you close the Everywear window.';
  const policyChanged = policy !== settings.residency.policy;

  return (
    <div className="mm-settings-root">
      <header className="mm-settings-head">
        <div>
          <div className="ah-right-kicker">MY MAIT</div>
          <h1>Settings</h1>
          <p className="mm-settings-save-contract">
            Toggles and presence save instantly; model group and residency policy require their explicit button.
          </p>
        </div>
        <MyMaitVramBadge status={settings.vram_status} />
      </header>

      {error && <SettingsErrorBox error={error} onRetry={refresh} />}

      <div className="mm-settings-grid">
        <MmSettingsSection
          title="Models"
          description="Choose the local model group your Mait should prefer when the shell has the hardware and files ready."
        >
          <MmSettingRow
            label="Current model intent"
            description="Auto lets Everywear pick the best fit; manual keeps the group you explicitly choose."
            layout="row"
          >
            <div className="mm-model-summary">
              <span>Mode</span>
              <b>{settings.model_preference.selection_mode.toUpperCase()}</b>
              <span>Selected</span>
              <b>{selectedGroup?.label || 'Auto'}</b>
            </div>
          </MmSettingRow>

          <div className="mm-model-groups">
            {settings.model_groups.map(group => {
              const active = selectedGroup?.id === group.id;
              return (
                <article key={group.id} className={`mm-model-group ew-v2-recessed ${active ? 'active' : ''}`}>
                  <div className="mm-model-group-head">
                    <div>
                      <h3>{group.label}</h3>
                      <span>{gb(group.min_vram_mb)} floor / {gb(group.total_vram_mb)} reserved</span>
                    </div>
                    {group.recommended && <b className="ew-badge ew-badge--warm">Recommended</b>}
                  </div>
                  <p className="mm-control-description">
                    Use this group when you want your Mait to prefer these local models on the next explicit save.
                  </p>
                  <div className="mm-model-list">
                    {group.models.map(model => (
                      <div key={model.key} className="mm-model-row">
                        <span>{model.role}</span>
                        <b>{model.filename || model.key}</b>
                        <em>{resolutionByKey.get(model.key) || 'UNRESOLVED'}</em>
                        <small>{gb(model.vram_mb)} / {bytes(model.size_bytes)}</small>
                      </div>
                    ))}
                  </div>
                  <button
                    type="button"
                    className="ew-btn ew-btn--sm"
                    disabled={saving || active || !group.fits_total_vram}
                    onClick={() => saveModelGroup(group)}
                  >
                    {active ? 'Selected' : group.fits_total_vram ? 'Use Group' : 'VRAM Blocked'}
                  </button>
                </article>
              );
            })}
          </div>

          <MmSettingRow
            label="Model override"
            description="Clear the manual group and let Everywear choose from hardware, installed files, and shell policy again."
            layout="row"
          >
            <button type="button" className="ew-btn ew-btn--ghost ew-btn--sm" disabled={saving} onClick={clearModelGroup}>
              Clear Override
            </button>
          </MmSettingRow>
        </MmSettingsSection>

        <MmSettingsSection
          title="Residency"
          description={residencyDescription}
        >
          <MmSettingRow
            label="Close-window policy"
            description="Pick whether your Mait's model unloads, stays warm, or asks you when the window closes."
            htmlFor="mm-residency"
            layout="row"
          >
            <div className="mm-policy-control">
              <select id="mm-residency" className="ew-select" value={policy} onChange={event => setPolicy(event.target.value as MyMaitResidencyPolicy)}>
                <option value="auto">Auto</option>
                <option value="unload_on_close">Unload on close</option>
                <option value="keep_hot">Keep hot</option>
                <option value="ask_on_close">Ask on close</option>
              </select>
              <button type="button" className="ew-btn ew-btn--primary ew-btn--sm" disabled={saving || !policyChanged} onClick={savePolicy}>
                Save Policy
              </button>
            </div>
          </MmSettingRow>

          <div className="mm-residency-line">
            <span>Resident now</span>
            <b>{settings.vram_status.my_mait_resident ? 'YES' : 'NO'}</b>
          </div>

          {policy === 'keep_hot' && (
            <div className="mm-residency-details">
              <div className="mm-residency-budget">
                <span>Budget used</span>
                <b>{gb(settings.vram_status.budget_allocated_mb)}</b>
                <span>Budget free</span>
                <b>{gb(settings.vram_status.budget_free_mb)}</b>
                <span>Keep-hot state</span>
                <b>{settings.residency.can_keep_hot ? 'AVAILABLE' : 'BLOCKED'}</b>
              </div>
              {settings.residency.guardrail && <div className="mm-settings-note">{settings.residency.guardrail}</div>}
            </div>
          )}

          {policy === 'ask_on_close' && (
            <div className="mm-settings-note">
              Everywear will ask before closing whether your Mait should stay ready or release the model.
            </div>
          )}
        </MmSettingsSection>

        <MmSettingsSection
          title="Memory / Vault"
          description="Shows where this settings surface is talking and which private store backs Mait memory."
        >
          <MmSettingRow
            label="Vault connection"
            description="Local IPC means the desktop host is active; preview means the browser mock is serving safe sample data."
            layout="row"
          >
            <div className="mm-model-summary">
              <span>Transport</span>
              <b>{transport.mode === 'tauri' ? 'LOCAL IPC' : 'PREVIEW'}</b>
              <span>Backing store</span>
              <b>Everywear Vault</b>
            </div>
          </MmSettingRow>
        </MmSettingsSection>

        <MmSettingsSection
          title="Personality"
          description="Displays the starter companion personality state currently owned by the shell."
        >
          <MmSettingRow
            label="Starter Mait"
            description="Your base Mait is present even before premium trait or skill shards are attached."
            layout="row"
          >
            <div className="mm-model-summary">
              <span>Starter</span>
              <b>Default Mait</b>
              <span>Voice</span>
              <b>{settings.companion.voice_enabled ? 'ON' : 'OFF'}</b>
            </div>
          </MmSettingRow>
        </MmSettingsSection>

        <MmSettingsSection
          title="Pet / Avatar"
          description="Controls how visible your Mait is in the shell and lists imported companion manifests."
        >
          <MmSettingRow
            label="Presence"
            description="These chips save instantly and decide whether your Mait hides, appears as a portrait, or lives as a desktop widget."
            layout="stack"
          >
            <div className="mm-presence-actions">
              {['hidden', 'portrait', 'desktop_widget'].map(tier => (
                <button
                  key={tier}
                  type="button"
                  className={`ew-chip ${settings.companion.presence_tier === tier ? 'ew-chip--on active' : ''}`}
                  disabled={saving}
                  onClick={() => savePresence(tier)}
                >
                  {tier.replaceAll('_', ' ')}
                </button>
              ))}
            </div>
          </MmSettingRow>

          <MmSettingRow
            label="Active manifest"
            description="Avatar manifests come from Character Studio imports; no import means your Mait uses the starter presence."
            layout="stack"
          >
            <div className="mm-model-summary">
              <span>Presence</span>
              <b>{settings.companion.presence_tier.replaceAll('_', ' ').toUpperCase()}</b>
              <span>Active</span>
              <b>{settings.companion.active_manifest_id || 'NONE'}</b>
            </div>
            <div className="mm-manifest-list">
              {settings.manifests.length === 0 ? (
                <p className="mm-manifest-empty">Import a Mait avatar from Character Studio to see it here.</p>
              ) : settings.manifests.map(manifest => (
                <div key={manifest.id} className="mm-manifest-row">
                  <b>{manifest.display_name}</b>
                  <span>{manifest.shard_count} shards</span>
                </div>
              ))}
            </div>
          </MmSettingRow>
        </MmSettingsSection>

        <MmSettingsSection
          title="Safety"
          description="Confirms the current approval posture before your Mait takes action outside chat."
        >
          <MmSettingRow
            label="Action safety"
            description="My Mait asks before acting and keeps local audit receipts for sensitive commands."
            layout="row"
          >
            <div className="mm-model-summary">
              <span>Approval</span>
              <b>ASK BEFORE ACTING</b>
              <span>Audit</span>
              <b>LOCAL</b>
            </div>
          </MmSettingRow>
        </MmSettingsSection>

        <MmSettingsSection
          title="System"
          description="Shows the shell-owned VRAM numbers My Mait can see but does not control directly."
        >
          <MmSettingRow
            label="VRAM status"
            description="Everywear owns GPU budgeting; this readout shows whether another applet is already using the model budget."
            layout="row"
          >
            <div className="mm-model-summary">
              <span>Total VRAM</span>
              <b>{gb(settings.vram_status.total_mb)}</b>
              <span>Free VRAM</span>
              <b>{gb(settings.vram_status.nvml_free_mb ?? settings.vram_status.free_mb)}</b>
              <span>Active applet</span>
              <b>{settings.vram_status.active_applet || 'NONE'}</b>
            </div>
          </MmSettingRow>
        </MmSettingsSection>
      </div>
    </div>
  );
}
