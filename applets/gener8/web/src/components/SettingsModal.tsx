// @ts-nocheck
import React, { useState, useEffect, useCallback } from 'react';
import { X, User as UserIcon, Palette, Info, Edit3, ExternalLink, Cpu, RefreshCw, AlertCircle, Check } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { EditProfileModal } from './EditProfileModal';
import { engineApi, type ModelInfo, type LMModelInfo } from '../services/api';

// ── SettingsModal ────────────────────────────────────────────────
// Profile · Account · Appearance · Engine · About.
//
// Themed via EWDS:
//   - Modal wrapper uses .ew-card (NOT .ew-dialog) at max-w-2xl. The
//     .ew-dialog primitive hardcodes width:min(480px, 92vw) which
//     squashes the dense Settings/Engine/About sections. .ew-card gives
//     the same chamfer treatment without the width constraint.
//   - All accent and surface colours read through var(--ew-*).
//   - Status pills (Connected / Offline) use --ew-success / --ew-danger.
//   - VRAM-tier colours in the GPU table use the semantic token quartet
//     (success / primary / warning / danger).
//   - Theme toggle (Light/Dark) is the only remaining colour primitive
//     since it represents the runtime light/dark switch, not a brand
//     accent — its active state still reads through --ew-primary.
// ──────────────────────────────────────────────────────────────────

interface SettingsModalProps {
    isOpen: boolean;
    onClose: () => void;
    theme: 'light' | 'dark';
    onToggleTheme: () => void;
    onNavigateToProfile?: (username: string) => void;
}

const HEADING: React.CSSProperties = { fontFamily: 'var(--ew-font-display)' };

