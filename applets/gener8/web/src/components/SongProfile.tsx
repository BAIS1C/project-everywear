// @ts-nocheck
import React, { useState, useEffect, useRef } from 'react';
import { Song } from '../types';
import { songsApi, getAudioUrl } from '../services/api';
import { useAuth } from '../context/AuthContext';
import {
    ArrowLeft, Play, Pause, Heart, Share2, MoreHorizontal,
    Music as MusicIcon, Eye, Pencil, Check, X,
    Repeat, FileText, FileMusic, Copy, Disc3, ImagePlus, RefreshCw, Upload
} from 'lucide-react';
import { ShareModal } from './ShareModal';
import { SongDropdownMenu } from './SongDropdownMenu';

interface SongProfileProps {
    songId: string;
    onBack: () => void;
    onPlay: (song: Song, list?: Song[]) => void;
    onNavigateToProfile: (username: string) => void;
    currentSong?: Song | null;
    isPlaying?: boolean;
    likedSongIds?: Set<string>;
    onToggleLike?: (songId: string) => void;
    onReusePrompt?: (song: Song) => void;
    onCover?: (song: Song) => void;
    onExportToDaw?: (song: Song) => void;
    onCreateVideo?: (song: Song) => void;
    onSongUpdate?: (song: Song) => void;
}

