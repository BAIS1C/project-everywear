// @ts-nocheck
import React, { useState, useEffect, useRef } from 'react';
import { Song, Playlist, playlistsApi, songsApi, getAudioUrl } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { ArrowLeft, Play, MoreHorizontal, Clock, Calendar, Shuffle, Trash2, Mic2, Music, Camera, Loader2 } from 'lucide-react';
import ConfirmDialog from './ConfirmDialog';

/**
 * Downscale + JPEG-encode an image File to a data URL the backend can
 * store as the playlist coverKey. Center-crops to a square at the
 * requested edge length so wide / tall photos still read as a tile.
 *
 * 400x400 @ 0.85 quality lands around 30–60 KB for typical photos,
 * which fits comfortably inside the existing playlist row payload and
 * round-trips through the cover_url -> coverKey field without needing
 * a separate upload endpoint. Sean, 2026-04-25 SGT.
 */
async function fileToCoverDataUrl(file: File, edge = 400, quality = 0.85): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Failed to read image file'));
    reader.onload = (ev) => {
      const src = ev.target?.result as string;
      if (!src) return reject(new Error('Empty file'));
      const img = new Image();
      img.onerror = () => reject(new Error('Failed to decode image'));
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = edge;
        canvas.height = edge;
        const ctx = canvas.getContext('2d');
        if (!ctx) return reject(new Error('Canvas 2D unavailable'));
        // Center-crop the source to a square, then scale into the canvas.
        const srcSide = Math.min(img.width, img.height);
        const sx = (img.width - srcSide) / 2;
        const sy = (img.height - srcSide) / 2;
        ctx.drawImage(img, sx, sy, srcSide, srcSide, 0, 0, edge, edge);
        try {
          resolve(canvas.toDataURL('image/jpeg', quality));
        } catch (e) {
          reject(e);
        }
      };
      img.src = src;
    };
    reader.readAsDataURL(file);
  });
}

interface PlaylistDetailProps {
    playlistId: string;
    onBack: () => void;
    onPlaySong: (song: Song, list?: Song[]) => void;
    onSelect: (song: Song) => void;
    onNavigateToProfile: (username: string) => void;
}

