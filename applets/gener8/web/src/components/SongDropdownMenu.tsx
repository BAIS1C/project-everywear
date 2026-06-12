// @ts-nocheck
import React, { useEffect, useRef, useState } from 'react';
import { Song } from '../types';
import { durationSecondsFromValue, getApiBase } from '../services/api';
import { useWorkspace } from '../context/WorkspaceContext';
import { showToast } from './ToastHost';
import { lrcToSrt, isLrcData, naiveLrcFromLyrics } from '../lib/lrcParser';
import {
    Video,
    Repeat,
    ListPlus,
    FolderOpen,
    Trash2,
    Share2,
    Disc3,
    FolderPlus,
    ChevronRight,
    Check,
    FileDown,
} from 'lucide-react';

interface SongDropdownMenuProps {
    song: Song;
    isOpen: boolean;
    onClose: () => void;
    isOwner?: boolean;
    position?: 'left' | 'right' | 'center';
    direction?: 'up' | 'down';
    onCreateVideo?: () => void;
    // onEditAudio removed 2026-05-06 SGT: re-enable when Music Director
    // DAW auto-import is wired up.
    onReusePrompt?: () => void;
    onCover?: () => void;
    onAddToPlaylist?: () => void;
    /**
     * Reveal the locally-generated track in the OS file explorer.
     * Renamed from onDownload 2026-05-01 SGT: tracks live on disk so
     * "download" was a misnomer — the right primitive is "open the
     * folder containing the track" (Windows: explorer.exe /select,<path>).
     * Caller may pass a custom handler; otherwise the default below
     * POSTs to /api/launcher/reveal-in-folder on the local shim.
     */
    onOpenLocation?: () => void;
    onShare?: () => void;
    onDelete?: () => void;
}

interface MenuItemProps {
    icon: React.ReactNode;
    label: string;
    onClick?: () => void;
    danger?: boolean;
    disabled?: boolean;
}

const MenuItem: React.FC<MenuItemProps> = ({ icon, label, onClick, danger, disabled }) => (
    <button
        onClick={onClick}
        disabled={disabled}
        className={`w-full px-3 py-2 text-left text-sm flex items-center gap-3 transition-colors
            ${danger
                ? 'text-red-400 hover:bg-red-500/10 hover:text-red-300'
                : 'text-zinc-300 hover:bg-white/5 hover:text-white'}
            ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
        `}
    >
        <span className="w-4 h-4 flex items-center justify-center opacity-70">{icon}</span>
        <span>{label}</span>
    </button>
);

const MenuDivider: React.FC = () => (
    <div className="h-px bg-white/10 my-1 mx-2" />
);

// 2026-05-05 SGT: Inline workspace picker for the context menu.
const WorkspaceSubmenu: React.FC<{ songId: string; onClose: () => void }> = ({ songId, onClose }) => {
    const { workspaces, workspaceSongs, addSongToWorkspace, removeSongFromWorkspace } = useWorkspace();
    const [expanded, setExpanded] = useState(false);

    if (workspaces.length === 0) return null;

    const toggle = (wsId: string) => {
        const songs = workspaceSongs[wsId] || [];
        if (songs.includes(songId)) {
            removeSongFromWorkspace(songId, wsId);
        } else {
            addSongToWorkspace(songId, wsId);
        }
    };

    return (
        <div>
            <button
                onClick={() => setExpanded(!expanded)}
                className="w-full px-3 py-2 text-left text-sm flex items-center gap-3 transition-colors text-zinc-300 hover:bg-white/5 hover:text-white cursor-pointer"
            >
                <span className="w-4 h-4 flex items-center justify-center opacity-70">
                    <FolderPlus size={14} />
                </span>
                <span className="flex-1">Workspaces</span>
                <ChevronRight size={12} className={`transition-transform ${expanded ? 'rotate-90' : ''}`} style={{ opacity: 0.4 }} />
            </button>
            {expanded && (
                <div className="py-0.5 mx-2 mb-1 rounded-lg" style={{ background: 'rgba(255,255,255,0.03)' }}>
                    {workspaces.map(ws => {
                        const isIn = (workspaceSongs[ws.id] || []).includes(songId);
                        return (
                            <button
                                key={ws.id}
                                onClick={() => toggle(ws.id)}
                                className="w-full px-3 py-1.5 text-left text-xs flex items-center gap-2 transition-colors text-zinc-400 hover:text-white hover:bg-white/5 cursor-pointer"
                            >
                                <span className="w-3 h-3 flex items-center justify-center">
                                    {isIn && <Check size={10} className="text-accent-400" />}
                                </span>
                                <span className={isIn ? 'text-accent-400 font-medium' : ''}>{ws.name}</span>
                            </button>
                        );
                    })}
                </div>
            )}
        </div>
    );
};