const updateMetaTags = (song: Song) => {
    const baseUrl = window.location.origin;
    const songUrl = `${baseUrl}/song/${song.id}`;
    const title = `${song.title} by ${song.creator || 'Unknown Artist'} | Strands Sounds`;
    const description = `Listen to "${song.title}" - ${song.style}. ${song.viewCount || 0} plays, ${song.likeCount || 0} likes. Create your own AI music with Strands Sounds.`;

    document.title = title;

    const updateOrCreateMeta = (selector: string, attribute: string, value: string) => {
        let element = document.querySelector(selector) as HTMLMetaElement;
        if (!element) {
            element = document.createElement('meta');
            const [attr, attrValue] = selector.replace(/[\[\]'"]/g, '').split('=');
            if (attr === 'property') element.setAttribute('property', attrValue);
            else if (attr === 'name') element.setAttribute('name', attrValue);
            document.head.appendChild(element);
        }
        element.setAttribute(attribute, value);
    };

    updateOrCreateMeta('meta[name="description"]', 'content', description);
    updateOrCreateMeta('meta[name="title"]', 'content', title);
    updateOrCreateMeta('meta[property="og:type"]', 'content', 'music.song');
    updateOrCreateMeta('meta[property="og:url"]', 'content', songUrl);
    updateOrCreateMeta('meta[property="og:title"]', 'content', title);
    updateOrCreateMeta('meta[property="og:description"]', 'content', description);
    updateOrCreateMeta('meta[property="og:image"]', 'content', song.coverUrl);
    updateOrCreateMeta('meta[property="og:image:width"]', 'content', '400');
    updateOrCreateMeta('meta[property="og:image:height"]', 'content', '400');
    updateOrCreateMeta('meta[property="og:audio"]', 'content', song.audioUrl || '');
    updateOrCreateMeta('meta[property="og:audio:type"]', 'content', 'audio/mpeg');
    updateOrCreateMeta('meta[name="twitter:card"]', 'content', 'summary_large_image');
    updateOrCreateMeta('meta[name="twitter:url"]', 'content', songUrl);
    updateOrCreateMeta('meta[name="twitter:title"]', 'content', title);
    updateOrCreateMeta('meta[name="twitter:description"]', 'content', description);
    updateOrCreateMeta('meta[name="twitter:image"]', 'content', song.coverUrl);
    updateOrCreateMeta('meta[property="music:duration"]', 'content', String(song.duration || 0));
    updateOrCreateMeta('meta[property="music:musician"]', 'content', song.creator || 'Unknown Artist');
};

const resetMetaTags = () => {
    document.title = 'Strands Sounds - Local AI Music Generator';
    const defaultDescription = 'Create original music locally. Generate songs in any style with custom lyrics and professional quality.';
    const defaultImage = '/og-image.png';

    const updateMeta = (selector: string, content: string) => {
        const element = document.querySelector(selector) as HTMLMetaElement;
        if (element) element.setAttribute('content', content);
    };

    updateMeta('meta[name="description"]', defaultDescription);
    updateMeta('meta[property="og:title"]', 'Strands Sounds - Local AI Music Generator');
    updateMeta('meta[property="og:description"]', defaultDescription);
    updateMeta('meta[property="og:image"]', defaultImage);
    updateMeta('meta[property="og:type"]', 'website');
    updateMeta('meta[name="twitter:title"]', 'Strands Sounds - Local AI Music Generator');
    updateMeta('meta[name="twitter:description"]', defaultDescription);
    updateMeta('meta[name="twitter:image"]', defaultImage);
};

export const SongProfile: React.FC<SongProfileProps> = ({
    songId, onBack, onPlay, onNavigateToProfile, currentSong, isPlaying,
    likedSongIds = new Set(), onToggleLike, onReusePrompt, onCover,
    onExportToDaw, onCreateVideo, onSongUpdate
}) => {
    const { user, token } = useAuth();
    const [song, setSong] = useState<Song | null>(null);
    const [loading, setLoading] = useState(true);
    const [shareModalOpen, setShareModalOpen] = useState(false);
    const [dropdownOpen, setDropdownOpen] = useState(false);
    const dropdownAnchorRef = useRef<HTMLDivElement>(null);

    // Inline title editing
    const [editingTitle, setEditingTitle] = useState(false);
    const [titleDraft, setTitleDraft] = useState('');
    const [savingTitle, setSavingTitle] = useState(false);
    const titleInputRef = useRef<HTMLInputElement>(null);

    // Thumbnail upload
    const thumbnailInputRef = useRef<HTMLInputElement>(null);
    const [uploadingThumbnail, setUploadingThumbnail] = useState(false);
    const [showThumbnailModal, setShowThumbnailModal] = useState(false);

    const isOwner = song && user?.id === song.userId;
    const isCurrentSong = song && currentSong?.id === song.id;
    const isCurrentlyPlaying = isCurrentSong && isPlaying;
    const isLiked = song ? likedSongIds.has(song.id) : false;

    useEffect(() => {
        loadSongData();
        return () => resetMetaTags();
    }, [songId]);

    useEffect(() => {
        if (song) updateMetaTags(song);
    }, [song]);

    useEffect(() => {
        if (editingTitle && titleInputRef.current) {
            titleInputRef.current.focus();
            titleInputRef.current.select();
        }
    }, [editingTitle]);

    const loadSongData = async () => {
        setLoading(true);
        try {
            const response = await songsApi.getFullSong(songId, token);
            const transformedSong: Song = {
                id: response.song.id,
                title: response.song.title,
                lyrics: response.song.lyrics,
                style: response.song.style,
                coverUrl: `https://picsum.photos/seed/${response.song.id}/400/400`,
                duration: response.song.duration
                    ? `${Math.floor(response.song.duration / 60)}:${String(Math.floor(response.song.duration % 60)).padStart(2, '0')}`
                    : '0:00',
                createdAt: new Date(response.song.created_at),
                tags: response.song.tags || [],
                audioUrl: getAudioUrl(response.song.audio_url, response.song.id),
                isPublic: response.song.is_public,
                likeCount: response.song.like_count || 0,
                viewCount: response.song.view_count || 0,
                userId: response.song.user_id,
                creator: response.song.creator,
                creator_avatar: response.song.creator_avatar,
                generation_params: response.song.generation_params,
            };
            setSong(transformedSong);
        } catch (error) {
            console.error('Failed to load song:', error);
        } finally {
            setLoading(false);
        }
    };

    const startEditingTitle = () => {
        if (!song || !isOwner) return;
        setTitleDraft(song.title);
        setEditingTitle(true);
    };

    const cancelEditingTitle = () => {
        setEditingTitle(false);
        setTitleDraft('');
    };

    const saveTitle = async () => {
        if (!song || !token || !titleDraft.trim() || titleDraft.trim() === song.title) {
            cancelEditingTitle();
            return;
        }
        setSavingTitle(true);
        try {
            await songsApi.updateSong(song.id, { title: titleDraft.trim() }, token);
            const updated = { ...song, title: titleDraft.trim() };
            setSong(updated);
            onSongUpdate?.(updated);
        } catch (error) {
            console.error('Failed to update title:', error);
        } finally {
            setSavingTitle(false);
            setEditingTitle(false);
        }
    };

    const handleTitleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') saveTitle();
        if (e.key === 'Escape') cancelEditingTitle();
    };

    const handleThumbnailUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file || !song || !token) return;

        // Validate: images only, max 5MB
        if (!file.type.startsWith('image/')) return;
        if (file.size > 5 * 1024 * 1024) {
            alert('Thumbnail must be under 5MB');
            return;
        }

        setUploadingThumbnail(true);
        try {
            // TODO: Wire to actual thumbnail upload endpoint when backend supports it
            // For now, create a local preview
            const url = URL.createObjectURL(file);
            const updated = { ...song, coverUrl: url };
            setSong(updated);
            onSongUpdate?.(updated);
            console.log('[S³] Thumbnail upload: backend endpoint pending. Local preview applied.');
        } catch (error) {
            console.error('Failed to upload thumbnail:', error);
        } finally {
            setUploadingThumbnail(false);
            if (thumbnailInputRef.current) thumbnailInputRef.current.value = '';
        }
    };

    const handleRegenerateThumbnail = () => {
        if (!song) return;
        // Regenerate by changing the picsum seed
        const newSeed = `${song.id}-${Date.now()}`;
        const updated = { ...song, coverUrl: `https://picsum.photos/seed/${newSeed}/400/400` };
        setSong(updated);
        onSongUpdate?.(updated);
    };

    // Reuse actions that extract specific data from generation_params
    const handleReusePrompts = () => {
        if (song && onReusePrompt) onReusePrompt(song);
    };

    const handleReuseLyrics = () => {
        if (!song) return;
        // Create a song-like object with only lyrics populated for reuse
        const lyricsOnly = { ...song, style: '' };
        onReusePrompt?.(lyricsOnly);
    };

    const handleReuseBoth = () => {
        if (song && onReusePrompt) onReusePrompt(song);
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center h-full bg-zinc-50 dark:bg-black">
                <div className="text-zinc-500 dark:text-zinc-400 flex items-center gap-2">
                    <div className="w-4 h-4 border-2 border-zinc-400 border-t-transparent rounded-full animate-spin" />
                    Loading song...
                </div>
            </div>
        );
    }

    if (!song) {
        return (
            <div className="flex flex-col items-center justify-center h-full gap-4 bg-zinc-50 dark:bg-black">
                <div className="text-zinc-500 dark:text-zinc-400">Song not found</div>
                <button onClick={onBack} className="px-4 py-2 bg-zinc-200 dark:bg-zinc-800 hover:bg-zinc-300 dark:hover:bg-zinc-700 rounded-lg text-zinc-900 dark:text-white transition-colors">
                    Go Back
                </button>
            </div>
        );
    }

    return (
        <div className="w-full h-full flex flex-col bg-zinc-50 dark:bg-black overflow-hidden">
            {/* Header */}
            <div className="border-b border-zinc-200 dark:border-zinc-800 px-4 md:px-6 py-4 flex-shrink-0">
                <button
                    onClick={onBack}
                    className="flex items-center gap-2 text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white mb-4 transition-colors"
                >
                    <ArrowLeft size={20} />
                    <span>Back</span>
                </button>

                <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
                    <div className="flex-1">
                        {/* Title with inline edit */}
                        <div className="flex items-center gap-2 mb-2">
                            {editingTitle ? (
                                <div className="flex items-center gap-2 flex-1">
                                    <input
                                        ref={titleInputRef}
                                        value={titleDraft}
                                        onChange={(e) => setTitleDraft(e.target.value)}
                                        onKeyDown={handleTitleKeyDown}
                                        className="text-2xl md:text-3xl font-bold text-zinc-900 dark:text-white bg-transparent border-b-2 border-accent-500 outline-none flex-1 min-w-0"
                                        disabled={savingTitle}
                                        maxLength={200}
                                    />
                                    <button
                                        onClick={saveTitle}
                                        disabled={savingTitle}
                                        className="p-1.5 rounded-full bg-green-600 hover:bg-green-700 text-white transition-colors"
                                        title="Save"
                                    >
                                        <Check size={16} />
                                    </button>
                                    <button
                                        onClick={cancelEditingTitle}
                                        className="p-1.5 rounded-full bg-zinc-600 hover:bg-zinc-700 text-white transition-colors"
                                        title="Cancel"
                                    >
                                        <X size={16} />
                                    </button>
                                </div>
                            ) : (
                                <>
                                    <h1 className="text-2xl md:text-3xl font-bold text-zinc-900 dark:text-white">{song.title}</h1>
                                    {isOwner && (
                                        <button
                                            onClick={startEditingTitle}
                                            className="p-1.5 rounded-full hover:bg-zinc-200 dark:hover:bg-zinc-800 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
                                            title="Edit title"
                                        >
                                            <Pencil size={14} />
                                        </button>
                                    )}
                                </>
                            )}
                        </div>

                        <div className="flex items-center gap-3 mb-3">
                            <div
                                onClick={() => song.creator && onNavigateToProfile(song.creator)}
                                className="flex items-center gap-2 cursor-pointer hover:underline"
                            >
                                <div className="w-6 h-6 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-xs font-bold text-white overflow-hidden">
                                    {song.creator_avatar ? (
                                        <img src={song.creator_avatar} alt={song.creator || 'Creator'} className="w-full h-full object-cover" />
                                    ) : (
                                        song.creator ? song.creator[0].toUpperCase() : 'A'
                                    )}
                                </div>
                                <span className="text-zinc-900 dark:text-white font-semibold">{song.creator || 'Anonymous'}</span>
                            </div>
                        </div>

                        {/* Tags */}
                        <div className="flex flex-wrap gap-2 mb-2">
                            {song.style.split(',').slice(0, 4).map((tag, i) => (
                                <span key={i} className="px-2 py-1 bg-zinc-200 dark:bg-zinc-800 rounded text-xs text-zinc-600 dark:text-zinc-300">
                                    {tag.trim()}
                                </span>
                            ))}
                        </div>

                        <div className="text-xs text-zinc-500">
                            {new Date(song.createdAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })} at {new Date(song.createdAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                            {!song.isPublic && isOwner && (
                                <span className="ml-2 px-2 py-0.5 bg-zinc-200 dark:bg-zinc-800 rounded text-xs text-zinc-600 dark:text-zinc-400">Private</span>
                            )}
                        </div>
                    </div>

                    {/* Related Songs Tab */}
                    <div className="hidden md:flex items-center gap-2">
                        <button className="px-4 py-2 bg-zinc-900 dark:bg-white text-white dark:text-black rounded-full text-sm font-semibold">
                            Similar
                        </button>
                        <button
                            onClick={() => song.creator && onNavigateToProfile(song.creator)}
                            className="px-4 py-2 text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white text-sm font-semibold transition-colors"
                        >
                            By {song.creator || 'Artist'}
                        </button>
                    </div>
                </div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto">
                <div className="max-w-3xl mx-auto px-4 md:px-6 py-4 md:py-6">
                    <div className="space-y-4 md:space-y-6">

                        {/* Cover Art with thumbnail controls */}
                        <div className="relative aspect-square max-w-xs md:max-w-sm mx-auto lg:mx-0 rounded-xl overflow-hidden shadow-2xl group">
                            <img src={song.coverUrl} alt={song.title} className={`w-full h-full object-cover transition-transform duration-500 ${isCurrentlyPlaying ? 'scale-105' : ''}`} />
                            <button
                                onClick={() => onPlay(song)}
                                className={`absolute inset-0 transition-colors flex items-center justify-center ${isCurrentSong ? 'bg-black/50' : 'bg-black/40 hover:bg-black/50'}`}
                            >
                                <div className="w-16 h-16 md:w-20 md:h-20 rounded-full bg-white group-hover:scale-110 transition-transform flex items-center justify-center shadow-xl">
                                    {isCurrentlyPlaying ? (
                                        <Pause size={28} className="text-black fill-black md:w-8 md:h-8" />
                                    ) : (
                                        <Play size={28} className="text-black fill-black ml-1 md:w-8 md:h-8" />
                                    )}
                                </div>
                            </button>
                            {isCurrentlyPlaying && (
                                <div className="absolute bottom-4 left-4 flex items-center gap-1">
                                    <span className="w-1.5 h-4 bg-accent-500 rounded-full animate-pulse" style={{ animationDelay: '0ms' }} />
                                    <span className="w-1.5 h-6 bg-accent-500 rounded-full animate-pulse" style={{ animationDelay: '150ms' }} />
                                    <span className="w-1.5 h-3 bg-accent-500 rounded-full animate-pulse" style={{ animationDelay: '300ms' }} />
                                    <span className="w-1.5 h-7 bg-accent-500 rounded-full animate-pulse" style={{ animationDelay: '450ms' }} />
                                </div>
                            )}

                            {/* Thumbnail controls (owner only, always visible) */}
                            {isOwner && (
                                <div className="absolute top-2 right-2 flex gap-1.5">
                                    <button
                                        onClick={(e) => { e.stopPropagation(); handleRegenerateThumbnail(); }}
                                        className="p-2 bg-black/70 hover:bg-black/90 rounded-lg text-white transition-colors"
                                        title="Regenerate thumbnail"
                                    >
                                        <RefreshCw size={14} />
                                    </button>
                                    <button
                                        onClick={(e) => { e.stopPropagation(); setShowThumbnailModal(true); }}
                                        className="p-2 bg-black/70 hover:bg-black/90 rounded-lg text-white transition-colors"
                                        title="Upload custom artwork"
                                    >
                                        <Upload size={14} />
                                    </button>
                                </div>
                            )}

                            {uploadingThumbnail && (
                                <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
                                    <div className="w-6 h-6 border-2 border-white border-t-transparent rounded-full animate-spin" />
                                </div>
                            )}
                        </div>

                        {/* Primary Action Buttons */}
                        <div className="flex items-center justify-center lg:justify-start gap-2 md:gap-3 flex-wrap">
                            <div className="flex items-center gap-2 bg-zinc-200 dark:bg-zinc-900 px-3 py-2 rounded-full text-sm">
                                <Eye size={16} className="text-zinc-600 dark:text-white" />
                                <span className="text-zinc-900 dark:text-white font-semibold">{song.viewCount || 0}</span>
                            </div>
                            <button
                                onClick={() => onToggleLike?.(song.id)}
                                className={`flex items-center gap-2 px-3 py-2 rounded-full text-sm transition-colors ${isLiked ? 'bg-accent-500 text-white' : 'bg-zinc-200 dark:bg-zinc-900 hover:bg-zinc-300 dark:hover:bg-zinc-800 text-zinc-900 dark:text-white'}`}
                            >
                                <Heart size={16} className={isLiked ? 'fill-current' : ''} />
                                <span className="font-semibold">{song.likeCount || 0}</span>
                            </button>
                            <button
                                onClick={() => setShareModalOpen(true)}
                                className="p-2 bg-zinc-200 dark:bg-zinc-900 hover:bg-zinc-300 dark:hover:bg-zinc-800 rounded-full transition-colors"
                                title="Share"
                            >
                                <Share2 size={16} className="text-zinc-700 dark:text-white" />
                            </button>

                            {/* Three-dot menu */}
                            <div ref={dropdownAnchorRef} className="relative">
                                <button
                                    onClick={() => setDropdownOpen(!dropdownOpen)}
                                    className="p-2 bg-zinc-200 dark:bg-zinc-900 hover:bg-zinc-300 dark:hover:bg-zinc-800 rounded-full transition-colors"
                                >
                                    <MoreHorizontal size={16} className="text-zinc-700 dark:text-white" />
                                </button>
                                <SongDropdownMenu
                                    song={song}
                                    isOpen={dropdownOpen}
                                    onClose={() => setDropdownOpen(false)}
                                    isOwner={!!isOwner}
                                    position="left"
                                    onCreateVideo={() => onCreateVideo?.(song)}
                                    onReusePrompt={() => handleReusePrompts()}
                                    onCover={() => onCover?.(song)}
                                    onShare={() => setShareModalOpen(true)}
                                    onDelete={async () => {
                                        if (!token) return;
                                        if (confirm('Delete this song permanently?')) {
                                            try {
                                                await songsApi.deleteSong(song.id, token);
                                                onBack();
                                            } catch (err) {
                                                console.error('Failed to delete song:', err);
                                            }
                                        }
                                    }}
                                />
                            </div>
                        </div>

                        {/* Creative Action Buttons */}
                        <div className="flex flex-wrap gap-2">
                            {onCover && (
                                <button
                                    onClick={() => onCover(song)}
                                    className="flex items-center gap-2 px-3 py-2 bg-purple-600/20 hover:bg-purple-600/30 border border-purple-500/30 rounded-lg text-sm text-purple-300 hover:text-purple-200 transition-colors"
                                    title="Use this song as a reference for an AI cover"
                                >
                                    <Disc3 size={14} />
                                    <span>Cover</span>
                                </button>
                            )}
                            {onReusePrompt && (
                                <button
                                    onClick={handleReusePrompts}
                                    className="flex items-center gap-2 px-3 py-2 bg-blue-600/20 hover:bg-blue-600/30 border border-blue-500/30 rounded-lg text-sm text-blue-300 hover:text-blue-200 transition-colors"
                                    title="Reuse the style/prompt from this song"
                                >
                                    <Repeat size={14} />
                                    <span>Reuse Prompts</span>
                                </button>
                            )}
                            {song.lyrics && onReusePrompt && (
                                <button
                                    onClick={handleReuseLyrics}
                                    className="flex items-center gap-2 px-3 py-2 bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/30 rounded-lg text-sm text-emerald-300 hover:text-emerald-200 transition-colors"
                                    title="Reuse the lyrics from this song"
                                >
                                    <FileText size={14} />
                                    <span>Reuse Lyrics</span>
                                </button>
                            )}
                            {song.lyrics && onReusePrompt && (
                                <button
                                    onClick={handleReuseBoth}
                                    className="flex items-center gap-2 px-3 py-2 bg-amber-600/20 hover:bg-amber-600/30 border border-amber-500/30 rounded-lg text-sm text-amber-300 hover:text-amber-200 transition-colors"
                                    title="Reuse both prompts and lyrics"
                                >
                                    <Copy size={14} />
                                    <span>Reuse Both</span>
                                </button>
                            )}
                            {onExportToDaw && (
                                <button
                                    onClick={() => onExportToDaw(song)}
                                    className="flex items-center gap-2 px-3 py-2 bg-cyan-600/20 hover:bg-cyan-600/30 border border-cyan-500/30 rounded-lg text-sm text-cyan-300 hover:text-cyan-200 transition-colors"
                                    title="Export to DAW for stem editing"
                                >
                                    <FileMusic size={14} />
                                    <span>Export to DAW</span>
                                </button>
                            )}
                        </div>

                        {/* Lyrics */}
                        {song.lyrics && (
                            <div className="bg-white dark:bg-zinc-900/50 border border-zinc-200 dark:border-zinc-800 rounded-xl p-4">
                                <h3 className="text-sm font-semibold text-zinc-900 dark:text-white mb-3">Lyrics</h3>
                                <div className="text-sm text-zinc-700 dark:text-zinc-300 whitespace-pre-line leading-relaxed max-h-72 md:max-h-96 overflow-y-auto">
                                    {song.lyrics}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {song && (
                <ShareModal
                    isOpen={shareModalOpen}
                    onClose={() => setShareModalOpen(false)}
                    song={song}
                />
            )}

            {/* Thumbnail Upload Modal */}
            {showThumbnailModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setShowThumbnailModal(false)}>
                    <div className="bg-zinc-900 border border-zinc-700 rounded-2xl p-6 max-w-sm mx-4 shadow-2xl" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center gap-3 mb-4">
                            <div className="w-10 h-10 rounded-xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center">
                                <ImagePlus size={18} className="text-purple-400" />
                            </div>
                            <div>
                                <h3 className="text-sm font-bold text-white">Upload Album Artwork</h3>
                                <p className="text-[10px] text-zinc-400">Replace the current cover image</p>
                            </div>
                        </div>

                        <div className="bg-zinc-800/50 rounded-lg p-4 mb-4 border border-zinc-700/50 space-y-2">
                            <div className="flex items-center justify-between text-xs">
                                <span className="text-zinc-400">Recommended size</span>
                                <span className="text-white font-medium">400 x 400 px</span>
                            </div>
                            <div className="flex items-center justify-between text-xs">
                                <span className="text-zinc-400">Max file size</span>
                                <span className="text-white font-medium">5 MB</span>
                            </div>
                            <div className="flex items-center justify-between text-xs">
                                <span className="text-zinc-400">Formats</span>
                                <span className="text-white font-medium">PNG, JPG, WebP</span>
                            </div>
                            <div className="flex items-center justify-between text-xs">
                                <span className="text-zinc-400">Aspect ratio</span>
                                <span className="text-white font-medium">1:1 (square)</span>
                            </div>
                        </div>

                        <p className="text-[11px] text-zinc-500 mb-4 leading-relaxed">
                            For best results, use a square image at 400x400 pixels or larger. Non-square images will be cropped to fit.
                        </p>

                        <div className="flex gap-2">
                            <button
                                onClick={() => setShowThumbnailModal(false)}
                                className="flex-1 px-3 py-2.5 text-xs font-medium text-zinc-400 hover:text-zinc-200 border border-zinc-700 rounded-lg transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={() => { thumbnailInputRef.current?.click(); }}
                                className="flex-1 px-3 py-2.5 text-xs font-bold text-black bg-purple-400 hover:bg-purple-300 rounded-lg transition-colors flex items-center justify-center gap-2"
                            >
                                <Upload size={14} />
                                Choose File
                            </button>
                        </div>

                        <input
                            ref={thumbnailInputRef}
                            type="file"
                            accept="image/png,image/jpeg,image/webp"
                            onChange={(e) => { handleThumbnailUpload(e); setShowThumbnailModal(false); }}
                            className="hidden"
                        />
                    </div>
                </div>
            )}
        </div>
    );
};
