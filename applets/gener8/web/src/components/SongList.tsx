// @ts-nocheck
import React, { useState, useMemo, useRef, useEffect } from 'react';
import { Song } from '../types';
import { Play, MoreHorizontal, Heart, ThumbsDown, ListPlus, Pause, Search, Filter, Check, Globe, Lock, Loader2, ThumbsUp, Share2, Video, Info, Clock, ChevronDown, Plus, Pencil, Trash2, X } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useWorkspace } from '../context/WorkspaceContext';
import { SongDropdownMenu } from './SongDropdownMenu';
import { ShareModal } from './ShareModal';
import { AlbumCover } from './AlbumCover';
import Waveform from './Waveform';
import GenerationProgress, { type GenerationStatus } from './GenerationProgress';

/**
 * AnimatedDots — three staggered-pulsing dots for "Creating..."/"Queued..."/
 * "Analysing..." state labels. Keeps visible motion on the row even when
 * the rest of the strip is idle. Uses Tailwind's built-in animate-pulse
 * (no custom keyframes needed).
 */
function AnimatedDots() {
    return (
        <span aria-hidden="true" className="inline-flex items-baseline gap-[1px]">
            <span className="animate-pulse" style={{ animationDelay: '0ms', animationDuration: '1.2s' }}>.</span>
            <span className="animate-pulse" style={{ animationDelay: '200ms', animationDuration: '1.2s' }}>.</span>
            <span className="animate-pulse" style={{ animationDelay: '400ms', animationDuration: '1.2s' }}>.</span>
        </span>
    );
}

interface SongListProps {
    songs: Song[];
    currentSong: Song | null;
    selectedSong: Song | null;
    likedSongIds: Set<string>;
    isPlaying: boolean;
    onPlay: (song: Song) => void;
    onSelect: (song: Song) => void;
    onToggleLike: (songId: string) => void;
    onAddToPlaylist: (song: Song) => void;
    onOpenVideo?: (song: Song) => void;
    onShowDetails?: (song: Song) => void;
    onNavigateToProfile?: (username: string) => void;
    onReusePrompt?: (song: Song) => void;
    onCover?: (song: Song) => void;
    onDelete?: (song: Song) => void;
}

// ... existing code ...



// Define Filter Types
type FilterType = 'liked' | 'public' | 'private' | 'generating';

// 2026-05-05 SGT: Removed Public/Private filters. No sharing system yet;
// public/private distinction is irrelevant until forum/social ships.
const FILTERS: { id: FilterType; label: string; icon: React.ReactNode }[] = [
    { id: 'liked', label: 'Liked', icon: <ThumbsUp size={16} /> },
    { id: 'generating', label: 'Generating', icon: <Loader2 size={16} /> },
];

// ── Workspace Breadcrumb ────────────────────────────────────────────
// 2026-05-05 SGT: Dropdown for switching/creating workspaces.

