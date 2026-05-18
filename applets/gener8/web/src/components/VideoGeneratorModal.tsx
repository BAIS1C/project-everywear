import React, { useRef, useEffect, useState, useCallback } from 'react';
import { Song } from '../types';
import { X, Play, Pause, Download, Wand2, Image as ImageIcon, Music, Video, Loader2, Palette, Layers, Zap, Type, Monitor, Aperture, Activity, Circle, Grid, Box, BarChart2, Waves, Disc, Upload, Plus, Trash2, Settings2, MousePointer2, Search, ExternalLink, Sun, Film, Minus, Eye, EyeOff, ChevronDown, ChevronRight } from 'lucide-react';
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';
import { useAuth, type Tier } from '../context/AuthContext';
import { drawS3Hero, drawDJAtWork } from '../lib/silhouetteEngine';
import { parseLrc, getCurrentLine, srtToLrc, naiveLrcFromLyrics } from '../lib/lrcParser';
import { vaultRegisterVideo } from '@everywear/transport';

// Stubs for S3 Studio dependencies not yet ported to Everywear
const useResponsive = () => ({ isMobile: false });
function showToast(msg: string, opts?: any) {
  console.log('[toast]', msg, opts);
}

interface VideoGeneratorModalProps {
  isOpen: boolean;
  onClose: () => void;
  song: Song | null;
  /** When true, renders inline (no fixed overlay/backdrop). Used by VidApp. */
  embedded?: boolean;
}

type PresetType =
  | 'NCS Circle' | 'Linear Bars' | 'Dual Mirror' | 'Center Wave'
  | 'Orbital' | 'Digital Rain' | 'Hexagon' | 'Shockwave'
  | 'Oscilloscope' | 'Minimal' | 'Strands Particle'
  | 'S3 Hero' | 'DJ At Work';

interface VisualizerConfig {
  preset: PresetType;
  primaryColor: string;
  secondaryColor: string;
  bgDim: number;
  particleCount: number;
  showVoidImage: boolean;
  particleScale: number;   // 0.1-3.0, default 1.0
  particleOffsetX: number; // -100 to 100 percentage
  particleOffsetY: number; // -100 to 100 percentage
}

interface EffectConfig {
  shake: boolean;
  glitch: boolean;
  vhs: boolean;
  cctv: boolean;
  scanlines: boolean;
  chromatic: boolean;
  bloom: boolean;
  filmGrain: boolean;
  pixelate: boolean;
  strobe: boolean;
  vignette: boolean;
  hueShift: boolean;
  letterbox: boolean;
}

interface EffectIntensities {
  shake: number;
  glitch: number;
  vhs: number;
  cctv: number;
  scanlines: number;
  chromatic: number;
  bloom: number;
  filmGrain: number;
  pixelate: number;
  strobe: number;
  vignette: number;
  hueShift: number;
  letterbox: number;
}

interface TextLayer {
  id: string;
  text: string;
  x: number; // 0-100 percentage
  y: number; // 0-100 percentage
  size: number;
  color: string;
  font: string;
  visible: boolean;
  background?: string; // background colour (transparent if empty/undefined)
}

interface PexelsPhoto {
  id: number;
  src: { large: string; original: string };
  photographer: string;
}

interface PexelsVideo {
  id: number;
  image: string;
  video_files: { link: string; quality: string; width: number }[];
  user: { name: string };
}

// Tiny S³ wordmark used as the preset card icon for the flagship
// particle preset. Uses the active skin's display font so it renders as
// Orbitron in Classic, Chakra Petch in Refined, IBM Plex Mono in Terminal,
// and stays sharp at 16px (a downscaled particle canvas would just blur).
// Sean, 2026-04-25 SGT.
const S3Wordmark = () => (
  <span
    aria-hidden="true"
    style={{
      display: 'inline-block',
      fontFamily: 'var(--ew-font-display)',
      fontWeight: 800,
      fontSize: 14,
      letterSpacing: '0.04em',
      lineHeight: 1,
      color: 'currentColor',
    }}
  >
    S³
  </span>
);

// "DJ" wordmark for the DJ-At-Work silhouette particle preset.
const DJWordmark = () => (
  <span
    aria-hidden="true"
    style={{
      display: 'inline-block',
      fontFamily: 'var(--ew-font-mono)',
      fontWeight: 700,
      fontSize: 12,
      letterSpacing: '0.18em',
      lineHeight: 1,
      color: 'currentColor',
    }}
  >
    DJ
  </span>
);

const PRESETS: { id: PresetType; label: string; icon: React.ReactNode }[] = [
  // S3 Hero: particles resolve into the "S³" wordmark via the silhouette
  // engine in videoRenderWorker. Replaces the original "Strands Particle"
  // preset as the flagship S³ branding visualiser. Sean 2026-04-25 SGT.
  { id: 'S3 Hero', label: 'S³', icon: <S3Wordmark /> },
  // DJ At Work: particles resolve into a stick-figure DJ silhouette
  // (head + headphones + body + raised arm + decks). Same engine as
  // S3 Hero, different target shape.
  { id: 'DJ At Work', label: 'DJ', icon: <DJWordmark /> },
  // Legacy Strands logo particle. Kept for backwards-compat with any
  // saved video configs that point at it.
  { id: 'Strands Particle', label: 'Strands', icon: <Disc size={16} /> },
  { id: 'NCS Circle', label: 'Classic NCS', icon: <Circle size={16} /> },
  { id: 'Linear Bars', label: 'Spectrum', icon: <BarChart2 size={16} /> },
  { id: 'Dual Mirror', label: 'Mirror', icon: <ColumnsIcon /> },
  { id: 'Center Wave', label: 'Shockwave', icon: <Waves size={16} /> },
  { id: 'Orbital', label: 'Orbital', icon: <Disc size={16} /> },
  { id: 'Hexagon', label: 'Hex Core', icon: <Box size={16} /> },
  { id: 'Oscilloscope', label: 'Analog', icon: <Activity size={16} /> },
  { id: 'Digital Rain', label: 'Matrix', icon: <Grid size={16} /> },
  { id: 'Shockwave', label: 'Pulse', icon: <Aperture size={16} /> },
  { id: 'Minimal', label: 'Clean', icon: <Type size={16} /> },
];

function ColumnsIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3v18"/>
      <rect width="18" height="18" x="3" y="3" rx="2" />
    </svg>
  );
}

