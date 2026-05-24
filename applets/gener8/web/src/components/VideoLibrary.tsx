// @ts-nocheck
import React, { useState, useEffect, useCallback } from 'react';
import { Film, FolderOpen, Share2, Play, RefreshCw } from 'lucide-react';
import { getApiBase } from '@/services/api';
import { ShareModal } from './ShareModal';
import { Song } from '../types';

interface VideoEntry {
  filename: string;
  path: string;
  size_bytes: number;
  created_at: number; // unix epoch millis
}

/** Extract a display title from the saved filename (strip timestamp hash + .mp4) */
function displayTitle(filename: string): string {
  // Format: "Title_Here_ab12cd34.mp4" → "Title Here"
  return filename
    .replace(/\.mp4$/i, '')
    .replace(/_[a-f0-9]{8}$/, '') // strip the 8-char hash suffix
    .replace(/_/g, ' ')
    .trim() || 'Untitled Video';
}

function formatDate(ms: number): string {
  const d = new Date(ms);
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export const VideoLibrary: React.FC = () => {
  const [videos, setVideos] = useState<VideoEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [playingVideo, setPlayingVideo] = useState<VideoEntry | null>(null);
  const [shareVideo, setShareVideo] = useState<VideoEntry | null>(null);

  const fetchVideos = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${getApiBase()}/api/videos`);
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const data = await res.json();
      setVideos(data.videos || []);
    } catch (e: any) {
      setError(e.message || 'Failed to load videos');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchVideos(); }, [fetchVideos]);

  const handleRevealInFolder = async (video: VideoEntry) => {
    try {
      // Use shell/reveal endpoint which accepts raw paths (not launcher/reveal-in-folder
      // which expects /audio/ URL keys and can't resolve video paths).
      const res = await fetch(`${getApiBase()}/api/shell/reveal`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: video.path }),
      });
      if (!res.ok) {
        const msg = await res.text().catch(() => res.statusText);
        console.error('Reveal failed:', msg);
      }
    } catch (e) {
      console.error('Reveal failed:', e);
    }
  };

  const handleShare = (video: VideoEntry) => {
    setShareVideo(video);
  };

  // Build a Song-like object for ShareModal compatibility
  const shareAsSong = (video: VideoEntry): Song => ({
    id: video.filename,
    title: displayTitle(video.filename),
    style: 'Video',
    lyrics: '',
    audio_url: '',
    duration: '',
    coverUrl: '',
  } as Song);

  return (
    <div className="flex-1 bg-white dark:bg-black overflow-y-auto custom-scrollbar p-6 lg:p-10 pb-32 transition-colors duration-300">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center">
            <Film size={20} className="text-white" />
          </div>
          <h1 className="text-3xl font-bold text-zinc-900 dark:text-white">Videos</h1>
          <span className="text-sm text-zinc-500 dark:text-zinc-400 ml-2">
            {videos.length} {videos.length === 1 ? 'video' : 'videos'}
          </span>
        </div>
        <button
          onClick={fetchVideos}
          className="flex items-center gap-2 text-zinc-500 hover:text-zinc-900 dark:hover:text-white transition-colors"
          title="Refresh"
        >
          <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Loading */}
      {loading && videos.length === 0 && (
        <div className="flex items-center justify-center py-20">
          <RefreshCw size={24} className="animate-spin text-zinc-400" />
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="text-center py-20">
          <p className="text-red-500 mb-2">{error}</p>
          <button onClick={fetchVideos} className="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-white underline">
            Retry
          </button>
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && videos.length === 0 && (
        <div className="text-center py-20">
          <Film size={48} className="mx-auto text-zinc-300 dark:text-zinc-600 mb-4" />
          <h2 className="text-xl font-semibold text-zinc-700 dark:text-zinc-300 mb-2">No videos yet</h2>
          <p className="text-zinc-500 dark:text-zinc-400">
            Videos you render in Video Studio will appear here automatically.
          </p>
        </div>
      )}

      {/* Video grid */}
      {videos.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {videos.map((video) => (
            <VideoCard
              key={video.filename}
              video={video}
              onPlay={() => setPlayingVideo(video)}
              onReveal={() => handleRevealInFolder(video)}
              onShare={() => handleShare(video)}
            />
          ))}
        </div>
      )}

      {/* Video player overlay */}
      {playingVideo && (
        <VideoPlayerOverlay
          video={playingVideo}
          onClose={() => setPlayingVideo(null)}
        />
      )}

      {/* Share modal */}
      {shareVideo && (
        <ShareModal
          isOpen={true}
          onClose={() => setShareVideo(null)}
          song={shareAsSong(shareVideo)}
        />
      )}
    </div>
  );
};

// ─── Video Card ──────────────────────────────────────────────────────

interface VideoCardProps {
  video: VideoEntry;
  onPlay: () => void;
  onReveal: () => void;
  onShare: () => void;
}

const VideoCard: React.FC<VideoCardProps> = ({ video, onPlay, onReveal, onShare }) => {
  const [thumbnail, setThumbnail] = useState<string | null>(null);

  // Generate thumbnail from first frame via shim /video/ route.
  // The studio window loads from s3studio.xyz (remote origin) so
  // asset:// protocol is blocked by same-origin. Serve through
  // the local shim HTTP server like audio files.
  useEffect(() => {
    const vid = document.createElement('video');
    vid.crossOrigin = 'anonymous';
    vid.preload = 'metadata';
    vid.muted = true;
    vid.src = `${getApiBase()}/video/${encodeURIComponent(video.filename)}`;

    vid.currentTime = 1;
    vid.addEventListener('seeked', () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = vid.videoWidth || 320;
        canvas.height = vid.videoHeight || 180;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(vid, 0, 0, canvas.width, canvas.height);
          setThumbnail(canvas.toDataURL('image/jpeg', 0.7));
        }
      } catch {
        // CORS or other error, leave as gradient
      }
    }, { once: true });
    vid.addEventListener('error', () => {
      // Asset protocol failed; leave gradient placeholder
    }, { once: true });
    vid.load();

    return () => { vid.src = ''; };
  }, [video.path]);

  return (
    <div className="group bg-white dark:bg-zinc-900/40 rounded-xl border border-zinc-200 dark:border-white/5 hover:border-zinc-300 dark:hover:border-white/10 hover:shadow-lg transition-all overflow-hidden">
      {/* Thumbnail / Preview */}
      <div
        className="relative aspect-video bg-gradient-to-br from-zinc-800 to-zinc-900 cursor-pointer"
        onClick={onPlay}
      >
        {thumbnail ? (
          <img src={thumbnail} alt="" className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <Film size={32} className="text-zinc-600" />
          </div>
        )}
        {/* Play overlay on hover */}
        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
          <div className="w-12 h-12 rounded-full bg-white/90 flex items-center justify-center">
            <Play size={20} fill="black" className="text-black ml-0.5" />
          </div>
        </div>
      </div>

      {/* Info */}
      <div className="p-3">
        <h3 className="font-medium text-zinc-900 dark:text-white text-sm truncate mb-1">
          {displayTitle(video.filename)}
        </h3>
        <div className="flex items-center justify-between text-xs text-zinc-500 dark:text-zinc-400">
          <span>{formatDate(video.created_at)}</span>
          <span>{formatSize(video.size_bytes)}</span>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1 mt-2 pt-2 border-t border-zinc-100 dark:border-white/5">
          <button
            onClick={onReveal}
            className="flex items-center gap-1 px-2 py-1 rounded-md text-xs text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-white/5 transition-colors"
            title="Open File Location"
          >
            <FolderOpen size={14} />
            <span>Location</span>
          </button>
          <button
            onClick={onShare}
            className="flex items-center gap-1 px-2 py-1 rounded-md text-xs text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-white/5 transition-colors"
            title="Share"
          >
            <Share2 size={14} />
            <span>Share</span>
          </button>
        </div>
      </div>
    </div>
  );
};

// ─── Video Player Overlay ────────────────────────────────────────────

interface VideoPlayerOverlayProps {
  video: VideoEntry;
  onClose: () => void;
}

const VideoPlayerOverlay: React.FC<VideoPlayerOverlayProps> = ({ video, onClose }) => {
  // Serve via shim /video/ route (same-origin safe; asset:// is blocked
  // because the studio window loads from the remote s3studio.xyz origin).
  const videoSrc = `${getApiBase()}/video/${encodeURIComponent(video.filename)}`;

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="relative w-full max-w-4xl">
        <button
          onClick={onClose}
          className="absolute -top-10 right-0 text-white/80 hover:text-white text-sm font-medium"
        >
          Close (Esc)
        </button>
        <video
          src={videoSrc}
          controls
          autoPlay
          className="w-full rounded-xl shadow-2xl"
          onError={(e) => {
            // Fallback: try direct file path for Tauri
            const target = e.currentTarget;
            if (!target.dataset.retried) {
              target.dataset.retried = 'true';
              target.src = video.path;
            }
          }}
        />
        <div className="mt-3 text-center">
          <h3 className="text-white font-medium">{displayTitle(video.filename)}</h3>
          <p className="text-white/60 text-sm">{formatDate(video.created_at)}</p>
        </div>
      </div>
    </div>
  );
};