function WorkspaceBreadcrumb() {
    const {
        workspaces, activeWorkspaceId, activeWorkspace,
        createWorkspace, renameWorkspace, deleteWorkspace, setActiveWorkspace,
    } = useWorkspace();
    const [isOpen, setIsOpen] = useState(false);
    const [isCreating, setIsCreating] = useState(false);
    const [isRenaming, setIsRenaming] = useState<string | null>(null);
    const [inputValue, setInputValue] = useState('');
    const dropdownRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    // Close on outside click
    useEffect(() => {
        const handler = (e: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
                setIsOpen(false);
                setIsCreating(false);
                setIsRenaming(null);
            }
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, []);

    // Auto-focus input when creating/renaming
    useEffect(() => {
        if ((isCreating || isRenaming) && inputRef.current) {
            inputRef.current.focus();
        }
    }, [isCreating, isRenaming]);

    const handleCreate = () => {
        const name = inputValue.trim();
        if (!name) return;
        const ws = createWorkspace(name);
        setActiveWorkspace(ws.id);
        setInputValue('');
        setIsCreating(false);
    };

    const handleRename = (id: string) => {
        const name = inputValue.trim();
        if (!name) return;
        renameWorkspace(id, name);
        setInputValue('');
        setIsRenaming(null);
    };

    const handleDelete = (id: string) => {
        deleteWorkspace(id);
    };

    const activeName = activeWorkspace ? activeWorkspace.name : 'My Workspace';

    return (
        <div className="relative" ref={dropdownRef}>
            <div
                className="flex items-center gap-2"
                style={{
                    fontFamily: 'var(--ew-font-mono)',
                    fontSize: 11,
                    letterSpacing: '0.18em',
                    textTransform: 'uppercase',
                    color: 'var(--ew-text-muted)',
                }}
            >
                <span style={{ color: 'var(--ew-text-faint)' }}>Workspaces</span>
                <span style={{ color: 'var(--ew-text-faint)' }}>›</span>
                <button
                    onClick={() => setIsOpen(!isOpen)}
                    className="flex items-center gap-1 cursor-pointer transition-colors"
                    style={{ color: 'var(--ew-text)', fontWeight: 600 }}
                    onMouseEnter={(e) => (e.currentTarget.style.opacity = '0.8')}
                    onMouseLeave={(e) => (e.currentTarget.style.opacity = '1')}
                >
                    {activeName}
                    <ChevronDown size={12} style={{ opacity: 0.5 }} />
                </button>
            </div>

            {/* Dropdown */}
            {isOpen && (
                <div
                    className="absolute left-0 top-full mt-2 w-64 rounded-xl shadow-2xl overflow-hidden py-1 z-50 animate-in fade-in zoom-in-95 duration-100 origin-top-left"
                    style={{
                        background: 'var(--ew-surface, #18181b)',
                        border: '1px solid var(--ew-border, rgba(255,255,255,0.1))',
                    }}
                >
                    {/* "All Songs" default */}
                    <button
                        onClick={() => { setActiveWorkspace(null); setIsOpen(false); }}
                        className="w-full text-left px-4 py-2.5 flex items-center justify-between transition-colors"
                        style={{
                            color: !activeWorkspaceId ? 'var(--ew-primary)' : 'var(--ew-text)',
                            background: !activeWorkspaceId ? 'var(--ew-primary-soft, rgba(139,92,246,0.08))' : 'transparent',
                            fontSize: 12,
                        }}
                        onMouseEnter={(e) => { if (activeWorkspaceId) e.currentTarget.style.background = 'var(--ew-surface-raised, rgba(255,255,255,0.04))'; }}
                        onMouseLeave={(e) => { if (activeWorkspaceId) e.currentTarget.style.background = 'transparent'; }}
                    >
                        <span className="font-medium">My Workspace</span>
                        <span style={{ fontSize: 10, opacity: 0.5 }}>All songs</span>
                    </button>

                    {/* Divider */}
                    {workspaces.length > 0 && (
                        <div style={{ borderTop: '1px solid var(--ew-border, rgba(255,255,255,0.06))', margin: '2px 0' }} />
                    )}

                    {/* Workspace list */}
                    {workspaces.map(ws => (
                        <div
                            key={ws.id}
                            className="flex items-center group"
                            style={{
                                background: activeWorkspaceId === ws.id ? 'var(--ew-primary-soft, rgba(139,92,246,0.08))' : 'transparent',
                            }}
                        >
                            {isRenaming === ws.id ? (
                                <div className="flex-1 flex items-center gap-1 px-3 py-1.5">
                                    <input
                                        ref={inputRef}
                                        value={inputValue}
                                        onChange={(e) => setInputValue(e.target.value)}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter') handleRename(ws.id);
                                            if (e.key === 'Escape') { setIsRenaming(null); setInputValue(''); }
                                        }}
                                        className="flex-1 bg-transparent border-b outline-none text-xs py-1"
                                        style={{ color: 'var(--ew-text)', borderColor: 'var(--ew-primary)' }}
                                        placeholder="Rename..."
                                    />
                                    <button
                                        onClick={() => handleRename(ws.id)}
                                        className="p-1 rounded transition-colors"
                                        style={{ color: 'var(--ew-primary)' }}
                                    >
                                        <Check size={12} />
                                    </button>
                                    <button
                                        onClick={() => { setIsRenaming(null); setInputValue(''); }}
                                        className="p-1 rounded transition-colors"
                                        style={{ color: 'var(--ew-text-faint)' }}
                                    >
                                        <X size={12} />
                                    </button>
                                </div>
                            ) : (
                                <>
                                    <button
                                        onClick={() => { setActiveWorkspace(ws.id); setIsOpen(false); }}
                                        className="flex-1 text-left px-4 py-2.5 transition-colors"
                                        style={{
                                            color: activeWorkspaceId === ws.id ? 'var(--ew-primary)' : 'var(--ew-text)',
                                            fontSize: 12,
                                        }}
                                    >
                                        <span className="font-medium">{ws.name}</span>
                                    </button>
                                    <div className="flex items-center gap-0.5 pr-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                setInputValue(ws.name);
                                                setIsRenaming(ws.id);
                                            }}
                                            className="p-1 rounded transition-colors"
                                            style={{ color: 'var(--ew-text-faint)' }}
                                            title="Rename"
                                        >
                                            <Pencil size={11} />
                                        </button>
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                handleDelete(ws.id);
                                            }}
                                            className="p-1 rounded transition-colors"
                                            style={{ color: 'var(--ew-text-faint)' }}
                                            title="Delete workspace"
                                        >
                                            <Trash2 size={11} />
                                        </button>
                                    </div>
                                </>
                            )}
                        </div>
                    ))}

                    {/* Divider before create */}
                    <div style={{ borderTop: '1px solid var(--ew-border, rgba(255,255,255,0.06))', margin: '2px 0' }} />

                    {/* Create new */}
                    {isCreating ? (
                        <div className="flex items-center gap-1 px-3 py-2">
                            <input
                                ref={inputRef}
                                value={inputValue}
                                onChange={(e) => setInputValue(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter') handleCreate();
                                    if (e.key === 'Escape') { setIsCreating(false); setInputValue(''); }
                                }}
                                className="flex-1 bg-transparent border-b outline-none text-xs py-1"
                                style={{ color: 'var(--ew-text)', borderColor: 'var(--ew-primary)' }}
                                placeholder="Workspace name..."
                            />
                            <button
                                onClick={handleCreate}
                                className="p-1 rounded transition-colors"
                                style={{ color: 'var(--ew-primary)' }}
                            >
                                <Check size={12} />
                            </button>
                            <button
                                onClick={() => { setIsCreating(false); setInputValue(''); }}
                                className="p-1 rounded transition-colors"
                                style={{ color: 'var(--ew-text-faint)' }}
                            >
                                <X size={12} />
                            </button>
                        </div>
                    ) : (
                        <button
                            onClick={() => { setIsCreating(true); setInputValue(''); }}
                            className="w-full text-left px-4 py-2.5 flex items-center gap-2 transition-colors"
                            style={{ color: 'var(--ew-text-muted)', fontSize: 12 }}
                            onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--ew-surface-raised, rgba(255,255,255,0.04))'; }}
                            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                        >
                            <Plus size={13} />
                            <span>New Workspace</span>
                        </button>
                    )}
                </div>
            )}
        </div>
    );
}