export const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose, theme, onToggleTheme, onNavigateToProfile }) => {
    const { user, token } = useAuth();
    const [isEditProfileOpen, setIsEditProfileOpen] = useState(false);

    // Engine state
    const [ditModels, setDitModels] = useState<ModelInfo[]>([]);
    const [lmModels, setLmModels] = useState<LMModelInfo[]>([]);
    const [selectedDit, setSelectedDit] = useState<string>('');
    const [selectedLm, setSelectedLm] = useState<string>('');
    const [loadedDit, setLoadedDit] = useState<string>('');
    const [loadedLm, setLoadedLm] = useState<string>('');
    const [engineStatus, setEngineStatus] = useState<'idle' | 'loading' | 'switching' | 'error'>('idle');
    const [engineMessage, setEngineMessage] = useState<string>('');
    const [engineConnected, setEngineConnected] = useState<boolean | null>(null);

    const fetchModelInventory = useCallback(async () => {
        if (!token) return;
        try {
            setEngineStatus('loading');
            const inventory = await engineApi.models(token);
            setDitModels(inventory.models || []);
            setLmModels(inventory.lm_models || []);
            const currentDit = inventory.models?.find(m => m.is_loaded)?.name || inventory.default_model || '';
            const currentLm = inventory.lm_models?.find(m => m.is_loaded)?.name || inventory.loaded_lm_model || '';
            setLoadedDit(currentDit);
            setLoadedLm(currentLm);
            setSelectedDit(currentDit);
            setSelectedLm(currentLm);
            setEngineConnected(true);
            setEngineStatus('idle');
            setEngineMessage('');
        } catch (err) {
            setEngineConnected(false);
            setEngineStatus('error');
            setEngineMessage('Cannot reach local music engine');
        }
    }, [token]);

    useEffect(() => {
        if (isOpen && token) {
            fetchModelInventory();
        }
    }, [isOpen, token, fetchModelInventory]);

    const handleModelSwitch = async () => {
        if (!token) return;
        const ditChanged = selectedDit !== loadedDit;
        const lmChanged = selectedLm !== loadedLm;
        if (!ditChanged && !lmChanged) return;

        try {
            setEngineStatus('switching');
            setEngineMessage('Switching models — this may take a moment...');
            const params: { model?: string; init_llm?: boolean; lm_model_path?: string } = {};
            if (ditChanged) params.model = selectedDit;
            if (lmChanged) {
                params.init_llm = true;
                params.lm_model_path = selectedLm;
            }
            const result = await engineApi.init(params, token);
            setLoadedDit(result.loaded_model || selectedDit);
            setLoadedLm(result.loaded_lm_model || selectedLm);
            setEngineStatus('idle');
            setEngineMessage('Models switched successfully');
            setTimeout(() => setEngineMessage(''), 3000);
        } catch (err) {
            setEngineStatus('error');
            setEngineMessage(`Switch failed: ${(err as Error).message}`);
        }
    };

    const handleReinitialize = async () => {
        if (!token) return;
        try {
            setEngineStatus('switching');
            setEngineMessage('Reinitializing service...');
            await engineApi.reinitialize(token);
            setEngineMessage('Service reinitialized — refreshing inventory...');
            await fetchModelInventory();
            setEngineMessage('Service reinitialized successfully');
            setTimeout(() => setEngineMessage(''), 3000);
        } catch (err) {
            setEngineStatus('error');
            setEngineMessage(`Reinitialize failed: ${(err as Error).message}`);
        }
    };

    const hasModelChanges = selectedDit !== loadedDit || selectedLm !== loadedLm;

    if (!isOpen || !user) {
        if (isEditProfileOpen && user) {
            return (
                <EditProfileModal
                    isOpen={isEditProfileOpen}
                    onClose={() => setIsEditProfileOpen(false)}
                    onSaved={() => setIsEditProfileOpen(false)}
                />
            );
        }
        return null;
    }

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            style={{ background: 'rgba(0,0,0,0.5)' }}
            onClick={onClose}
        >
            <div
                className="ew-card max-w-4xl w-full max-h-[90vh] overflow-y-auto"
                style={{ background: 'var(--ew-surface)', padding: 0 }}
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div
                    className="flex items-center justify-between p-6 border-b"
                    style={{ borderColor: 'var(--ew-border)' }}
                >
                    <h2
                        className="text-2xl font-bold"
                        style={{ ...HEADING, color: 'var(--ew-text)' }}
                    >
                        Settings
                    </h2>
                    <button
                        onClick={onClose}
                        className="ew-btn ew-btn--ghost ew-btn--sm"
                        aria-label="Close"
                    >
                        <X size={16} />
                    </button>
                </div>

                <div className="p-6 space-y-8">
                    {/* User Profile Section */}
                    <div className="ew-card p-6">
                        <div className="flex items-center gap-4">
                            <div
                                className="w-16 h-16 rounded-full flex items-center justify-center text-2xl font-bold overflow-hidden"
                                style={{
                                    background: 'var(--ew-primary)',
                                    color: 'var(--ew-primary-fg)',
                                }}
                            >
                                {user.avatar_url ? (
                                    <img src={user.avatar_url} alt={user.username} className="w-full h-full object-cover" />
                                ) : (
                                    user.username[0].toUpperCase()
                                )}
                            </div>
                            <div className="flex-1">
                                <h3
                                    className="text-xl font-bold"
                                    style={{ color: 'var(--ew-text)' }}
                                >
                                    {user.username}
                                </h3>
                                <p
                                    className="text-xs mt-1"
                                    style={{ color: 'var(--ew-text-faint)' }}
                                >
                                    Member since {new Date(user.createdAt).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
                                </p>
                            </div>
                            <div className="flex gap-2">
                                <button
                                    onClick={() => {
                                        onClose();
                                        setIsEditProfileOpen(true);
                                    }}
                                    className="ew-btn ew-btn--primary ew-btn--sm"
                                >
                                    <Edit3 size={14} />
                                    Edit Profile
                                </button>
                                <button
                                    onClick={() => {
                                        onClose();
                                        onNavigateToProfile?.(user.raw_username || user.username.replace(/@everywear\.id$/, ''));
                                    }}
                                    className="ew-btn ew-btn--ghost ew-btn--sm"
                                >
                                    <ExternalLink size={14} />
                                    View Profile
                                </button>
                            </div>
                        </div>
                    </div>

                    {/* Account Section */}
                    <div className="space-y-4">
                        <div
                            className="flex items-center gap-2"
                            style={{ color: 'var(--ew-text)' }}
                        >
                            <UserIcon size={20} />
                            <h3 className="font-semibold" style={HEADING}>Account</h3>
                        </div>
                        <div className="pl-7 space-y-3">
                            <div>
                                <label
                                    className="text-sm"
                                    style={{ color: 'var(--ew-text-muted)' }}
                                >
                                    Username
                                </label>
                                <p className="font-medium" style={{ color: 'var(--ew-text)' }}>
                                    {user.username}
                                </p>
                            </div>
                        </div>
                    </div>

                    {/* Theme Section */}
                    <div className="space-y-4">
                        <div
                            className="flex items-center gap-2"
                            style={{ color: 'var(--ew-text)' }}
                        >
                            <Palette size={20} />
                            <h3 className="font-semibold" style={HEADING}>Appearance</h3>
                        </div>
                        <div className="pl-7 space-y-3">
                            <div className="flex gap-3">
                                <button
                                    onClick={theme === 'dark' ? onToggleTheme : undefined}
                                    className={`ew-btn flex-1 ${theme === 'light' ? 'ew-btn--primary' : 'ew-btn--ghost'}`}
                                >
                                    Light
                                </button>
                                <button
                                    onClick={theme === 'light' ? onToggleTheme : undefined}
                                    className={`ew-btn flex-1 ${theme === 'dark' ? 'ew-btn--primary' : 'ew-btn--ghost'}`}
                                >
                                    Dark
                                </button>
                            </div>
                        </div>
                    </div>

                    {/* Engine Section */}
                    <div className="space-y-4">
                        <div className="flex items-center justify-between">
                            <div
                                className="flex items-center gap-2"
                                style={{ color: 'var(--ew-text)' }}
                            >
                                <Cpu size={20} />
                                <h3 className="font-semibold" style={HEADING}>Engine</h3>
                            </div>
                            {engineConnected !== null && (
                                <span
                                    className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full"
                                    style={{
                                        background: engineConnected
                                            ? 'color-mix(in srgb, var(--ew-success) 15%, transparent)'
                                            : 'color-mix(in srgb, var(--ew-danger) 15%, transparent)',
                                        color: engineConnected ? 'var(--ew-success)' : 'var(--ew-danger)',
                                    }}
                                >
                                    <span
                                        className="w-1.5 h-1.5 rounded-full"
                                        style={{ background: engineConnected ? 'var(--ew-success)' : 'var(--ew-danger)' }}
                                    />
                                    {engineConnected ? 'Connected' : 'Offline'}
                                </span>
                            )}
                        </div>

                        {engineConnected === false ? (
                            <div className="pl-7">
                                <div
                                    className="ew-card flex items-start gap-3 p-4"
                                    style={{
                                        background: 'color-mix(in srgb, var(--ew-danger) 10%, transparent)',
                                        borderColor: 'color-mix(in srgb, var(--ew-danger) 35%, transparent)',
                                    }}
                                >
                                    <AlertCircle
                                        size={18}
                                        style={{ color: 'var(--ew-danger)', flexShrink: 0, marginTop: 2 }}
                                    />
                                    <div>
                                        <p
                                            className="text-sm font-medium"
                                            style={{ color: 'var(--ew-danger)' }}
                                        >
                                            Local music engine unreachable
                                        </p>
                                        <p
                                            className="text-xs mt-1"
                                            style={{ color: 'var(--ew-danger)', opacity: 0.85 }}
                                        >
                                            Make sure the local music engine is running.
                                        </p>
                                        <button
                                            onClick={fetchModelInventory}
                                            className="mt-2 text-xs underline hover:opacity-80"
                                            style={{ color: 'var(--ew-danger)' }}
                                        >
                                            Retry connection
                                        </button>
                                    </div>
                                </div>
                            </div>
                        ) : engineConnected === true ? (
                            <div className="pl-7 space-y-4">
                                {/* Loaded Models (read-only) */}
                                <div>
                                    <label
                                        className="text-sm mb-1.5 block"
                                        style={{ color: 'var(--ew-text-muted)' }}
                                    >
                                        DiT Model
                                    </label>
                                    <div
                                        className="ew-input w-full text-sm"
                                        style={{ fontFamily: 'var(--ew-font-mono)' }}
                                    >
                                        {loadedDit || 'Not loaded'}
                                    </div>
                                </div>

                                <div>
                                    <label
                                        className="text-sm mb-1.5 block"
                                        style={{ color: 'var(--ew-text-muted)' }}
                                    >
                                        Language Model (lyrics/caption)
                                    </label>
                                    <div
                                        className="ew-input w-full text-sm"
                                        style={{ fontFamily: 'var(--ew-font-mono)' }}
                                    >
                                        {loadedLm || 'Not loaded'}
                                    </div>
                                </div>

                                <p className="text-xs" style={{ color: 'var(--ew-text-faint)' }}>
                                    Models are managed automatically. Turbo is used for generation; Base is loaded when the DAW or StyleForge requires it.
                                </p>

                                {/* Status Message */}
                                {engineMessage && (
                                    <div
                                        className="ew-card flex items-center gap-2 p-3 text-sm"
                                        style={
                                            engineStatus === 'error'
                                                ? {
                                                    background: 'color-mix(in srgb, var(--ew-danger) 10%, transparent)',
                                                    borderColor: 'color-mix(in srgb, var(--ew-danger) 30%, transparent)',
                                                    color: 'var(--ew-danger)',
                                                }
                                                : engineStatus === 'switching'
                                                ? {
                                                    background: 'color-mix(in srgb, var(--ew-warning) 10%, transparent)',
                                                    borderColor: 'color-mix(in srgb, var(--ew-warning) 30%, transparent)',
                                                    color: 'var(--ew-warning)',
                                                }
                                                : {
                                                    background: 'color-mix(in srgb, var(--ew-success) 10%, transparent)',
                                                    borderColor: 'color-mix(in srgb, var(--ew-success) 30%, transparent)',
                                                    color: 'var(--ew-success)',
                                                }
                                        }
                                    >
                                        {engineStatus === 'error' && <AlertCircle size={16} />}
                                        {engineStatus === 'switching' && <RefreshCw size={16} className="animate-spin" />}
                                        {engineStatus === 'idle' && engineMessage && <Check size={16} />}
                                        {engineMessage}
                                    </div>
                                )}

                                {/* Reload Engine Button */}
                                <button
                                    onClick={handleReinitialize}
                                    disabled={engineStatus === 'switching'}
                                    className="ew-btn ew-btn--ghost w-full"
                                    title="Reload engine from defaults"
                                >
                                    <RefreshCw size={14} className={engineStatus === 'switching' ? 'animate-spin' : ''} />
                                    {engineStatus === 'switching' ? 'Reloading...' : 'Reload Engine'}
                                </button>
                            </div>
                        ) : (
                            <div className="pl-7">
                                <div
                                    className="flex items-center gap-2 text-sm"
                                    style={{ color: 'var(--ew-text-muted)' }}
                                >
                                    <RefreshCw size={14} className="animate-spin" />
                                    Connecting to engine...
                                </div>
                            </div>
                        )}
                    </div>

                    {/* About Section */}
                    <div className="space-y-4">
                        <div
                            className="flex items-center gap-2"
                            style={{ color: 'var(--ew-text)' }}
                        >
                            <Info size={20} />
                            <h3 className="font-semibold" style={HEADING}>About</h3>
                        </div>
                        <div
                            className="pl-7 space-y-3 text-sm"
                            style={{ color: 'var(--ew-text-muted)' }}
                        >
                            <p>Version 1.9</p>
                            <p style={{ ...HEADING, letterSpacing: '0.04em' }}>Strands Sounds Creator</p>
                            <p
                                className="text-xs mt-2"
                                style={{ color: 'var(--ew-text-faint)' }}
                            >
                                A StrandsNation product by Somo Kasane.
                            </p>

                            {/* GPU Requirements */}
                            <div
                                className="pt-3 mt-4 border-t"
                                style={{ borderColor: 'var(--ew-border)' }}
                            >
                                <p
                                    className="font-medium mb-3"
                                    style={{ color: 'var(--ew-text)' }}
                                >
                                    GPU Requirements
                                </p>
                                <div
                                    className="ew-card overflow-hidden text-xs"
                                    style={{ padding: 0 }}
                                >
                                    <table className="w-full">
                                        <thead>
                                            <tr style={{ background: 'var(--ew-surface-raised)' }}>
                                                <th className="px-3 py-2 text-left font-semibold" style={{ color: 'var(--ew-text-muted)' }}>VRAM</th>
                                                <th className="px-3 py-2 text-left font-semibold" style={{ color: 'var(--ew-text-muted)' }}>Model</th>
                                                <th className="px-3 py-2 text-left font-semibold" style={{ color: 'var(--ew-text-muted)' }}>Capabilities</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            <VramRow vram="24+ GB" tone="success" model="XL Turbo / XL Base" caps="Full generation + 4B LM + LoRA training" />
                                            <VramRow vram="12-24 GB" tone="primary" model="Standard Turbo / Base" caps="Generation + 1.7B LM + LoRA training" />
                                            <VramRow vram="8-12 GB" tone="warning" model="Standard Turbo" caps="Generation + 0.6B LM, no training" />
                                            <VramRow vram="4-8 GB" tone="danger" model="Standard Turbo (CPU offload)" caps="Slow generation, no LM, no training" />
                                            <VramRow vram="<4 GB" tone="danger" model={<span className="italic" style={{ color: 'var(--ew-text-faint)' }}>Not recommended</span>} caps="CPU-only mode, very slow" />
                                        </tbody>
                                    </table>
                                </div>
                                <div
                                    className="mt-2 space-y-1 text-[11px]"
                                    style={{ color: 'var(--ew-text-faint)' }}
                                >
                                    <p><span className="font-semibold" style={{ color: 'var(--ew-text-muted)' }}>XL models</span> — larger architecture, higher quality output. Requires 24+ GB VRAM.</p>
                                    <p><span className="font-semibold" style={{ color: 'var(--ew-text-muted)' }}>Turbo</span> — fast generation (8 steps). Supports: text-to-music, cover, repaint.</p>
                                    <p><span className="font-semibold" style={{ color: 'var(--ew-text-muted)' }}>Base</span> — all 6 modes including extract, lego, complete. More steps needed. Loaded automatically when DAW or StyleForge requires it.</p>
                                    <p><span className="font-semibold" style={{ color: 'var(--ew-text-muted)' }}>Training</span> — LoRA/LoKr fine-tuning needs 12+ GB VRAM minimum. 24+ recommended.</p>
                                </div>
                            </div>

                            <div
                                className="pt-3 mt-4 border-t"
                                style={{ borderColor: 'var(--ew-border)' }}
                            >
                                <p className="font-medium mb-3" style={{ color: 'var(--ew-text)' }}>
                                    Created by{' '}
                                    <span style={{ color: 'var(--ew-primary)' }}>@B4SICAI</span>{' '}
                                    for{' '}
                                    <span style={{ color: 'var(--ew-primary)' }}>@metafintek</span>
                                </p>
                                <p
                                    className="text-xs mb-3"
                                    style={{ color: 'var(--ew-text-faint)' }}
                                >
                                    Derived from{' '}
                                    <span style={{ color: 'var(--ew-text-muted)' }}>@AmbsdOP</span>
                                </p>
                                <div className="flex flex-wrap gap-2">
                                    <a
                                        href="https://x.com/B4SICAI"
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="ew-btn ew-btn--primary ew-btn--sm"
                                    >
                                        <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
                                            <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                                        </svg>
                                        @B4SICAI
                                    </a>
                                    <a
                                        href="https://x.com/metafintek"
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="ew-btn ew-btn--ghost ew-btn--sm"
                                    >
                                        <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
                                            <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                                        </svg>
                                        @metafintek
                                    </a>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Footer */}
                <div
                    className="border-t p-6 flex justify-end"
                    style={{ borderColor: 'var(--ew-border)' }}
                >
                    <button
                        onClick={onClose}
                        className="ew-btn ew-btn--primary"
                    >
                        Done
                    </button>
                </div>
            </div>

            <EditProfileModal
                isOpen={isEditProfileOpen}
                onClose={() => setIsEditProfileOpen(false)}
                onSaved={() => setIsEditProfileOpen(false)}
            />
        </div>
    );
};

// Inline VRAM-tier row helper. Maps tone → semantic token.
type VramTone = 'success' | 'primary' | 'warning' | 'danger';
const VramRow: React.FC<{ vram: string; tone: VramTone; model: React.ReactNode; caps: string }> = ({ vram, tone, model, caps }) => {
    const toneColor =
        tone === 'success' ? 'var(--ew-success)' :
        tone === 'primary' ? 'var(--ew-primary)' :
        tone === 'warning' ? 'var(--ew-warning)' :
        'var(--ew-danger)';
    return (
        <tr style={{ borderTop: '1px solid var(--ew-border)' }}>
            <td
                className="px-3 py-2 font-mono"
                style={{ color: toneColor, fontFamily: 'var(--ew-font-mono)' }}
            >
                {vram}
            </td>
            <td className="px-3 py-2" style={{ color: 'var(--ew-text)' }}>{model}</td>
            <td className="px-3 py-2" style={{ color: 'var(--ew-text-muted)' }}>{caps}</td>
        </tr>
    );
};