export const VideoGeneratorModal: React.FC<VideoGeneratorModalProps> = ({ isOpen, onClose, song, embedded = false }) => {
  const { isMobile } = useResponsive();
  const { user, tier } = useAuth();
  // Tier mapping: in Everywear, 'gener8_pro' or 'creator_studio' = Pro features
  const hasTier = (t: string) => {
    const tierOrder: Tier[] = ['demo', 'gener8', 'gener8_pro', 'creator_studio'];
    return tierOrder.indexOf(tier) >= tierOrder.indexOf(t as Tier);
  };
  const isTrialActive = false; // Trials handled by shell, not per-applet
  const canRemoveWatermark = hasTier('gener8_pro');
  const isGener8Pro = hasTier('gener8_pro');
  // canRemoveWatermark = subscribed Pro/Creator only (NOT trial). Trial
  // users see Pro UI everywhere else but the watermark stays on as the
  // viral free-distribution hook (task #42, 2026-05-03 SGT).
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const animationRef = useRef<number>(0);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const bgImageRef = useRef<HTMLImageElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoFileInputRef = useRef<HTMLInputElement>(null);

  // Time tracking for delta-time calculations (Strands Particle preset)
  const lastTimeRef = useRef<number>(0);

  // FFmpeg Refs
  const ffmpegRef = useRef<FFmpeg | null>(null);

  // Tabs: 'presets' | 'style' | 'text' | 'effects'
  const [activeTab, setActiveTab] = useState('presets');

  // State
  const [isPlaying, setIsPlaying] = useState(false);
  const [backgroundType, setBackgroundType] = useState<'random' | 'custom' | 'video'>('random');
  const [backgroundSeed, setBackgroundSeed] = useState(Date.now());
  const [customImage, setCustomImage] = useState<string | null>(null);
  const [videoUrl, setVideoUrl] = useState<string>('');
  const bgVideoRef = useRef<HTMLVideoElement | null>(null);

  // Custom Album Art
  const [customAlbumArt, setCustomAlbumArt] = useState<string | null>(null);
  const albumArtInputRef = useRef<HTMLInputElement>(null);
  const customAlbumArtImageRef = useRef<HTMLImageElement | null>(null);

  // Slideshow layer (Gener8 Pro) — beat-synced image bank
  const [slideshowImages, setSlideshowImages] = useState<string[]>([]); // data URLs
  const slideshowImagesRef = useRef<HTMLImageElement[]>([]);
  const slideshowIndexRef = useRef(0);
  const slideshowPrevBassRef = useRef(0);
  const slideshowCooldownRef = useRef(0); // timestamp of last beat trigger
  const slideshowInputRef = useRef<HTMLInputElement>(null);
  const subtitleInputRef = useRef<HTMLInputElement>(null);
  const [slideshowEnabled, setSlideshowEnabled] = useState(false);
  const slideshowEnabledRef = useRef(false);
  const [slideshowOpacity, setSlideshowOpacity] = useState(0.8); // 0-1
  const slideshowOpacityRef = useRef(0.8);
  const [slideshowFit, setSlideshowFit] = useState<'cover' | 'contain'>('cover');
  const slideshowFitRef = useRef<'cover' | 'contain'>('cover');
  const SLIDESHOW_BEAT_THRESHOLD = 0.25; // bass transient delta to trigger
  const SLIDESHOW_COOLDOWN_MS = 200; // minimum ms between beat triggers

  // Pexels Browser State
  const [showPexelsBrowser, setShowPexelsBrowser] = useState(false);
  const [pexelsTarget, setPexelsTarget] = useState<'background' | 'albumArt'>('background');
  const [pexelsTab, setPexelsTab] = useState<'photos' | 'videos'>('photos');
  const [pexelsQuery, setPexelsQuery] = useState('abstract');
  const [pexelsPhotos, setPexelsPhotos] = useState<PexelsPhoto[]>([]);
  const [pexelsVideos, setPexelsVideos] = useState<PexelsVideo[]>([]);
  const [pexelsLoading, setPexelsLoading] = useState(false);
  const [pexelsApiKey, setPexelsApiKey] = useState<string>(() => localStorage.getItem('pexels_api_key') || '');
  const [showPexelsApiKeyInput, setShowPexelsApiKeyInput] = useState(false);
  const [pexelsError, setPexelsError] = useState<string | null>(null);
  
  // Export resolution presets — social platforms + standard aspect ratios
  // Gener8 Pro unlocks everything beyond 540p 9:16
  const RENDER_PRESETS = [
    // --- Social-optimised (9:16 vertical) ---
    { label: 'TikTok / Reels',      w: 1080, h: 1920, aspect: '9:16', tier: 'pro' as const },
    { label: 'YouTube Shorts',       w: 1080, h: 1920, aspect: '9:16', tier: 'pro' as const },
    { label: 'Snapchat',             w: 1080, h: 1920, aspect: '9:16', tier: 'pro' as const },
    { label: 'Pinterest',            w: 1000, h: 1500, aspect: '2:3',  tier: 'pro' as const },
    // --- Social-optimised (1:1 square) ---
    { label: 'Instagram Post',       w: 1080, h: 1080, aspect: '1:1',  tier: 'pro' as const },
    // --- Standard landscape (16:9) ---
    { label: '540p (16:9)',          w: 960,  h: 540,  aspect: '16:9', tier: 'base' as const },
    { label: '720p (16:9)',          w: 1280, h: 720,  aspect: '16:9', tier: 'pro' as const },
    { label: '1080p (16:9)',         w: 1920, h: 1080, aspect: '16:9', tier: 'pro' as const },
    // --- Square ---
    { label: 'Square 720',          w: 720,  h: 720,  aspect: '1:1',  tier: 'pro' as const },
    // --- Vertical (base) ---
    { label: '540p (9:16)',          w: 540,  h: 960,  aspect: '9:16', tier: 'base' as const },
  ] as const;
  const BASE_DEFAULT_INDEX = 5; // 540p 16:9
  const [selectedPreset, setSelectedPreset] = useState(BASE_DEFAULT_INDEX);
  const renderRes = RENDER_PRESETS[isGener8Pro ? selectedPreset : BASE_DEFAULT_INDEX];

  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [exportStage, setExportStage] = useState<'idle' | 'capturing' | 'encoding'>('idle');
  const [exportEta, setExportEta] = useState<string>('');
  const [ffmpegLoaded, setFfmpegLoaded] = useState(false);
  const [ffmpegLoading, setFfmpegLoading] = useState(false);

  // GPU Encoder State (local sidecar on port 9877)
  const [gpuEncoderAvailable, setGpuEncoderAvailable] = useState(false);
  const [gpuEncoderInfo, setGpuEncoderInfo] = useState<{ encoder: string; label: string; gpu: string | null; hardware: boolean } | null>(null);
  const gpuWsRef = useRef<WebSocket | null>(null);
  const renderWorkerRef = useRef<Worker | null>(null);

  // Local system fonts (populated via queryLocalFonts API)
  const [systemFonts, setSystemFonts] = useState<string[]>([]);
  const [fontsLoaded, setFontsLoaded] = useState(false);

  // Config State
  const [config, setConfig] = useState<VisualizerConfig>({
    preset: 'Strands Particle',
    primaryColor: '#00C2FF',
    secondaryColor: '#3b82f6',
    bgDim: 0.6,
    particleCount: 50,
    showVoidImage: false,
    particleScale: 1.0,
    particleOffsetX: 0,
    particleOffsetY: 0,
  });

  const [effects, setEffects] = useState<EffectConfig>({
    shake: true,
    glitch: false,
    vhs: false,
    cctv: false,
    scanlines: false,
    chromatic: false,
    bloom: false,
    filmGrain: false,
    pixelate: false,
    strobe: false,
    vignette: false,
    hueShift: false,
    letterbox: false
  });

  const [intensities, setIntensities] = useState<EffectIntensities>({
    shake: 0.05,
    glitch: 0.3,
    vhs: 0.5,
    cctv: 0.8,
    scanlines: 0.4,
    chromatic: 0.5,
    bloom: 0.5,
    filmGrain: 0.3,
    pixelate: 0.3,
    strobe: 0.5,
    vignette: 0.5,
    hueShift: 0.5,
    letterbox: 0.5
  });

  // Text Layers State
  const [textLayers, setTextLayers] = useState<TextLayer[]>([]);
  const [showWatermark, setShowWatermark] = useState(true);

  // Watermark resets to ON on every tier or trial transition (task #45,
  // 2026-05-03 SGT). Sean's explicit rule: any subscription state change
  // forces the watermark back on; subscribed Pro/Creator users have to
  // actively re-disable after each transition. Prevents stale watermark-
  // off state carrying over across:
  //   - Free → Pro upgrade (user must consciously disable)
  //   - Pro → Free downgrade (re-enabled defensively)
  //   - Trial start → trial active (re-enabled defensively)
  //   - Trial expire → free (re-enabled defensively)
  //   - Pro → Creator Studio upgrade (re-enabled even though entitlement
  //     unchanged, per the literal "any tier change" rule)
  //   - Sign-in / sign-out (tiers flip to/from empty)
  //
  // 2026-05-04 SGT fix: user?.tier was always undefined (User type has
  // `tiers: Record<string, boolean>`, not `tier`). The effect only fired
  // on isTrialActive changes. Fixed: derive a stable key from tiers.
  //
  // Idempotent on initial mount: useState already defaults to true and
  // this effect re-asserts it, so first paint behaviour is unchanged.
  const tierKey = JSON.stringify(user?.tiers ?? {});
  useEffect(() => {
    setShowWatermark(true);
  }, [tierKey, isTrialActive]);

  // Init default text on load
  useEffect(() => {
    if (song) {
        setTextLayers([
            { id: '1', text: song.title, x: 50, y: 85, size: 52, color: '#ffffff', font: 'Inter', visible: true },
            { id: '2', text: 'REPLACE WITH YOUR OWN TEXT', x: 50, y: 92, size: 24, color: '#3b82f6', font: 'Inter', visible: true }
        ]);
    }
  }, [song]);

  // Use refs for render loop to access latest state without re-binding
  const configRef = useRef(config);
  const effectsRef = useRef(effects);
  const intensitiesRef = useRef(intensities);
  const textLayersRef = useRef(textLayers);
  const lrcDataRef = useRef<string | null>(song?.lrc_data ?? null);
  const showWatermarkRef = useRef(showWatermark);

  useEffect(() => { configRef.current = config; }, [config]);
  useEffect(() => { effectsRef.current = effects; }, [effects]);
  useEffect(() => { intensitiesRef.current = intensities; }, [intensities]);
  useEffect(() => { textLayersRef.current = textLayers; }, [textLayers]);
  useEffect(() => { lrcDataRef.current = song?.lrc_data ?? null; }, [song]);
  useEffect(() => { showWatermarkRef.current = showWatermark; }, [showWatermark]);
  useEffect(() => { slideshowEnabledRef.current = slideshowEnabled; }, [slideshowEnabled]);
  useEffect(() => { slideshowOpacityRef.current = slideshowOpacity; }, [slideshowOpacity]);
  useEffect(() => { slideshowFitRef.current = slideshowFit; }, [slideshowFit]);

  // Preload slideshow HTMLImageElements when data URLs change
  useEffect(() => {
    const imgs: HTMLImageElement[] = [];
    slideshowImages.forEach(src => {
      const img = new Image();
      img.src = src;
      imgs.push(img);
    });
    slideshowImagesRef.current = imgs;
    slideshowIndexRef.current = 0;
  }, [slideshowImages]);

  // ── Detect local GPU encoder sidecar (port 9877) ──
  useEffect(() => {
    if (!isOpen) return;
    const controller = new AbortController();
    const checkGpuEncoder = async () => {
      try {
        const res = await fetch('http://127.0.0.1:9877/health', {
          signal: controller.signal,
          // 2s timeout via AbortController
        });
        if (res.ok) {
          const data = await res.json();
          setGpuEncoderAvailable(true);
          setGpuEncoderInfo({
            encoder: data.encoder,
            label: data.label,
            gpu: data.gpu,
            hardware: data.hardware,
          });
          console.log('[Video Studio] GPU encoder detected:', data.label, data.encoder, data.gpu || '');
          if (!data.hardware) {
            console.warn(
              '[Video Studio] Sidecar reached but reports software-only encoder (%s). ' +
              'NVENC not detected at sidecar startup — check nvidia-smi, ffmpeg -encoders | grep nvenc.',
              data.encoder
            );
          }
        } else {
          // Sidecar responded with non-OK status
          setGpuEncoderAvailable(false);
          setGpuEncoderInfo(null);
          console.warn(
            '[Video Studio] Sidecar /health returned %d %s — falling back to WASM.',
            res.status, res.statusText
          );
        }
      } catch (err: unknown) {
        // Self-report the failure mode so NVENC regressions don't hide.
        // CORS rejection, connection refused, and abort-timeout look
        // different in devtools — don't flatten them into a single line.
        setGpuEncoderAvailable(false);
        setGpuEncoderInfo(null);
        const e = err as { name?: string; message?: string };
        if (e?.name === 'AbortError') {
          console.warn('[Video Studio] Sidecar /health timed out (>2s) — WASM fallback.');
        } else if (e?.message?.includes('Failed to fetch') || e?.message?.includes('NetworkError')) {
          console.warn(
            '[Video Studio] Cannot reach http://127.0.0.1:9877/health — ' +
            'sidecar offline OR CORS block (stale dist?). WASM fallback. ' +
            'Debug: curl http://127.0.0.1:9877/health from a terminal.'
          );
        } else {
          console.warn('[Video Studio] GPU encoder check failed (%s) — WASM fallback.', e?.message || err);
        }
      }
    };
    checkGpuEncoder();
    // Timeout the health check after 2 seconds
    const timeout = setTimeout(() => controller.abort(), 2000);
    return () => { controller.abort(); clearTimeout(timeout); };
  }, [isOpen]);

  // ── Load local system fonts via queryLocalFonts API (Chromium only) ──
  useEffect(() => {
    if (!isOpen || fontsLoaded) return;
    const loadFonts = async () => {
      try {
        // queryLocalFonts requires user gesture the first time (browser will prompt permission)
        if ('queryLocalFonts' in window) {
          const fonts = await (window as unknown as { queryLocalFonts: () => Promise<{ family: string }[]> }).queryLocalFonts();
          // Deduplicate font families and sort
          const families = [...new Set(fonts.map((f: { family: string }) => f.family))].sort();
          console.log(`[Video Studio] Loaded ${families.length} local fonts`);
          setSystemFonts(families);
          setFontsLoaded(true);
        } else {
          // Fallback: common fonts for non-Chromium browsers
          setSystemFonts([
            'Arial', 'Arial Black', 'Calibri', 'Cambria', 'Comic Sans MS', 'Consolas',
            'Courier New', 'Georgia', 'Impact', 'Inter', 'Lucida Console', 'Palatino Linotype',
            'Rajdhani', 'Segoe UI', 'Tahoma', 'Times New Roman', 'Trebuchet MS', 'Verdana',
          ]);
          setFontsLoaded(true);
        }
      } catch (err) {
        console.log('[Video Studio] Font access denied or unavailable, using defaults');
        setSystemFonts([
          'Arial', 'Arial Black', 'Calibri', 'Comic Sans MS', 'Consolas',
          'Courier New', 'Georgia', 'Impact', 'Inter', 'Rajdhani',
          'Segoe UI', 'Tahoma', 'Times New Roman', 'Trebuchet MS', 'Verdana',
        ]);
        setFontsLoaded(true);
      }
    };
    loadFonts();
  }, [isOpen, fontsLoaded]);

  // Load FFmpeg
  const loadFFmpeg = useCallback(async () => {
    if (ffmpegRef.current || ffmpegLoading) return;

    setFfmpegLoading(true);
    try {
      const ffmpeg = new FFmpeg();

      ffmpeg.on('progress', ({ progress }) => {
        if (exportStage === 'encoding') {
          setExportProgress(Math.round(progress * 100));
        }
      });

      const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm';
      await ffmpeg.load({
        coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
        wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
      });

      ffmpegRef.current = ffmpeg;
      setFfmpegLoaded(true);
    } catch (error) {
      console.error('Failed to load FFmpeg:', error);
      alert('Failed to load video encoder. Please refresh and try again.');
    } finally {
      setFfmpegLoading(false);
    }
  }, [ffmpegLoading, exportStage]);

  // Load Background Image
  useEffect(() => {
    if (backgroundType === 'video') {
      bgImageRef.current = null;
      return;
    }

    const img = new Image();
    img.crossOrigin = "Anonymous";
    if (backgroundType === 'custom' && customImage) {
      // Pexels + other external URLs taint the canvas without a same-origin proxy.
      // Mirror the customAlbumArt loader pattern (L544-545). Sean 2026-04-26 SGT.
      const isExternal = customImage.startsWith('http');
      img.src = isExternal ? `/api/proxy/image?url=${encodeURIComponent(customImage)}` : customImage;
    } else {
      img.src = `https://picsum.photos/seed/${backgroundSeed}/1920/1080?blur=4`;
    }
    img.onload = () => {
      bgImageRef.current = img;
    };
  }, [backgroundSeed, backgroundType, customImage]);

  // Load Background Video
  useEffect(() => {
    if (backgroundType !== 'video' || !videoUrl) {
      if (bgVideoRef.current) {
        bgVideoRef.current.pause();
        bgVideoRef.current = null;
      }
      return;
    }

    const video = document.createElement('video');
    video.crossOrigin = 'anonymous';
    video.src = videoUrl;
    video.loop = true;
    video.muted = true;
    video.playsInline = true;
    video.autoplay = true;

    video.onloadeddata = () => {
      bgVideoRef.current = video;
      video.play().catch(console.error);
    };

    video.onerror = () => {
      console.error('Failed to load video:', videoUrl);
      bgVideoRef.current = null;
    };

    return () => {
      video.pause();
      video.src = '';
    };
  }, [backgroundType, videoUrl]);

  // Load Custom Album Art
  useEffect(() => {
    if (!customAlbumArt) {
      customAlbumArtImageRef.current = null;
      return;
    }

    // Clear ref immediately so we don't show stale image
    customAlbumArtImageRef.current = null;

    const img = new Image();
    img.crossOrigin = 'anonymous';

    // Use proxy for external URLs to avoid CORS issues
    const isExternal = customAlbumArt.startsWith('http');
    img.src = isExternal ? `/api/proxy/image?url=${encodeURIComponent(customAlbumArt)}` : customAlbumArt;

    img.onload = () => {
      customAlbumArtImageRef.current = img;
    };
    img.onerror = () => {
      console.error('Failed to load custom album art:', customAlbumArt);
      customAlbumArtImageRef.current = null;
    };
  }, [customAlbumArt]);

  // Initialize Audio & Canvas
  useEffect(() => {
    if (!isOpen || !song) return;

    // Reset basics
    setIsPlaying(false);
    setIsExporting(false);
    setExportProgress(0);
    setExportStage('idle');
    setExportEta('');

    // Reset slideshow beat-sync refs so stale state from a previous
    // song/playback cycle doesn't suppress triggers.
    slideshowPrevBassRef.current = 0;
    slideshowCooldownRef.current = 0;
    slideshowIndexRef.current = 0;

    // Audio Setup
    const audio = new Audio();
    audio.crossOrigin = "anonymous";
    audio.src = song.audioUrl || '';
    audioRef.current = audio;

    const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const audioCtx = new AudioContextClass();
    audioContextRef.current = audioCtx;

    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 2048;
    analyserRef.current = analyser;

    const source = audioCtx.createMediaElementSource(audio);
    source.connect(analyser);
    analyser.connect(audioCtx.destination);

    audio.onended = () => {
      setIsPlaying(false);
    };

    // Start Loop
    cancelAnimationFrame(animationRef.current);
    renderLoop();

    return () => {
      audio.pause();
      if (audioContextRef.current?.state !== 'closed') {
        audioContextRef.current?.close();
      }
      cancelAnimationFrame(animationRef.current);
      // Terminate render worker if running
      if (renderWorkerRef.current) {
        renderWorkerRef.current.postMessage({ type: 'abort' });
        renderWorkerRef.current.terminate();
        renderWorkerRef.current = null;
      }
    };
  }, [isOpen, song]); 

  const togglePlay = async () => {
    if (!audioRef.current || !audioContextRef.current) return;
    if (audioContextRef.current.state === 'suspended') {
      await audioContextRef.current.resume();
    }
    if (isPlaying) audioRef.current.pause();
    else audioRef.current.play();
    setIsPlaying(!isPlaying);
  };

  const startRecording = async () => {
    if (!canvasRef.current || !song) return;

    setIsExporting(true);
    setExportStage('capturing');
    setExportProgress(0);

    try {
      if (gpuEncoderAvailable) {
        // Route to local GPU encoder sidecar
        console.log('[Video Studio] Using local GPU encoder');
        await renderViaGpu();
      } else {
        // Fallback to WASM FFmpeg
        console.log('[Video Studio] Using WASM FFmpeg');
        if (!ffmpegRef.current) {
          await loadFFmpeg();
          if (!ffmpegRef.current) return;
        }
        await renderOffline();
      }
    } catch (error) {
      console.error('Rendering failed:', error);
      alert('Video rendering failed. Please try again.');
      setIsExporting(false);
      setExportStage('idle');
    }
  };

  const analyzeAudioOffline = async (audioBuffer: AudioBuffer, fps: number): Promise<Uint8Array[]> => {
    const duration = audioBuffer.duration;
    const totalFrames = Math.ceil(duration * fps);
    const samplesPerFrame = Math.floor(audioBuffer.sampleRate / fps);
    const fftSize = 2048;
    const frequencyBinCount = fftSize / 2;

    // Get raw audio data from first channel
    const channelData = audioBuffer.getChannelData(0);
    const frequencyDataFrames: Uint8Array[] = [];

    // Simple FFT approximation using amplitude analysis
    // For each frame, compute frequency-like data from audio samples
    for (let frame = 0; frame < totalFrames; frame++) {
      const startSample = frame * samplesPerFrame;
      const endSample = Math.min(startSample + fftSize, channelData.length);

      const frameData = new Uint8Array(frequencyBinCount);

      // Compute amplitude spectrum approximation
      for (let bin = 0; bin < frequencyBinCount; bin++) {
        let sum = 0;
        const binSize = Math.max(1, Math.floor((endSample - startSample) / frequencyBinCount));
        const binStart = startSample + bin * binSize;
        const binEnd = Math.min(binStart + binSize, endSample);

        for (let i = binStart; i < binEnd && i < channelData.length; i++) {
          sum += Math.abs(channelData[i]);
        }

        const avg = binSize > 0 ? sum / binSize : 0;
        // Scale to 0-255 range with some amplification
        frameData[bin] = Math.min(255, Math.floor(avg * 512));
      }

      frequencyDataFrames.push(frameData);
    }

    return frequencyDataFrames;
  };

  const loadImageAsDataUrl = async (url: string): Promise<string | null> => {
    try {
      // Use proxy for external URLs to avoid CORS issues
      const isExternal = url.startsWith('http') && !url.includes(window.location.host);
      const fetchUrl = isExternal ? `/api/proxy/image?url=${encodeURIComponent(url)}` : url;

      const response = await fetch(fetchUrl);
      const blob = await response.blob();
      return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => resolve(null);
        reader.readAsDataURL(blob);
      });
    } catch {
      return null;
    }
  };

  const renderOffline = async () => {
    if (!song || !ffmpegRef.current) return;

    // Create a separate clean canvas to avoid tainted canvas issues
    const canvas = document.createElement('canvas');
    canvas.width = renderRes.w;
    canvas.height = renderRes.h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const ffmpeg = ffmpegRef.current;
    const fps = 24; // 24fps draft, 30fps in Vid Pro
    const width = canvas.width;
    const height = canvas.height;
    const centerX = width / 2;
    const centerY = height / 2;

    setExportProgress(1);

    // Pre-load images via proxy to avoid CORS/tainted canvas issues
    let bgImage: HTMLImageElement | null = null;
    let bgVideo: HTMLVideoElement | null = null;
    let albumImage: HTMLImageElement | null = null;

    // Load background video or image
    if (backgroundType === 'video' && videoUrl) {
      bgVideo = document.createElement('video');
      bgVideo.crossOrigin = 'anonymous';
      bgVideo.src = videoUrl;
      bgVideo.muted = true;
      bgVideo.playsInline = true;
      await new Promise<void>((resolve) => {
        bgVideo!.onloadeddata = () => resolve();
        bgVideo!.onerror = () => {
          console.warn('Failed to load background video, falling back to image');
          bgVideo = null;
          resolve();
        };
        bgVideo!.load();
      });
    } else if (bgImageRef.current?.src) {
      const bgDataUrl = await loadImageAsDataUrl(bgImageRef.current.src);
      if (bgDataUrl) {
        bgImage = new Image();
        bgImage.src = bgDataUrl;
        await new Promise<void>((resolve) => {
          bgImage!.onload = () => resolve();
          bgImage!.onerror = () => resolve();
        });
      }
    }

    // Load album art (use custom if set, otherwise song cover)
    const albumArtSource = customAlbumArt || song.coverUrl;
    if (albumArtSource) {
      // Custom album art might already be a data URL
      const albumDataUrl = albumArtSource.startsWith('data:')
        ? albumArtSource
        : await loadImageAsDataUrl(albumArtSource);
      if (albumDataUrl) {
        albumImage = new Image();
        albumImage.src = albumDataUrl;
        await new Promise<void>((resolve) => {
          albumImage!.onload = () => resolve();
          albumImage!.onerror = () => resolve();
        });
      }
    }

    // Fetch and decode audio
    setExportProgress(2);
    const audioUrl = song.audioUrl || '';
    const audioResponse = await fetch(audioUrl);
    const audioArrayBuffer = await audioResponse.arrayBuffer();

    // Keep a copy for FFmpeg
    const audioDataCopy = audioArrayBuffer.slice(0);

    setExportProgress(5);

    // Decode audio for analysis
    const audioCtx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    const audioBuffer = await audioCtx.decodeAudioData(audioArrayBuffer);
    const duration = audioBuffer.duration;
    const totalFrames = Math.ceil(duration * fps);

    setExportProgress(10);

    // Analyze audio to get frequency data for each frame
    const frequencyDataFrames = await analyzeAudioOffline(audioBuffer, fps);

    setExportProgress(15);

    // Render all frames
    const currentConfig = configRef.current;
    const currentEffects = effectsRef.current;
    const currentIntensities = intensitiesRef.current;
    const currentTexts = textLayersRef.current;
    const renderStartTime = performance.now();

    for (let frameIndex = 0; frameIndex < totalFrames; frameIndex++) {
      const time = frameIndex / fps;
      const dataArray = frequencyDataFrames[frameIndex] || new Uint8Array(1024);

      // Create time domain data (simple sine wave approximation based on bass)
      const timeDomain = new Uint8Array(1024);
      let bassSum = 0;
      for (let i = 0; i < 20; i++) bassSum += dataArray[i];
      const bassLevel = bassSum / 20 / 255;
      for (let i = 0; i < timeDomain.length; i++) {
        timeDomain[i] = 128 + Math.sin(i * 0.1 + time * 10) * 64 * bassLevel;
      }

      // Calculate bass and pulse
      let bass = 0;
      for (let i = 0; i < 20; i++) bass += dataArray[i];
      bass = bass / 20;
      const normBass = bass / 255;
      const pulse = 1 + normBass * 0.15;

      // Clear canvas
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, width, height);

      // Draw background (video or image)
      let bgSource: HTMLImageElement | HTMLVideoElement | null = bgImage;

      if (bgVideo) {
        // Seek video to current frame time (loop if video is shorter)
        const videoTime = time % (bgVideo.duration || 1);
        bgVideo.currentTime = videoTime;
        // Wait for seek to complete
        await new Promise<void>((resolve) => {
          const onSeeked = () => {
            bgVideo!.removeEventListener('seeked', onSeeked);
            resolve();
          };
          bgVideo!.addEventListener('seeked', onSeeked);
          // Fallback timeout in case seeked never fires
          setTimeout(resolve, 50);
        });
        bgSource = bgVideo;
      }

      if (bgSource) {
        ctx.save();
        ctx.globalAlpha = 1 - currentConfig.bgDim;

        if (currentEffects.shake && normBass > (0.6 - (currentIntensities.shake * 0.3))) {
          const magnitude = currentIntensities.shake * 50;
          const shakeX = (Math.random() - 0.5) * magnitude * normBass;
          const shakeY = (Math.random() - 0.5) * magnitude * normBass;
          ctx.translate(shakeX, shakeY);
        }

        const zoom = 1 + (Math.sin(time * 0.5) * 0.05);
        ctx.translate(centerX, centerY);
        ctx.scale(zoom, zoom);
        ctx.drawImage(bgSource, -width/2, -height/2, width, height);
        ctx.restore();
      }

      // Slideshow layer (beat-synced)
      renderSlideshow(ctx, width, height, normBass, frameIndex * (1000 / fps));

      // Draw preset
      ctx.save();
      if (currentEffects.shake && normBass > 0.6) {
        const magnitude = currentIntensities.shake * 30;
        const shakeX = (Math.random() - 0.5) * magnitude * normBass;
        const shakeY = (Math.random() - 0.5) * magnitude * normBass;
        ctx.translate(shakeX, shakeY);
      }

      // Apply particle transform (zoom + offset)
      ctx.save();
      const pScale = currentConfig.particleScale;
      const pOffX = (currentConfig.particleOffsetX / 100) * width;
      const pOffY = (currentConfig.particleOffsetY / 100) * height;
      ctx.translate(centerX + pOffX, centerY + pOffY);
      ctx.scale(pScale, pScale);
      ctx.translate(-centerX, -centerY);

      switch(currentConfig.preset) {
        case 'NCS Circle':
          drawNCSCircle(ctx, centerX, centerY, dataArray, pulse, time, currentConfig.primaryColor, currentConfig.secondaryColor);
          break;
        case 'Linear Bars':
          drawLinearBars(ctx, width, height, dataArray, currentConfig.primaryColor, currentConfig.secondaryColor);
          break;
        case 'Dual Mirror':
          drawDualMirror(ctx, width, height, dataArray, currentConfig.primaryColor);
          break;
        case 'Center Wave':
          drawCenterWave(ctx, centerX, centerY, dataArray, time, currentConfig.primaryColor);
          break;
        case 'Orbital':
          drawOrbital(ctx, centerX, centerY, dataArray, time, currentConfig.primaryColor, currentConfig.secondaryColor);
          break;
        case 'Hexagon':
          drawHexagon(ctx, centerX, centerY, dataArray, pulse, time, currentConfig.primaryColor);
          break;
        case 'Oscilloscope':
          drawOscilloscope(ctx, width, height, timeDomain, currentConfig.primaryColor);
          break;
        case 'Digital Rain':
          drawDigitalRain(ctx, width, height, dataArray, time, currentConfig.primaryColor);
          break;
        case 'Shockwave':
          drawShockwave(ctx, centerX, centerY, bass, time, currentConfig.primaryColor);
          break;
        case 'Strands Particle':
          drawStrandsParticle(ctx, centerX, centerY, width, height, normBass, time, 1 / fps);
          break;
        // S3 Hero + DJ At Work — shared silhouette engine in
        // lib/silhouetteEngine.ts. Same module imported by the worker
        // (workers/videoRenderWorker.ts) so live preview and
        // render-to-file produce pixel-identical output. 2026-04-26 SGT.
        case 'S3 Hero':
          drawS3Hero(ctx, centerX, centerY, width, height, normBass, currentConfig.primaryColor);
          break;
        case 'DJ At Work':
          drawDJAtWork(ctx, centerX, centerY, width, height, normBass, currentConfig.primaryColor);
          break;
      }

      drawParticles(ctx, width, height, time, bass, currentConfig.particleCount, currentConfig.primaryColor);
      ctx.restore(); // End particle transform

      // Pixelate effect (applied before text so text stays sharp)
      if (currentEffects.pixelate) {
        const pixelSize = Math.max(4, Math.floor(16 * currentIntensities.pixelate));
        ctx.imageSmoothingEnabled = false;
        const tempCanvas2 = document.createElement('canvas');
        const smallW = Math.floor(width / pixelSize);
        const smallH = Math.floor(height / pixelSize);
        tempCanvas2.width = smallW;
        tempCanvas2.height = smallH;
        const tempCtx2 = tempCanvas2.getContext('2d')!;
        tempCtx2.drawImage(canvas, 0, 0, smallW, smallH);
        ctx.clearRect(0, 0, width, height);
        ctx.drawImage(tempCanvas2, 0, 0, smallW, smallH, 0, 0, width, height);
        ctx.imageSmoothingEnabled = true;
      }

      // Draw text layers (scale font size from preview res 1080 to render res)
      const fontScale = Math.min(width / 1920, height / 1080);
      ctx.shadowBlur = 10 * fontScale;
      ctx.shadowColor = 'black';
      ctx.textAlign = 'center';

      currentTexts.filter(layer => layer.visible !== false).forEach(layer => {
        const dynamicSize = (layer.id === '1' && currentConfig.preset === 'Minimal' ? layer.size * pulse : layer.size) * fontScale;
        ctx.font = `bold ${dynamicSize}px ${layer.font}, sans-serif`;
        const xPos = (layer.x / 100) * width;
        const yPos = (layer.y / 100) * height;

        // Resolve display text: timed lyrics layer reads current line from LRC
        let displayText = layer.text;
        if (layer.id === 'timed-lyrics' && audioRef.current) {
          const lrc = lrcDataRef.current;
          if (lrc) {
            const parsed = parseLrc(lrc);
            displayText = getCurrentLine(parsed, audioRef.current.currentTime);
          }
        }

        if (!displayText) return;

        // Background pill behind text
        if (layer.background) {
          const metrics = ctx.measureText(displayText);
          const pad = dynamicSize * 0.4;
          const bgW = metrics.width + pad * 2;
          const bgH = dynamicSize * 1.3;
          ctx.fillStyle = layer.background;
          ctx.fillRect(xPos - bgW / 2, yPos - bgH * 0.75, bgW, bgH);
        }

        ctx.fillStyle = layer.color;
        ctx.fillText(displayText, xPos, yPos);
      });

      // Strands watermark — bottom-right (toggleable)
      if (showWatermarkRef.current) drawStrandsWatermark(ctx, width, height);

      ctx.restore();

      // Apply post-processing effects
      if (currentEffects.scanlines || currentEffects.cctv) {
        ctx.fillStyle = `rgba(0,0,0,${currentIntensities.scanlines * 0.8})`;
        for (let i = 0; i < height; i += 4) {
          ctx.fillRect(0, i, width, 2);
        }
      }

      if (currentEffects.vhs || currentEffects.chromatic || (currentEffects.glitch && Math.random() > (1 - currentIntensities.glitch))) {
        const intensity = currentEffects.vhs ? currentIntensities.vhs : currentIntensities.chromatic;
        const offset = (10 * intensity) * normBass;
        ctx.globalCompositeOperation = 'screen';
        ctx.fillStyle = `rgba(255,0,0,${0.2 * intensity})`;
        ctx.fillRect(-offset, 0, width, height);
        ctx.fillStyle = `rgba(0,0,255,${0.2 * intensity})`;
        ctx.fillRect(offset, 0, width, height);
        ctx.globalCompositeOperation = 'source-over';
      }

      if (currentEffects.glitch && Math.random() > (1 - currentIntensities.glitch)) {
        ctx.fillStyle = Math.random() > 0.5 ? currentConfig.primaryColor : '#fff';
        ctx.fillRect(Math.random() * width, Math.random() * height, Math.random() * 200, 4);
      }

      if (currentEffects.cctv) {
        const intensity = currentIntensities.cctv;
        ctx.globalCompositeOperation = 'overlay';
        ctx.fillStyle = `rgba(0, 50, 0, ${0.4 * intensity})`;
        ctx.fillRect(0, 0, width, height);

        const grad = ctx.createRadialGradient(centerX, centerY, height * 0.4, centerX, centerY, height * 0.9);
        grad.addColorStop(0, 'transparent');
        grad.addColorStop(1, 'black');
        ctx.globalCompositeOperation = 'multiply';
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, width, height);
        ctx.globalCompositeOperation = 'source-over';
      }

      // Bloom / Glow effect
      if (currentEffects.bloom) {
        const intensity = currentIntensities.bloom;
        ctx.globalCompositeOperation = 'screen';
        ctx.filter = `blur(${15 * intensity}px)`;
        ctx.globalAlpha = 0.4 * intensity;
        ctx.drawImage(canvas, 0, 0);
        ctx.filter = 'none';
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
      }

      // Film Grain
      if (currentEffects.filmGrain) {
        const intensity = currentIntensities.filmGrain;
        const imageData = ctx.getImageData(0, 0, width, height);
        const data = imageData.data;
        const grainAmount = intensity * 50;
        for (let i = 0; i < data.length; i += 16) {
          const noise = (Math.random() - 0.5) * grainAmount;
          data[i] += noise;
          data[i + 1] += noise;
          data[i + 2] += noise;
        }
        ctx.putImageData(imageData, 0, 0);
      }

      // Strobe effect
      if (currentEffects.strobe && normBass > (0.7 - currentIntensities.strobe * 0.3)) {
        ctx.globalCompositeOperation = 'screen';
        ctx.fillStyle = `rgba(255, 255, 255, ${currentIntensities.strobe * normBass * 0.8})`;
        ctx.fillRect(0, 0, width, height);
        ctx.globalCompositeOperation = 'source-over';
      }

      // Vignette effect
      if (currentEffects.vignette) {
        const intensity = currentIntensities.vignette;
        const grad = ctx.createRadialGradient(centerX, centerY, height * 0.3, centerX, centerY, height * 0.8);
        grad.addColorStop(0, 'transparent');
        grad.addColorStop(1, `rgba(0, 0, 0, ${0.8 * intensity})`);
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, width, height);
      }

      // Hue Shift effect
      if (currentEffects.hueShift) {
        const hueRotation = currentIntensities.hueShift * 360 * (1 + normBass * 0.5);
        ctx.filter = `hue-rotate(${hueRotation}deg)`;
        ctx.drawImage(canvas, 0, 0);
        ctx.filter = 'none';
      }

      // Letterbox effect
      if (currentEffects.letterbox) {
        const barHeight = height * 0.12 * currentIntensities.letterbox;
        ctx.fillStyle = 'black';
        ctx.fillRect(0, 0, width, barHeight);
        ctx.fillRect(0, height - barHeight, width, barHeight);
      }

      // Capture frame (synchronous toDataURL, lower quality for speed)
      const frameData = canvas.toDataURL('image/jpeg', 0.7);
      const base64Data = frameData.split(',')[1];
      const binaryData = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0));
      await ffmpeg.writeFile(`frame${String(frameIndex).padStart(6, '0')}.jpg`, binaryData);

      // Yield to event loop every 30 frames for UI responsiveness + update progress
      if (frameIndex % 30 === 0) {
        await new Promise(r => setTimeout(r, 0));
        setExportProgress(15 + Math.round((frameIndex / totalFrames) * 55));
        if (frameIndex > 0) {
          const elapsed = (performance.now() - renderStartTime) / 1000;
          const msPerFrame = elapsed / frameIndex;
          const remaining = Math.ceil(msPerFrame * (totalFrames - frameIndex));
          const mins = Math.floor(remaining / 60);
          const secs = remaining % 60;
          setExportEta(mins > 0 ? `~${mins}m ${secs}s remaining` : `~${secs}s remaining`);
        }
      }
    }

    setExportEta('');
    setExportStage('encoding');
    setExportProgress(70);

    // Write audio file
    console.log('[Video] Writing audio file...');
    await ffmpeg.writeFile('audio.mp3', new Uint8Array(audioDataCopy));

    setExportProgress(75);

    // Encode video - use ultrafast preset for browser performance
    console.log(`[Video] Encoding ${totalFrames} frames at ${fps}fps...`);
    console.log('[Video] This may take a while in the browser. Please wait...');

    const encodeResult = await ffmpeg.exec([
      '-framerate', String(fps),
      '-i', 'frame%06d.jpg',
      '-i', 'audio.mp3',
      '-c:v', 'libx264',
      '-preset', 'ultrafast',  // Fastest encoding
      '-tune', 'fastdecode',   // Optimize for fast decoding
      '-crf', '28',            // Slightly lower quality but much faster
      '-pix_fmt', 'yuv420p',
      '-c:a', 'aac',
      '-b:a', '128k',          // Lower bitrate audio
      '-shortest',
      '-movflags', '+faststart',
      'output.mp4'
    ]);
    console.log('[Video] FFmpeg encode result:', encodeResult);

    setExportProgress(95);

    // Read and download output
    console.log('[Video] Reading output file...');
    const outputData = await ffmpeg.readFile('output.mp4');
    console.log('[Video] Output file size:', outputData.length, 'bytes');

    if (outputData.length === 0) {
      throw new Error('FFmpeg produced an empty output file');
    }

    const blob = new Blob([outputData], { type: 'video/mp4' });
    const url = URL.createObjectURL(blob);
    console.log('[Video] Created blob URL:', url, 'Size:', blob.size);

    // More reliable download method
    const a = document.createElement('a');
    a.style.display = 'none';
    a.href = url;
    a.download = `${song.title || 'strands-sounds'}.mp4`;
    document.body.appendChild(a);
    a.click();

    // Delay cleanup to ensure download starts
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 1000);

    console.log('[Video] Download triggered!');
    showToast({ kind: 'success', message: 'Video exported! Check your Downloads folder.', durationMs: 5000 });

    /**
     * CODEX_NEEDED: Vault registration for CPU-encoded (FFmpeg.wasm) videos.
     * The CPU path produces a Blob and triggers a browser download; there is no
     * filesystem path to register with the vault. Options:
     *   (A) POST the blob to the Gener8 shim's /api/video/save endpoint (like GPU path)
     *       to get a filesystem path, then register with vault.
     *   (B) Add a Tauri command that accepts base64/blob data and writes it to the
     *       Everywear Vault directory, returning the path.
     *   (C) Use Tauri's fs plugin to write the blob directly from the webview.
     * For now, attempt the shim save route as a best-effort vault registration.
     */
    try {
      const shimSaveRes = await fetch(
        `http://127.0.0.1:3001/api/video/save?title=${encodeURIComponent(song.title || 'strands-sounds')}`,
        { method: 'POST', body: blob, headers: { 'Content-Type': 'video/mp4' } }
      );
      if (shimSaveRes.ok) {
        const shimData = await shimSaveRes.json();
        await vaultRegisterVideo({
          title: `${song.title || 'Video'} ${new Date().toISOString().slice(0, 10)}`,
          filePath: shimData.path,
          durationSeconds: song.duration || undefined,
          tags: ['gener8', 'video', 'cpu-encode'],
        });
      }
    } catch (vaultErr) {
      console.warn('[Video] Vault registration failed (CPU path):', vaultErr);
    }

    // Cleanup FFmpeg filesystem
    setExportProgress(98);
    for (let i = 0; i < totalFrames; i++) {
      await ffmpeg.deleteFile(`frame${String(i).padStart(6, '0')}.jpg`).catch(() => {});
    }
    await ffmpeg.deleteFile('audio.mp3').catch(() => {});
    await ffmpeg.deleteFile('output.mp4').catch(() => {});
    await audioCtx.close();

    setExportProgress(100);

    // Small delay before hiding the progress to show completion
    setTimeout(() => {
      setIsExporting(false);
      setExportStage('idle');
    }, 500);
  };

  const stopRecording = () => {
    // For offline rendering, we can't really stop mid-process
    // This is kept for compatibility but offline render runs to completion
  };

  // ── GPU Encode via local sidecar (WebSocket frame streaming) ──
  const renderViaGpu = async () => {
    if (!song || !canvasRef.current) return;

    // Create offline canvas at selected resolution
    const canvas = document.createElement('canvas');
    canvas.width = renderRes.w;
    canvas.height = renderRes.h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const fps = 24; // 24fps draft, 30fps in Vid Pro
    const width = canvas.width;
    const height = canvas.height;
    const centerX = width / 2;
    const centerY = height / 2;

    setExportProgress(1);

    // Fetch audio as ArrayBuffer
    console.log('[GPU Encode] Fetching audio...');
    const audioResponse = await fetch(song.audioUrl || '');
    const audioData = await audioResponse.arrayBuffer();
    const audioDataCopy = audioData.slice(0);

    // Decode audio for FFT analysis
    const audioCtx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    const audioBuffer = await audioCtx.decodeAudioData(audioData);
    const duration = audioBuffer.duration;
    const totalFrames = Math.ceil(duration * fps);

    console.log(`[GPU Encode] Audio: ${duration.toFixed(1)}s, ${totalFrames} frames`);

    // Analyze audio offline
    setExportProgress(5);
    const frequencyDataFrames = await analyzeAudioOffline(audioBuffer, fps);

    // Pre-load images (same as WASM path)
    let bgImage: HTMLImageElement | null = null;
    let bgVideo: HTMLVideoElement | null = null;

    if (backgroundType === 'video' && videoUrl) {
      bgVideo = document.createElement('video');
      bgVideo.crossOrigin = 'anonymous';
      bgVideo.src = videoUrl;
      bgVideo.muted = true;
      bgVideo.playsInline = true;
      await new Promise<void>((resolve) => {
        bgVideo!.onloadeddata = () => resolve();
        bgVideo!.onerror = () => { bgVideo = null; resolve(); };
      });
    }

    if (!bgVideo) {
      let bgImageUrl: string | null = null;
      if (backgroundType === 'custom' && customImage) {
        bgImageUrl = customImage;
      } else {
        bgImageUrl = await loadImageAsDataUrl(`https://picsum.photos/seed/${backgroundSeed}/1920/1080?blur=4`);
      }
      if (bgImageUrl) {
        bgImage = new Image();
        bgImage.crossOrigin = 'anonymous';
        bgImage.src = bgImageUrl;
        await new Promise<void>((resolve) => {
          bgImage!.onload = () => resolve();
          bgImage!.onerror = () => { bgImage = null; resolve(); };
        });
      }
    }

    setExportProgress(10);

    // Determine render path: worker (JPEG) or fallback (raw RGBA)
    const workerSupported = typeof OffscreenCanvas !== 'undefined' && !bgVideo;
    const frameFormat = workerSupported ? 'jpeg' : 'raw';

    // ── Open WebSocket to local encoder ──
    console.log(`[GPU Encode] Connecting to local encoder (${frameFormat} frames)...`);
    const ws = new WebSocket('ws://127.0.0.1:9877/encode');
    gpuWsRef.current = ws;

    await new Promise<void>((resolve, reject) => {
      ws.onopen = () => resolve();
      ws.onerror = () => reject(new Error('Failed to connect to GPU encoder'));
      setTimeout(() => reject(new Error('WebSocket connection timeout')), 5000);
    });

    // Init session: JPEG for worker path, raw RGBA for fallback
    ws.send(JSON.stringify({ type: 'init', fps, width, height, totalFrames, format: frameFormat }));

    // Wait for session acknowledgment
    const sessionId = await new Promise<string>((resolve, reject) => {
      const handler = (event: MessageEvent) => {
        const msg = JSON.parse(event.data);
        if (msg.type === 'session') {
          ws.removeEventListener('message', handler);
          resolve(msg.sessionId);
        } else if (msg.type === 'error') {
          ws.removeEventListener('message', handler);
          reject(new Error(msg.message));
        }
      };
      ws.addEventListener('message', handler);
    });

    console.log(`[GPU Encode] Session: ${sessionId.slice(0, 8)}`);

    // Send audio as chunked base64 — String.fromCharCode blows the stack on large arrays
    const audioBytes = new Uint8Array(audioDataCopy);
    const chunkSize = 32768;
    let audioStr = '';
    for (let i = 0; i < audioBytes.length; i += chunkSize) {
      const chunk = audioBytes.subarray(i, Math.min(i + chunkSize, audioBytes.length));
      audioStr += String.fromCharCode.apply(null, Array.from(chunk));
    }
    const audioBase64 = btoa(audioStr);
    ws.send(JSON.stringify({ type: 'audio', data: audioBase64 }));

    // Wait for audio acknowledgment
    await new Promise<void>((resolve) => {
      const handler = (event: MessageEvent) => {
        const msg = JSON.parse(event.data);
        if (msg.type === 'audio_received') {
          ws.removeEventListener('message', handler);
          resolve();
        }
      };
      ws.addEventListener('message', handler);
    });

    // Start FFmpeg on the sidecar
    ws.send(JSON.stringify({ type: 'start', fps, width, height }));

    // Wait for ready signal
    await new Promise<void>((resolve) => {
      const handler = (event: MessageEvent) => {
        const msg = JSON.parse(event.data);
        if (msg.type === 'ready') {
          ws.removeEventListener('message', handler);
          resolve();
        }
      };
      ws.addEventListener('message', handler);
    });

    setExportStage('capturing');
    setExportProgress(15);

    // ── Render frames and stream to sidecar ──
    const currentConfig = configRef.current;
    const currentEffects = effectsRef.current;
    const currentIntensities = intensitiesRef.current;
    const currentTexts = textLayersRef.current;
    const renderStartTime = performance.now();

    if (workerSupported) {
      // ═══ PARALLEL WORKER PATH ═══
      // Offloads ALL canvas drawing to a Web Worker thread.
      // Main thread stays free for UI updates + WebSocket streaming.
      console.log('[GPU Encode] Using parallel OffscreenCanvas worker');

      // Prepare background image as ImageBitmap for transfer to worker
      let bgImageBitmap: ImageBitmap | null = null;
      if (bgImage) {
        bgImageBitmap = await createImageBitmap(bgImage);
      }

      // Convert frequencyData Uint8Arrays to ArrayBuffers for transfer
      const frequencyBuffers = frequencyDataFrames.map(f => {
        const copy = new Uint8Array(f);
        return copy.buffer;
      });

      // Spawn worker
      const worker = new Worker(
        new URL('../workers/videoRenderWorker.ts', import.meta.url),
        { type: 'module' }
      );
      renderWorkerRef.current = worker;

      // Send init message with all render config + pre-analyzed FFT data
      const initMsg: Record<string, unknown> = {
        type: 'init',
        width,
        height,
        fps,
        totalFrames,
        config: currentConfig,
        effects: currentEffects,
        intensities: currentIntensities,
        texts: currentTexts,
        showWatermark: showWatermarkRef.current,
        frequencyData: frequencyBuffers,
        lrcData: lrcDataRef.current ?? undefined,
      };

      const transferables: Transferable[] = [...frequencyBuffers];
      if (bgImageBitmap) {
        initMsg.bgImageBitmap = bgImageBitmap;
        transferables.push(bgImageBitmap);
      }

      // Slideshow: convert preloaded images to ImageBitmaps for worker transfer
      if (slideshowEnabled && slideshowImagesRef.current.length > 0) {
        const bitmaps: ImageBitmap[] = [];
        for (const img of slideshowImagesRef.current) {
          if (img.complete && img.naturalWidth) {
            const bmp = await createImageBitmap(img);
            bitmaps.push(bmp);
          }
        }
        if (bitmaps.length > 0) {
          initMsg.slideshowBitmaps = bitmaps;
          initMsg.slideshowEnabled = true;
          initMsg.slideshowOpacity = slideshowOpacity;
          initMsg.slideshowFit = slideshowFit;
          transferables.push(...bitmaps);
        }
      }

      worker.postMessage(initMsg, transferables);

      // Listen for JPEG frames and forward to WebSocket (sidecar uses image2pipe)
      await new Promise<void>((resolve, reject) => {
        worker.onmessage = (e: MessageEvent) => {
          const msg = e.data;

          switch (msg.type) {
            case 'frame_blob': {
              // Reconstruct JPEG Blob from transferred ArrayBuffer (~50KB vs ~2MB raw RGBA)
              const jpegBlob = new Blob([msg.buffer], { type: 'image/jpeg' });
              ws.send(jpegBlob);

              // Backpressure: JPEG frames are ~40x smaller, raise threshold check
              if (ws.bufferedAmount > 8 * 1024 * 1024) {
                worker.postMessage({ type: 'pause' });
                const drainCheck = () => {
                  if (ws.bufferedAmount < 4 * 1024 * 1024) {
                    worker.postMessage({ type: 'resume' });
                  } else {
                    setTimeout(drainCheck, 10);
                  }
                };
                drainCheck();
              }
              break;
            }

            case 'progress': {
              const pct = 15 + Math.round((msg.frameIndex / msg.totalFrames) * 55);
              setExportProgress(pct);
              if (msg.frameIndex > 0) {
                const elapsed = (performance.now() - renderStartTime) / 1000;
                const msPerFrame = elapsed / msg.frameIndex;
                const remaining = Math.ceil(msPerFrame * (msg.totalFrames - msg.frameIndex));
                const mins = Math.floor(remaining / 60);
                const secs = remaining % 60;
                setExportEta(mins > 0 ? `~${mins}m ${secs}s remaining` : `~${secs}s remaining`);
              }
              break;
            }

            case 'done':
              worker.terminate();
              renderWorkerRef.current = null;
              resolve();
              break;

            case 'error':
              worker.terminate();
              renderWorkerRef.current = null;
              reject(new Error(`Worker error: ${msg.message}`));
              break;
          }
        };

        worker.onerror = (err) => {
          console.error('[GPU Encode] Worker crashed:', err);
          worker.terminate();
          renderWorkerRef.current = null;
          reject(new Error('Render worker crashed'));
        };
      });

    } else {
      // ═══ FALLBACK: SYNCHRONOUS MAIN-THREAD RENDER ═══
      // Used when OffscreenCanvas is unavailable or video background is active.
      console.log('[GPU Encode] Using synchronous main-thread render (fallback)');

      for (let frameIndex = 0; frameIndex < totalFrames; frameIndex++) {
        const time = frameIndex / fps;
        const dataArray = frequencyDataFrames[Math.min(frameIndex, frequencyDataFrames.length - 1)];

        ctx.save();
        ctx.clearRect(0, 0, width, height);

        // Background
        if (bgVideo) {
          const seekTime = time % (bgVideo.duration || 1);
          bgVideo.currentTime = seekTime;
          ctx.drawImage(bgVideo, 0, 0, width, height);
        } else if (bgImage) {
          ctx.drawImage(bgImage, 0, 0, width, height);
        } else {
          ctx.fillStyle = '#0a0a0a';
          ctx.fillRect(0, 0, width, height);
        }

        // Dimming
        ctx.fillStyle = `rgba(0,0,0,${currentConfig.bgDim})`;
        ctx.fillRect(0, 0, width, height);

        // Get audio metrics
        let bass = 0;
        for (let i = 0; i < 10; i++) bass += dataArray[i] || 0;
        bass /= 10;
        const normBass = bass / 255;
        const pulse = 1 + normBass * 0.15;

        // Synthesize time-domain waveform for Oscilloscope preset
        const timeDomain = new Uint8Array(1024);
        for (let i = 0; i < timeDomain.length; i++) {
          timeDomain[i] = 128 + Math.sin(i * 0.1 + time * 10) * 64 * normBass;
        }

        // Slideshow layer (beat-synced)
        renderSlideshow(ctx, width, height, normBass, frameIndex * (1000 / fps));

        // Apply particle transform (zoom + offset)
        ctx.save();
        const pScale = currentConfig.particleScale;
        const pOffX = (currentConfig.particleOffsetX / 100) * width;
        const pOffY = (currentConfig.particleOffsetY / 100) * height;
        ctx.translate(centerX + pOffX, centerY + pOffY);
        ctx.scale(pScale, pScale);
        ctx.translate(-centerX, -centerY);

        switch (currentConfig.preset) {
          case 'NCS Circle':
            drawNCSCircle(ctx, centerX, centerY, dataArray, pulse, time, currentConfig.primaryColor, currentConfig.secondaryColor);
            break;
          case 'Linear Bars':
            drawLinearBars(ctx, width, height, dataArray, currentConfig.primaryColor, currentConfig.secondaryColor);
            break;
          case 'Dual Mirror':
            drawDualMirror(ctx, width, height, dataArray, currentConfig.primaryColor);
            break;
          case 'Center Wave':
            drawCenterWave(ctx, centerX, centerY, dataArray, time, currentConfig.primaryColor);
            break;
          case 'Orbital':
            drawOrbital(ctx, centerX, centerY, dataArray, time, currentConfig.primaryColor, currentConfig.secondaryColor);
            break;
          case 'Hexagon':
            drawHexagon(ctx, centerX, centerY, dataArray, pulse, time, currentConfig.primaryColor);
            break;
          case 'Oscilloscope':
            drawOscilloscope(ctx, width, height, timeDomain, currentConfig.primaryColor);
            break;
          case 'Digital Rain':
            drawDigitalRain(ctx, width, height, dataArray, time, currentConfig.primaryColor);
            break;
          case 'Shockwave':
            drawShockwave(ctx, centerX, centerY, bass, time, currentConfig.primaryColor);
            break;
          case 'Strands Particle':
            drawStrandsParticle(ctx, centerX, centerY, width, height, normBass, time, 1 / fps);
            break;
          // S3 Hero + DJ At Work — shared silhouette engine, see first switch.
          case 'S3 Hero':
            drawS3Hero(ctx, centerX, centerY, width, height, normBass, currentConfig.primaryColor);
            break;
          case 'DJ At Work':
            drawDJAtWork(ctx, centerX, centerY, width, height, normBass, currentConfig.primaryColor);
            break;
          case 'Minimal':
          default:
            break;
        }

        drawParticles(ctx, width, height, time, bass, currentConfig.particleCount, currentConfig.primaryColor);
        ctx.restore(); // End particle transform

        // Effects
        if (currentEffects.pixelate) {
          const pixelSize = Math.max(4, Math.floor(16 * currentIntensities.pixelate));
          ctx.imageSmoothingEnabled = false;
          const tempCanvas2 = document.createElement('canvas');
          const smallW = Math.floor(width / pixelSize);
          const smallH = Math.floor(height / pixelSize);
          tempCanvas2.width = smallW;
          tempCanvas2.height = smallH;
          const tempCtx2 = tempCanvas2.getContext('2d')!;
          tempCtx2.drawImage(canvas, 0, 0, smallW, smallH);
          ctx.clearRect(0, 0, width, height);
          ctx.drawImage(tempCanvas2, 0, 0, smallW, smallH, 0, 0, width, height);
          ctx.imageSmoothingEnabled = true;
        }

        // Text layers (scale font size from preview res 1080 to render res)
        const fontScale = Math.min(width / 1920, height / 1080);
        ctx.shadowBlur = 10 * fontScale;
        ctx.shadowColor = 'black';
        ctx.textAlign = 'center';
        currentTexts.filter(layer => layer.visible !== false).forEach(layer => {
          const dynamicSize = (layer.id === '1' && currentConfig.preset === 'Minimal' ? layer.size * pulse : layer.size) * fontScale;
          ctx.font = `bold ${dynamicSize}px ${layer.font}, sans-serif`;
          const xPos = (layer.x / 100) * width;
          const yPos = (layer.y / 100) * height;

          // Resolve display text: timed lyrics layer reads current line from LRC
          let displayText = layer.text;
          if (layer.id === 'timed-lyrics' && audioRef.current) {
            const lrc = lrcDataRef.current;
            if (lrc) {
              const parsed = parseLrc(lrc);
              displayText = getCurrentLine(parsed, audioRef.current.currentTime);
            }
          }

          if (!displayText) return;

          // Background pill behind text
          if (layer.background) {
            const metrics = ctx.measureText(displayText);
            const pad = dynamicSize * 0.4;
            const bgW = metrics.width + pad * 2;
            const bgH = dynamicSize * 1.3;
            ctx.fillStyle = layer.background;
            ctx.fillRect(xPos - bgW / 2, yPos - bgH * 0.75, bgW, bgH);
          }

          ctx.fillStyle = layer.color;
          ctx.fillText(displayText, xPos, yPos);
        });

        if (showWatermarkRef.current) drawStrandsWatermark(ctx, width, height);
        ctx.restore();

        // Post-processing effects
        if (currentEffects.scanlines || currentEffects.cctv) {
          ctx.fillStyle = `rgba(0,0,0,${currentIntensities.scanlines * 0.8})`;
          for (let i = 0; i < height; i += 4) ctx.fillRect(0, i, width, 2);
        }
        if (currentEffects.letterbox) {
          const barHeight = height * 0.12 * currentIntensities.letterbox;
          ctx.fillStyle = 'black';
          ctx.fillRect(0, 0, width, barHeight);
          ctx.fillRect(0, height - barHeight, width, barHeight);
        }

        // Capture frame as raw RGBA pixels
        const imageData = ctx.getImageData(0, 0, width, height);
        ws.send(imageData.data.buffer);

        // Backpressure: if WebSocket buffer exceeds 16MB, wait for it to drain
        if (ws.bufferedAmount > 16 * 1024 * 1024) {
          await new Promise<void>(resolve => {
            const check = () => {
              if (ws.bufferedAmount < 4 * 1024 * 1024) resolve();
              else setTimeout(check, 10);
            };
            check();
          });
        }

        // Yield to event loop every 30 frames to keep UI responsive + update progress
        if (frameIndex % 30 === 0) {
          await new Promise(r => setTimeout(r, 0));
          setExportProgress(15 + Math.round((frameIndex / totalFrames) * 55));
          if (frameIndex > 0) {
            const elapsed = (performance.now() - renderStartTime) / 1000;
            const msPerFrame = elapsed / frameIndex;
            const remaining = Math.ceil(msPerFrame * (totalFrames - frameIndex));
            const mins = Math.floor(remaining / 60);
            const secs = remaining % 60;
            setExportEta(mins > 0 ? `~${mins}m ${secs}s remaining` : `~${secs}s remaining`);
          }
        }
      }
    }

    // Signal end of frames
    ws.send(JSON.stringify({ type: 'end' }));
    setExportEta('');
    setExportStage('encoding');
    setExportProgress(70);

    // ── Wait for completion ──
    const downloadUrl = await new Promise<string>((resolve, reject) => {
      const handler = (event: MessageEvent) => {
        const msg = JSON.parse(event.data);
        if (msg.type === 'progress' && msg.stage === 'encoding') {
          setExportProgress(70 + Math.round(msg.progress * 25));
        } else if (msg.type === 'complete') {
          ws.removeEventListener('message', handler);
          resolve(msg.downloadUrl);
        } else if (msg.type === 'error') {
          ws.removeEventListener('message', handler);
          reject(new Error(msg.message));
        }
      };
      ws.addEventListener('message', handler);
    });

    setExportProgress(95);

    // Fetch MP4 from sidecar then persist via shim
    console.log(`[GPU Encode] Downloading from ${downloadUrl}`);
    const mp4Response = await fetch(`http://127.0.0.1:9877${downloadUrl}`);
    const mp4Blob = await mp4Response.blob();

    // Save to Videos/Strands Sound Studio via local shim
    const videoTitle = (song.title || 'strands-sounds')
      .replace(/\s*\((reference|cover)\)/gi, '')
      .replace(/\s*\(\d+\)\s*$/, '')
      .trim();
    const saveRes = await fetch(
      `http://127.0.0.1:3001/api/video/save?title=${encodeURIComponent(videoTitle)}`,
      { method: 'POST', body: mp4Blob, headers: { 'Content-Type': 'video/mp4' } }
    );
    if (!saveRes.ok) {
      const errText = await saveRes.text();
      console.error('[GPU Encode] Save failed:', errText);
      showToast({ kind: 'error', message: 'Video save failed. Check disk space.' });
    } else {
      const saveData = await saveRes.json();
      console.log(`[GPU Encode] Saved to: ${saveData.path} (${saveData.size_bytes} bytes)`);
      const sizeMb = (saveData.size_bytes / (1024 * 1024)).toFixed(1);
      showToast({ kind: 'success', message: `Video saved (${sizeMb} MB) → Videos/Strands Sound Studio`, durationMs: 5000 });

      // Register with Everywear Vault
      try {
        await vaultRegisterVideo({
          title: `${videoTitle} ${new Date().toISOString().slice(0, 10)}`,
          filePath: saveData.path,
          durationSeconds: song.duration || undefined,
          tags: ['gener8', 'video', 'gpu-encode'],
        });
      } catch (vaultErr) {
        console.warn('[GPU Encode] Vault registration failed:', vaultErr);
      }
    }

    console.log('[GPU Encode] Video saved!');
    await audioCtx.close();
    ws.close();
    gpuWsRef.current = null;

    setExportProgress(100);
    setTimeout(() => {
      setIsExporting(false);
      setExportStage('idle');
    }, 500);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = (ev) => {
            const result = ev.target?.result as string;
            setCustomImage(result);
            setBackgroundType('custom');
        };
        reader.readAsDataURL(file);
    }
  };

  const handleVideoFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const url = URL.createObjectURL(file);
      setVideoUrl(url);
      setBackgroundType('video');
    }
  };

  const searchPexels = async (query: string, type: 'photos' | 'videos') => {
    setPexelsLoading(true);
    setPexelsError(null);
    try {
      const endpoint = type === 'photos'
        ? `/api/pexels/photos?query=${encodeURIComponent(query)}`
        : `/api/pexels/videos?query=${encodeURIComponent(query)}`;

      const headers: HeadersInit = {};
      if (pexelsApiKey) {
        headers['X-Pexels-Api-Key'] = pexelsApiKey;
      }

      const response = await fetch(endpoint, { headers });
      const data = await response.json();

      if (!response.ok) {
        if (response.status === 400 || response.status === 401) {
          setPexelsError(data.error || 'API key required');
          setShowPexelsApiKeyInput(true);
        } else {
          setPexelsError(data.error || 'Search failed');
        }
        return;
      }

      if (type === 'photos') {
        setPexelsPhotos(data.photos || []);
      } else {
        setPexelsVideos(data.videos || []);
      }
    } catch (error) {
      console.error('Pexels search failed:', error);
      setPexelsError('Search failed. Please try again.');
    } finally {
      setPexelsLoading(false);
    }
  };

  const savePexelsApiKey = (key: string) => {
    setPexelsApiKey(key);
    localStorage.setItem('pexels_api_key', key);
    setShowPexelsApiKeyInput(false);
    setPexelsError(null);
    // Retry search with new key
    if (key) {
      searchPexels(pexelsQuery, pexelsTab);
    }
  };

  const selectPexelsPhoto = (photo: PexelsPhoto) => {
    if (pexelsTarget === 'albumArt') {
      setCustomAlbumArt(photo.src.large);
    } else {
      setCustomImage(photo.src.large);
      setBackgroundType('custom');
    }
    setShowPexelsBrowser(false);
  };

  const selectPexelsVideo = (video: PexelsVideo) => {
    // Get best quality video file (prefer HD)
    const hdFile = video.video_files.find(f => f.quality === 'hd' && f.width >= 1280);
    const sdFile = video.video_files.find(f => f.quality === 'sd');
    const videoFile = hdFile || sdFile || video.video_files[0];
    if (videoFile) {
      setVideoUrl(videoFile.link);
      setBackgroundType('video');
      setShowPexelsBrowser(false);
    }
  };

  const openPexelsBrowser = (target: 'background' | 'albumArt' = 'background', tab: 'photos' | 'videos' = 'photos') => {
    setPexelsTarget(target);
    setPexelsTab(target === 'albumArt' ? 'photos' : tab); // Album art is always photos
    setShowPexelsBrowser(true);
    const searchTab = target === 'albumArt' ? 'photos' : tab;
    if ((searchTab === 'photos' && pexelsPhotos.length === 0) || (searchTab === 'videos' && pexelsVideos.length === 0)) {
      searchPexels(pexelsQuery, searchTab);
    }
  };

  const handleAlbumArtUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (ev) => {
        setCustomAlbumArt(ev.target?.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  // --- RENDER ENGINE ---
  const renderLoop = () => {
    if (!canvasRef.current || !analyserRef.current || !song) {
        animationRef.current = requestAnimationFrame(renderLoop);
        return;
    }

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Read current state
    const currentConfig = configRef.current;
    const currentEffects = effectsRef.current;
    const currentIntensities = intensitiesRef.current;
    const currentTexts = textLayersRef.current;

    const width = canvas.width;
    const height = canvas.height;
    const centerX = width / 2;
    const centerY = height / 2;
    const time = Date.now() / 1000;

    // Data
    const bufferLength = analyserRef.current.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    const timeDomain = new Uint8Array(bufferLength);
    analyserRef.current.getByteFrequencyData(dataArray);
    analyserRef.current.getByteTimeDomainData(timeDomain);


    // Bass Calc
    let bass = 0;
    for (let i = 0; i < 20; i++) bass += dataArray[i];
    bass = bass / 20;
    const normBass = bass / 255;
    const pulse = 1 + normBass * 0.15;

    // --- 1. CLEAR & BACKGROUND ---
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, width, height);

    // Draw video or image background
    const bgSource = bgVideoRef.current && bgVideoRef.current.readyState >= 2
        ? bgVideoRef.current
        : bgImageRef.current;

    if (bgSource) {
        ctx.save();
        ctx.globalAlpha = 1 - currentConfig.bgDim;

        // Shake Effect (Camera)
        if (currentEffects.shake && normBass > (0.6 - (currentIntensities.shake * 0.3))) {
             const magnitude = currentIntensities.shake * 50;
             const shakeX = (Math.random() - 0.5) * magnitude * normBass;
             const shakeY = (Math.random() - 0.5) * magnitude * normBass;
             ctx.translate(shakeX, shakeY);
        }

        const zoom = 1 + (Math.sin(time * 0.5) * 0.05);
        ctx.translate(centerX, centerY);
        ctx.scale(zoom, zoom);
        ctx.drawImage(bgSource, -width/2, -height/2, width, height);
        ctx.restore();
    }

    // --- 1.5. SLIDESHOW LAYER (beat-synced, between bg and visualiser) ---
    renderSlideshow(ctx, width, height, normBass, Date.now());

    // --- 2. PRESET DRAWING ---
    ctx.save();
    
    // Apply Shake to visual elements
    if (currentEffects.shake && normBass > 0.6) {
         const magnitude = currentIntensities.shake * 30;
         const shakeX = (Math.random() - 0.5) * magnitude * normBass;
         const shakeY = (Math.random() - 0.5) * magnitude * normBass;
         ctx.translate(shakeX, shakeY);
    }

    // Apply particle transform (zoom + offset)
    ctx.save();
    const pScale = currentConfig.particleScale;
    const pOffX = (currentConfig.particleOffsetX / 100) * width;
    const pOffY = (currentConfig.particleOffsetY / 100) * height;
    ctx.translate(centerX + pOffX, centerY + pOffY);
    ctx.scale(pScale, pScale);
    ctx.translate(-(centerX), -(centerY));

    switch(currentConfig.preset) {
        case 'NCS Circle':
            drawNCSCircle(ctx, centerX, centerY, dataArray, pulse, time, currentConfig.primaryColor, currentConfig.secondaryColor);
            break;
        case 'Linear Bars':
            drawLinearBars(ctx, width, height, dataArray, currentConfig.primaryColor, currentConfig.secondaryColor);
            break;
        case 'Dual Mirror':
            drawDualMirror(ctx, width, height, dataArray, currentConfig.primaryColor);
            break;
        case 'Center Wave':
            drawCenterWave(ctx, centerX, centerY, dataArray, time, currentConfig.primaryColor);
            break;
        case 'Orbital':
            drawOrbital(ctx, centerX, centerY, dataArray, time, currentConfig.primaryColor, currentConfig.secondaryColor);
            break;
        case 'Hexagon':
            drawHexagon(ctx, centerX, centerY, dataArray, pulse, time, currentConfig.primaryColor);
            break;
        case 'Oscilloscope':
            drawOscilloscope(ctx, width, height, timeDomain, currentConfig.primaryColor);
            break;
        case 'Digital Rain':
            drawDigitalRain(ctx, width, height, dataArray, time, currentConfig.primaryColor);
            break;
        case 'Shockwave':
             drawShockwave(ctx, centerX, centerY, bass, time, currentConfig.primaryColor);
             break;
        case 'Strands Particle': {
             const dt = lastTimeRef.current > 0 ? time - lastTimeRef.current : 1/60;
             drawStrandsParticle(ctx, centerX, centerY, width, height, normBass, time, Math.min(dt, 0.1));
             break;
        }
        // S3 Hero + DJ At Work — shared silhouette engine, see first switch.
        case 'S3 Hero':
            drawS3Hero(ctx, centerX, centerY, width, height, normBass, currentConfig.primaryColor);
            break;
        case 'DJ At Work':
            drawDJAtWork(ctx, centerX, centerY, width, height, normBass, currentConfig.primaryColor);
            break;
    }
    lastTimeRef.current = time;

    drawParticles(ctx, width, height, time, bass, currentConfig.particleCount, currentConfig.primaryColor);

    if (currentConfig.showVoidImage && ['NCS Circle', 'Hexagon', 'Orbital', 'Shockwave'].includes(currentConfig.preset)) {
        const rawAlbumArtUrl = customAlbumArt || song.coverUrl;
        const albumArtUrl = rawAlbumArtUrl.startsWith('http')
            ? `/api/proxy/image?url=${encodeURIComponent(rawAlbumArtUrl)}`
            : rawAlbumArtUrl;
        drawAlbumArt(ctx, centerX, centerY, pulse, albumArtUrl, currentConfig.primaryColor, customAlbumArtImageRef.current);
    }

    ctx.restore(); // End particle transform

    // Pixelate effect (applied before text so text stays sharp)
    if (currentEffects.pixelate) {
        const pixelSize = Math.max(4, Math.floor(16 * currentIntensities.pixelate));
        ctx.imageSmoothingEnabled = false;
        const tempCanvas = document.createElement('canvas');
        const smallW = Math.floor(width / pixelSize);
        const smallH = Math.floor(height / pixelSize);
        tempCanvas.width = smallW;
        tempCanvas.height = smallH;
        const tempCtx = tempCanvas.getContext('2d')!;
        tempCtx.drawImage(canvas, 0, 0, smallW, smallH);
        ctx.clearRect(0, 0, width, height);
        ctx.drawImage(tempCanvas, 0, 0, smallW, smallH, 0, 0, width, height);
        ctx.imageSmoothingEnabled = true;
    }

    // --- 3. CUSTOM TEXT LAYERS (scale font from reference 1080 to canvas height) ---
    const fontScale = Math.min(width / 1920, height / 1080);
    ctx.shadowBlur = 10 * fontScale;
    ctx.shadowColor = 'black';
    ctx.textAlign = 'center';

    currentTexts.filter(layer => layer.visible !== false).forEach(layer => {
        const dynamicSize = (layer.id === '1' && currentConfig.preset === 'Minimal' ? layer.size * pulse : layer.size) * fontScale;
        ctx.font = `bold ${dynamicSize}px ${layer.font}, sans-serif`;

        const xPos = (layer.x / 100) * width;
        const yPos = (layer.y / 100) * height;

        // Resolve display text: timed lyrics layer reads current line from LRC
        let displayText = layer.text;
        if (layer.id === 'timed-lyrics' && audioRef.current) {
            const lrc = lrcDataRef.current;
            if (lrc) {
                const parsed = parseLrc(lrc);
                displayText = getCurrentLine(parsed, audioRef.current.currentTime);
            }
        }

        if (!displayText) return;

        // Background pill behind text
        if (layer.background) {
            const metrics = ctx.measureText(displayText);
            const pad = dynamicSize * 0.4;
            const bgW = metrics.width + pad * 2;
            const bgH = dynamicSize * 1.3;
            ctx.fillStyle = layer.background;
            ctx.fillRect(xPos - bgW / 2, yPos - bgH * 0.75, bgW, bgH);
        }

        ctx.fillStyle = layer.color;
        ctx.fillText(displayText, xPos, yPos);
    });

    // Strands watermark — bottom-right (toggleable)
    if (showWatermarkRef.current) drawStrandsWatermark(ctx, width, height);

    ctx.restore();

    // --- 4. POST-PROCESSING EFFECTS ---
    
    // Scanlines
    if (currentEffects.scanlines || currentEffects.cctv) {
        ctx.fillStyle = `rgba(0,0,0,${currentIntensities.scanlines * 0.8})`;
        for (let i = 0; i < height; i+=4) {
            ctx.fillRect(0, i, width, 2);
        }
    }

    // VHS Color Shift / Chromatic Aberration
    if (currentEffects.vhs || currentEffects.chromatic || (currentEffects.glitch && Math.random() > (1 - currentIntensities.glitch))) {
        const intensity = currentEffects.vhs ? currentIntensities.vhs : currentIntensities.chromatic;
        const offset = (10 * intensity) * normBass;
        ctx.globalCompositeOperation = 'screen';

        // Red Shift - draw colored rectangle offset left
        ctx.fillStyle = `rgba(255,0,0,${0.2 * intensity})`;
        ctx.fillRect(-offset, 0, width, height);

        // Blue Shift - draw colored rectangle offset right
        ctx.fillStyle = `rgba(0,0,255,${0.2 * intensity})`;
        ctx.fillRect(offset, 0, width, height);

        ctx.globalCompositeOperation = 'source-over';
    }

    // Glitch Slices
    if (currentEffects.glitch && Math.random() > (1 - currentIntensities.glitch)) {
        const sliceHeight = Math.random() * 50;
        const sliceY = Math.random() * height;
        const offset = (Math.random() - 0.5) * 40 * currentIntensities.glitch;
        
        ctx.drawImage(canvas, 0, sliceY, width, sliceHeight, offset, sliceY, width, sliceHeight);
        
        // Random colored block
        ctx.fillStyle = Math.random() > 0.5 ? currentConfig.primaryColor : '#fff';
        ctx.fillRect(Math.random()*width, Math.random()*height, Math.random()*200, 4);
    }

    // CCTV Vignette & Grain
    if (currentEffects.cctv) {
        const intensity = currentIntensities.cctv;
        // Green tint
        ctx.globalCompositeOperation = 'overlay';
        ctx.fillStyle = `rgba(0, 50, 0, ${0.4 * intensity})`;
        ctx.fillRect(0, 0, width, height);

        // Vignette
        const grad = ctx.createRadialGradient(centerX, centerY, height * 0.4, centerX, centerY, height * 0.9);
        grad.addColorStop(0, 'transparent');
        grad.addColorStop(1, 'black');
        ctx.globalCompositeOperation = 'multiply';
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, width, height);

        // Date Stamp
        ctx.globalCompositeOperation = 'source-over';
        ctx.font = 'mono 24px monospace';
        ctx.fillStyle = 'white';
        ctx.shadowColor = 'black';
        ctx.fillText(new Date().toLocaleString().toUpperCase(), 60, 60);
        ctx.fillText("REC ●", width - 120, 60);
    }

    // Bloom / Glow effect
    if (currentEffects.bloom) {
        const intensity = currentIntensities.bloom;
        ctx.globalCompositeOperation = 'screen';
        ctx.filter = `blur(${15 * intensity}px)`;
        ctx.globalAlpha = 0.4 * intensity;
        ctx.drawImage(canvas, 0, 0);
        ctx.filter = 'none';
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
    }

    // Film Grain
    if (currentEffects.filmGrain) {
        const intensity = currentIntensities.filmGrain;
        const imageData = ctx.getImageData(0, 0, width, height);
        const data = imageData.data;
        const grainAmount = intensity * 50;
        for (let i = 0; i < data.length; i += 4) {
            const noise = (Math.random() - 0.5) * grainAmount;
            data[i] += noise;
            data[i + 1] += noise;
            data[i + 2] += noise;
        }
        ctx.putImageData(imageData, 0, 0);
    }

    // Strobe effect
    if (currentEffects.strobe && normBass > (0.7 - currentIntensities.strobe * 0.3)) {
        ctx.globalCompositeOperation = 'screen';
        ctx.fillStyle = `rgba(255, 255, 255, ${currentIntensities.strobe * normBass * 0.8})`;
        ctx.fillRect(0, 0, width, height);
        ctx.globalCompositeOperation = 'source-over';
    }

    // Vignette effect
    if (currentEffects.vignette) {
        const intensity = currentIntensities.vignette;
        const grad = ctx.createRadialGradient(centerX, centerY, height * 0.3, centerX, centerY, height * 0.8);
        grad.addColorStop(0, 'transparent');
        grad.addColorStop(1, `rgba(0, 0, 0, ${0.8 * intensity})`);
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, width, height);
    }

    // Hue Shift effect
    if (currentEffects.hueShift) {
        const hueRotation = currentIntensities.hueShift * 360 * (1 + normBass * 0.5);
        ctx.filter = `hue-rotate(${hueRotation}deg)`;
        ctx.drawImage(canvas, 0, 0);
        ctx.filter = 'none';
    }

    // Letterbox effect
    if (currentEffects.letterbox) {
        const barHeight = height * 0.12 * currentIntensities.letterbox;
        ctx.fillStyle = 'black';
        ctx.fillRect(0, 0, width, barHeight);
        ctx.fillRect(0, height - barHeight, width, barHeight);
    }

    animationRef.current = requestAnimationFrame(renderLoop);
  };

  // --- DRAWING FUNCTIONS ---
  // (Reusing existing drawing functions from previous step, ensuring they use updated args)
  const drawNCSCircle = (ctx: CanvasRenderingContext2D, cx: number, cy: number, data: Uint8Array, pulse: number, time: number, c1: string, c2: string) => {
    const radius = 150 + (pulse - 1) * 50;
    const bars = 80;
    const step = (Math.PI * 2) / bars;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(time * 0.15);
    for (let i = 0; i < bars; i++) {
        const val = data[i + 10];
        const normalized = val / 255;
        const h = 8 + Math.pow(normalized, 1.5) * 120;
        ctx.save();
        ctx.rotate(i * step);
        const grad = ctx.createLinearGradient(0, radius, 0, radius + h);
        grad.addColorStop(0, c1);
        grad.addColorStop(1, c2);
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.roundRect(-3, radius + 10, 6, h, 3);
        ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.15)';
        ctx.beginPath();
        ctx.roundRect(-3, radius + 10 + h + 2, 6, 3, 2);
        ctx.fill();
        ctx.restore();
    }
    ctx.beginPath();
    ctx.arc(0, 0, radius + 150, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();
  };

  const drawLinearBars = (ctx: CanvasRenderingContext2D, w: number, h: number, data: Uint8Array, c1: string, c2: string) => {
      const bars = 64;
      const barW = w / bars;
      const gap = 2;
      for(let i=0; i<bars; i++) {
          const val = data[i * 2];
          const normalized = val / 255;
          const barH = 10 + Math.pow(normalized, 1.3) * (h * 0.35);
          const grad = ctx.createLinearGradient(0, h/2, 0, h/2 - barH);
          grad.addColorStop(0, c1);
          grad.addColorStop(1, c2);
          ctx.fillStyle = grad;
          ctx.fillRect(i * barW + gap/2, h/2 - barH, barW - gap, barH);
          ctx.fillStyle = 'rgba(255,255,255,0.2)';
          ctx.fillRect(i * barW + gap/2, h/2, barW - gap, barH * 0.3);
      }
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.fillRect(0, h/2, w, 1);
  };

  const drawDualMirror = (ctx: CanvasRenderingContext2D, w: number, h: number, data: Uint8Array, color: string) => {
      const bars = 40;
      const barH = h / bars;
      const cy = h/2;
      for(let i=0; i<bars; i++) {
          const val = data[i*3];
          const normalized = val / 255;
          const len = 20 + Math.pow(normalized, 1.4) * (w * 0.3);
          const alpha = 0.4 + normalized * 0.6;
          ctx.fillStyle = color;
          ctx.globalAlpha = alpha;
          ctx.fillRect(0, cy - (i*barH), len, barH-2);
          ctx.fillRect(0, cy + (i*barH), len, barH-2);
          ctx.fillRect(w - len, cy - (i*barH), len, barH-2);
          ctx.fillRect(w - len, cy + (i*barH), len, barH-2);
      }
      ctx.globalAlpha = 1;
  };

  const drawOrbital = (ctx: CanvasRenderingContext2D, cx: number, cy: number, data: Uint8Array, time: number, c1: string, c2: string) => {
      for(let i=0; i<5; i++) {
          const r = 100 + (i * 55);
          const val = data[i*10];
          const normalized = val / 255;
          const width = 4 + normalized * 6;
          ctx.beginPath();
          ctx.strokeStyle = i % 2 === 0 ? c1 : c2;
          ctx.lineWidth = width;
          ctx.shadowBlur = 20;
          ctx.shadowColor = ctx.strokeStyle;
          const direction = i % 2 === 0 ? 1 : -1;
          const speed = direction * (0.5 + i * 0.1);
          const start = time * speed;
          const arcLength = Math.PI * 1.2 + normalized * Math.PI * 0.3;
          ctx.arc(cx, cy, r, start, start + arcLength);
          ctx.stroke();
      }
      ctx.shadowBlur = 0;
  };

  const drawHexagon = (ctx: CanvasRenderingContext2D, cx: number, cy: number, data: Uint8Array, pulse: number, time: number, color: string) => {
      const sides = 6;
      const r = 180 * pulse;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(time * 0.4);
      ctx.beginPath();
      ctx.lineWidth = 12;
      ctx.strokeStyle = color;
      ctx.lineJoin = 'round';
      ctx.shadowBlur = 25;
      ctx.shadowColor = color;
      for(let i=0; i<=sides; i++) {
          const angle = i * 2 * Math.PI / sides;
          const x = r * Math.cos(angle);
          const y = r * Math.sin(angle);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.restore();
      ctx.shadowBlur = 0;
  };

  const drawOscilloscope = (ctx: CanvasRenderingContext2D, w: number, h: number, data: Uint8Array, color: string) => {
      ctx.lineWidth = 3;
      ctx.strokeStyle = color;
      ctx.shadowBlur = 15;
      ctx.shadowColor = color;
      ctx.beginPath();
      const sliceWidth = w / data.length;
      let x = 0;
      for(let i = 0; i < data.length; i++) {
          const normalized = (data[i] - 128) / 128.0;
          const dampened = normalized * 0.6;
          const yPos = (h/2) + (dampened * h/2);
          if(i === 0) ctx.moveTo(x, yPos);
          else ctx.lineTo(x, yPos);
          x += sliceWidth;
      }
      ctx.stroke();

      ctx.strokeStyle = 'rgba(255,255,255,0.1)';
      ctx.shadowBlur = 0;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, h/2);
      ctx.lineTo(w, h/2);
      ctx.stroke();
  };
  
  const drawCenterWave = (ctx: CanvasRenderingContext2D, cx: number, cy: number, data: Uint8Array, time: number, color: string) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.shadowBlur = 8;
      ctx.shadowColor = color;
      for(let i=0; i<12; i++) {
          ctx.beginPath();
          const baseR = 60 + (i * 35);
          const val = data[i*4];
          const normalized = val / 255;
          const r = baseR + Math.pow(normalized, 1.5) * 25;
          ctx.globalAlpha = 0.8 - (i/15);
          ctx.ellipse(cx, cy, r, r * 0.75, time * 0.5 + i * 0.3, 0, Math.PI * 2);
          ctx.stroke();
      }
      ctx.globalAlpha = 1;
      ctx.shadowBlur = 0;
  };

  const drawDigitalRain = (ctx: CanvasRenderingContext2D, w: number, h: number, data: Uint8Array, time: number, color: string) => {
      const cols = 50;
      const colW = w / cols;
      ctx.fillStyle = color;
      ctx.font = 'bold 14px monospace';
      ctx.shadowBlur = 8;
      ctx.shadowColor = color;
      for(let i=0; i<cols; i++) {
          const val = data[i*2];
          const normalized = val / 255;
          const len = 8 + Math.floor(Math.pow(normalized, 1.3) * 15);
          const baseSpeed = 40 + (i % 5) * 10;
          const speedOffset = (time * baseSpeed) % h;
          for(let j=0; j<len; j++) {
              const char = String.fromCharCode(0x30A0 + Math.random() * 96);
              const y = (speedOffset + (j * 18)) % h;
              ctx.globalAlpha = (1 - (j/len)) * 0.8;
              ctx.fillText(char, i * colW, y);
          }
      }
      ctx.globalAlpha = 1;
      ctx.shadowBlur = 0;
  };

  const drawShockwave = (ctx: CanvasRenderingContext2D, cx: number, cy: number, bass: number, time: number, color: string) => {
      const normBass = bass / 255;
      const maxRadius = 500;
      const rings = 6;

      ctx.shadowColor = color;

      for (let i = 0; i < rings; i++) {
          const phase = (time * 0.8 + (i * 0.4)) % 2;
          const progress = phase / 2;
          const radius = 50 + progress * maxRadius;
          const alpha = (1 - progress) * (0.5 + normBass * 0.5);
          const lineWidth = (1 - progress) * (8 + normBass * 12);

          if (alpha > 0.05) {
              ctx.beginPath();
              ctx.strokeStyle = color;
              ctx.lineWidth = lineWidth;
              ctx.globalAlpha = alpha;
              ctx.shadowBlur = 20 + normBass * 30;
              ctx.arc(cx, cy, radius, 0, Math.PI * 2);
              ctx.stroke();
          }
      }

      const coreSize = 30 + normBass * 40;
      const coreGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, coreSize);
      coreGrad.addColorStop(0, color);
      coreGrad.addColorStop(0.5, color);
      coreGrad.addColorStop(1, 'transparent');
      ctx.globalAlpha = 0.6 + normBass * 0.4;
      ctx.fillStyle = coreGrad;
      ctx.beginPath();
      ctx.arc(cx, cy, coreSize, 0, Math.PI * 2);
      ctx.fill();

      ctx.globalAlpha = 1;
      ctx.shadowBlur = 0;
  };

  // ─── STRANDS PARTICLE PRESET ─────────────────────────────────────────────
  // Adapted from ParticleHero.tsx — globe ↔ logo morph, beat-synced phases
  // Instead of a fixed 4s cycle, bass energy drives phase transitions.

  // Strands logo coordinates (extracted from actual SVG paths)
  const STRANDS_LOGO_RAW: [number, number][] = [
    [0.0261,-0.4899],[0.0442,-0.4655],[0.0562,-0.4422],[0.0837,-0.4269],[0.1111,-0.4114],
    [0.1384,-0.3958],[0.1657,-0.3801],[0.1931,-0.3646],[0.2206,-0.3492],[0.2472,-0.3483],
    [0.277,-0.354],[0.304,-0.3409],[0.3169,-0.3133],[0.311,-0.283],[0.2865,-0.2639],
    [0.2553,-0.2632],[0.2317,-0.2832],[0.2258,-0.3128],[0.2095,-0.3343],[0.1818,-0.3493],
    [0.1546,-0.365],[0.1271,-0.3804],[0.0997,-0.3959],[0.0724,-0.4116],[0.0451,-0.4272],
    [0.0226,-0.4099],[-0.0078,-0.4066],[-0.0294,-0.3981],[-0.0478,-0.3726],[-0.0662,-0.347],
    [-0.0846,-0.3215],[-0.1029,-0.2959],[-0.1207,-0.2699],[-0.1395,-0.2446],[-0.1291,-0.2262],
    [-0.1019,-0.2103],[-0.0747,-0.1945],[-0.0477,-0.1783],[-0.0203,-0.1627],[0.007,-0.1471],
    [0.034,-0.1309],[0.061,-0.1147],[0.0881,-0.0987],[0.1151,-0.0825],[0.1419,-0.066],
    [0.1687,-0.0495],[0.1955,-0.033],[0.2223,-0.0164],[0.2507,-0.0082],[0.281,-0.0129],
    [0.3079,0.0014],[0.3192,0.0294],[0.3109,0.0583],[0.2856,0.0753],[0.2791,0.1008],
    [0.2794,0.1322],[0.2798,0.1637],[0.2802,0.1952],[0.2805,0.2267],[0.2804,0.2582],
    [0.3078,0.2698],[0.3219,0.2973],[0.3167,0.3281],[0.2923,0.347],[0.2621,0.3492],
    [0.2358,0.3362],[0.2078,0.3505],[0.1802,0.3658],[0.1527,0.381],[0.1249,0.3958],
    [0.0971,0.4107],[0.0695,0.4256],[0.0415,0.4399],[0.0409,0.4686],[0.0231,0.4934],
    [-0.0068,0.5],[-0.0339,0.4877],[-0.0486,0.461],[-0.0592,0.4358],[-0.0865,0.4201],
    [-0.1142,0.4051],[-0.1418,0.3899],[-0.1691,0.3743],[-0.1966,0.359],[-0.2236,0.3428],
    [-0.2494,0.3454],[-0.2792,0.3509],[-0.306,0.337],[-0.3204,0.3096],[-0.3128,0.2793],
    [-0.2879,0.2608],[-0.2574,0.2616],[-0.2334,0.2805],[-0.2271,0.3106],[-0.21,0.3311],
    [-0.1822,0.346],[-0.155,0.3618],[-0.1275,0.3771],[-0.0999,0.3922],[-0.0725,0.4077],
    [-0.0451,0.4233],[-0.0193,0.4092],[0.0068,0.3962],[0.0249,0.3704],[0.0429,0.3446],
    [0.0609,0.3187],[0.079,0.293],[0.0971,0.2673],[0.1152,0.2415],[0.1325,0.2152],
    [0.1065,0.1998],[0.0794,0.1837],[0.0523,0.1677],[0.0253,0.1516],[-0.0016,0.1351],
    [-0.0284,0.1186],[-0.0552,0.1022],[-0.0823,0.0861],[-0.1097,0.0707],[-0.137,0.055],
    [-0.1641,0.0389],[-0.1913,0.0231],[-0.2185,0.0073],[-0.2451,-0.0067],[-0.274,0.0025],
    [-0.3029,-0.0076],[-0.3187,-0.0344],[-0.316,-0.0643],[-0.2943,-0.0861],[-0.2842,-0.1075],
    [-0.2842,-0.1389],[-0.2842,-0.1704],[-0.2842,-0.2019],[-0.2841,-0.2334],[-0.2854,-0.2639],
    [-0.3112,-0.2795],[-0.3219,-0.3084],[-0.3114,-0.3376],[-0.2844,-0.3533],[-0.2542,-0.3495],
    [-0.2275,-0.3455],[-0.2003,-0.3612],[-0.1729,-0.3768],[-0.1455,-0.3922],[-0.1181,-0.4077],
    [-0.0906,-0.4231],[-0.0629,-0.4381],[-0.0429,-0.4588],[-0.0297,-0.4854],[-0.0031,-0.5],
    [0.0525,-0.1016],[0.088,-0.0796],[0.1233,-0.0574],[0.1591,-0.036],[0.1944,-0.0138],
    [0.2303,0.0075],[0.2103,0.0318],[0.1697,0.0416],[0.1289,0.0504],[0.0884,0.0604],
    [0.0478,0.0701],[0.0071,0.0791],[-0.0334,0.0891],[-0.0702,0.0737],[-0.1061,0.0524],
    [-0.1423,0.0316],[-0.1785,0.0108],[-0.2144,-0.0104],[-0.2286,-0.0421],[-0.1893,-0.0542],
    [-0.1486,-0.0635],[-0.1083,-0.0741],[-0.0678,-0.0842],[-0.0273,-0.0944],[0.0132,-0.104],
    [-0.1569,-0.2216],[-0.1341,-0.2086],[-0.1115,-0.1952],[-0.0885,-0.1823],[-0.0657,-0.1692],
    [-0.0427,-0.1562],[-0.0196,-0.1435],[0.0034,-0.1308],[0.0108,-0.1178],[-0.0148,-0.1116],
    [-0.0405,-0.1058],[-0.066,-0.0993],[-0.0917,-0.0933],[-0.1174,-0.0873],[-0.1429,-0.0809],
    [-0.1685,-0.0746],[-0.1941,-0.0682],[-0.2197,-0.062],[-0.2393,-0.0725],[-0.2483,-0.0927],
    [-0.2333,-0.1143],[-0.2176,-0.1355],[-0.2025,-0.1571],[-0.1873,-0.1786],[-0.1718,-0.1999],
    [0.2292,0.042],[0.2415,0.0643],[0.2281,0.0863],[0.2127,0.1072],[0.1974,0.1281],
    [0.1828,0.1494],[0.1671,0.1701],[0.1524,0.1914],[0.1333,0.1961],[0.1112,0.1826],
    [0.089,0.1691],[0.0668,0.1558],[0.0444,0.1427],[0.022,0.1296],[-0.0003,0.1165],
    [-0.0214,0.1017],[0.0021,0.0946],[0.0273,0.0887],[0.0526,0.0829],[0.0779,0.0771],
    [0.1031,0.0713],[0.1283,0.0652],[0.1535,0.0592],[0.1787,0.0533],[0.2041,0.0479],
    [0.1486,0.225],[0.1707,0.2364],[0.1921,0.2493],[0.2132,0.2624],[0.2348,0.275],
    [0.2291,0.2972],[0.2286,0.3208],[0.2067,0.3328],[0.1847,0.3445],[0.1626,0.356],
    [0.1407,0.3681],[0.1188,0.38],[0.0969,0.3918],[0.075,0.4039],[0.0532,0.416],
    [0.0312,0.4256],[0.0188,0.4081],[0.033,0.3877],[0.0474,0.3674],[0.0618,0.347],
    [0.0762,0.3266],[0.0906,0.3062],[0.1052,0.286],[0.1196,0.2656],[0.134,0.2453],
    [-0.0391,-0.4309],[-0.0416,-0.4106],[-0.0553,-0.3923],[-0.0685,-0.3738],[-0.0816,-0.355],
    [-0.0945,-0.3362],[-0.1077,-0.3177],[-0.1213,-0.2993],[-0.1347,-0.2809],[-0.1476,-0.2621],
    [-0.1618,-0.2449],[-0.1816,-0.2562],[-0.201,-0.2682],[-0.2204,-0.2802],[-0.2319,-0.2954],
    [-0.2316,-0.3178],[-0.2185,-0.332],[-0.1986,-0.3431],[-0.1788,-0.3545],[-0.1591,-0.366],
    [-0.1391,-0.377],[-0.119,-0.3878],[-0.099,-0.3988],[-0.0791,-0.4098],[-0.0591,-0.4208],
    [0.2556,0.073],[0.2633,0.0847],[0.2633,0.104],[0.2633,0.1234],[0.2633,0.1428],
    [0.2633,0.1621],[0.2633,0.1815],[0.2633,0.2009],[0.2633,0.2203],[0.2633,0.2396],
    [0.2633,0.259],[0.247,0.2646],[0.2301,0.2552],[0.2136,0.245],[0.1971,0.2348],
    [0.1807,0.2246],[0.1643,0.2143],[0.1652,0.1989],[0.1762,0.1829],[0.1873,0.1671],
    [0.1989,0.1516],[0.2105,0.1361],[0.2217,0.1202],[0.233,0.1045],[0.2445,0.0889],
    [-0.2438,-0.2743],[-0.2279,-0.2666],[-0.2126,-0.2575],[-0.1974,-0.2483],[-0.1821,-0.2392],
    [-0.1724,-0.2265],[-0.1825,-0.2122],[-0.1931,-0.1979],[-0.2034,-0.1834],[-0.2136,-0.1687],
    [-0.2237,-0.1541],[-0.2339,-0.1395],[-0.2443,-0.1251],[-0.2548,-0.1107],[-0.2653,-0.0963],
    [-0.2673,-0.1119],[-0.2677,-0.1297],[-0.268,-0.1475],[-0.2683,-0.1653],[-0.2686,-0.1831],
    [-0.2687,-0.2009],[-0.2688,-0.2187],[-0.2687,-0.2365],[-0.2686,-0.2543],[-0.2591,-0.2657],
  ];

  // Strands banner gradient: cyan → blue → purple → violet → magenta
  const STRANDS_GRADIENT = ['#13F8FD','#29CEFD','#44ADFB','#628BF9','#8E6BFC','#B550FF','#DA34F2','#EA32FD'];

  // Persistent particle state for Strands preset (initialised lazily)
  const strandsParticleState = useRef<{
    px: Float32Array; py: Float32Array;
    pr: Float32Array; pg: Float32Array; pb: Float32Array;
    baseSize: Float32Array; speed: Float32Array;
    phase: number; phaseProgress: number; phaseAccum: number;
    lastBassHit: number; initialised: boolean;
  } | null>(null);

  const getStrandsGlobePoint = (index: number, total: number, time: number) => {
    const latLines = 12, lonLines = 20;
    const gridIdx = index % (latLines * lonLines);
    const lat = (Math.floor(gridIdx / lonLines) / (latLines - 1)) * Math.PI - Math.PI / 2;
    const lon = ((gridIdx % lonLines) / lonLines) * Math.PI * 2 + time * 0.001;
    const r = 0.38;
    const x = Math.cos(lat) * Math.sin(lon) * r;
    const y = Math.sin(lat) * r;
    const z = Math.cos(lat) * Math.cos(lon) * r;
    const perspective = 2 / (2 + z);
    const lonSector = Math.floor((((lon % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) / (Math.PI * 2) * 8);
    return { x: x * perspective, y: y * perspective, z, scale: perspective, isPeel: lonSector % 2 === 0 };
  };

  /**
   * drawStrandsParticle — 11th visualiser preset
   * Globe → Logo morph driven by bass energy.
   *
   * Phase cycle (beat-synced):
   *   0 = GLOBE        — spinning wireframe globe, grey particles
   *   1 = LOGO_FORM    — particles fly to Strands logo shape (white)
   *   2 = LOGO_HOLD_BW — hold in white
   *   3 = LOGO_COLOR   — gradient sweep cyan→magenta across logo
   *   4 = GLOBE_RETURN — morph back to globe
   *
   * Each phase persists for ~1.5s base time, but a strong bass hit (normBass > 0.6)
   * accelerates the accumulator, so drops and beats trigger faster transitions.
   */
  const drawStrandsParticle = (
    ctx: CanvasRenderingContext2D,
    cx: number, cy: number,
    w: number, h: number,
    normBass: number,
    time: number,
    deltaTime: number
  ) => {
    const COUNT = 300;
    const dim = Math.min(w, h);

    // Lazy-init particle state
    if (!strandsParticleState.current || !strandsParticleState.current.initialised) {
      const state = {
        px: new Float32Array(COUNT), py: new Float32Array(COUNT),
        pr: new Float32Array(COUNT), pg: new Float32Array(COUNT), pb: new Float32Array(COUNT),
        baseSize: new Float32Array(COUNT), speed: new Float32Array(COUNT),
        phase: 0, phaseProgress: 0, phaseAccum: 0,
        lastBassHit: 0, initialised: true,
      };
      for (let i = 0; i < COUNT; i++) {
        const gp = getStrandsGlobePoint(i, COUNT, time * 1000);
        state.px[i] = cx + gp.x * dim;
        state.py[i] = cy + gp.y * dim;
        state.pr[i] = 200; state.pg[i] = 200; state.pb[i] = 200;
        state.baseSize[i] = 1.5 + (i % 10) * 0.15;
        state.speed[i] = 0.5 + (i % 7) * 0.07;
      }
      strandsParticleState.current = state;
    }

    const S = strandsParticleState.current;
    const { px, py, pr, pg, pb, baseSize, speed } = S;

    // ── Beat-synced phase accumulator ──
    // Base tick rate plus bass boost — high bass accelerates phase transitions
    const bassBoost = normBass > 0.55 ? normBass * 2.0 : 0.3;
    S.phaseAccum += deltaTime * (0.5 + bassBoost);

    // Phase duration ~1.8s base, shorter on sustained bass
    const phaseDuration = 1.8 - normBass * 0.6;
    if (S.phaseAccum >= phaseDuration) {
      S.phaseAccum = 0;
      S.phase = (S.phase + 1) % 5;
    }
    S.phaseProgress = Math.min(1, S.phaseAccum / phaseDuration);

    const phase = S.phase;
    const progress = S.phaseProgress;
    const elapsed = time * 1000;

    // ── Compute targets and draw ──
    // Move speed (lerp factor) — faster during form phases
    const moveSpeed = phase === 0 || phase === 4 ? 0.12 : phase === 1 ? 0.08 + progress * 0.12 : 0.1;

    // Globe wireframe (phases 0 and 4)
    if (phase === 0 || phase === 4) {
      const wireOpacity = phase === 0 ? 0.2 : 0.2 * progress;
      if (wireOpacity > 0.01) {
        const r = 0.38 * dim;
        const rotY = elapsed * 0.001;
        ctx.strokeStyle = `rgba(100,100,100,${wireOpacity})`;
        ctx.lineWidth = 0.5;
        for (let lat = -80; lat <= 80; lat += 20) {
          const latR = (lat / 180) * Math.PI;
          ctx.beginPath();
          let started = false;
          for (let lon = 0; lon <= 360; lon += 5) {
            const lonR = (lon / 180) * Math.PI + rotY;
            const z3 = Math.cos(latR) * Math.cos(lonR);
            if (z3 < -0.1) { started = false; continue; }
            const p = 2 / (2 + z3);
            const sx = cx + Math.cos(latR) * Math.sin(lonR) * p * r;
            const sy = cy + Math.sin(latR) * p * r;
            if (!started) { ctx.moveTo(sx, sy); started = true; } else ctx.lineTo(sx, sy);
          }
          ctx.stroke();
        }
        for (let lon = 0; lon < 360; lon += 45) {
          const lonR = (lon / 180) * Math.PI + rotY;
          ctx.beginPath();
          let started = false;
          for (let lat2 = -90; lat2 <= 90; lat2 += 5) {
            const latR = (lat2 / 180) * Math.PI;
            const z3 = Math.cos(latR) * Math.cos(lonR);
            if (z3 < -0.1) { started = false; continue; }
            const p = 2 / (2 + z3);
            const sx = cx + Math.cos(latR) * Math.sin(lonR) * p * r;
            const sy = cy + Math.sin(latR) * p * r;
            if (!started) { ctx.moveTo(sx, sy); started = true; } else ctx.lineTo(sx, sy);
          }
          ctx.stroke();
        }
      }
    }

    // Connection lines (logo phases)
    if (phase >= 1 && phase <= 3) {
      const lineOp = phase === 1 ? progress * 0.08 : 0.08;
      ctx.strokeStyle = `rgba(255,255,255,${lineOp})`;
      ctx.lineWidth = 0.4;
      for (let i = 0; i < COUNT; i += 2) {
        for (let j = i + 3; j < COUNT; j += 3) {
          const ddx = px[i] - px[j], ddy = py[i] - py[j];
          if (ddx * ddx + ddy * ddy < 900) {
            ctx.beginPath(); ctx.moveTo(px[i], py[i]); ctx.lineTo(px[j], py[j]); ctx.stroke();
          }
        }
      }
    }

    // Update and draw particles
    for (let i = 0; i < COUNT; i++) {
      let tx: number, ty: number;
      let trr: number, tgg: number, tbb: number;
      let op: number, sz: number;

      switch (phase) {
        case 0: { // GLOBE
          const gp = getStrandsGlobePoint(i, COUNT, elapsed);
          tx = cx + gp.x * dim; ty = cy + gp.y * dim;
          trr = gp.isPeel ? 200 : 120; tgg = trr; tbb = trr;
          op = (gp.scale * 0.5 + 0.3) * (gp.isPeel ? 0.8 : 0.45);
          sz = baseSize[i] * gp.scale;
          break;
        }
        case 1: // LOGO_FORM
        case 2: { // LOGO_HOLD_BW
          const coord = STRANDS_LOGO_RAW[i % STRANDS_LOGO_RAW.length];
          tx = cx + coord[0] * 0.85 * dim;
          ty = cy + coord[1] * 0.85 * dim;
          trr = 248; tgg = 248; tbb = 248;
          op = 0.85; sz = baseSize[i] * 1.2;
          break;
        }
        case 3: { // LOGO_HOLD_COLOR
          const coord2 = STRANDS_LOGO_RAW[i % STRANDS_LOGO_RAW.length];
          tx = cx + coord2[0] * 0.85 * dim;
          ty = cy + coord2[1] * 0.85 * dim;
          // Map x-position across full gradient
          const norm = Math.max(0, Math.min(1, (coord2[0] + 0.35) / 0.7));
          const ci = Math.min(STRANDS_GRADIENT.length - 1, Math.floor(norm * STRANDS_GRADIENT.length));
          const hex = STRANDS_GRADIENT[ci];
          trr = parseInt(hex.slice(1, 3), 16);
          tgg = parseInt(hex.slice(3, 5), 16);
          tbb = parseInt(hex.slice(5, 7), 16);
          op = 0.9; sz = baseSize[i] * 1.2;
          // Bass-reactive size pulse on colour phase
          sz += normBass * 0.8;
          break;
        }
        case 4: { // GLOBE_RETURN
          const gp = getStrandsGlobePoint(i, COUNT, elapsed);
          tx = cx + gp.x * dim; ty = cy + gp.y * dim;
          trr = 200; tgg = 200; tbb = 200;
          op = (gp.scale * 0.5 + 0.3) * (gp.isPeel ? 0.8 : 0.45);
          sz = baseSize[i] * gp.scale;
          break;
        }
        default:
          tx = cx; ty = cy; trr = 200; tgg = 200; tbb = 200; op = 0.5; sz = 1.5;
      }

      // Color lerp
      pr[i] += (trr - pr[i]) * 0.25;
      pg[i] += (tgg - pg[i]) * 0.25;
      pb[i] += (tbb - pb[i]) * 0.25;

      // Position lerp with ambient drift
      let vx = (tx - px[i]) * moveSpeed * speed[i];
      let vy = (ty - py[i]) * moveSpeed * speed[i];
      vx += Math.sin(elapsed * 0.002 + i * 0.7) * 0.15;
      vy += Math.cos(elapsed * 0.002 + i * 1.1) * 0.15;

      // Bass-reactive push — particles expand outward from center on drops
      if (normBass > 0.5) {
        const dx = px[i] - cx, dy = py[i] - cy;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const pushForce = (normBass - 0.5) * 3;
        vx += (dx / dist) * pushForce;
        vy += (dy / dist) * pushForce;
      }

      px[i] += vx; py[i] += vy;

      // Draw
      if (op < 0.02) continue;
      ctx.globalAlpha = Math.min(1, op);
      ctx.fillStyle = `rgb(${pr[i] | 0},${pg[i] | 0},${pb[i] | 0})`;
      ctx.shadowBlur = phase === 3 ? 6 + normBass * 8 : 0;
      ctx.shadowColor = phase === 3 ? `rgb(${pr[i] | 0},${pg[i] | 0},${pb[i] | 0})` : 'transparent';
      ctx.beginPath();
      ctx.arc(px[i], py[i], Math.max(0.5, sz), 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
  };
  // ─── END STRANDS PARTICLE PRESET ───────────────────────────────────────

  const drawParticles = (ctx: CanvasRenderingContext2D, w: number, h: number, time: number, bass: number, count: number, color: string) => {
      const normBass = bass / 255;
      const cx = w / 2;
      const cy = h / 2;

      // Rising particles - float upward with drift
      const risingCount = Math.floor(count * 0.4);
      for (let i = 0; i < risingCount; i++) {
          const seed = i * 127.1;
          const xBase = ((Math.sin(seed) * 10000) % w + w) % w;
          const drift = Math.sin(time * 2 + seed) * 30;
          const x = xBase + drift;
          const speed = 20 + (i % 7) * 15;
          const y = h - ((time * speed + seed * 10) % (h + 100));
          const size = 2 + (i % 4) + normBass * 3;
          const twinkle = 0.5 + Math.sin(time * 8 + seed) * 0.3;

          ctx.beginPath();
          ctx.fillStyle = color;
          ctx.shadowBlur = 15 + normBass * 10;
          ctx.shadowColor = color;
          ctx.globalAlpha = twinkle * (0.4 + normBass * 0.4);
          ctx.arc(x, y, size, 0, Math.PI * 2);
          ctx.fill();
      }

      // Burst particles - explode from center on bass
      const burstCount = Math.floor(count * 0.35);
      for (let i = 0; i < burstCount; i++) {
          const angle = (i / burstCount) * Math.PI * 2 + time * 0.3;
          const seed = i * 234.5;
          const burstPhase = (time * 1.5 + seed * 0.01) % 3;
          const burstProgress = burstPhase / 3;
          const maxDist = 300 + normBass * 200;
          const dist = burstProgress * maxDist;
          const x = cx + Math.cos(angle) * dist;
          const y = cy + Math.sin(angle) * dist;
          const size = (1 - burstProgress) * (3 + normBass * 4);
          const alpha = (1 - burstProgress) * (0.6 + normBass * 0.4);

          if (size > 0.5 && alpha > 0.1) {
              ctx.beginPath();
              ctx.fillStyle = color;
              ctx.shadowBlur = 10;
              ctx.shadowColor = color;
              ctx.globalAlpha = alpha;
              ctx.arc(x, y, size, 0, Math.PI * 2);
              ctx.fill();
          }
      }

      // Orbital sparkles - circle around center
      const orbitalCount = Math.floor(count * 0.15);
      for (let i = 0; i < orbitalCount; i++) {
          const orbitRadius = 150 + (i % 4) * 80 + normBass * 50;
          const speed = (i % 2 === 0 ? 1 : -1) * (0.8 + (i % 3) * 0.3);
          const angle = time * speed + (i / orbitalCount) * Math.PI * 2;
          const x = cx + Math.cos(angle) * orbitRadius;
          const y = cy + Math.sin(angle) * orbitRadius;
          const sparkle = 0.5 + Math.sin(time * 12 + i * 5) * 0.5;
          const size = 2 + sparkle * 2 + normBass * 2;

          ctx.beginPath();
          ctx.fillStyle = '#fff';
          ctx.shadowBlur = 20;
          ctx.shadowColor = color;
          ctx.globalAlpha = sparkle * 0.8;
          ctx.arc(x, y, size, 0, Math.PI * 2);
          ctx.fill();
      }

      // Floating dust - subtle background particles
      const dustCount = Math.floor(count * 0.1);
      for (let i = 0; i < dustCount; i++) {
          const seed = i * 567.8;
          const x = ((Math.sin(seed) * 10000) % w + w) % w;
          const y = ((Math.cos(seed) * 10000) % h + h) % h;
          const drift = Math.sin(time + seed) * 2;
          const size = 1 + Math.sin(time * 3 + seed) * 0.5;

          ctx.beginPath();
          ctx.fillStyle = '#fff';
          ctx.shadowBlur = 5;
          ctx.shadowColor = '#fff';
          ctx.globalAlpha = 0.2 + normBass * 0.2;
          ctx.arc(x + drift, y, size, 0, Math.PI * 2);
          ctx.fill();
      }

      ctx.globalAlpha = 1;
      ctx.shadowBlur = 0;
  };

  const drawAlbumArt = (ctx: CanvasRenderingContext2D, cx: number, cy: number, pulse: number, url: string, borderColor: string, preloadedImage?: HTMLImageElement | null) => {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(pulse, pulse);
    ctx.shadowBlur = 40;
    ctx.shadowColor = borderColor;
    ctx.beginPath();
    ctx.arc(0, 0, 150, 0, Math.PI * 2);
    ctx.closePath();
    ctx.lineWidth = 5;
    ctx.strokeStyle = 'white';
    ctx.stroke();
    ctx.clip();

    // Use preloaded image if available, otherwise try to draw from URL
    if (preloadedImage && preloadedImage.complete) {
        ctx.drawImage(preloadedImage, -150, -150, 300, 300);
    } else {
        const img = new Image();
        img.src = url;
        if (img.complete) {
            ctx.drawImage(img, -150, -150, 300, 300);
        } else {
            ctx.fillStyle = '#111';
            ctx.fillRect(-150, -150, 300, 300);
        }
    }
    ctx.restore();
  };

  /**
   * Draw Strands Nation watermark — bottom-right corner of every frame.
   * Visible in both live preview and exported video.
   * Logo + "strandsnation.xyz" link text.
   */
  const drawStrandsWatermark = (ctx: CanvasRenderingContext2D, w: number, h: number) => {
    ctx.save();
    ctx.globalAlpha = 0.4;
    ctx.shadowBlur = 0;

    const margin = Math.round(w * 0.02);
    const brandSize = Math.round(w * 0.022);
    const linkSize = Math.round(w * 0.011);
    const superSize = Math.round(brandSize * 0.55);

    // "S³ STUDIO" brand mark
    ctx.textAlign = 'right';
    ctx.textBaseline = 'bottom';
    ctx.fillStyle = '#ffffff';
    ctx.font = `bold ${brandSize}px 'Orbitron', 'Inter', sans-serif`;
    // Watermark string updated 2026-05-01 SGT: "S³ Strands Sound Studio" + "s3studio.xyz".
    // Points at the product domain rather than the holding entity per Sean's call.
    const studioText = ' Strands Sound Studio';
    const studioWidth = ctx.measureText(studioText).width;
    const sWidth = ctx.measureText('S').width;
    const cubeWidth = (() => { ctx.font = `bold ${superSize}px 'Orbitron', 'Inter', sans-serif`; return ctx.measureText('\u00B3').width; })();
    const totalBrandWidth = sWidth + cubeWidth + studioWidth;
    const brandY = h - margin - linkSize - 4;
    let cursorX = w - margin - studioWidth;

    // Draw "STUDIO" part
    ctx.font = `bold ${brandSize}px 'Orbitron', 'Inter', sans-serif`;
    ctx.fillText(studioText, w - margin, brandY);

    // Draw superscript "³"
    ctx.font = `bold ${superSize}px 'Orbitron', 'Inter', sans-serif`;
    ctx.fillStyle = '#00C2FF';
    ctx.textAlign = 'right';
    ctx.fillText('\u00B3', w - margin - studioWidth, brandY - brandSize * 0.35);

    // Draw "S"
    ctx.font = `bold ${brandSize}px 'Orbitron', 'Inter', sans-serif`;
    ctx.fillStyle = '#ffffff';
    ctx.fillText('S', w - margin - studioWidth - cubeWidth, brandY);

    // "s3studio.xyz" link
    ctx.textAlign = 'right';
    ctx.font = `${linkSize}px 'Rajdhani', 'Inter', sans-serif`;
    ctx.fillStyle = '#00C2FF';
    ctx.fillText('s3studio.xyz', w - margin, h - margin);

    ctx.restore();
  };

  /**
   * Draw a slideshow image cover/contain-fitted into the canvas.
   */
  const drawSlideshowImage = (
    ctx: CanvasRenderingContext2D,
    img: HTMLImageElement,
    w: number, h: number,
    fit: 'cover' | 'contain',
    opacity: number
  ) => {
    if (!img.complete || !img.naturalWidth) return;
    ctx.save();
    ctx.globalAlpha = opacity;
    const imgRatio = img.naturalWidth / img.naturalHeight;
    const canvasRatio = w / h;
    let sw: number, sh: number, sx: number, sy: number;
    if (fit === 'cover') {
      if (imgRatio > canvasRatio) {
        sh = img.naturalHeight;
        sw = sh * canvasRatio;
        sx = (img.naturalWidth - sw) / 2;
        sy = 0;
      } else {
        sw = img.naturalWidth;
        sh = sw / canvasRatio;
        sx = 0;
        sy = (img.naturalHeight - sh) / 2;
      }
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, w, h);
    } else {
      // contain
      let dw: number, dh: number;
      if (imgRatio > canvasRatio) {
        dw = w;
        dh = w / imgRatio;
      } else {
        dh = h;
        dw = h * imgRatio;
      }
      ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
    }
    ctx.restore();
  };

  /**
   * Beat detection for slideshow: returns true if a beat was detected this frame.
   * Uses bass transient (current - previous) with threshold + cooldown.
   */
  const detectBeat = (normBass: number, now: number): boolean => {
    const delta = normBass - slideshowPrevBassRef.current;
    slideshowPrevBassRef.current = normBass;
    if (delta > SLIDESHOW_BEAT_THRESHOLD && (now - slideshowCooldownRef.current) > SLIDESHOW_COOLDOWN_MS) {
      slideshowCooldownRef.current = now;
      return true;
    }
    return false;
  };

  /**
   * Advance slideshow index on beat and draw current image.
   */
  const renderSlideshow = (
    ctx: CanvasRenderingContext2D,
    w: number, h: number,
    normBass: number, now: number
  ) => {
    const imgs = slideshowImagesRef.current;
    if (!slideshowEnabledRef.current || imgs.length === 0) return;
    if (detectBeat(normBass, now) && imgs.length > 1) {
      slideshowIndexRef.current = (slideshowIndexRef.current + 1) % imgs.length;
    }
    const currentImg = imgs[slideshowIndexRef.current];
    if (currentImg) {
      drawSlideshowImage(ctx, currentImg, w, h, slideshowFitRef.current, slideshowOpacityRef.current);
    }
  };

  // Slideshow file upload handler
  const handleSlideshowUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    const readers: Promise<string>[] = [];
    for (let i = 0; i < files.length; i++) {
      readers.push(new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.readAsDataURL(files[i]);
      }));
    }
    Promise.all(readers).then(urls => {
      setSlideshowImages(prev => [...prev, ...urls]);
    });
    e.target.value = '';
  };

  // Import SRT/LRC subtitle file and inject as timed-lyrics layer
  const handleSubtitleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const raw = ev.target?.result as string;
      if (!raw) return;
      let lrcString = '';
      const ext = file.name.split('.').pop()?.toLowerCase();
      if (ext === 'lrc') {
        // Already LRC format
        lrcString = raw;
      } else if (ext === 'srt') {
        lrcString = srtToLrc(raw);
      } else {
        // Try to parse as plain text, one line per entry; no timestamps
        showToast({ kind: 'error', message: 'Unsupported subtitle format. Use .srt or .lrc files.' });
        return;
      }
      if (!lrcString.trim()) {
        showToast({ kind: 'error', message: 'No valid subtitle entries found in file.' });
        return;
      }
      // Remove existing timed-lyrics layer if present, then add new one
      setTextLayers(prev => {
        const filtered = prev.filter(l => l.id !== 'timed-lyrics');
        return [{
          id: 'timed-lyrics',
          text: '[Timed Lyrics]',
          x: 50,
          y: 85,
          size: 32,
          color: '#ffffff',
          font: 'Inter',
          visible: true,
          background: '#000000aa',
        }, ...filtered];
      });
      // Store the LRC data on the lrcDataRef so the render loop picks it up
      lrcDataRef.current = lrcString;
      showToast({ kind: 'success', message: 'Subtitles imported!', durationMs: 3000 });
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const addTextLayer = () => {
      const newLayer: TextLayer = {
          id: Date.now().toString(),
          text: 'New Text',
          x: 50,
          y: 50,
          size: 40,
          color: '#ffffff',
          font: 'Inter',
          visible: true
      };
      setTextLayers([...textLayers, newLayer]);
  };

  const updateTextLayer = (id: string, updates: Partial<TextLayer>) => {
      setTextLayers(textLayers.map(l => l.id === id ? { ...l, ...updates } : l));
  };

  const removeTextLayer = (id: string) => {
      setTextLayers(textLayers.filter(l => l.id !== id));
  };

  if (!embedded && (!isOpen || !song)) return null;
  if (embedded && !song) return null;

  // Embedded mode: render content directly without modal overlay
  const outerClass = embedded
    ? 'w-full h-full'
    : 'fixed inset-0 z-[60] flex items-center justify-center bg-black/90 backdrop-blur-md p-0 md:p-4 animate-in fade-in duration-200';

  const innerClass = embedded
    ? `bg-s3-card w-full h-full overflow-hidden relative ${isMobile ? 'flex flex-col' : 'flex'}`
    : `bg-s3-card w-full h-full md:max-w-7xl md:h-[90vh] md:rounded-2xl border-0 md:border border-white/10 overflow-hidden shadow-2xl relative ${isMobile ? 'flex flex-col' : 'flex'}`;

  return (
    <div className={outerClass}>

      <div className={innerClass}>

        {/* Close Button — hidden in embedded mode */}
        {!embedded && (
          <button onClick={onClose} className="absolute top-3 right-3 md:top-4 md:right-4 z-50 p-2 bg-black/50 hover:bg-white/20 rounded-full text-white transition-colors">
              <X size={isMobile ? 20 : 24} />
          </button>
        )}

        {/* Mobile: Preview at top */}
        {isMobile && (
          <div className="relative bg-black flex-shrink-0">
            {/* Header */}
            <div className="absolute top-0 left-0 right-0 z-10 p-3 bg-gradient-to-b from-black/80 to-transparent">
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                <Video className="text-accent-500" size={18} />
                Video Studio
              </h2>
            </div>

            {/* Canvas Preview */}
            <div className="w-full flex justify-center" style={{ aspectRatio: `${renderRes.w} / ${renderRes.h}`, maxHeight: '60vh' }}>
              <canvas
                ref={canvasRef}
                width={renderRes.w}
                height={renderRes.h}
                className="w-full h-full object-contain bg-[#0a0a0a]"
              />
            </div>

            {/* Playback Controls */}
            <div className="absolute bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-black/90 to-transparent flex items-center justify-center">
              <button
                onClick={togglePlay}
                disabled={isExporting}
                className="w-14 h-14 rounded-full bg-white text-black flex items-center justify-center shadow-xl tap-highlight-none disabled:opacity-50"
              >
                {isPlaying ? <Pause fill="black" size={22} /> : <Play fill="black" className="ml-1" size={22} />}
              </button>
            </div>
          </div>
        )}

        {/* Sidebar Controls */}
        <div className={`${isMobile ? 'flex-1 overflow-hidden' : 'w-96'} bg-s3-panel ${isMobile ? '' : 'border-r border-white/5'} flex flex-col z-20`}>
            {/* Header - Desktop only */}
            {!isMobile && (
              <div className="p-6 border-b border-white/5">
                  <h2 className="text-xl font-bold text-white mb-1 flex items-center gap-2">
                      <Video className="text-accent-500" size={20} />
                      Video Studio
                  </h2>
                  <p className="text-zinc-500 text-xs">Each layer compounds — Preset → Style → Text → FX all stack together.</p>
              </div>
            )}

            {/* Tabs */}
            {/* Sequential wizard: Presets -> Style -> Text -> FX -> Render.
                Export format + Render CTA only show on the Render tab so the
                flow reads as a clear sequence (Sean 2026-04-25 SGT).
                data-tour anchors keyed `vid.tab.<id>` for vidTour walkthrough. */}
            <div className="flex border-b border-white/5 px-2 gap-0.5">
                {[
                    { id: 'presets', label: 'Presets',  icon: <Grid size={12} /> },
                    { id: 'style',   label: 'Style',    icon: <Palette size={12} /> },
                    { id: 'text',    label: 'Text',     icon: <Type size={12} /> },
                    { id: 'effects', label: 'FX',       icon: <Zap size={12} /> },
                    { id: 'render',  label: 'Render',   icon: <Download size={12} /> },
                ].map(tab => (
                    <button
                        key={tab.id}
                        onClick={() => setActiveTab(tab.id)}
                        data-tour={`vid.tab.${tab.id}`}
                        className={`flex-1 flex items-center justify-center gap-1 py-2.5 text-[9px] font-bold uppercase tracking-wider transition-colors ${activeTab === tab.id ? 'text-white border-b-2 border-accent-500 bg-white/5' : 'text-zinc-500 hover:text-zinc-300'}`}
                    >
                        {tab.icon} {tab.label}
                    </button>
                ))}
            </div>

            {/* Content Area */}
            <div className="flex-1 overflow-y-auto custom-scrollbar p-4 md:p-6 space-y-4 md:space-y-6">
                
                {/* PRESETS TAB */}
                {activeTab === 'presets' && (
                    <div className="grid grid-cols-2 gap-3">
                        {PRESETS.map(preset => {
                            const isActive = config.preset === preset.id;
                            return (
                                <button
                                    key={preset.id}
                                    onClick={() => setConfig({ ...config, preset: preset.id })}
                                    className="ew-card flex flex-col items-center gap-2 p-4 transition-all"
                                    style={isActive
                                        ? {
                                            background: 'var(--ew-primary-soft)',
                                            borderColor: 'var(--ew-primary)',
                                            color: 'var(--ew-text)',
                                        }
                                        : {
                                            color: 'var(--ew-text-muted)',
                                        }
                                    }
                                >
                                    <div
                                        className="p-2 rounded-full"
                                        style={isActive
                                            ? { background: 'var(--ew-primary)', color: 'var(--ew-primary-fg)' }
                                            : { background: 'var(--ew-surface-raised)', color: 'var(--ew-text-faint)' }
                                        }
                                    >
                                        {preset.icon}
                                    </div>
                                    <span className="text-xs font-medium">{preset.label}</span>
                                </button>
                            );
                        })}
                    </div>
                )}

                {/* STYLE TAB */}
                {activeTab === 'style' && (
                    <div className="space-y-6">
                         {/* Background */}
                         <div className="space-y-3">
                            <label className="text-xs font-bold text-zinc-500 uppercase flex justify-between">
                                Background
                            </label>
                            <div className="ew-card p-3 space-y-3">
                                {/* Type Selection */}
                                <div className="grid grid-cols-3 gap-2">
                                     <button
                                        onClick={() => { setBackgroundType('random'); setBackgroundSeed(Date.now()); }}
                                        className={`py-2 rounded text-xs font-bold flex items-center justify-center gap-1 ${backgroundType === 'random' ? 'bg-accent-600 text-white' : 'bg-zinc-800 text-zinc-400'}`}
                                     >
                                         <Wand2 size={12}/> Random
                                     </button>
                                     <button
                                        onClick={() => setBackgroundType('custom')}
                                        className={`py-2 rounded text-xs font-bold flex items-center justify-center gap-1 ${backgroundType === 'custom' ? 'bg-accent-600 text-white' : 'bg-zinc-800 text-zinc-400'}`}
                                     >
                                         <ImageIcon size={12}/> Image
                                     </button>
                                     <button
                                        onClick={() => setBackgroundType('video')}
                                        className={`py-2 rounded text-xs font-bold flex items-center justify-center gap-1 ${backgroundType === 'video' ? 'bg-accent-600 text-white' : 'bg-zinc-800 text-zinc-400'}`}
                                     >
                                         <Video size={12}/> Video
                                     </button>
                                </div>

                                {/* Image Options */}
                                {backgroundType === 'custom' && (
                                    <div className="space-y-2">
                                        <div className="grid grid-cols-3 gap-2">
                                            <button
                                                onClick={() => fileInputRef.current?.click()}
                                                className="py-2 px-2 bg-zinc-700 hover:bg-zinc-600 rounded text-[11px] text-white flex items-center justify-center gap-1"
                                            >
                                                <Upload size={12}/> Upload
                                            </button>
                                            <button
                                                onClick={() => openPexelsBrowser('background', 'photos')}
                                                className="py-2 px-2 bg-emerald-600 hover:bg-emerald-700 rounded text-[11px] text-white flex items-center justify-center gap-1"
                                            >
                                                <Search size={12}/> Pexels
                                            </button>
                                            <button
                                                type="button"
                                                disabled
                                                aria-disabled="true"
                                                title="With Imag3n coming soon"
                                                className="py-2 px-2 bg-zinc-800 rounded text-[11px] text-zinc-500 cursor-not-allowed opacity-60 flex items-center justify-center gap-1 border border-dashed border-zinc-700 relative group"
                                            >
                                                <Wand2 size={12}/> Generate
                                                <span className="pointer-events-none absolute left-1/2 -translate-x-1/2 top-full mt-1 whitespace-nowrap rounded-md bg-zinc-950/95 border border-zinc-700 px-2 py-1 text-[10px] font-medium text-zinc-300 opacity-0 group-hover:opacity-100 transition-opacity z-10">
                                                  With Imag3n coming soon
                                                </span>
                                            </button>
                                        </div>
                                        {customImage && (
                                            <div className="relative rounded overflow-hidden h-20">
                                                <img src={customImage} alt="Background" className="w-full h-full object-cover" />
                                            </div>
                                        )}
                                    </div>
                                )}

                                {/* Video Options */}
                                {backgroundType === 'video' && (
                                    <div className="space-y-2">
                                        <div className="grid grid-cols-2 gap-2">
                                            <button
                                                onClick={() => videoFileInputRef.current?.click()}
                                                className="py-2 px-3 bg-zinc-700 hover:bg-zinc-600 rounded text-xs text-white flex items-center justify-center gap-1"
                                            >
                                                <Upload size={12}/> Upload
                                            </button>
                                            <button
                                                onClick={() => openPexelsBrowser('background', 'videos')}
                                                className="py-2 px-3 bg-emerald-600 hover:bg-emerald-700 rounded text-xs text-white flex items-center justify-center gap-1"
                                            >
                                                <Search size={12}/> Pexels
                                            </button>
                                        </div>
                                        <input
                                            type="text"
                                            placeholder="Paste video URL (MP4, WebM) or YouTube link..."
                                            value={videoUrl}
                                            onChange={(e) => setVideoUrl(e.target.value)}
                                            className="w-full bg-zinc-800 rounded px-3 py-2 text-xs text-white border border-white/10 placeholder-zinc-500"
                                        />
                                        <p className="text-[10px] text-zinc-500">Direct video files (MP4/WebM) for background. YouTube links stored as reference.</p>
                                        {videoUrl && (
                                            <p className="text-[10px] text-emerald-400 truncate">✓ {videoUrl.includes('youtube') || videoUrl.includes('youtu.be') ? 'YouTube link saved' : 'Video loaded'}</p>
                                        )}
                                    </div>
                                )}

                                {/* Hidden File Inputs */}
                                <input
                                    type="file"
                                    ref={fileInputRef}
                                    onChange={handleFileUpload}
                                    className="hidden"
                                    accept="image/*"
                                />
                                <input
                                    type="file"
                                    ref={videoFileInputRef}
                                    onChange={handleVideoFileUpload}
                                    className="hidden"
                                    accept="video/*"
                                />
                                <input
                                    type="file"
                                    ref={albumArtInputRef}
                                    onChange={handleAlbumArtUpload}
                                    className="hidden"
                                    accept="image/*"
                                />

                                <div>
                                    <div className="flex justify-between text-sm text-zinc-300 mb-2">
                                        <span>Dimming</span>
                                        <span>{Math.round(config.bgDim * 100)}%</span>
                                    </div>
                                    <input
                                        type="range" min="0" max="1" step="0.1"
                                        value={config.bgDim}
                                        onChange={(e) => setConfig({...config, bgDim: parseFloat(e.target.value)})}
                                        className="w-full accent-accent-500 h-1 bg-zinc-700 rounded-lg appearance-none cursor-pointer"
                                    />
                                </div>
                            </div>
                        </div>

                         {/* Colors */}
                         <div className="space-y-3">
                             <label className="text-xs font-bold text-zinc-500 uppercase">Color Presets</label>
                             <div className="grid grid-cols-5 gap-2">
                                 {[
                                     { name: 'Neon Pink', primary: '#00C2FF', secondary: '#8b5cf6' },
                                     { name: 'Cyber Blue', primary: '#06b6d4', secondary: '#3b82f6' },
                                     { name: 'Sunset', primary: '#f97316', secondary: '#eab308' },
                                     { name: 'Matrix', primary: '#22c55e', secondary: '#10b981' },
                                     { name: 'Fire', primary: '#ef4444', secondary: '#f97316' },
                                     { name: 'Ocean', primary: '#0ea5e9', secondary: '#06b6d4' },
                                     { name: 'Violet', primary: '#a855f7', secondary: '#00C2FF' },
                                     { name: 'Gold', primary: '#eab308', secondary: '#f59e0b' },
                                     { name: 'Ice', primary: '#67e8f9', secondary: '#a5f3fc' },
                                     { name: 'Mono', primary: '#ffffff', secondary: '#a1a1aa' },
                                 ].map((preset) => (
                                     <button
                                         key={preset.name}
                                         onClick={() => setConfig({...config, primaryColor: preset.primary, secondaryColor: preset.secondary})}
                                         className={`group relative h-8 rounded-lg overflow-hidden border-2 transition-all ${
                                             config.primaryColor === preset.primary && config.secondaryColor === preset.secondary
                                                 ? 'border-white scale-110 shadow-lg'
                                                 : 'border-transparent hover:border-white/30 hover:scale-105'
                                         }`}
                                         title={preset.name}
                                     >
                                         <div className="absolute inset-0 flex">
                                             <div className="flex-1" style={{ backgroundColor: preset.primary }} />
                                             <div className="flex-1" style={{ backgroundColor: preset.secondary }} />
                                         </div>
                                     </button>
                                 ))}
                             </div>
                         </div>

                         <div className="space-y-3">
                             <label className="text-xs font-bold text-zinc-500 uppercase">Custom Colors</label>
                             <div className="grid grid-cols-2 gap-4">
                                 <div>
                                     <span className="text-[10px] text-zinc-400 mb-1 block">Primary</span>
                                     <div className="flex items-center gap-2 bg-black/20 p-2 rounded border border-white/5">
                                         <input type="color" value={config.primaryColor} onChange={(e) => setConfig({...config, primaryColor: e.target.value})} className="w-6 h-6 rounded cursor-pointer border-none bg-transparent" />
                                         <span className="text-xs text-zinc-300 font-mono">{config.primaryColor}</span>
                                     </div>
                                 </div>
                                 <div>
                                     <span className="text-[10px] text-zinc-400 mb-1 block">Secondary</span>
                                      <div className="flex items-center gap-2 bg-black/20 p-2 rounded border border-white/5">
                                         <input type="color" value={config.secondaryColor} onChange={(e) => setConfig({...config, secondaryColor: e.target.value})} className="w-6 h-6 rounded cursor-pointer border-none bg-transparent" />
                                         <span className="text-xs text-zinc-300 font-mono">{config.secondaryColor}</span>
                                     </div>
                                 </div>
                             </div>
                         </div>
                         
                         {/* Particles */}
                         <div className="space-y-3">
                            <div className="flex justify-between text-xs font-bold text-zinc-500 uppercase">
                                <span>Particles</span>
                                <span>{config.particleCount}</span>
                            </div>
                            <input
                                type="range" min="0" max="200" step="10"
                                value={config.particleCount}
                                onChange={(e) => setConfig({...config, particleCount: parseInt(e.target.value)})}
                                className="w-full accent-accent-500 h-1 bg-zinc-700 rounded-lg appearance-none cursor-pointer"
                            />
                        </div>

                        {/* Particle Transform Controls — Gener8 Pro */}
                        {isGener8Pro && <div className="space-y-3">
                            <label className="text-xs font-bold text-zinc-500 uppercase">Particle Transform <span className="text-accent-500">PRO</span></label>
                            <div>
                                <div className="flex justify-between text-[10px] text-zinc-400 mb-1">
                                    <span>Zoom</span>
                                    <span>{config.particleScale.toFixed(1)}x</span>
                                </div>
                                <input
                                    type="range" min="0.1" max="3.0" step="0.1"
                                    value={config.particleScale}
                                    onChange={(e) => setConfig({...config, particleScale: parseFloat(e.target.value)})}
                                    className="w-full accent-accent-500 h-1 bg-zinc-700 rounded-lg appearance-none cursor-pointer"
                                />
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                                <div>
                                    <div className="flex justify-between text-[10px] text-zinc-400 mb-1">
                                        <span>X Offset</span>
                                        <span>{config.particleOffsetX}%</span>
                                    </div>
                                    <input
                                        type="range" min="-100" max="100" step="1"
                                        value={config.particleOffsetX}
                                        onChange={(e) => setConfig({...config, particleOffsetX: parseInt(e.target.value)})}
                                        className="w-full accent-accent-500 h-1 bg-zinc-700 rounded-lg appearance-none cursor-pointer"
                                    />
                                </div>
                                <div>
                                    <div className="flex justify-between text-[10px] text-zinc-400 mb-1">
                                        <span>Y Offset</span>
                                        <span>{config.particleOffsetY}%</span>
                                    </div>
                                    <input
                                        type="range" min="-100" max="100" step="1"
                                        value={config.particleOffsetY}
                                        onChange={(e) => setConfig({...config, particleOffsetY: parseInt(e.target.value)})}
                                        className="w-full accent-accent-500 h-1 bg-zinc-700 rounded-lg appearance-none cursor-pointer"
                                    />
                                </div>
                            </div>
                        </div>}

                        {/* Void Centre Image Toggle — Gener8 Pro */}
                        {isGener8Pro && ['NCS Circle', 'Hexagon', 'Orbital', 'Shockwave'].includes(config.preset) && (
                            <div className="space-y-3">
                                <div
                                    className={`ew-card flex items-center justify-between p-3 cursor-pointer transition-all ${config.showVoidImage ? '' : 'opacity-70'}`}
                                    onClick={() => setConfig({...config, showVoidImage: !config.showVoidImage})}
                                >
                                    <div className="flex items-center gap-2">
                                        <div className={`w-4 h-4 rounded border flex items-center justify-center transition-colors ${config.showVoidImage ? 'bg-accent-500 border-accent-500' : 'bg-zinc-800 border-zinc-600'}`}>
                                            {config.showVoidImage && <Eye size={10} className="text-white" />}
                                            {!config.showVoidImage && <EyeOff size={10} className="text-zinc-500" />}
                                        </div>
                                        <span className="text-xs font-bold text-zinc-300">Centre Image</span>
                                        <span className="text-[10px] text-zinc-600">Album art or custom</span>
                                    </div>
                                </div>
                                {config.showVoidImage && (
                                    <div className="space-y-2">
                                        <div className="grid grid-cols-3 gap-2">
                                            <button
                                                onClick={() => albumArtInputRef.current?.click()}
                                                className="py-1.5 bg-zinc-800 text-zinc-300 rounded text-[10px] hover:bg-zinc-700 border border-white/5 flex items-center justify-center gap-1"
                                            >
                                                <Upload size={10}/> Upload
                                            </button>
                                            <button
                                                onClick={() => openPexelsBrowser('albumArt', 'photos')}
                                                className="py-1.5 bg-emerald-600/80 text-white rounded text-[10px] hover:bg-emerald-600 border border-white/5 flex items-center justify-center gap-1"
                                            >
                                                <Search size={10}/> Pexels
                                            </button>
                                            <button
                                                type="button"
                                                disabled
                                                aria-disabled="true"
                                                title="With Imag3n coming soon"
                                                className="py-1.5 bg-zinc-900 text-zinc-500 rounded text-[10px] border border-dashed border-zinc-700 cursor-not-allowed opacity-60 flex items-center justify-center gap-1 relative group"
                                            >
                                                <Wand2 size={10}/> Generate
                                                <span className="pointer-events-none absolute left-1/2 -translate-x-1/2 top-full mt-1 whitespace-nowrap rounded-md bg-zinc-950/95 border border-zinc-700 px-2 py-1 text-[10px] font-medium text-zinc-300 opacity-0 group-hover:opacity-100 transition-opacity z-10">
                                                  With Imag3n coming soon
                                                </span>
                                            </button>
                                        </div>
                                        {customAlbumArt && (
                                            <button
                                                onClick={() => setCustomAlbumArt(null)}
                                                className="w-full py-1.5 bg-zinc-800 text-zinc-400 rounded text-[10px] hover:bg-zinc-700 border border-white/5"
                                            >
                                                Reset to Album Art
                                            </button>
                                        )}
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Slideshow: beat-synced image bank (re-enabled 2026-05-08, stale closure fixed) */}
                        <div className="ew-card p-3 space-y-2">
                            <div className="flex items-center justify-between">
                                <label className="text-xs font-bold text-zinc-300 flex items-center gap-2">
                                    <input
                                        type="checkbox"
                                        checked={slideshowEnabled}
                                        onChange={e => setSlideshowEnabled(e.target.checked)}
                                        className="accent-accent-500"
                                    />
                                    Beat-Synced Slideshow
                                </label>
                                <button
                                    className="text-[10px] text-accent-400 hover:text-accent-300"
                                    onClick={() => slideshowInputRef.current?.click()}
                                >
                                    + Add Images
                                </button>
                                <input
                                    ref={slideshowInputRef}
                                    type="file"
                                    accept="image/*"
                                    multiple
                                    className="hidden"
                                    onChange={e => {
                                        const files = Array.from(e.target.files || []);
                                        files.forEach(file => {
                                            const reader = new FileReader();
                                            reader.onload = ev => {
                                                if (ev.target?.result) {
                                                    setSlideshowImages(prev => [...prev, ev.target!.result as string]);
                                                }
                                            };
                                            reader.readAsDataURL(file);
                                        });
                                        e.target.value = '';
                                    }}
                                />
                            </div>
                            {slideshowEnabled && (
                                <div className="space-y-2">
                                    <div className="flex items-center gap-2">
                                        <span className="text-[10px] text-zinc-500 w-12">Opacity</span>
                                        <input
                                            type="range" min={0} max={1} step={0.05}
                                            value={slideshowOpacity}
                                            onChange={e => setSlideshowOpacity(parseFloat(e.target.value))}
                                            className="flex-1 accent-accent-500"
                                        />
                                        <span className="text-[10px] text-zinc-400 w-8 text-right">{Math.round(slideshowOpacity * 100)}%</span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <span className="text-[10px] text-zinc-500 w-12">Fit</span>
                                        <button
                                            className={`text-[10px] px-2 py-0.5 rounded ${slideshowFit === 'cover' ? 'bg-accent-500 text-white' : 'bg-zinc-800 text-zinc-400'}`}
                                            onClick={() => setSlideshowFit('cover')}
                                        >Cover</button>
                                        <button
                                            className={`text-[10px] px-2 py-0.5 rounded ${slideshowFit === 'contain' ? 'bg-accent-500 text-white' : 'bg-zinc-800 text-zinc-400'}`}
                                            onClick={() => setSlideshowFit('contain')}
                                        >Contain</button>
                                    </div>
                                    {slideshowImages.length > 0 && (
                                        <div className="flex gap-1 flex-wrap">
                                            {slideshowImages.map((src, i) => (
                                                <div key={i} className="relative w-10 h-10 rounded overflow-hidden border border-zinc-700 group">
                                                    <img src={src} className="w-full h-full object-cover" alt="" />
                                                    <button
                                                        className="absolute inset-0 bg-black/60 text-red-400 text-[10px] opacity-0 group-hover:opacity-100 transition-opacity"
                                                        onClick={() => setSlideshowImages(prev => prev.filter((_, j) => j !== i))}
                                                    >&times;</button>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                    {slideshowImages.length === 0 && (
                                        <p className="text-[10px] text-zinc-600">Add images above. They cycle on beat transients during playback and export.</p>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* TEXT TAB */}
                {activeTab === 'text' && (
                    <div className="space-y-4">
                        {/* Timed Lyrics + Import Subtitles (re-enabled 2026-05-08 SGT,
                            guarded: toast when song has no lrc_data) */}
                        <div className="ew-card p-3 space-y-2">
                            <div className="flex items-center justify-between">
                                <label className="text-xs font-bold text-zinc-300 flex items-center gap-2">
                                    Timed Lyrics
                                </label>
                                <div className="flex items-center gap-2">
                                    <button
                                        className="text-[10px] text-accent-400 hover:text-accent-300"
                                        onClick={() => {
                                            // Toggle timed-lyrics layer
                                            setTextLayers(prev => {
                                                const exists = prev.find(l => l.id === 'timed-lyrics');
                                                if (exists) return prev.filter(l => l.id !== 'timed-lyrics');
                                                return [{
                                                    id: 'timed-lyrics',
                                                    text: '[Timed Lyrics]',
                                                    x: 50, y: 85, size: 32,
                                                    color: '#ffffff', font: 'Inter',
                                                    visible: true, background: '#000000aa',
                                                }, ...prev];
                                            });
                                            // If no lrc_data, silently generate naive time-split
                                            if (!lrcDataRef.current && song?.lyrics) {
                                                const dur = typeof song.duration === 'number'
                                                    ? song.duration
                                                    : parseFloat(String(song.duration || '0')) || 180;
                                                lrcDataRef.current = naiveLrcFromLyrics(song.lyrics, dur);
                                            }
                                        }}
                                    >
                                        {textLayers.some(l => l.id === 'timed-lyrics') ? '- Remove' : '+ Enable'}
                                    </button>
                                    <button
                                        className="text-[10px] text-zinc-500 hover:text-zinc-300"
                                        onClick={() => subtitleInputRef.current?.click()}
                                    >
                                        Import .srt/.lrc
                                    </button>
                                    <input
                                        ref={subtitleInputRef}
                                        type="file"
                                        accept=".srt,.lrc"
                                        className="hidden"
                                        onChange={handleSubtitleImport}
                                    />
                                </div>
                            </div>
                            {textLayers.some(l => l.id === 'timed-lyrics') && (
                                <p className="text-[10px] text-zinc-500">
                                    Captions will follow playback timing.
                                    {!song?.lrc_data && ' Using estimated timing (import .srt/.lrc for precise sync).'}
                                </p>
                            )}
                        </div>

                        {/* Watermark toggle.
                            Subscribed Gener8 Pro / Creator Studio: can toggle off.
                            Trial users: locked ON (canRemoveWatermark = false even
                            though isGener8Pro = true during trial). Drives viral
                            free-distribution loop and conversion to paid.
                            Base/anon: locked ON (no Pro UI access at all).
                            See AuthContext canRemoveWatermark for full rationale. */}
                        <div
                            className={`ew-card flex items-center justify-between p-3 transition-all ${
                              canRemoveWatermark ? 'cursor-pointer' : 'cursor-not-allowed'
                            } ${showWatermark ? '' : 'opacity-70'}`}
                            title={
                              canRemoveWatermark
                                ? (showWatermark ? 'Click to disable watermark' : 'Click to re-enable watermark')
                                : isTrialActive
                                  ? 'Subscribe to Gener8 Pro to remove the watermark'
                                  : 'Enabled in Gener8 Pro'
                            }
                            onClick={() => canRemoveWatermark && setShowWatermark(!showWatermark)}
                        >
                            <div className="flex items-center gap-2">
                                <div className={`w-4 h-4 rounded border flex items-center justify-center transition-colors ${showWatermark ? 'bg-accent-500 border-accent-500' : 'bg-zinc-800 border-zinc-600'}`}>
                                    {showWatermark && <Eye size={10} className="text-white" />}
                                    {!showWatermark && <EyeOff size={10} className="text-zinc-500" />}
                                </div>
                                <span className={`text-xs font-bold ${showWatermark ? 'text-zinc-300' : 'text-zinc-600'}`}>Watermark</span>
                                <span className="text-[10px] text-zinc-600">S³ Strands Sound Studio · s3studio.xyz</span>
                                {!canRemoveWatermark && (
                                  <span className="text-[8px] text-yellow-500/60 ml-1">
                                    {isTrialActive ? 'SUBSCRIBE to remove' : 'PRO to remove'}
                                  </span>
                                )}
                            </div>
                        </div>

                        <button
                            onClick={addTextLayer}
                            className="ew-btn ew-btn--primary w-full"
                        >
                            <Plus size={14} /> Add Text Layer
                        </button>

                        <div className="space-y-3">
                            {textLayers.map((layer, index) => (
                                <div key={layer.id} className={`ew-card transition-all ${layer.visible ? '' : 'opacity-60'}`}>
                                    {/* Header row: checkbox + label + collapse chevron */}
                                    <div className="flex items-center justify-between p-3 cursor-pointer" onClick={() => updateTextLayer(layer.id, { visible: !layer.visible })}>
                                        <div className="flex items-center gap-2">
                                            <div className={`w-4 h-4 rounded border flex items-center justify-center transition-colors ${layer.visible ? 'bg-accent-500 border-accent-500' : 'bg-zinc-800 border-zinc-600'}`}>
                                                {layer.visible && <Eye size={10} className="text-white" />}
                                                {!layer.visible && <EyeOff size={10} className="text-zinc-500" />}
                                            </div>
                                            <span className={`text-xs font-bold ${layer.visible ? 'text-zinc-300' : 'text-zinc-600'}`}>Layer {index + 1}</span>
                                            <span className="text-[10px] text-zinc-600 truncate max-w-[120px]">{layer.text}</span>
                                        </div>
                                        {layer.visible ? <ChevronDown size={14} className="text-zinc-500" /> : <ChevronRight size={14} className="text-zinc-600" />}
                                    </div>
                                    {/* Collapsible content — only shown when visible/active */}
                                    {layer.visible && (
                                        <div className="px-3 pb-3 space-y-3 animate-in fade-in slide-in-from-top-2">
                                            <input
                                                type="text"
                                                value={layer.text}
                                                onChange={(e) => updateTextLayer(layer.id, { text: e.target.value })}
                                                className="w-full bg-zinc-800 rounded px-2 py-1 text-xs text-white border border-white/5"
                                                placeholder="Text content"
                                            />
                                            <div className="grid grid-cols-2 gap-2">
                                                <div>
                                                    <label className="text-[10px] text-zinc-500 block mb-1">X Position</label>
                                                    <input type="range" min="0" max="100" value={layer.x} onChange={(e) => updateTextLayer(layer.id, { x: parseInt(e.target.value) })} className="w-full accent-accent-500 h-1 bg-zinc-700 rounded-lg appearance-none" />
                                                </div>
                                                <div>
                                                    <label className="text-[10px] text-zinc-500 block mb-1">Y Position</label>
                                                    <input type="range" min="0" max="100" value={layer.y} onChange={(e) => updateTextLayer(layer.id, { y: parseInt(e.target.value) })} className="w-full accent-accent-500 h-1 bg-zinc-700 rounded-lg appearance-none" />
                                                </div>
                                            </div>
                                            {/* Font selector */}
                                            <div>
                                                <label className="text-[10px] text-zinc-500 block mb-1">Font</label>
                                                <select
                                                    value={layer.font}
                                                    onChange={(e) => updateTextLayer(layer.id, { font: e.target.value })}
                                                    className="w-full bg-zinc-800 rounded px-2 py-1.5 text-xs text-white border border-white/5 appearance-none cursor-pointer"
                                                    style={{ fontFamily: layer.font }}
                                                >
                                                    {systemFonts.length > 0 ? (
                                                        systemFonts.map(f => (
                                                            <option key={f} value={f} style={{ fontFamily: f }}>{f}</option>
                                                        ))
                                                    ) : (
                                                        <>
                                                            <option value="Inter">Inter</option>
                                                            <option value="Arial">Arial</option>
                                                            <option value="Rajdhani">Rajdhani</option>
                                                        </>
                                                    )}
                                                </select>
                                            </div>
                                            <div className="flex gap-2">
                                                <div className="flex-1">
                                                    <label className="text-[10px] text-zinc-500 block mb-1">Size</label>
                                                    <input type="number" value={layer.size} onChange={(e) => updateTextLayer(layer.id, { size: parseInt(e.target.value) })} className="w-full bg-zinc-800 rounded px-2 py-1 text-xs text-white border border-white/5" />
                                                </div>
                                                <div>
                                                    <label className="text-[10px] text-zinc-500 block mb-1">Color</label>
                                                    <input type="color" value={layer.color} onChange={(e) => updateTextLayer(layer.id, { color: e.target.value })} className="w-8 h-6 rounded cursor-pointer border-none bg-transparent" />
                                                </div>
                                                <div>
                                                    <label className="text-[10px] text-zinc-500 block mb-1">BG</label>
                                                    <div className="flex items-center gap-1">
                                                        <input
                                                            type="color"
                                                            value={layer.background || '#000000'}
                                                            onChange={(e) => updateTextLayer(layer.id, { background: e.target.value })}
                                                            className="w-6 h-6 rounded cursor-pointer border-none bg-transparent"
                                                            disabled={!layer.background}
                                                        />
                                                        <button
                                                            onClick={() => updateTextLayer(layer.id, { background: layer.background ? undefined : '#000000cc' })}
                                                            className={`w-6 h-6 rounded text-[8px] font-bold border transition-colors ${layer.background ? 'bg-accent-500 border-accent-500 text-white' : 'bg-zinc-800 border-zinc-600 text-zinc-400'}`}
                                                            title={layer.background ? 'Remove background' : 'Add background'}
                                                        >
                                                            BG
                                                        </button>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* EFFECTS TAB */}
                {activeTab === 'effects' && (
                    <div className="space-y-2">
                        {[
                            { id: 'shake', label: 'Bass Shake', desc: 'Camera reacts to low freq', icon: <Activity size={16}/> },
                            { id: 'glitch', label: 'Digital Glitch', desc: 'Random artifacting', icon: <Zap size={16}/> },
                            { id: 'vhs', label: 'VHS Tape', desc: 'Color bleeding & noise', icon: <Disc size={16}/> },
                            { id: 'cctv', label: 'CCTV Mode', desc: 'Night vision style', icon: <Monitor size={16}/> },
                            { id: 'scanlines', label: 'Scanlines', desc: 'Old monitor effect', icon: <Grid size={16}/> },
                            { id: 'chromatic', label: 'Aberration', desc: 'RGB Split', icon: <Layers size={16}/> },
                            { id: 'bloom', label: 'Bloom', desc: 'Glow on bright areas', icon: <Sun size={16}/> },
                            { id: 'filmGrain', label: 'Film Grain', desc: 'Cinematic noise', icon: <Film size={16}/> },
                            { id: 'pixelate', label: 'Pixelate', desc: 'Retro pixel look', icon: <Grid size={16}/> },
                            { id: 'strobe', label: 'Strobe', desc: 'Flash on bass hits', icon: <Zap size={16}/> },
                            { id: 'vignette', label: 'Vignette', desc: 'Dark edges', icon: <Circle size={16}/> },
                            { id: 'hueShift', label: 'Hue Shift', desc: 'Color rotation', icon: <Palette size={16}/> },
                            { id: 'letterbox', label: 'Letterbox', desc: 'Cinematic bars', icon: <Minus size={16}/> },
                        ].map((effect) => {
                             const effectId = effect.id as keyof EffectConfig;
                             const isActive = effects[effectId];
                             const intensity = intensities[effectId as keyof EffectIntensities];

                             return (
                                <div
                                    key={effect.id}
                                    className="ew-card transition-all"
                                    style={isActive
                                        ? { background: 'var(--ew-primary-soft)', borderColor: 'var(--ew-primary)' }
                                        : undefined
                                    }
                                >
                                     <button 
                                        onClick={() => setEffects(prev => ({ ...prev, [effectId]: !prev[effectId] }))}
                                        className="w-full flex items-center justify-between p-3"
                                    >
                                        <div className="flex items-center gap-3">
                                            <div className={`p-1.5 rounded-md ${isActive ? 'bg-accent-500 text-white' : 'bg-zinc-800 text-zinc-500'}`}>
                                                {effect.icon}
                                            </div>
                                            <div className="text-left">
                                                <div className={`text-sm font-bold ${isActive ? 'text-white' : 'text-zinc-400'}`}>{effect.label}</div>
                                                <div className="text-[10px] text-zinc-500">{effect.desc}</div>
                                            </div>
                                        </div>
                                        <div className={`w-3 h-3 rounded-full ${isActive ? 'bg-accent-500 shadow-[0_0_8px_rgba(236,72,153,0.8)]' : 'bg-zinc-700'}`}></div>
                                    </button>
                                    
                                    {/* Intensity Slider */}
                                    {isActive && (
                                        <div className="px-3 pb-3 pt-0 animate-in fade-in slide-in-from-top-2">
                                            <div className="flex justify-between text-[10px] text-zinc-400 mb-1">
                                                <span>Intensity</span>
                                                <span>{Math.round(intensity * 100)}%</span>
                                            </div>
                                            <input 
                                                type="range" min="0" max="1" step="0.05" 
                                                value={intensity}
                                                onChange={(e) => setIntensities({...intensities, [effectId]: parseFloat(e.target.value)})}
                                                className="w-full accent-accent-500 h-1 bg-zinc-700 rounded-lg appearance-none cursor-pointer"
                                            />
                                        </div>
                                    )}
                                </div>
                             );
                        })}
                    </div>
                )}

            </div>

            {/* Footer */}
            <div className="p-4 md:p-6 border-t border-white/5 bg-black/20 space-y-3 safe-area-inset-bottom">
                 {ffmpegLoading ? (
                     <div className="w-full bg-zinc-800 rounded-xl h-12 flex items-center justify-center px-4">
                         <div className="flex items-center gap-2 text-white font-bold text-sm">
                             <Loader2 className="animate-spin" size={18} />
                             Loading video encoder...
                         </div>
                     </div>
                 ) : isExporting ? (
                     <div className="w-full bg-zinc-800 rounded-xl h-12 flex items-center justify-center px-4 relative overflow-hidden">
                         <div
                           className={`absolute left-0 top-0 bottom-0 transition-all duration-100 ${exportStage === 'capturing' ? 'bg-accent-600/20' : 'bg-blue-600/20'}`}
                           style={{ width: `${exportProgress}%` }}
                         />
                         <div className="flex items-center gap-2 z-10 text-white font-bold text-sm">
                             {exportStage === 'capturing' ? (
                               <>
                                 <Loader2 className="animate-spin text-accent-400" size={16} />
                                 Rendering frames {Math.round(exportProgress)}%{exportEta ? ` · ${exportEta}` : ''}
                               </>
                             ) : (
                               <>
                                 <Loader2 className="animate-spin text-blue-400" size={16} />
                                 {exportProgress < 95 ? 'Encoding (be patient)...' : `Encoding MP4 ${Math.round(exportProgress)}%`}
                               </>
                             )}
                         </div>
                     </div>
                 ) : activeTab !== 'render' ? (
                    /* Pre-render tabs (Presets / Style / Text / FX) get a
                       quiet hint instead of the export controls so the flow
                       reads as a wizard. Sean 2026-04-25 SGT. */
                    <div
                        className="w-full flex items-center justify-center px-4 py-3 text-xs"
                        style={{
                            color: 'var(--ew-text-faint)',
                            fontFamily: 'var(--ew-font-mono)',
                            letterSpacing: '0.18em',
                            textTransform: 'uppercase',
                            border: '1px solid var(--ew-border)',
                            background: 'var(--ew-surface-sunken)',
                        }}
                    >
                        Continue to Render to export
                    </div>
                 ) : (
                    <>
                    {/* Export preset picker — full-page radio grid grouped by
                        aspect ratio, with platform headings and PRO badges.
                        Replaces the prior <select><optgroup> dropdown
                        (2026-04-19). Sean's call: the Render tab has the
                        whole page available, give the resolutions room to
                        breathe and surface the Gener8 Pro upsell visually
                        on each locked card rather than buried in a dropdown.
                        2026-04-25 SGT.

                        2026-05-02 SGT scroll-bug fix: the picker outgrew
                        the footer when all four aspect groups rendered,
                        pushing the Render CTA below viewport with no
                        scroll available. Cap at 40vh + internal scroll;
                        Render button remains a sibling below the scroll
                        region so it's always visible. */}
                    <div
                      className="mb-4 overflow-y-auto custom-scrollbar"
                      style={{ maxHeight: '40vh' }}
                    >
                      <div className="flex items-center justify-between mb-3">
                        <span
                          className="ew-eyebrow"
                          style={{ color: 'var(--ew-text-muted)' }}
                        >
                          Export Format
                        </span>
                        {!isGener8Pro && (
                          <span
                            className="text-[10px] normal-case tracking-normal font-medium"
                            style={{ color: 'var(--ew-warning)' }}
                          >
                            Upgrade to Gener8 Pro to unlock all formats
                          </span>
                        )}
                      </div>

                      {(['9:16', '1:1', '2:3', '16:9'] as const).map(group => {
                        const groupLabel =
                          group === '9:16' ? '9:16 — Social (Vertical)' :
                          group === '1:1'  ? '1:1 — Square' :
                          group === '2:3'  ? '2:3 — Pinterest' :
                                             '16:9 — Landscape';
                        const groupPresets = RENDER_PRESETS
                          .map((p, i) => ({ p, i }))
                          .filter(({ p }) => p.aspect === group);
                        if (groupPresets.length === 0) return null;
                        return (
                          <div key={group} className="mb-4">
                            <h4
                              className="ew-eyebrow mb-2"
                              style={{ color: 'var(--ew-text-faint)' }}
                            >
                              {groupLabel}
                            </h4>
                            <div className="grid grid-cols-2 gap-2">
                              {groupPresets.map(({ p, i }) => {
                                const locked = p.tier === 'pro' && !isGener8Pro;
                                const isSelected = selectedPreset === i && !locked;
                                return (
                                  <button
                                    key={i}
                                    type="button"
                                    disabled={locked}
                                    title={locked ? 'Enabled in Gener8 Pro' : `${p.label} — ${p.w} × ${p.h}`}
                                    onClick={() => {
                                      if (locked) return;
                                      setSelectedPreset(i);
                                    }}
                                    className="ew-card text-left transition-all"
                                    style={{
                                      padding: '10px 12px',
                                      cursor: locked ? 'not-allowed' : 'pointer',
                                      opacity: locked ? 0.55 : 1,
                                      ...(isSelected
                                        ? {
                                            background: 'var(--ew-primary-soft)',
                                            borderColor: 'var(--ew-primary)',
                                          }
                                        : {}),
                                    }}
                                  >
                                    <div className="flex items-start justify-between gap-2">
                                      <div
                                        className="text-xs font-bold"
                                        style={{
                                          color: isSelected ? 'var(--ew-primary)' : 'var(--ew-text)',
                                        }}
                                      >
                                        {p.label}
                                      </div>
                                      {p.tier === 'pro' && (
                                        <span
                                          className="ew-eyebrow"
                                          style={{
                                            fontSize: 8,
                                            padding: '1px 5px',
                                            background: locked
                                              ? 'color-mix(in srgb, var(--ew-warning) 18%, transparent)'
                                              : 'var(--ew-primary)',
                                            color: locked
                                              ? 'var(--ew-warning)'
                                              : 'var(--ew-primary-fg)',
                                            border: locked
                                              ? '1px solid color-mix(in srgb, var(--ew-warning) 40%, transparent)'
                                              : '1px solid var(--ew-primary)',
                                            letterSpacing: '0.2em',
                                          }}
                                        >
                                          PRO
                                        </span>
                                      )}
                                    </div>
                                    <div
                                      className="text-[10px] mt-1"
                                      style={{
                                        color: 'var(--ew-text-faint)',
                                        fontFamily: 'var(--ew-font-mono)',
                                      }}
                                    >
                                      {p.w} × {p.h}
                                    </div>
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    {/* Primary render CTA. Routes through .ew-btn--primary
                        so the chamfer + glow + primary color follow the
                        active skin. The previous emerald-to-cyan gradient
                        ignored the skin system and stayed teal under
                        Refined / Terminal. EWDS retheme polish 2026-04-25
                        SGT. Width / height / centering kept inline. */}
                    <button
                        onClick={startRecording}
                        disabled={ffmpegLoading}
                        data-tour="vid.render-cta"
                        className="ew-btn ew-btn--primary"
                        style={{
                            width: '100%',
                            height: 48,
                            justifyContent: 'center',
                            fontSize: 14,
                            letterSpacing: '0.12em',
                        }}
                    >
                        <Download size={18} />
                        {gpuEncoderAvailable
                          ? `Render ${renderRes.label} (${gpuEncoderInfo?.hardware ? 'GPU' : 'CPU'})`
                          : `Render ${renderRes.label} (WASM)`}
                    </button>
                    </>
                 )}
                 <p className="text-[10px] text-zinc-600 text-center">
                   {gpuEncoderAvailable
                     ? `${gpuEncoderInfo?.label}${gpuEncoderInfo?.gpu ? ` • ${gpuEncoderInfo.gpu}` : ''} • `
                     : ffmpegLoaded ? 'WASM encoder ready • ' : ''}Do not close this window while rendering.
                 </p>
            </div>
        </div>

        {/* Preview Area - Desktop only */}
        {!isMobile && (
          <div className="flex-1 bg-black relative flex flex-col items-center justify-center" data-tour="vid.preview">
               <canvas
                  ref={canvasRef}
                  width={renderRes.w}
                  height={renderRes.h}
                  className="max-w-full max-h-full object-contain bg-[#0a0a0a]"
               />

               {/* Playback Controls Overlay */}
               <div className="absolute bottom-0 left-0 right-0 p-8 bg-gradient-to-t from-black/90 via-black/40 to-transparent flex items-center justify-center gap-6">
                   <button
                      onClick={togglePlay}
                      disabled={isExporting}
                      className="w-16 h-16 rounded-full bg-white text-black flex items-center justify-center hover:scale-105 transition-transform shadow-xl hover:shadow-2xl disabled:opacity-50 disabled:cursor-not-allowed"
                   >
                       {isPlaying ? <Pause fill="black" size={24} /> : <Play fill="black" className="ml-1" size={24} />}
                   </button>
               </div>
          </div>
        )}

      </div>

      {/* Pexels Browser Modal */}
      {showPexelsBrowser && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="bg-zinc-900 w-full max-w-4xl max-h-[80vh] rounded-2xl border border-white/10 flex flex-col overflow-hidden">
            {/* Header */}
            <div className="p-4 border-b border-white/10 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-emerald-600 rounded-lg">
                  <ExternalLink size={18} className="text-white" />
                </div>
                <div>
                  <h3 className="text-white font-bold">
                    {pexelsTarget === 'albumArt' ? 'Select Center Image' : 'Select Background'}
                  </h3>
                  <p className="text-zinc-500 text-xs">
                    {pexelsTarget === 'albumArt' ? 'Choose an image for the center circle' : 'Free stock photos & videos'}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowPexelsApiKeyInput(!showPexelsApiKeyInput)}
                  className={`p-2 hover:bg-white/10 rounded-lg ${pexelsApiKey ? 'text-emerald-400' : 'text-amber-400'}`}
                  title={pexelsApiKey ? 'API key configured' : 'Set API key'}
                >
                  <Settings2 size={20} />
                </button>
                <button onClick={() => setShowPexelsBrowser(false)} className="p-2 hover:bg-white/10 rounded-lg text-zinc-400">
                  <X size={20} />
                </button>
              </div>
            </div>

            {/* API Key Input */}
            {showPexelsApiKeyInput && (
              <div className="p-4 bg-zinc-800/50 border-b border-white/10 space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium text-zinc-300">Pexels API Key</label>
                  <a
                    href="https://www.pexels.com/api/new/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-emerald-400 hover:underline flex items-center gap-1"
                  >
                    Get free API key <ExternalLink size={10} />
                  </a>
                </div>
                <div className="flex gap-2">
                  <input
                    type="password"
                    value={pexelsApiKey}
                    onChange={(e) => setPexelsApiKey(e.target.value)}
                    placeholder="Enter your Pexels API key..."
                    className="flex-1 bg-zinc-900 rounded-lg px-4 py-2 text-sm text-white border border-white/10 placeholder-zinc-500"
                  />
                  <button
                    onClick={() => savePexelsApiKey(pexelsApiKey)}
                    className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 rounded-lg text-white font-bold text-sm"
                  >
                    Save
                  </button>
                </div>
                <p className="text-xs text-zinc-500">Your API key is stored locally in your browser.</p>
              </div>
            )}

            {/* Error Message */}
            {pexelsError && (
              <div className="px-4 py-2 bg-red-500/10 border-b border-red-500/20 text-red-400 text-sm flex items-center gap-2">
                <span>{pexelsError}</span>
                {!pexelsApiKey && (
                  <button
                    onClick={() => setShowPexelsApiKeyInput(true)}
                    className="text-red-300 underline hover:text-red-200"
                  >
                    Set API key
                  </button>
                )}
              </div>
            )}

            {/* Tabs & Search */}
            <div className="p-4 border-b border-white/10 space-y-3">
              {pexelsTarget !== 'albumArt' && (
              <div className="flex gap-2">
                <button
                  onClick={() => { setPexelsTab('photos'); searchPexels(pexelsQuery, 'photos'); }}
                  className={`px-4 py-2 rounded-lg text-sm font-bold flex items-center gap-2 ${pexelsTab === 'photos' ? 'bg-emerald-600 text-white' : 'bg-zinc-800 text-zinc-400'}`}
                >
                  <ImageIcon size={14} /> Photos
                </button>
                <button
                  onClick={() => { setPexelsTab('videos'); searchPexels(pexelsQuery, 'videos'); }}
                  className={`px-4 py-2 rounded-lg text-sm font-bold flex items-center gap-2 ${pexelsTab === 'videos' ? 'bg-emerald-600 text-white' : 'bg-zinc-800 text-zinc-400'}`}
                >
                  <Video size={14} /> Videos
                </button>
              </div>
              )}
              <div className="flex gap-2">
                <input
                  type="text"
                  value={pexelsQuery}
                  onChange={(e) => setPexelsQuery(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && searchPexels(pexelsQuery, pexelsTab)}
                  placeholder="Search for backgrounds..."
                  className="flex-1 bg-zinc-800 rounded-lg px-4 py-2 text-sm text-white border border-white/10 placeholder-zinc-500"
                />
                <button
                  onClick={() => searchPexels(pexelsQuery, pexelsTab)}
                  disabled={pexelsLoading}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 rounded-lg text-white font-bold text-sm flex items-center gap-2 disabled:opacity-50"
                >
                  {pexelsLoading ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
                  Search
                </button>
              </div>
              {/* Quick Tags */}
              <div className="flex flex-wrap gap-2">
                {['abstract', 'nature', 'city', 'space', 'neon', 'particles', 'smoke', 'fire', 'water', 'technology'].map(tag => (
                  <button
                    key={tag}
                    onClick={() => { setPexelsQuery(tag); searchPexels(tag, pexelsTab); }}
                    className="px-3 py-1 bg-zinc-800 hover:bg-zinc-700 rounded-full text-xs text-zinc-400 hover:text-white capitalize"
                  >
                    {tag}
                  </button>
                ))}
              </div>
            </div>

            {/* Results Grid */}
            <div className="flex-1 overflow-y-auto p-4">
              {pexelsLoading ? (
                <div className="flex items-center justify-center h-48">
                  <Loader2 size={32} className="animate-spin text-emerald-500" />
                </div>
              ) : pexelsTab === 'photos' ? (
                <div className="grid grid-cols-3 gap-3">
                  {pexelsPhotos.map(photo => (
                    <button
                      key={photo.id}
                      onClick={() => selectPexelsPhoto(photo)}
                      className="relative group rounded-lg overflow-hidden aspect-video bg-zinc-800"
                    >
                      <img src={photo.src.large} alt="" className="w-full h-full object-cover" />
                      <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                        <span className="text-white text-xs font-bold bg-emerald-600 px-3 py-1 rounded-full">Select</span>
                      </div>
                      <div className="absolute bottom-0 left-0 right-0 p-2 bg-gradient-to-t from-black/80 to-transparent">
                        <p className="text-[10px] text-zinc-300 truncate">by {photo.photographer}</p>
                      </div>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="grid grid-cols-3 gap-3">
                  {pexelsVideos.map(video => (
                    <button
                      key={video.id}
                      onClick={() => selectPexelsVideo(video)}
                      className="relative group rounded-lg overflow-hidden aspect-video bg-zinc-800"
                    >
                      <img src={video.image} alt="" className="w-full h-full object-cover" />
                      <div className="absolute top-2 right-2 bg-black/60 px-2 py-0.5 rounded text-[10px] text-white font-bold">
                        <Video size={10} className="inline mr-1" />VIDEO
                      </div>
                      <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                        <span className="text-white text-xs font-bold bg-emerald-600 px-3 py-1 rounded-full">Select</span>
                      </div>
                      <div className="absolute bottom-0 left-0 right-0 p-2 bg-gradient-to-t from-black/80 to-transparent">
                        <p className="text-[10px] text-zinc-300 truncate">by {video.user.name}</p>
                      </div>
                    </button>
                  ))}
                </div>
              )}

              {!pexelsLoading && pexelsPhotos.length === 0 && pexelsTab === 'photos' && (
                <p className="text-center text-zinc-500 py-8">No photos found. Try a different search term.</p>
              )}
              {!pexelsLoading && pexelsVideos.length === 0 && pexelsTab === 'videos' && (
                <p className="text-center text-zinc-500 py-8">No videos found. Try a different search term.</p>
              )}
            </div>

            {/* Footer */}
            <div className="p-3 border-t border-white/10 bg-zinc-800/50">
              <p className="text-[10px] text-zinc-500 text-center">
                Photos and videos provided by <a href="https://www.pexels.com" target="_blank" rel="noopener noreferrer" className="text-emerald-400 hover:underline">Pexels</a>. Free for commercial use.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