export const PlaylistDetail: React.FC<PlaylistDetailProps> = ({ playlistId, onBack, onPlaySong, onSelect, onNavigateToProfile }) => {
    const { user: currentUser, token } = useAuth();
    const [playlist, setPlaylist] = useState<Playlist & { creator_avatar?: string } | null>(null);
    const [songs, setSongs] = useState<Song[]>([]);
    const [loading, setLoading] = useState(true);
    const [uploadingCover, setUploadingCover] = useState(false);
    const [coverError, setCoverError] = useState<string | null>(null);
    const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
    const coverInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        loadPlaylist();
    }, [playlistId]);

    const loadPlaylist = async () => {
        setLoading(true);
        try {
            const res = await playlistsApi.getPlaylist(playlistId, token);
            // res.playlist comes from DB row, which now includes creator_avatar
            setPlaylist(res.playlist as any);

            // Songs come from api.ts already normalised (getAudioUrl applied,
            // is_public + isPublic mirrors populated, addedAt attached).
            // Add cover fallback for rows with no cover_url.
            const withCoverFallback: Song[] = res.songs.map((s) => ({
                ...s,
                coverUrl: s.coverUrl || s.cover_url || `https://picsum.photos/seed/${s.id}/400/400`,
            }));

            setSongs(withCoverFallback);
        } catch (error) {
            console.error('Failed to load playlist:', error);
        } finally {
            setLoading(false);
        }
    };

    // ... (retaining methods handleRemove, handleDelete) ...
    const handleRemoveSong = async (songId: string) => {
        if (!token || !playlist) return;
        try {
            await playlistsApi.removeSong(playlist.id, songId, token);
            setSongs(prev => prev.filter(s => s.id !== songId));
        } catch (error) {
            console.error('Failed to remove song:', error);
        }
    };

    const handleDeletePlaylist = async () => {
        if (!token || !playlist) return;
        try {
            await playlistsApi.delete(playlist.id, token);
            onBack();
        } catch (error) {
            console.error('Failed to delete playlist:', error);
        }
    };

    /**
     * Owner-only cover upload. Reads the picked file, downscales to a
     * 400x400 JPEG via fileToCoverDataUrl, then patches the playlist
     * record with the data URL as cover_url. The backend stores it in
     * coverKey, which the read path returns inline (see api.ts coverUrl
     * resolution: data: prefix is passed through as-is). 2026-04-25 SGT.
     */
    const handleCoverChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        // Reset input value so picking the same file twice still fires onChange.
        e.target.value = '';
        if (!file || !token || !playlist) return;
        if (!file.type.startsWith('image/')) {
            setCoverError('Pick an image file (PNG, JPG, WEBP).');
            return;
        }
        setCoverError(null);
        setUploadingCover(true);
        try {
            const dataUrl = await fileToCoverDataUrl(file);
            const res = await playlistsApi.update(
                playlist.id,
                { cover_url: dataUrl },
                token,
            );
            setPlaylist((prev) =>
                prev ? { ...prev, cover_url: res.playlist.cover_url, coverUrl: res.playlist.cover_url } : prev,
            );
        } catch (err) {
            console.error('Failed to update playlist cover:', err);
            setCoverError(err instanceof Error ? err.message : 'Failed to update cover');
        } finally {
            setUploadingCover(false);
        }
    };

    const triggerCoverPicker = () => {
        if (!isOwner || uploadingCover) return;
        coverInputRef.current?.click();
    };

    if (loading) return (
        <div className="flex items-center justify-center h-full bg-black">
            <div className="text-zinc-400 gap-2 flex items-center">
                <div className="w-4 h-4 border-2 border-zinc-400 border-t-transparent rounded-full animate-spin"></div>
                Loading playlist...
            </div>
        </div>
    );

    if (!playlist) return (
        <div className="flex flex-col items-center justify-center h-full gap-4 bg-black">
            <div className="text-zinc-400">Playlist not found</div>
            <button onClick={onBack} className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 rounded-lg text-white">
                Go Back
            </button>
        </div>
    );

    const isOwner = currentUser?.id === playlist.user_id;

    // Gradient based on ID/Name
    const gradients = [
        'from-purple-900 to-black',
        'from-blue-900 to-black',
        'from-indigo-900 to-black',
        'from-rose-900 to-black',
    ];
    const bgGradient = gradients[playlist.name.length % gradients.length];

    return (
        <div className={`w-full h-full flex flex-col bg-gradient-to-b ${bgGradient} overflow-hidden`}>
            {/* Header */}
            <div className="flex-shrink-0 p-4 md:p-8 pt-12 md:pt-8 flex flex-col md:flex-row gap-4 md:gap-8 items-center md:items-end bg-black/20 backdrop-blur-lg border-b border-white/10">
                {/* Cover. Owner-clickable: opens a hidden file picker that
                    routes through fileToCoverDataUrl + playlistsApi.update.
                    Hover overlay surfaces a Camera affordance only for the
                    owner; viewers see a static cover. EWDS retheme polish
                    2026-04-25 SGT. */}
                <div
                    onClick={triggerCoverPicker}
                    className={`w-32 h-32 md:w-52 md:h-52 shadow-2xl rounded-lg bg-zinc-800 flex items-center justify-center overflow-hidden flex-shrink-0 group relative ${isOwner ? 'cursor-pointer' : ''}`}
                    title={isOwner ? 'Change playlist cover' : undefined}
                >
                    {playlist.cover_url ? (
                        <img src={playlist.cover_url} alt={playlist.name} className="w-full h-full object-cover" />
                    ) : (
                        <div className="w-full h-full bg-gradient-to-br from-zinc-700 to-zinc-900 flex items-center justify-center">
                            <Music size={40} className="text-white/20 md:hidden" />
                            <Music size={64} className="text-white/20 hidden md:block" />
                            <span className="text-4xl md:text-6xl font-bold text-white/10">{playlist.name[0].toUpperCase()}</span>
                        </div>
                    )}

                    {/* Owner-only hover overlay. Shows Camera + label so
                        the affordance is obvious without taking the cover
                        out of full bleed. Loading spinner replaces it
                        while the new cover is encoding/uploading. */}
                    {isOwner && (
                        <div
                            className="absolute inset-0 flex flex-col items-center justify-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity"
                            style={{
                                background: 'rgba(0,0,0,0.55)',
                                color: 'var(--ew-text)',
                            }}
                        >
                            {uploadingCover ? (
                                <>
                                    <Loader2 size={22} className="animate-spin" />
                                    <span
                                        style={{
                                            fontFamily: 'var(--ew-font-mono)',
                                            fontSize: 9,
                                            letterSpacing: '0.22em',
                                            textTransform: 'uppercase',
                                        }}
                                    >
                                        Saving
                                    </span>
                                </>
                            ) : (
                                <>
                                    <Camera size={22} />
                                    <span
                                        style={{
                                            fontFamily: 'var(--ew-font-mono)',
                                            fontSize: 9,
                                            letterSpacing: '0.22em',
                                            textTransform: 'uppercase',
                                        }}
                                    >
                                        Change Cover
                                    </span>
                                </>
                            )}
                        </div>
                    )}

                    {/* Persistent spinner when uploading even without hover,
                        so the user gets feedback if their cursor moves off. */}
                    {isOwner && uploadingCover && (
                        <div
                            className="absolute top-2 right-2 w-6 h-6 flex items-center justify-center"
                            style={{
                                background: 'rgba(0,0,0,0.65)',
                                borderRadius: '50%',
                            }}
                        >
                            <Loader2 size={14} className="animate-spin" style={{ color: 'var(--ew-primary)' }} />
                        </div>
                    )}

                    {/* Hidden file input. accept=image/* keeps the OS picker
                        scoped to images; multiple=false because covers are
                        single-image. */}
                    {isOwner && (
                        <input
                            ref={coverInputRef}
                            type="file"
                            accept="image/png,image/jpeg,image/webp,image/gif"
                            className="hidden"
                            onChange={handleCoverChange}
                        />
                    )}
                </div>

                {/* Info */}
                <div className="flex-1 space-y-2 md:space-y-4 text-center md:text-left">
                    <span className="text-xs font-bold tracking-wider uppercase text-white/80">Playlist</span>
                    <h1 className="text-2xl md:text-5xl lg:text-7xl font-bold text-white tracking-tight leading-none drop-shadow-lg">
                        {playlist.name}
                    </h1>
                    {playlist.description && (
                        <p className="text-zinc-300 text-sm max-w-2xl hidden md:block">{playlist.description}</p>
                    )}

                    <div className="flex items-center justify-center md:justify-start gap-2 text-sm text-white font-medium flex-wrap">
                        {playlist.creator && (
                            <div
                                className="flex items-center gap-2 cursor-pointer hover:underline"
                                onClick={() => onNavigateToProfile(playlist.creator!)}
                            >
                                {playlist.creator_avatar ? (
                                    <img src={playlist.creator_avatar} alt={playlist.creator} className="w-5 h-5 md:w-6 md:h-6 rounded-full object-cover" />
                                ) : (
                                    <div className="w-5 h-5 md:w-6 md:h-6 rounded-full bg-gradient-to-r from-green-400 to-blue-500"></div>
                                )}
                                <span>{playlist.creator}</span>
                            </div>
                        )}
                        <span className="w-1 h-1 rounded-full bg-white/50"></span>
                        <span>{songs.length} songs</span>
                        <span className="w-1 h-1 rounded-full bg-white/50 hidden md:block"></span>
                        <span className="text-zinc-400 hidden md:block">
                            {songs.reduce((acc, s) => acc + (s.duration ? (typeof s.duration === 'string' ? 0 : s.duration) : 0), 0) > 0
                                ? Math.floor(songs.reduce((acc, s) => acc + (s.duration as number || 0), 0) / 60) + " min"
                                : ""}
                        </span>
                    </div>
                </div>
            </div>

            {/* Actions Bar */}
            <div className="px-4 md:px-8 py-3 md:py-4 bg-black/20 flex items-center gap-3 md:gap-4">
                <button
                    onClick={() => songs.length > 0 && onPlaySong(songs[0], songs)}
                    className="w-12 h-12 md:w-14 md:h-14 rounded-full bg-green-500 hover:scale-105 transition-transform flex items-center justify-center text-black shadow-lg"
                >
                    <Play size={24} fill="currentColor" className="ml-1" />
                </button>

                {isOwner && (
                    <button
                        onClick={() => setDeleteConfirmOpen(true)}
                        className="text-zinc-400 hover:text-red-500 transition-colors p-2"
                        title="Delete Playlist"
                    >
                        <Trash2 size={20} />
                    </button>
                )}

                <div className="flex-1"></div>

                <div className="text-zinc-400 text-xs md:text-sm">
                    {playlist.is_public ? 'Public' : 'Private'}
                </div>
            </div>

            {/* Song List */}
            <div className="flex-1 overflow-y-auto bg-black/40">
                <div className="px-2 md:px-8 py-2 md:py-4">
                    {/* Desktop Header */}
                    <div className="hidden md:grid grid-cols-[16px_4fr_3fr_2fr_minmax(120px,1fr)] gap-4 px-4 py-2 border-b border-white/10 text-sm font-medium text-zinc-400 mb-2 sticky top-0 bg-[#121212] z-10">
                        <span>#</span>
                        <span>Title</span>
                        <span>Artist</span>
                        <span>Date Added</span>
                        <span className="text-right"><Clock size={16} className="inline" /></span>
                    </div>

                    <div className="space-y-1">
                        {songs.map((song, index) => (
                            <div
                                key={song.id}
                                className="group flex md:grid md:grid-cols-[16px_4fr_3fr_2fr_minmax(120px,1fr)] gap-3 md:gap-4 px-2 md:px-4 py-3 rounded-md hover:bg-white/10 items-center transition-colors text-sm text-zinc-400 hover:text-white cursor-pointer"
                                onClick={() => {
                                    onSelect(song);
                                    onPlaySong(song, songs);
                                }}
                            >
                                {/* Index - hidden on mobile */}
                                <span className="hidden md:block group-hover:text-white">{index + 1}</span>

                                {/* Cover + Title */}
                                <div className="flex items-center gap-3 overflow-hidden flex-1 md:flex-none">
                                    <div className="w-12 h-12 md:w-10 md:h-10 rounded bg-zinc-800 flex-shrink-0 overflow-hidden relative group/img">
                                        <img src={song.coverUrl} alt="" className="w-full h-full object-cover" />
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                onPlaySong(song, songs);
                                            }}
                                            className="absolute inset-0 bg-black/50 flex md:hidden group-hover/img:flex items-center justify-center text-white"
                                        >
                                            <Play size={16} fill="white" />
                                        </button>
                                    </div>
                                    <div className="flex flex-col truncate min-w-0">
                                        <span className="font-medium text-white truncate">{song.title}</span>
                                        <span className="text-xs text-zinc-500 group-hover:text-zinc-400 truncate">
                                            {song.creator || 'Unknown'} <span className="md:hidden">• {song.duration ? `${Math.floor(song.duration / 60)}:${String(Math.floor(song.duration % 60)).padStart(2, '0')}` : '0:00'}</span>
                                        </span>
                                    </div>
                                </div>

                                {/* Artist - hidden on mobile */}
                                <span className="hidden md:block hover:underline cursor-pointer truncate" onClick={(e) => {
                                    e.stopPropagation();
                                    song.creator && onNavigateToProfile(song.creator);
                                }}>
                                    {song.creator || 'Unknown'}
                                </span>

                                {/* Date Added - hidden on mobile */}
                                <span className="hidden md:block">
                                    {song.addedAt ? new Date(song.addedAt).toLocaleDateString() : 'Just now'}
                                </span>

                                {/* Duration + Actions */}
                                <div className="hidden md:flex items-center justify-end gap-4">
                                    <span className="font-mono text-xs">
                                        {song.duration ? `${Math.floor(song.duration / 60)}:${String(Math.floor(song.duration % 60)).padStart(2, '0')}` : '0:00'}
                                    </span>
                                    {isOwner && (
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                handleRemoveSong(song.id);
                                            }}
                                            className="opacity-0 group-hover:opacity-100 text-zinc-500 hover:text-white transition-opacity"
                                        >
                                            <Trash2 size={16} />
                                        </button>
                                    )}
                                </div>

                                {/* Mobile delete button */}
                                {isOwner && (
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            handleRemoveSong(song.id);
                                        }}
                                        className="md:hidden text-zinc-500 hover:text-white p-2"
                                    >
                                        <Trash2 size={18} />
                                    </button>
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            {/* Back button absolute */}
            <button
                onClick={onBack}
                className="absolute top-6 left-6 z-50 w-8 h-8 rounded-full bg-black/50 flex items-center justify-center text-white hover:bg-black/70 transition-colors"
            >
                <ArrowLeft size={18} />
            </button>

            <ConfirmDialog
                open={deleteConfirmOpen}
                title="Delete playlist?"
                body={`"${playlist.name}" will be removed. This cannot be undone.`}
                confirmLabel="Delete"
                destructive
                onCancel={() => setDeleteConfirmOpen(false)}
                onConfirm={() => {
                    setDeleteConfirmOpen(false);
                    void handleDeletePlaylist();
                }}
            />
        </div>
    );
};