export const SongList: React.FC<SongListProps> = ({
    songs,
    currentSong,
    selectedSong,
    likedSongIds,
    isPlaying,
    onPlay,
    onSelect,
    onToggleLike,
    onAddToPlaylist,
    onOpenVideo,
    onShowDetails,
    onNavigateToProfile,
    onReusePrompt,
    onCover,
    onDelete
}) => {
    const { user } = useAuth();
    const { isSongInActiveWorkspace } = useWorkspace();
    const [searchQuery, setSearchQuery] = useState('');
    const [activeFilters, setActiveFilters] = useState<Set<FilterType>>(new Set());
    const [isFilterOpen, setIsFilterOpen] = useState(false);
    const filterRef = useRef<HTMLDivElement>(null);

    // Close filter dropdown when clicking outside
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (filterRef.current && !filterRef.current.contains(event.target as Node)) {
                setIsFilterOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const toggleFilter = (filterId: FilterType) => {
        setActiveFilters(prev => {
            const newFilters = new Set(prev);
            if (newFilters.has(filterId)) {
                newFilters.delete(filterId);
            } else {
                newFilters.add(filterId);
            }
            return newFilters;
        });
    };

    const filteredSongs = useMemo(() => {
        return songs.filter(song => {
            // 0. Workspace filter (generating songs always pass through)
            if (!song.isGenerating && !isSongInActiveWorkspace(song.id)) return false;

            // 1. Search Logic
            const matchesSearch =
                song.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
                song.style.toLowerCase().includes(searchQuery.toLowerCase()) ||
                song.tags.some(tag => tag.toLowerCase().includes(searchQuery.toLowerCase()));

            if (!matchesSearch) return false;

            // 2. Filter Logic
            if (activeFilters.size === 0) return true;

            if (activeFilters.has('liked') && !likedSongIds.has(song.id)) return false;
            if (activeFilters.has('public') && !song.isPublic) return false;
            if (activeFilters.has('private') && song.isPublic) return false;
            if (activeFilters.has('generating') && !song.isGenerating) return false;

            return true;
        });
    }, [songs, searchQuery, activeFilters, likedSongIds, isSongInActiveWorkspace]);

    return (
        <div className="flex-1 h-full overflow-y-auto custom-scrollbar p-6 pb-32 transition-colors duration-300" style={{ background: 'var(--s3-bg, #0A0B0D)' }}>
            <div className="max-w-5xl mx-auto w-full"> {/* Container constraint */}

                {/* Header. Workspace breadcrumb with dropdown for switching/creating.
                    2026-05-05 SGT: Upgraded from static "MY WORKSPACE" to full
                    workspace system. EWDS mono tokens for skin compat. */}
                <div className="flex flex-col gap-6 mb-8">
                    <WorkspaceBreadcrumb />

                    {/* Search + Filters bar. Uses .ew-input / .ew-btn so
                        focus rings and chamfer follow the active skin.
                        EWDS retheme polish 2026-04-25 SGT. */}
                    <div className="flex items-center gap-3">
                        <div className="relative group flex-1">
                            <input
                                type="text"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                placeholder="Search your songs..."
                                className="ew-input w-full"
                                style={{ paddingLeft: 36, paddingRight: 16, paddingTop: 10, paddingBottom: 10, fontSize: 13 }}
                            />
                            <Search
                                className="w-4 h-4 absolute left-3 top-3 transition-colors"
                                style={{ color: 'var(--ew-text-faint)' }}
                            />
                        </div>

                        <div className="relative" ref={filterRef}>
                            <button
                                onClick={() => setIsFilterOpen(!isFilterOpen)}
                                className={`ew-btn ew-btn--sm ${isFilterOpen || activeFilters.size > 0 ? 'ew-btn--primary' : 'ew-btn--ghost'}`}
                            >
                                <Filter size={14} fill={activeFilters.size > 0 ? "currentColor" : "none"} />
                                <span>Filters {activeFilters.size > 0 && `(${activeFilters.size})`}</span>
                            </button>

                            {/* Filter Dropdown */}
                            {isFilterOpen && (
                                <div className="absolute right-0 top-full mt-2 w-56 bg-white dark:bg-[#18181b] border border-zinc-200 dark:border-white/10 rounded-xl shadow-2xl overflow-hidden py-1 z-50 animate-in fade-in zoom-in-95 duration-100 origin-top-right">
                                    <div className="px-3 py-2 text-[10px] font-bold text-zinc-500 uppercase tracking-wider">
                                        Refine By
                                    </div>
                                    {FILTERS.map(filter => (
                                        <button
                                            key={filter.id}
                                            onClick={() => toggleFilter(filter.id)}
                                            className="w-full text-left px-4 py-2.5 flex items-center justify-between hover:bg-zinc-100 dark:hover:bg-white/5 transition-colors group"
                                        >
                                            <div className="flex items-center gap-3 text-sm font-medium text-zinc-700 dark:text-zinc-300 group-hover:text-black dark:group-hover:text-white">
                                                <span className="text-zinc-400 dark:text-zinc-500 group-hover:text-zinc-600 dark:group-hover:text-zinc-300 transition-colors">
                                                    {filter.icon}
                                                </span>
                                                {filter.label}
                                            </div>
                                            <div className={`
                                     w-4 h-4 rounded border flex items-center justify-center transition-all
                                     ${activeFilters.has(filter.id)
                                                    ? 'bg-accent-600 border-accent-600'
                                                    : 'border-zinc-300 dark:border-zinc-600 group-hover:border-zinc-400 dark:group-hover:border-zinc-500'
                                                }
                                 `}>
                                                {activeFilters.has(filter.id) && <Check size={10} className="text-white" strokeWidth={4} />}
                                            </div>
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                {/* List */}
                <div className="space-y-2"> {/* Reduced vertical spacing */}
                    {filteredSongs.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-64 text-zinc-500 space-y-4 border border-dashed border-zinc-200 dark:border-white/5 rounded-2xl bg-zinc-50 dark:bg-white/[0.02]">
                            <div className="w-16 h-16 rounded-full bg-zinc-100 dark:bg-white/5 flex items-center justify-center">
                                <Filter size={32} />
                            </div>
                            <p className="font-medium">No songs match your filters.</p>
                            <button
                                onClick={() => { setActiveFilters(new Set()); setSearchQuery(''); }}
                                className="text-accent-600 dark:text-accent-500 text-sm font-bold hover:underline"
                            >
                                Clear filters
                            </button>
                        </div>
                    ) : (
                        filteredSongs.map((song) => (
                            <SongItem
                                key={song.id}
                                song={song}
                                isCurrent={currentSong?.id === song.id}
                                isSelected={selectedSong?.id === song.id}
                                isLiked={likedSongIds.has(song.id)}
                                isPlaying={isPlaying}
                                isOwner={Boolean(onDelete)}
                                onPlay={() => onPlay(song)}
                                onSelect={() => onSelect(song)}
                                onToggleLike={() => onToggleLike(song.id)}
                                onAddToPlaylist={() => onAddToPlaylist(song)}
                                onOpenVideo={() => onOpenVideo && onOpenVideo(song)}
                                onShowDetails={() => onShowDetails && onShowDetails(song)}
                                onNavigateToProfile={onNavigateToProfile}
                                onReusePrompt={() => onReusePrompt?.(song)}
                                onCover={() => onCover?.(song)}
                                onDelete={() => onDelete?.(song)}
                            />
                        ))
                    )}
                </div>
            </div> {/* End container */}
        </div>
    );
};

interface SongItemProps {
    song: Song;
    isCurrent: boolean;
    isSelected: boolean;
    isLiked: boolean;
    isPlaying: boolean;
    isOwner: boolean;
    onPlay: () => void;
    onSelect: () => void;
    onToggleLike: () => void;
    onAddToPlaylist: () => void;
    onOpenVideo?: () => void;
    onShowDetails?: () => void;
    onNavigateToProfile?: (username: string) => void;
    onReusePrompt?: () => void;
    onCover?: () => void;
    onDelete?: () => void;
}

const SongItem: React.FC<SongItemProps> = ({
    song,
    isCurrent,
    isSelected,
    isLiked,
    isPlaying,
    isOwner,
    onPlay,
    onSelect,
    onToggleLike,
    onAddToPlaylist,
    onOpenVideo,
    onShowDetails,
    onNavigateToProfile,
    onReusePrompt,
    onCover,
    onDelete
}) => {
    const [showDropdown, setShowDropdown] = useState(false);
    const [shareModalOpen, setShareModalOpen] = useState(false);
    const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
    const [skipDeleteConfirm, setSkipDeleteConfirm] = useState(false);
    const [imageError, setImageError] = useState(false);
    // Author resolution (added 2026-05-01 SGT, fix-on-deploy 2026-05-02 SGT):
    // SongItem is a sibling component to SongList and does not inherit
    // SongList's `user` destructure via React closure. Hooks fix: pull
    // user directly via useAuth() inside SongItem so the resolution IIFE
    // below has it in scope. Previous build deployed without this and
    // crashed the SPA with `ReferenceError: user is not defined` at
    // EverywearApp-KjK5j_V5.js:91:4445 (component stack rooted at $c
    // which minifies SongItem).
    const { user } = useAuth();

    const handleDragStart = (e: React.DragEvent<HTMLDivElement>) => {
        e.dataTransfer.setData('application/s3-song', JSON.stringify({
            id: song.id,
            title: song.title,
            audioUrl: song.audio_url || song.audioUrl,
            duration: song.duration,
            style: song.style,
        }));
        e.dataTransfer.effectAllowed = 'copy';
    };

    const requestDelete = (e: React.MouseEvent) => {
        e.stopPropagation();
        if (!onDelete) return;
        if (localStorage.getItem('s3studio:skip_delete_confirm') === '1') {
            (window as any).__s3DeleteConfirmedSongId = song.id;
            onDelete();
            return;
        }
        setConfirmDeleteOpen(true);
    };

    const confirmDelete = () => {
        if (skipDeleteConfirm) {
            localStorage.setItem('s3studio:skip_delete_confirm', '1');
        }
        (window as any).__s3DeleteConfirmedSongId = song.id;
        setConfirmDeleteOpen(false);
        onDelete?.();
    };

    return (
        <>
        {/* Song row chrome routed through EWDS tokens. Selected state
            paints with --ew-surface and a primary-tinted hairline so it
            reads in every skin. Cover thumbnail keeps its rounded-md
            (the chamfer would look wrong on a square album image).

            NOTE: clipPath was REMOVED 2026-04-25 SGT. clip-path on this
            row was masking the SongDropdownMenu (which renders as an
            absolutely-positioned descendant) to the row polygon — the
            menu disappeared in Refined where the polygon is non-trivial.
            Classic and Terminal worked because tokens.css collapses
            --ew-clip-button-sm to none in those skins. Border-radius
            replacement gives Classic the rounded look it needs without
            ancestor masking. */}
        <div
            onClick={onSelect}
            onDragStart={handleDragStart}
            draggable
            className="group flex items-center gap-4 p-2 transition-all cursor-move"
            style={{
                background: isSelected ? 'var(--ew-surface)' : 'transparent',
                border: `1px solid ${isSelected ? 'var(--ew-border-strong)' : 'transparent'}`,
                borderRadius: 'var(--ew-radius-md)',
            }}
            onMouseEnter={(e) => {
                if (!isSelected) e.currentTarget.style.background = 'var(--ew-surface)';
            }}
            onMouseLeave={(e) => {
                if (!isSelected) e.currentTarget.style.background = 'transparent';
            }}
        >

            {/* Cover Art - Reduced size */}
            <div className="relative w-16 h-16 flex-shrink-0 rounded-md bg-zinc-200 dark:bg-zinc-800 overflow-hidden shadow-sm group/image">
                {/* Use gradient fallback if no coverUrl or image fails to load */}
                {(!song.coverUrl || imageError) ? (
                    <AlbumCover seed={song.id || song.title} size="full" className={`w-full h-full ${song.isGenerating ? 'opacity-20 blur-sm' : 'opacity-100'}`} />
                ) : (
                    <img
                        src={song.coverUrl}
                        alt={song.title}
                        className={`w-full h-full object-cover transition-opacity ${song.isGenerating ? 'opacity-20 blur-sm' : 'opacity-100'}`}
                        onError={() => setImageError(true)}
                    />
                )}

                {(song.isGenerating || song.isAnalysing) ? (
                    <div className="absolute inset-0 bg-black/40 flex flex-col items-center justify-center gap-1">
                        {song.queuePosition ? (
                            /* Queue indicator — kept for cover-art overlay */
                            <>
                                <div className="w-8 h-8 rounded-full bg-amber-500/20 flex items-center justify-center">
                                    <Clock size={16} className="text-amber-400" />
                                </div>
                                <span className="text-[10px] font-medium text-amber-400">Queue #{song.queuePosition}</span>
                            </>
                        ) : (
                            /* Generating / Analysing — cover overlay spinner,
                               the real progress strip lives below the title.
                               Circular buffering spinner keeps motion on screen
                               even if the waveform fill stalls mid-gen. */
                            <Loader2
                                size={28}
                                className="text-accent-500 animate-spin"
                                strokeWidth={2.5}
                                aria-label={song.isAnalysing ? 'Analysing' : 'Generating'}
                            />
                        )}
                    </div>
                ) : (
                    <div
                        className={`absolute inset-0 bg-black/40 flex items-center justify-center backdrop-blur-[1px] cursor-pointer transition-opacity duration-200 ${isCurrent ? 'opacity-100' : 'opacity-0 group-hover/image:opacity-100'}`}
                        onClick={(e) => {
                            e.stopPropagation();
                            onPlay();
                        }}
                    >
                        {/* Cover-overlay play button. Chamfered TR+BL via
                            .ew-clip-button-sm in Classic/Refined, sharp 0px
                            on Terminal. Background uses --ew-primary so it
                            tracks the active skin (cyan / steel-blue / amber)
                            instead of the previous hardcoded white circle.
                            EWDS retheme polish 2026-04-25 SGT. */}
                        <div
                            className="w-10 h-10 flex items-center justify-center transform transition-transform hover:scale-105"
                            style={{
                                background: 'var(--ew-primary)',
                                color: 'var(--ew-primary-fg)',
                                clipPath: 'var(--ew-clip-button-sm)',
                                boxShadow: 'var(--ew-shadow-glow)',
                            }}
                        >
                            {isCurrent && isPlaying ? (
                                <Pause fill="currentColor" className="w-5 h-5" />
                            ) : (
                                <Play fill="currentColor" className="ml-1 w-5 h-5" />
                            )}
                        </div>
                    </div>
                )}
            </div>

            {/* Content */}
            <div className="flex-1 min-w-0 flex flex-col justify-between py-1">
                <div className="space-y-1">
                    <div className="flex items-center gap-2">
                        <h3 className={`font-bold text-lg truncate ${isCurrent ? 'text-accent-600 dark:text-accent-500' : 'text-zinc-900 dark:text-white'}`}>
                            {song.title || (song.isGenerating ? (song.queuePosition ? <>Queued<AnimatedDots /></> : <>Creating<AnimatedDots /></>) : "Untitled")}
                        </h3>
                        {song.isPublic === false && (
                            <Lock size={12} className="text-zinc-400 dark:text-zinc-500" />
                        )}
                    </div>
                    <div className="flex items-center gap-2">
                        {(() => {
                            /*
                             * Author resolution (added 2026-05-01 SGT).
                             * Prior fallback was the literal "Unknown" — which
                             * meant My Workspace songs all read as Unknown
                             * even when the user had set a display_name in
                             * Profile (Sean's smoke-test observation: profile
                             * said Spaceman, song list said Unknown). Until
                             * the generation pipeline back-fills song.creator
                             * with user.display_name at insert time, derive
                             * the author at render time from the auth
                             * context. The resolved name is used both as the
                             * label and as the seed for the avatar bubble's
                             * single-letter monogram so the colour pill
                             * matches the displayed name.
                             */
                            const resolved =
                                song.creator
                                || (user as { display_name?: string } | null)?.display_name
                                || (user?.username ? user.username.split('@')[0] : '')
                                || 'Unknown';
                            const initial = (resolved[0] || 'U').toUpperCase();
                            return (
                        <div
                            className="flex items-center gap-1.5 cursor-pointer hover:opacity-80 transition-opacity"
                            onClick={(e) => {
                                e.stopPropagation();
                                // Navigate by song.creator if explicitly set,
                                // else by the resolved current-user identity
                                // (legacy songs have null creator). Fix
                                // 2026-05-02 SGT: prior guard required
                                // song.creator truthy and dropped the
                                // navigation entirely on legacy rows.
                                const target = song.creator || user?.raw_username || resolved;
                                if (target && onNavigateToProfile) {
                                    onNavigateToProfile(target);
                                }
                            }}
                        >
                            <div className="w-4 h-4 rounded-full bg-purple-500 text-[8px] flex items-center justify-center font-bold text-white">
                                {initial}
                            </div>
                            <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 transition-colors hover:underline">
                                {resolved}
                            </span>
                        </div>
                            );
                        })()}
                    </div>
                    <p className="text-xs text-zinc-500 dark:text-zinc-500 line-clamp-2 pt-1 font-medium max-w-2xl">
                        {song.style}
                    </p>

                    {/* Waveform strip — static peaks for completed tracks,
                        faux fallback if real analysis hasn't landed yet.
                        Hidden during generation / analysing (progress strip owns the slot). */}
                    {!song.isGenerating && !song.isAnalysing && (song.peaks || song.fauxPeaks) && (
                        <div className="pt-1.5 pr-4 max-w-xl">
                            <Waveform
                                peaks={song.peaks ?? song.fauxPeaks ?? []}
                                mode={song.peaksReady && song.peaks ? 'real' : 'faux'}
                                height={24}
                                barGap={1}
                                aria-label={`Waveform for ${song.title}`}
                            />
                        </div>
                    )}
                </div>

                {/* Generation progress — occupies the actions row slot
                    while the song is being generated or analysed. */}
                {(song.isGenerating || song.isAnalysing) && (
                    <div className="pt-2 pr-4 max-w-xl">
                        <GenerationProgress
                            songId={song.id}
                            status={
                                song.isAnalysing
                                    ? 'analysing'
                                    : song.queuePosition
                                    ? 'queued'
                                    : 'running'
                            }
                            queuePosition={song.queuePosition}
                            startedAt={song.generationStartedAt}
                        />
                    </div>
                )}

                {/* Actions Row - Hidden while generating or analysing */}
                {!song.isGenerating && !song.isAnalysing && (
                    <div className="flex items-center gap-1 pt-2">
                        <button
                            className={`flex items-center gap-1 px-3 py-1.5 rounded-full hover:bg-white/5 transition-colors ${isLiked ? 'text-accent-600 dark:text-accent-500 bg-accent-100 dark:bg-accent-500/10' : 'text-zinc-400 hover:text-black dark:hover:text-white'}`}
                            onClick={(e) => { e.stopPropagation(); onToggleLike(); }}
                        >
                            <ThumbsUp size={16} fill={isLiked ? "currentColor" : "none"} />
                            {(song.likeCount || 0) > 0 && (
                                <span className="text-xs font-bold">{song.likeCount}</span>
                            )}
                        </button>

                        <button
                            className="p-2 rounded-full hover:bg-zinc-200 dark:hover:bg-white/5 text-zinc-400 hover:text-black dark:hover:text-white transition-colors"
                            onClick={(e) => { e.stopPropagation(); }}
                        >
                            <ThumbsDown size={16} />
                        </button>

                        <button
                            className="p-2 rounded-full hover:bg-zinc-200 dark:hover:bg-white/5 text-zinc-400 hover:text-black dark:hover:text-white transition-colors"
                            onClick={(e) => { e.stopPropagation(); setShareModalOpen(true); }}
                            title="Share"
                        >
                            <Share2 size={16} />
                        </button>

                        <button
                            className="p-2 rounded-full hover:bg-zinc-200 dark:hover:bg-white/5 text-zinc-400 hover:text-black dark:hover:text-white transition-colors"
                            onClick={(e) => { e.stopPropagation(); if (onOpenVideo) onOpenVideo(); }}
                            title="Create Video"
                        >
                            <Video size={16} />
                        </button>

                        <button
                            className="p-2 rounded-full hover:bg-zinc-200 dark:hover:bg-white/5 text-zinc-400 hover:text-black dark:hover:text-white transition-colors ml-auto"
                            onClick={(e) => { e.stopPropagation(); onAddToPlaylist(); }}
                            title="Add to Playlist"
                        >
                            <ListPlus size={16} />
                        </button>

                        {/* Info Button - Visible only on small/medium screens where sidebar is hidden */}
                        <button
                            className="p-2 rounded-full hover:bg-zinc-200 dark:hover:bg-white/5 text-zinc-400 hover:text-black dark:hover:text-white transition-colors xl:hidden"
                            onClick={(e) => { e.stopPropagation(); if (onShowDetails) onShowDetails(); }}
                            title="Song Details"
                        >
                            <Info size={16} />
                        </button>

                        {isOwner && onDelete && (
                            <button
                                className="p-2 rounded-full hover:bg-red-500/10 text-zinc-400 hover:text-red-500 transition-colors"
                                onClick={requestDelete}
                                title="Delete song"
                            >
                                <Trash2 size={16} />
                            </button>
                        )}

                        <div className="relative">
                            <button
                                className="p-2 rounded-full hover:bg-zinc-200 dark:hover:bg-white/5 text-zinc-400 hover:text-black dark:hover:text-white transition-colors"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    setShowDropdown(!showDropdown);
                                }}
                            >
                                <MoreHorizontal size={16} />
                            </button>
                            <SongDropdownMenu
                                song={song}
                                isOpen={showDropdown}
                                onClose={() => setShowDropdown(false)}
                                isOwner={isOwner}
                                onCreateVideo={() => onOpenVideo?.()}
                                onReusePrompt={() => onReusePrompt?.()}
                                onCover={onCover}
                                onAddToPlaylist={() => onAddToPlaylist?.()}
                                onDelete={() => onDelete?.()}
                                onShare={() => setShareModalOpen(true)}
                            />
                        </div>
                    </div>
                )}
            </div>

            {confirmDeleteOpen && (
                <div
                    className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/50 px-4"
                    onClick={(e) => { e.stopPropagation(); setConfirmDeleteOpen(false); }}
                >
                    <div
                        className="w-full max-w-sm rounded-xl border border-white/10 bg-[#14151C] p-4 shadow-2xl"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="flex items-start gap-3">
                            <div className="mt-0.5 rounded-lg bg-red-500/10 p-2 text-red-400">
                                <Trash2 size={16} />
                            </div>
                            <div className="min-w-0 flex-1">
                                <h3 className="text-sm font-bold text-white">Delete generation?</h3>
                                <p className="mt-1 text-xs leading-relaxed text-white/45">
                                    "{song.title}" will be removed permanently.
                                </p>
                            </div>
                        </div>
                        <label className="mt-4 flex items-center gap-2 text-xs text-white/45">
                            <input
                                type="checkbox"
                                checked={skipDeleteConfirm}
                                onChange={(e) => setSkipDeleteConfirm(e.target.checked)}
                            />
                            Do not ask again
                        </label>
                        <div className="mt-4 flex justify-end gap-2">
                            <button
                                className="rounded-lg border border-white/10 px-3 py-2 text-xs font-semibold text-white/55 hover:bg-white/5"
                                onClick={() => setConfirmDeleteOpen(false)}
                            >
                                Cancel
                            </button>
                            <button
                                className="rounded-lg bg-red-500 px-3 py-2 text-xs font-bold text-white hover:bg-red-400"
                                onClick={confirmDelete}
                            >
                                Delete
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Timestamp */}
            <div className="text-xs font-mono text-zinc-500 dark:text-zinc-600 self-start pt-1">
                {song.isAnalysing ? (
                    <span className="text-accent-500">Analysing<AnimatedDots /></span>
                ) : song.isGenerating ? (
                    <span className={song.queuePosition ? 'text-amber-500' : 'text-accent-500'}>
                        {song.queuePosition ? `#${song.queuePosition}` : <>Creating<AnimatedDots /></>}
                    </span>
                ) : song.duration}
            </div>
        </div>

        <ShareModal
            isOpen={shareModalOpen}
            onClose={() => setShareModalOpen(false)}
            song={song}
        />
        </>
    );
};