export const SongDropdownMenu: React.FC<SongDropdownMenuProps> = ({
    song,
    isOpen,
    onClose,
    isOwner = false,
    position = 'right',
    direction = 'down',
    onCreateVideo,
    onReusePrompt,
    onCover,
    onAddToPlaylist,
    onOpenLocation,
    onShare,
    onDelete
}) => {
    const menuRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
                onClose();
            }
        };

        const handleEscape = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                onClose();
            }
        };

        if (isOpen) {
            document.addEventListener('mousedown', handleClickOutside);
            document.addEventListener('keydown', handleEscape);
        }

        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
            document.removeEventListener('keydown', handleEscape);
        };
    }, [isOpen, onClose]);

    if (!isOpen) return null;

    const handleAction = (action?: () => void) => {
        if (action) {
            action();
        }
        onClose();
    };

    /**
     * Open the local OS file explorer at the track's location.
     * Replaces the prior browser-blob "download" path (2026-05-01 SGT).
     * Tracks are generated locally to %USERPROFILE%/Music/Strands Sound
     * Studio/gener8/, so the right action is a folder reveal, not a fetch.
     *
     * Posts the audio URL to the local shim, which translates URL -> on-disk
     * path -> spawns `explorer.exe /select,<path>` on Windows (or the macOS
     * `open -R` equivalent later). The shim route lives at
     * /api/launcher/reveal-in-folder and is added in PHASE F1 alongside
     * the parity-audit shim routes; until that lands this fetch will 404
     * and the catch logs the failure without breaking the UI.
     */
    const handleOpenLocation = async () => {
        const audioUrl = song.audioUrl || (song as any).audio_url;
        if (!audioUrl) {
            showToast({ kind: 'error', message: 'No audio URL on this track', durationMs: 3000 });
            onClose();
            return;
        }
        try {
            const response = await fetch(`${getApiBase()}/api/launcher/reveal-in-folder`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ audio_url: audioUrl }),
            });
            if (!response.ok) {
                const detail = await response.text().catch(() => '');
                console.error(`Open Track Location failed (${response.status}): ${detail}`);
                showToast({ kind: 'error', message: `Could not open track location: ${response.status}`, durationMs: 4000 });
            }
        } catch (error) {
            console.error('Open Track Location failed:', error);
            showToast({ kind: 'error', message: 'Engine not reachable; cannot open folder', durationMs: 4000 });
        }
        onClose();
    };

    /**
     * Export Lyrics as SRT. Converts the song's LRC data to SRT format
     * and POSTs to the local shim which writes the .srt file next to the
     * audio track. Falls back to browser download if no lrc_data or if
     * the shim route isn't available yet.
     * 2026-05-06 SGT: wired for launch day.
     * 2026-05-08 SGT: naive time-split fallback for tracks without lrc_data.
     */
    const handleExportLyrics = async () => {
        const lrcData = song.lrc_data;
        const lyrics = song.lyrics;
        const content = lrcData || lyrics;
        if (!content) {
            showToast({ kind: 'error', message: 'No lyrics on this track to export', durationMs: 3000 });
            onClose();
            return;
        }

        // Convert LRC to SRT: use real lrc_data if available, otherwise
        // generate naive time-split from plain lyrics + track duration.
        let srtContent: string;
        if (lrcData && isLrcData(lrcData)) {
            srtContent = lrcToSrt(lrcData);
        } else if (lyrics) {
            // Naive fallback: distribute lines evenly across track duration
            const dur = durationSecondsFromValue(song.duration) ?? 180;
            const naiveLrc = naiveLrcFromLyrics(lyrics, dur);
            srtContent = naiveLrc ? lrcToSrt(naiveLrc) : '';
        } else {
            srtContent = '';
        }
        if (!srtContent) {
            showToast({ kind: 'error', message: 'Could not generate timed subtitles for this track.', durationMs: 3000 });
            onClose();
            return;
        }

        // Try to write via shim (puts .srt next to the audio file)
        const audioUrl = song.audioUrl || (song as any).audio_url;
        try {
            const resp = await fetch(`${getApiBase()}/api/export/srt`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    audio_url: audioUrl,
                    song_id: song.id,
                    title: song.title,
                    srt_content: srtContent,
                }),
            });
            if (resp.ok) {
                const data = await resp.json().catch(() => ({}));
                showToast({ kind: 'success', message: `SRT saved: ${data.path || 'next to audio file'}`, durationMs: 4000 });
                onClose();
                return;
            }
        } catch {
            // Shim route not available; fall back to browser download
        }

        // Fallback: browser blob download
        const blob = new Blob([srtContent], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `${song.title || 'lyrics'}.srt`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        showToast({ kind: 'success', message: 'SRT downloaded to browser downloads', durationMs: 3000 });
        onClose();
    };

    const positionClasses =
        position === 'left'
            ? 'left-0'
            : position === 'center'
                ? 'left-1/2 -translate-x-1/2'
                : 'right-0';
    const directionClasses = direction === 'up'
        ? 'bottom-full mb-2'
        : 'top-full mt-2';
    const animationClasses = direction === 'up'
        ? 'animate-in fade-in slide-in-from-bottom-2'
        : 'animate-in fade-in slide-in-from-top-2';

    return (
        <div
            ref={menuRef}
            className={`absolute ${positionClasses} ${directionClasses} w-52
                bg-zinc-900 rounded-xl shadow-2xl border border-white/10 py-1.5 z-50
                ${animationClasses} duration-150`}
            onClick={(e) => e.stopPropagation()}
        >
            {/* Creative Actions */}
            <MenuItem
                icon={<Video size={14} />}
                label="Create Video"
                onClick={() => handleAction(onCreateVideo)}
            />
            {/* Edit Audio removed 2026-05-06 SGT: re-enable with Music Director DAW */}
            <MenuItem
                icon={<Repeat size={14} />}
                label="Reuse Prompt"
                onClick={() => handleAction(onReusePrompt)}
            />
            <MenuItem
                icon={<Disc3 size={14} />}
                label="AI Cover"
                onClick={() => handleAction(onCover)}
                disabled={!song.audioUrl && !song.audio_url}
            />

            <MenuDivider />

            {/* Library Actions */}
            <MenuItem
                icon={<ListPlus size={14} />}
                label="Add to Playlist"
                onClick={() => handleAction(onAddToPlaylist)}
            />
            <WorkspaceSubmenu songId={song.id} onClose={onClose} />
            <MenuItem
                icon={<FolderOpen size={14} />}
                label="Open Track Location"
                onClick={onOpenLocation ? () => handleAction(onOpenLocation) : handleOpenLocation}
            />
            {/* Export Lyrics (SRT) re-enabled 2026-05-08 SGT. Falls back to
                naive time-split when no lrc_data. Silent, just works. */}
            <MenuItem
                icon={<FileDown size={14} />}
                label="Export Lyrics (SRT)"
                onClick={() => {
                    handleExportLyrics();
                    onClose();
                }}
            />
            <MenuItem
                icon={<Share2 size={14} />}
                label="Share"
                onClick={() => handleAction(onShare)}
            />

            {/* Owner-only Actions */}
            {isOwner && (
                <>
                    <MenuDivider />
                    <MenuItem
                        icon={<Trash2 size={14} />}
                        label="Delete Song"
                        onClick={() => handleAction(onDelete)}
                        danger
                    />
                </>
            )}
        </div>
    );
};

export default SongDropdownMenu;
