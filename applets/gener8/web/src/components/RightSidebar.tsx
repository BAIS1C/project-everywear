// @ts-nocheck
import React, { useState, useEffect } from 'react';
import { Song } from '@/types';
import { Heart, Share2, Play, Pause, MoreHorizontal, X, Copy, Wand2, MoreVertical, FolderOpen, Repeat, Video, Music, Link as LinkIcon, Sparkles, Globe, Lock, Trash2, Edit3, Layers, Disc3, ChevronDown, ChevronUp, Cpu } from 'lucide-react';
import { songsApi, getApiBase } from '@/services/api';
import { useAuth } from '@/context/AuthContext';
import { SongDropdownMenu } from './SongDropdownMenu';
import { ShareModal } from './ShareModal';
import { AlbumCover } from './AlbumCover';

// ── Generation DNA Modal ─────────────────────────────────────────────
function GenDnaModal({
    song,
    isOpen,
    onClose,
    onReuse,
}: {
    song: Song;
    isOpen: boolean;
    onClose: () => void;
    onReuse?: (song: Song) => void;
}) {
    const [copied, setCopied] = React.useState(false);
    if (!isOpen) return null;

    let gp: Record<string, unknown> | null = null;
    if (song.generation_params) {
        if (typeof song.generation_params === 'string') {
            try { gp = JSON.parse(song.generation_params); } catch { gp = null; }
        } else {
            gp = song.generation_params as Record<string, unknown>;
        }
    }

    // Build ordered param list
    const rows: { label: string; key: string; value: string; copyable?: boolean }[] = [];
    if (gp) {
        if (gp.model) rows.push({ label: 'Model', key: 'model', value: String(gp.model) });
        // 2026-05-04 SGT (Bug C fix): show generation Task at the top of
        // the DNA panel. Reference is text2music with a reference URL
        // set; Cover is taskType=cover. Anything else is plain
        // text-to-music. The label mirrors the title-suffix fix in
        // CreatePanel so users can correlate the (reference) / (cover)
        // tag in the song title with the Task row in the DNA modal.
        {
            const tt = String(gp.taskType ?? gp.task_type ?? '').toLowerCase();
            const hasReference = !!(gp.referenceAudioUrl ?? gp.reference_audio_url);
            const hasSource = !!(gp.sourceAudioUrl ?? gp.source_audio_url);
            let display: string | null = null;
            if (tt === 'cover' || hasSource) {
                display = 'Cover';
            } else if (tt === 'text2music' && hasReference) {
                display = 'Reference';
            } else if (tt === 'text2music') {
                display = 'Text-to-Music';
            } else if (tt) {
                display = tt.charAt(0).toUpperCase() + tt.slice(1);
            }
            if (display) {
                rows.push({ label: 'Task', key: 'task', value: display });
            }
        }
        if (gp.seed !== undefined) rows.push({ label: 'Seed', key: 'seed', value: String(gp.seed), copyable: true });
        if (gp.inferenceSteps ?? gp.inference_steps) rows.push({ label: 'Steps', key: 'steps', value: String(gp.inferenceSteps ?? gp.inference_steps) });
        if (gp.guidanceScale ?? gp.guidance_scale) rows.push({ label: 'CFG (Style)', key: 'cfg', value: String(gp.guidanceScale ?? gp.guidance_scale) });
        if (gp.shift !== undefined) rows.push({ label: 'Shift (Weird)', key: 'shift', value: String(gp.shift) });
        if (gp.inferMethod ?? gp.infer_method) rows.push({ label: 'Method', key: 'method', value: String(gp.inferMethod ?? gp.infer_method).toUpperCase() });
        if (gp.batchSize ?? gp.batch_size) rows.push({ label: 'Batch Size', key: 'batch', value: String(gp.batchSize ?? gp.batch_size) });
        if (gp.thinking !== undefined || gp.use_cot_caption !== undefined) rows.push({ label: 'COT (Thinking)', key: 'cot', value: (gp.thinking ?? gp.use_cot_caption) ? 'On' : 'Off' });
        if (gp.duration) rows.push({ label: 'Duration', key: 'duration', value: `${gp.duration}s` });
        if (gp.bpm) rows.push({ label: 'BPM', key: 'bpm', value: String(gp.bpm) });
        if (gp.keyScale ?? gp.key_scale) rows.push({ label: 'Key', key: 'key', value: String(gp.keyScale ?? gp.key_scale) });
        if (gp.timeSignature ?? gp.time_signature) rows.push({ label: 'Time Sig', key: 'timesig', value: String(gp.timeSignature ?? gp.time_signature) });
        if (gp.audioFormat ?? gp.audio_format) rows.push({ label: 'Format', key: 'format', value: String(gp.audioFormat ?? gp.audio_format).toUpperCase() });
        if (gp.lmTemperature ?? gp.lm_temperature) rows.push({ label: 'LM Temp', key: 'lm_temp', value: String(gp.lmTemperature ?? gp.lm_temperature) });
        if (gp.lmCfgScale ?? gp.lm_cfg_scale) rows.push({ label: 'LM CFG', key: 'lm_cfg', value: String(gp.lmCfgScale ?? gp.lm_cfg_scale) });
        if (gp.lmTopP ?? gp.lm_top_p) rows.push({ label: 'LM Top-P', key: 'lm_topp', value: String(gp.lmTopP ?? gp.lm_top_p) });
        if (gp.vocalGender ?? gp.vocal_gender) rows.push({ label: 'Vocal', key: 'vocal', value: String(gp.vocalGender ?? gp.vocal_gender) });
    }

    const allText = rows.map(r => `${r.label}: ${r.value}`).join('\n');

    const handleCopyAll = async () => {
        await copyToClipboard(allText);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const handleCopyValue = async (val: string) => {
        await copyToClipboard(val);
    };

    return (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
            <div className="w-[380px] max-h-[80vh] bg-s3-panel border border-white/10 rounded-2xl shadow-2xl overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
                {/* Header */}
                <div className="px-5 py-4 border-b border-white/[0.06] flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <Cpu size={14} className="text-accent-400" />
                        <h2 className="text-sm font-bold text-white">Generation DNA</h2>
                    </div>
                    <button onClick={onClose} className="text-white/30 hover:text-white/60 transition-colors">
                        <X size={16} />
                    </button>
                </div>

                {/* Song title */}
                <div className="px-5 py-3 border-b border-white/[0.04] bg-white/[0.02]">
                    <p className="text-xs text-white/50 truncate">{song.title}</p>
                </div>

                {/* Params list */}
                <div className="flex-1 overflow-y-auto px-5 py-3">
                    {rows.length === 0 ? (
                        <p className="text-sm text-white/30 text-center py-8">No generation data stored for this song.</p>
                    ) : (
                        <div className="space-y-1">
                            {rows.map((row) => (
                                <div key={row.key} className="flex items-center justify-between py-1.5 group">
                                    <span className="text-[11px] text-white/40 uppercase tracking-wide">{row.label}</span>
                                    <div className="flex items-center gap-1.5">
                                        <span className="text-[12px] text-white/80 font-mono">{row.value}</span>
                                        {row.copyable && (
                                            <button
                                                onClick={() => handleCopyValue(row.value)}
                                                className="opacity-0 group-hover:opacity-100 text-white/30 hover:text-accent-400 transition-all"
                                                title={`Copy ${row.label}`}
                                            >
                                                <Copy size={10} />
                                            </button>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* Actions */}
                {rows.length > 0 && (
                    <div className="px-5 py-3 border-t border-white/[0.06] flex items-center gap-2">
                        <button
                            onClick={handleCopyAll}
                            className="flex-1 py-2 rounded-lg text-xs font-medium border border-white/10 bg-white/[0.04] text-white/60 hover:bg-white/[0.08] hover:text-white transition-all flex items-center justify-center gap-1.5"
                        >
                            <Copy size={12} />
                            {copied ? 'Copied!' : 'Copy All'}
                        </button>
                        {onReuse && (
                            <button
                                onClick={() => { onReuse(song); onClose(); }}
                                className="flex-1 py-2 rounded-lg text-xs font-bold bg-gradient-to-r from-accent-500 to-purple-500 text-white hover:brightness-110 transition-all flex items-center justify-center gap-1.5"
                            >
                                <Sparkles size={12} />
                                Reuse All
                            </button>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}

/** Robust clipboard copy — works on http://localhost and non-secure contexts */
async function copyToClipboard(text: string): Promise<boolean> {
    // Try modern API first
    if (navigator.clipboard && window.isSecureContext) {
        try {
            await navigator.clipboard.writeText(text);
            return true;
        } catch { /* fall through */ }
    }
    // Fallback: textarea + execCommand
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    // Must be visible to work in all browsers
    textarea.style.position = 'fixed';
    textarea.style.left = '0';
    textarea.style.top = '0';
    textarea.style.width = '1px';
    textarea.style.height = '1px';
    textarea.style.padding = '0';
    textarea.style.border = 'none';
    textarea.style.outline = 'none';
    textarea.style.boxShadow = 'none';
    textarea.style.background = 'transparent';
    textarea.style.opacity = '0.01';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    let success = false;
    try {
        success = document.execCommand('copy');
    } catch (e) {
        console.error('Clipboard copy failed:', e);
    }
    document.body.removeChild(textarea);
    return success;
}

interface RightSidebarProps {
    song: Song | null;
    onClose?: () => void;
    onOpenVideo?: () => void;
    onReuse?: (song: Song) => void;
    onCover?: (song: Song) => void;
    onSongUpdate?: (song: Song) => void;
    onNavigateToProfile?: (username: string) => void;
    onNavigateToSong?: (songId: string) => void;
    isLiked?: boolean;
    onToggleLike?: (songId: string) => void;
    onDelete?: (song: Song) => void;
    onAddToPlaylist?: (song: Song) => void;
    onPlay?: (song: Song) => void;
    isPlaying?: boolean;
    currentSong?: Song | null;
    onSendToDaw?: (song: Song) => void;
}

export const RightSidebar: React.FC<RightSidebarProps> = ({ song, onClose, onOpenVideo, onReuse, onCover, onSongUpdate, onNavigateToProfile, onNavigateToSong, isLiked, onToggleLike, onDelete, onAddToPlaylist, onPlay, isPlaying, currentSong, onSendToDaw }) => {
    const { token, user } = useAuth();
    const [showMenu, setShowMenu] = useState(false);
    const [isOwner, setIsOwner] = useState(false);
    const [tagsExpanded, setTagsExpanded] = useState(false);
    const [shareModalOpen, setShareModalOpen] = useState(false);
    const [copiedStyle, setCopiedStyle] = useState(false);
    const [copiedLyrics, setCopiedLyrics] = useState(false);
    const [genParamsExpanded, setGenParamsExpanded] = useState(false);
    const [showDnaModal, setShowDnaModal] = useState(false);
    const [isEditingTitle, setIsEditingTitle] = useState(false);
    const [titleDraft, setTitleDraft] = useState('');
    const [titleError, setTitleError] = useState<string | null>(null);
    const [isSavingTitle, setIsSavingTitle] = useState(false);

    useEffect(() => {
        if (song) {
            setIsOwner(user?.id === song.userId);
        }
    }, [song, user]);

    useEffect(() => {
        if (song) {
            setTitleDraft(song.title || '');
            setIsEditingTitle(false);
            setTitleError(null);
            setIsSavingTitle(false);
        }
    }, [song?.id]);

    const startTitleEdit = () => {
        if (!song || !isOwner) return;
        setTitleDraft(song.title || '');
        setTitleError(null);
        setIsEditingTitle(true);
    };

    const cancelTitleEdit = () => {
        if (!song) return;
        setTitleDraft(song.title || '');
        setTitleError(null);
        setIsEditingTitle(false);
    };

    const saveTitleEdit = async () => {
        if (!song) return;
        if (!token) {
            setTitleError('Please sign in to rename.');
            return;
        }
        const trimmed = titleDraft.trim();
        if (!trimmed) {
            setTitleError('Title cannot be empty.');
            return;
        }
        if (trimmed === song.title) {
            setIsEditingTitle(false);
            return;
        }
        setIsSavingTitle(true);
        setTitleError(null);
        try {
            await songsApi.updateSong(song.id, { title: trimmed }, token);
            onSongUpdate?.({ ...song, title: trimmed });
            setIsEditingTitle(false);
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Rename failed';
            setTitleError(message);
        } finally {
            setIsSavingTitle(false);
        }
    };

    if (!song) return (
        <div className="w-full h-full bg-zinc-50 dark:bg-s3-panel border-l border-zinc-200 dark:border-white/5 flex items-center justify-center text-zinc-400 dark:text-zinc-500 text-sm transition-colors duration-300">
            <div className="flex flex-col items-center gap-2">
                <Music size={40} className="text-zinc-300 dark:text-zinc-700" />
                <p>Select a song to view details</p>
            </div>
        </div>
    );

    // Song details panel routed through EWDS chrome tokens so the
    // border + background follow the active skin. Close button gets
    // sprite icon weight via Lucide skin override (icons.css).
    // EWDS retheme polish 2026-04-25 SGT.
    return (
        <div
            className="w-full h-full flex flex-col relative transition-colors duration-300"
            style={{
                background: 'var(--ew-surface)',
                borderLeft: '1px solid var(--ew-border)',
            }}
        >

            {/* Header */}
            <div
                className="h-14 flex items-center justify-between px-4 flex-shrink-0 z-10"
                style={{
                    background: 'var(--ew-chrome-bg)',
                    borderBottom: '1px solid var(--ew-chrome-border)',
                    backdropFilter: 'blur(8px)',
                    WebkitBackdropFilter: 'blur(8px)',
                }}
            >
                <span
                    style={{
                        fontFamily: 'var(--ew-font-mono)',
                        fontSize: 11,
                        fontWeight: 600,
                        letterSpacing: '0.18em',
                        textTransform: 'uppercase',
                        color: 'var(--ew-text)',
                    }}
                >
                    Song Details
                </span>
                <button
                    onClick={onClose}
                    className="p-1.5 transition-colors"
                    style={{
                        color: 'var(--ew-text-faint)',
                        background: 'transparent',
                        border: 'none',
                        cursor: 'pointer',
                    }}
                    onMouseEnter={(e) => {
                        e.currentTarget.style.color = 'var(--ew-text)';
                        e.currentTarget.style.background = 'var(--ew-surface-overlay)';
                    }}
                    onMouseLeave={(e) => {
                        e.currentTarget.style.color = 'var(--ew-text-faint)';
                        e.currentTarget.style.background = 'transparent';
                    }}
                >
                    <X size={18} />
                </button>
            </div>

            <div className="flex-1 overflow-y-auto custom-scrollbar">
                <div className="p-5 space-y-6">

                    {/* Cover Art */}
                    <div
                        className="group relative aspect-square w-full rounded-xl overflow-hidden shadow-2xl bg-zinc-200 dark:bg-zinc-800 ring-1 ring-black/5 dark:ring-white/10 cursor-pointer"
                        onClick={() => onPlay?.(song)}
                    >
                        {song.coverUrl ? (
                            <img src={song.coverUrl} alt={song.title} className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
                        ) : null}
                        {!song.coverUrl && <AlbumCover seed={song.id || song.title} size="full" className="w-full h-full" />}

                        {/* Overlay Gradient */}
                        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-60"></div>

                        {/* Play Button Overlay */}
                        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onPlay?.(song);
                                }}
                                className="w-16 h-16 rounded-full bg-white/95 dark:bg-white text-black flex items-center justify-center shadow-2xl hover:scale-110 transition-transform"
                            >
                                {isPlaying && currentSong?.id === song.id ? (
                                    <Pause size={28} fill="currentColor" />
                                ) : (
                                    <Play size={28} fill="currentColor" className="ml-1" />
                                )}
                            </button>
                        </div>

                        <div className="absolute bottom-4 left-4 right-4 flex items-center justify-between">
                            <div className="flex items-center gap-2 text-white">
                                <Play size={16} fill="currentColor" />
                                <span className="text-xs font-bold font-mono">{song.viewCount || 0}</span>
                            </div>
                            <span className="text-[10px] font-bold text-black bg-white/90 px-1.5 py-0.5 rounded backdrop-blur-sm">
                                {song.duration}
                            </span>
                        </div>
                    </div>

                    {/* Title & Artist Block */}
                    <div className="space-y-3">
                        <div className="flex justify-between items-start gap-2">
                            <div className="flex items-center gap-2 flex-1">
                                {!isEditingTitle ? (
                                    <h2
                                        onClick={() => onNavigateToSong?.(song.id)}
                                        className="text-2xl font-bold text-zinc-900 dark:text-white leading-tight tracking-tight cursor-pointer hover:underline"
                                    >
                                        {song.title}
                                    </h2>
                                ) : (
                                    <div className="w-full">
                                        <input
                                            value={titleDraft}
                                            onChange={(e) => setTitleDraft(e.target.value)}
                                            onKeyDown={(e) => {
                                                if (e.key === 'Enter') {
                                                    e.preventDefault();
                                                    void saveTitleEdit();
                                                }
                                                if (e.key === 'Escape') {
                                                    e.preventDefault();
                                                    cancelTitleEdit();
                                                }
                                            }}
                                            className="w-full text-xl font-bold text-zinc-900 dark:text-white bg-white dark:bg-black/30 border border-zinc-200 dark:border-white/10 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent-500/40"
                                            maxLength={120}
                                            autoFocus
                                        />
                                        <div className="flex items-center gap-2 mt-2">
                                            <button
                                                onClick={() => void saveTitleEdit()}
                                                disabled={isSavingTitle}
                                                className="px-3 py-1.5 rounded-md text-xs font-semibold bg-accent-600 text-white hover:bg-accent-700 disabled:opacity-60"
                                            >
                                                {isSavingTitle ? 'Saving...' : 'Save'}
                                            </button>
                                            <button
                                                onClick={cancelTitleEdit}
                                                disabled={isSavingTitle}
                                                className="px-3 py-1.5 rounded-md text-xs font-semibold bg-zinc-200 text-zinc-700 hover:bg-zinc-300 dark:bg-white/10 dark:text-zinc-200 dark:hover:bg-white/20 disabled:opacity-60"
                                            >
                                                Cancel
                                            </button>
                                            {titleError && (
                                                <span className="text-xs text-red-500">{titleError}</span>
                                            )}
                                        </div>
                                    </div>
                                )}
                            </div>
                            <div className="relative">
                                {isOwner && !isEditingTitle && (
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            startTitleEdit();
                                        }}
                                        className="text-zinc-400 hover:text-black dark:hover:text-white p-1 mr-1"
                                        title="Rename song"
                                    >
                                        <Edit3 size={18} />
                                    </button>
                                )}
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        setShowMenu(!showMenu);
                                    }}
                                    className="text-zinc-400 hover:text-black dark:hover:text-white p-1"
                                >
                                    <MoreVertical size={20} />
                                </button>
                                <SongDropdownMenu
                                    song={song}
                                    isOpen={showMenu}
                                    onClose={() => setShowMenu(false)}
                                    isOwner={isOwner}
                                    onCreateVideo={onOpenVideo}
                                    onReusePrompt={() => onReuse?.(song)}
                                    onCover={() => onCover?.(song)}
                                    onDelete={() => onDelete?.(song)}
                                    onAddToPlaylist={() => onAddToPlaylist?.(song)}
                                    onShare={() => setShareModalOpen(true)}
                                />
                            </div>
                        </div>

                        {(() => {
                            /*
                             * Author + avatar resolution (added 2026-05-01 SGT).
                             * Same pattern as SongList: when song.creator
                             * is empty (because the generation pipeline
                             * doesn't yet back-fill display_name), fall
                             * back to user.display_name from the auth
                             * context. The avatar uses creator_avatar
                             * if present, else user.avatar_url, else the
                             * single-letter monogram seeded from the
                             * resolved name.
                             */
                            const resolved =
                                song.creator
                                || (user as { display_name?: string } | null)?.display_name
                                || (user?.username ? user.username.split('@')[0] : '')
                                || 'Anonymous';
                            const initial = (resolved[0] || 'A').toUpperCase();
                            const avatarUrl =
                                song.creator_avatar
                                || (user as { avatar_url?: string } | null)?.avatar_url
                                || null;
                            return (
                        <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-xs font-bold text-white shadow-sm ring-2 ring-white dark:ring-black overflow-hidden">
                                {avatarUrl ? (
                                    <img src={avatarUrl} alt={resolved} className="w-full h-full object-cover" />
                                ) : (
                                    initial
                                )}
                            </div>
                            <div className="flex flex-col">
                                <span
                                    onClick={() => {
                                        // Fall back to current-user identity for
                                        // legacy songs that have no song.creator.
                                        // Fix 2026-05-02 SGT.
                                        const target = song.creator || user?.raw_username || resolved;
                                        if (target) onNavigateToProfile?.(target);
                                    }}
                                    className="text-sm font-semibold text-zinc-900 dark:text-white hover:underline cursor-pointer"
                                >
                                    {resolved}
                                </span>
                                <span className="text-xs text-zinc-500 dark:text-zinc-400">Created {new Date(song.createdAt).toLocaleDateString()}</span>
                            </div>
                        </div>
                            );
                        })()}
                    </div>

                    {/* Main Actions */}
                    <div className="flex items-center justify-between px-3 py-2.5 bg-zinc-200/80 dark:bg-black/40 backdrop-blur-sm rounded-2xl border border-zinc-300/50 dark:border-white/5">
                        <button
                            onClick={onOpenVideo}
                            title="Create Video"
                            className="p-3 text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white hover:bg-zinc-300/50 dark:hover:bg-white/10 rounded-xl transition-all duration-200"
                        >
                            <Video size={18} strokeWidth={1.5} />
                        </button>
                        <button
                            onClick={() => onSendToDaw && onSendToDaw(song)}
                            title="Send to DAW"
                            className="p-3 text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white hover:bg-zinc-300/50 dark:hover:bg-white/10 rounded-xl transition-all duration-200"
                        >
                            <Layers size={18} strokeWidth={1.5} />
                        </button>
                        <button
                            onClick={() => {
                                if (!song?.audioUrl) return;
                                const audioUrl = song.audioUrl.startsWith('http') ? song.audioUrl : `${window.location.origin}${song.audioUrl}`;
                                window.open(`/editor?audioUrl=${encodeURIComponent(audioUrl)}`, '_blank');
                            }}
                            title="Open in Editor"
                            className="p-3 text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white hover:bg-zinc-300/50 dark:hover:bg-white/10 rounded-xl transition-all duration-200"
                        >
                            <Edit3 size={18} strokeWidth={1.5} />
                        </button>
                        <button
                            onClick={() => onReuse && onReuse(song)}
                            title="Reuse Prompt"
                            className="p-3 text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white hover:bg-zinc-300/50 dark:hover:bg-white/10 rounded-xl transition-all duration-200"
                        >
                            <Repeat size={18} strokeWidth={1.5} />
                        </button>
                        <button
                            onClick={() => onCover && onCover(song)}
                            title="AI Cover"
                            disabled={!song.audioUrl && !song.audio_url}
                            className={`p-3 rounded-xl transition-all duration-200 ${
                                song.audioUrl || song.audio_url
                                    ? 'text-accent-500 hover:text-accent-400 hover:bg-accent-500/10'
                                    : 'text-zinc-600 opacity-40 cursor-not-allowed'
                            }`}
                        >
                            <Disc3 size={18} strokeWidth={1.5} />
                        </button>
                        {/* Stem extraction disabled in demo build */}
                    </div>

                    {/* Icon Actions Row */}
                    <div className="flex items-center justify-between px-2 py-2">
                        <div className="flex items-center gap-6">
                            <ActionButton
                                icon={<Heart size={22} fill={isLiked ? 'currentColor' : 'none'} />}
                                label={String(song.likeCount || 0)}
                                active={isLiked}
                                onClick={() => onToggleLike?.(song.id)}
                            />
                            <ActionButton icon={<Share2 size={22} />} onClick={() => setShareModalOpen(true)} />
                        </div>
                        <div className="flex items-center gap-2">
                            {/* Open Track Location (replaced Download 2026-05-01 SGT).
                                Tracks are generated locally; the right primitive
                                is a folder reveal, not a fetch+blob download.
                                Posts to /api/launcher/reveal-in-folder on the
                                local shim, which spawns explorer.exe /select,<path>.
                                Shim route is added in PHASE F1; until then this
                                404s gracefully and logs to console. Theme
                                versions (Classic/Refined/Terminal) all consume
                                this same component so the swap propagates. */}
                            <button
                                className="p-2 text-zinc-400 hover:text-zinc-900 dark:hover:text-white transition-colors"
                                title="Open Track Location"
                                onClick={async () => {
                                    const audioUrl = song.audioUrl || (song as any).audio_url;
                                    if (!audioUrl) return;
                                    try {
                                        const response = await fetch(`${getApiBase()}/api/launcher/reveal-in-folder`, {
                                            method: 'POST',
                                            headers: { 'Content-Type': 'application/json' },
                                            body: JSON.stringify({ audio_url: audioUrl }),
                                        });
                                        if (!response.ok) {
                                            const detail = await response.text().catch(() => '');
                                            console.error(`Open Track Location failed (${response.status}): ${detail}`);
                                        }
                                    } catch (error) {
                                        console.error('Open Track Location failed:', error);
                                    }
                                }}
                            >
                                <FolderOpen size={20} />
                            </button>
                        </div>
                    </div>

                    <div className="h-px bg-zinc-200 dark:bg-white/5 w-full"></div>

                    {/* Tags / Style */}
                    <div className="space-y-2">
                        <div className="flex items-center justify-between">
                            <h3 className="text-xs font-bold text-zinc-500 dark:text-zinc-500 uppercase tracking-wider">Style & Tags</h3>
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    // Build copy text: prefer tags array, fall back to style string, then caption.
                                    // 2026-05-05 SGT: detect ["custom"] sentinel and fall back to song.style,
                                    // matching the display logic below (was only copying "custom").
                                    let rawTags: unknown = song.tags;
                                    if (typeof rawTags === 'string') {
                                        try { rawTags = JSON.parse(rawTags as string); } catch { rawTags = null; }
                                    }
                                    const tagsArray = Array.isArray(rawTags)
                                        ? (rawTags as unknown[]).map(t => String(t))
                                        : null;
                                    const isCustomSentinel =
                                        tagsArray !== null
                                        && tagsArray.length === 1
                                        && tagsArray[0].trim().toLowerCase() === 'custom';
                                    const useTags = tagsArray !== null && tagsArray.length > 0 && !isCustomSentinel;
                                    const stylePart = useTags
                                        ? tagsArray!.join(', ')
                                        : (song.style || song.caption || '');
                                    // When Style Assist was used, song.caption holds the
                                    // raw user input and song.style holds the enhanced text.
                                    // Append the raw prompt so the user can paste it into
                                    // a future generation.
                                    const hasEnhanced = song.caption && song.style && song.caption !== song.style;
                                    const allTags = hasEnhanced
                                        ? `${stylePart}\n\n--- Original Prompt ---\n${song.caption}`
                                        : stylePart;
                                    if (!allTags) return;
                                    copyToClipboard(allTags).then(() => {
                                        setCopiedStyle(true);
                                        setTimeout(() => setCopiedStyle(false), 2000);
                                    });
                                }}
                                className={`flex items-center gap-1 text-[10px] font-medium transition-colors ${copiedStyle ? 'text-green-500' : 'text-zinc-500 hover:text-black dark:hover:text-white'}`}
                                title="Copy all tags"
                            >
                                <Copy size={12} /> {copiedStyle ? 'Copied!' : 'Copy'}
                            </button>
                        </div>
                        <div
                            onClick={() => setTagsExpanded(!tagsExpanded)}
                            className={`flex flex-wrap gap-1.5 cursor-pointer relative ${!tagsExpanded ? 'max-h-[22px] overflow-hidden' : ''}`}
                        >
                            {(() => {
                                /*
                                 * Style & Tags rendering reconciled 2026-05-01 SGT.
                                 * Prior logic preferred `song.tags` whenever it
                                 * was a non-empty array, but generation persists
                                 * the literal sentinel ["custom"] when the user
                                 * supplies a freeform style prompt instead of
                                 * picking from a curated tag set. That made the
                                 * panel show "custom" + "+more" for every
                                 * Custom-mode track, hiding the real prompt
                                 * stored in `song.style`. Fix: detect the
                                 * sentinel and fall back to splitting
                                 * song.style on commas.
                                 */
                                let rawTags: unknown = song.tags;
                                if (typeof rawTags === 'string') {
                                    try { rawTags = JSON.parse(rawTags); } catch { rawTags = null; }
                                }
                                const tagsArray = Array.isArray(rawTags)
                                    ? (rawTags as unknown[]).map((t) => String(t))
                                    : null;
                                const isCustomSentinel =
                                    tagsArray !== null
                                    && tagsArray.length === 1
                                    && tagsArray[0].trim().toLowerCase() === 'custom';
                                const useTags = tagsArray !== null && tagsArray.length > 0 && !isCustomSentinel;

                                const displayTags: string[] = useTags
                                    ? tagsArray as string[]
                                    : (song.style || '')
                                        .split(',')
                                        .map((t) => t.trim())
                                        .filter(Boolean);

                                if (displayTags.length === 0) {
                                    return (
                                        <span className="px-2 py-0.5 bg-zinc-100 dark:bg-white/5 border border-zinc-200 dark:border-white/10 rounded text-[11px] font-medium text-zinc-500 italic">
                                            No style tags
                                        </span>
                                    );
                                }

                                return displayTags.map((tag, idx) => (
                                    <span key={`${tag}-${idx}`} className="px-2 py-0.5 bg-zinc-100 dark:bg-white/5 hover:bg-zinc-200 dark:hover:bg-white/10 border border-zinc-200 dark:border-white/10 rounded text-[11px] font-medium text-zinc-600 dark:text-zinc-300 transition-colors">
                                        {tag}
                                    </span>
                                ));
                            })()}
                            {!tagsExpanded && (
                                <span className="absolute right-0 top-0 px-2 py-0.5 bg-zinc-200 dark:bg-zinc-700 rounded text-[11px] font-medium text-zinc-600 dark:text-zinc-300">
                                    +more
                                </span>
                            )}
                        </div>
                    </div>

                    {/* Generation DNA — compact summary + modal trigger */}
                    {(() => {
                        let gp: Record<string, unknown> | null = null;
                        if (song.generation_params) {
                            if (typeof song.generation_params === 'string') {
                                try { gp = JSON.parse(song.generation_params); } catch { gp = null; }
                            } else {
                                gp = song.generation_params as Record<string, unknown>;
                            }
                        }
                        if (!gp) return null;

                        // Quick summary: model + steps + seed
                        const model = gp.model ? String(gp.model).split('/').pop() : '';
                        const stepsRaw = gp.inferenceSteps ?? gp.inference_steps;
                        const steps = stepsRaw !== undefined && stepsRaw !== null ? String(stepsRaw) : '';
                        const seed = gp.seed !== undefined ? String(gp.seed) : '';

                        return (
                            <button
                                onClick={() => setShowDnaModal(true)}
                                className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl border border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.05] hover:border-accent-500/20 transition-all group cursor-pointer"
                            >
                                <div className="flex items-center gap-2 min-w-0">
                                    <Cpu size={12} className="text-accent-400 shrink-0" />
                                    <span className="text-[11px] text-white/50 uppercase tracking-wide font-semibold">DNA</span>
                                    {model && <span className="text-[10px] text-white/30 font-mono truncate">{model}</span>}
                                    {steps && <span className="text-[10px] text-white/25 font-mono">{steps}st</span>}
                                </div>
                                <div className="flex items-center gap-1.5">
                                    {seed && <span className="text-[10px] text-white/20 font-mono">seed:{seed.slice(0, 8)}</span>}
                                    <ChevronDown size={12} className="text-white/20 group-hover:text-accent-400 transition-colors" />
                                </div>
                            </button>
                        );
                    })()}

                    {/* Lyrics Section */}
                    <div className="bg-white dark:bg-black/20 rounded-xl border border-zinc-200 dark:border-white/5 overflow-hidden">
                        <div className="px-4 py-3 border-b border-zinc-100 dark:border-white/5 flex items-center justify-between bg-zinc-50 dark:bg-white/5">
                            <h3 className="text-xs font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">Lyrics</h3>
                            <button
                                onClick={() => {
                                    if (!song.lyrics) return;
                                    copyToClipboard(song.lyrics).then(() => {
                                        setCopiedLyrics(true);
                                        setTimeout(() => setCopiedLyrics(false), 2000);
                                    });
                                }}
                                className={`flex items-center gap-1 text-[10px] font-medium transition-colors ${copiedLyrics ? 'text-green-500' : 'text-zinc-500 hover:text-black dark:hover:text-white'}`}
                            >
                                <Copy size={12} /> {copiedLyrics ? 'Copied!' : 'Copy'}
                            </button>
                        </div>
                        <div className="p-4 max-h-[300px] overflow-y-auto custom-scrollbar">
                            <div className="text-sm text-zinc-700 dark:text-zinc-300 font-mono whitespace-pre-wrap leading-relaxed opacity-90">
                                {song.lyrics || <div className="text-zinc-400 dark:text-zinc-600 italic text-center py-8">Instrumental<br /><span className="text-xs not-italic">No lyrics generated</span></div>}
                            </div>
                        </div>
                    </div>

                </div>
            </div>

            <GenDnaModal
                song={song}
                isOpen={showDnaModal}
                onClose={() => setShowDnaModal(false)}
                onReuse={onReuse}
            />

            {song && (
                <ShareModal
                    isOpen={shareModalOpen}
                    onClose={() => setShareModalOpen(false)}
                    song={song}
                />
            )}
        </div>
    );
};

const ActionButton: React.FC<{ icon: React.ReactNode; label?: string; active?: boolean; onClick?: () => void }> = ({ icon, label, active, onClick }) => (
    <button
        onClick={onClick}
        className={`flex items-center gap-1.5 ${active ? 'text-accent-600 dark:text-accent-500' : 'text-zinc-400'} hover:text-black dark:hover:text-white transition-colors`}
    >
        {icon}
        {label && <span className="text-xs font-semibold">{label}</span>}
    </button>
);
