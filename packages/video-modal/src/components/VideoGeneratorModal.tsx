import React, { useRef, useEffect, useState, useCallback } from 'react';
import { X, Play, Pause, Download, Wand2, Image as ImageIcon, Music, Video, Loader2, Palette, Layers, Zap, Type, Monitor, Activity, Circle, Grid, Disc, Upload, Plus, Trash2, Settings2, MousePointer2, Search, ExternalLink, Sun, Film, Minus, Eye, EyeOff, ChevronDown, ChevronRight } from 'lucide-react';
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';
import { drawS3Hero, drawDJAtWork } from '../lib/silhouetteEngine';
import { parseLrc, getCurrentLine, srtToLrc, naiveLrcFromLyrics } from '../lib/lrcParser';
import VideoRenderWorker from '../workers/videoRenderWorker.ts?worker';
import { drawAlbumArt, drawCenterWave, drawDigitalRain, drawDualMirror, drawHexagon, drawLinearBars, drawNCSCircle, drawOrbital, drawOscilloscope, drawParticles, drawShockwave, drawStrandsParticle, drawStrandsWatermark, renderSlideshow } from '../render/canvasVisualizers';
import { BASE_DEFAULT_INDEX, DEFAULT_EFFECTS, DEFAULT_INTENSITIES, DEFAULT_VISUALIZER_CONFIG, RENDER_PRESETS, defaultShowToast, useResponsive } from './videoModalDefaults';
import { PRESETS } from './videoModalPresets';
import type { EffectConfig, EffectIntensities, PexelsPhoto, PexelsVideo, TextLayer, VideoGeneratorModalProps, VideoModalTier, VisualizerConfig } from './videoModalTypes';
import {
  findEngineEndpoint,
  readEngineHealth,
  subscribeEngineHealth,
  type EngineHealthEndpoint,
} from '@everywear/shared';

export const VideoGeneratorModal: React.FC<VideoGeneratorModalProps> = ({
  isOpen,
  onClose,
  song,
  embedded = false,
  tier = 'demo',
  vaultTag = 'gener8',
  registerVideo,
  isMobile: isMobileOverride,
  proEnabled,
  isTrialActive: isTrialActiveOverride,
  canRemoveWatermark: canRemoveWatermarkOverride,
  apiBase = 'http://127.0.0.1:3001',
  gpuSaveMode = 'upload-blob',
  registerCpuExport = false,
  onToast,
}) => {
  const { isMobile: fallbackIsMobile } = useResponsive();
  const isMobile = isMobileOverride ?? fallbackIsMobile;
  const showToast = onToast ?? defaultShowToast;
  // Tier mapping: in Everywear, 'gener8_pro' or 'creator_studio' = Pro features
  const hasTier = (t: string) => {
    const tierOrder: VideoModalTier[] = ['demo', 'gener8', 'gener8_pro', 'creator_studio'];
    return tierOrder.indexOf(tier) >= tierOrder.indexOf(t as VideoModalTier);
  };
  const tierHasPro = hasTier('gener8_pro');
  const isTrialActive = isTrialActiveOverride ?? false;
  const canRemoveWatermark = canRemoveWatermarkOverride ?? tierHasPro;
  const isGener8Pro = proEnabled ?? tierHasPro;
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
  const slideshowRenderState = {
    imagesRef: slideshowImagesRef,
    indexRef: slideshowIndexRef,
    prevBassRef: slideshowPrevBassRef,
    cooldownRef: slideshowCooldownRef,
    enabledRef: slideshowEnabledRef,
    opacityRef: slideshowOpacityRef,
    fitRef: slideshowFitRef,
    beatThreshold: SLIDESHOW_BEAT_THRESHOLD,
    cooldownMs: SLIDESHOW_COOLDOWN_MS,
  };

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
  
  const [selectedPreset, setSelectedPreset] = useState(BASE_DEFAULT_INDEX);
  const renderRes = RENDER_PRESETS[isGener8Pro ? selectedPreset : BASE_DEFAULT_INDEX];

  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [exportStage, setExportStage] = useState<'idle' | 'capturing' | 'encoding'>('idle');
  const [exportEta, setExportEta] = useState<string>('');
  // Visible export failure surface. alert() is unreliable inside the Tauri
  // WebView, which made every render failure invisible (Vid render silent
  // no-op, native QA 2026-06-10). All export paths report here.
  const [exportError, setExportError] = useState<string | null>(null);
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
  const [config, setConfig] = useState<VisualizerConfig>(DEFAULT_VISUALIZER_CONFIG);
  const [effects, setEffects] = useState<EffectConfig>(DEFAULT_EFFECTS);
  const [intensities, setIntensities] = useState<EffectIntensities>(DEFAULT_INTENSITIES);

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
  const tierKey = JSON.stringify({ tier, proEnabled: isGener8Pro, canRemoveWatermark, isTrialActive });
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

  // ── Acquire + detect local GPU encoder sidecar (port 9877) ──
  // The shell owns the NVENC sidecar lifecycle: it boots on the first
  // `request_video_encoder` and stops on the last release. Nothing called
  // request_video_encoder before this, so the sidecar never booted and Vid
  // always fell back to WASM despite the RTX being detected by the shell.
  // (Handoff 2026-06-07: Vid NVENC routing.)
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    let acquired = false;

    const probeHealth = async (timeoutMs: number): Promise<Response> => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        return await fetch('http://127.0.0.1:9877/health', { signal: controller.signal });
      } finally {
        clearTimeout(timer);
      }
    };

    const readEncoderInfo = async (timeoutMs: number) => {
      try {
        const res = await probeHealth(timeoutMs);
        if (!res.ok) return null;
        return await res.json();
      } catch {
        return null;
      }
    };

    const waitForShellEncoder = async (timeoutMs: number): Promise<EngineHealthEndpoint | null> => {
      const current = findEngineEndpoint(readEngineHealth(), 'video-encoder');
      if (current?.online) return current;

      return new Promise((resolve) => {
        let last = current;
        const timer = window.setTimeout(() => {
          unsubscribe();
          resolve(last);
        }, timeoutMs);
        const unsubscribe = subscribeEngineHealth((payload) => {
          const endpoint = findEngineEndpoint(payload, 'video-encoder');
          if (endpoint) last = endpoint;
          if (endpoint?.online) {
            window.clearTimeout(timer);
            unsubscribe();
            resolve(endpoint);
          }
        });
      });
    };

    const checkGpuEncoder = async () => {
      const shellRuntime = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
      if (shellRuntime) {
        try {
          const { invoke } = await import('@tauri-apps/api/core');
          await invoke('request_video_encoder');
          acquired = true;
        } catch (err) {
          console.warn(
            '[Video Studio] request_video_encoder unavailable (%s) — probing port 9877 directly.',
            err
          );
        }
      }

      if (shellRuntime) {
        const endpoint = await waitForShellEncoder(12000);
        if (cancelled) return;
        if (endpoint?.online) {
          const data = await readEncoderInfo(750);
          if (cancelled) return;
          setGpuEncoderAvailable(true);
          setGpuEncoderInfo({
            encoder: data?.encoder ?? 'video-encoder',
            label: data?.label ?? 'Local video encoder sidecar',
            gpu: data?.gpu ?? null,
            hardware: data?.hardware ?? true,
          });
          return;
        }
        setGpuEncoderAvailable(false);
        setGpuEncoderInfo(null);
        console.warn(
          '[Video Studio] GPU encoder sidecar is offline in shell engine-health; WASM fallback.'
        );
        return;
      }

      // Sidecar boot + NVENC detection takes a few seconds; retry instead of
      // failing after a single 2s attempt.
      const MAX_ATTEMPTS = 10;
      for (let attempt = 0; attempt < MAX_ATTEMPTS && !cancelled; attempt++) {
        try {
          const res = await probeHealth(1500);
          if (res.ok) {
            const data = await res.json();
            if (cancelled) return;
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
                'NVENC not detected at sidecar startup — check nvidia-smi, ffmpeg -encoders | findstr nvenc.',
                data.encoder
              );
            }
            return;
          }
          console.warn(
            '[Video Studio] Sidecar /health returned %d %s (attempt %d/%d).',
            res.status, res.statusText, attempt + 1, MAX_ATTEMPTS
          );
        } catch {
          // Connection refused or timeout while the sidecar boots — retry.
        }
        if (!cancelled && attempt < MAX_ATTEMPTS - 1) {
          await new Promise((resolve) => setTimeout(resolve, 700));
        }
      }
      if (cancelled) return;
      setGpuEncoderAvailable(false);
      setGpuEncoderInfo(null);
      console.warn(
        '[Video Studio] GPU encoder sidecar unreachable after %d attempts — WASM fallback. ' +
        'Debug: curl http://127.0.0.1:9877/health; check nvidia-smi and ffmpeg -encoders | findstr nvenc.',
        MAX_ATTEMPTS
      );
    };

    checkGpuEncoder();
    return () => {
      cancelled = true;
      if (acquired) {
        import('@tauri-apps/api/core')
          .then(({ invoke }) => invoke('release_video_encoder'))
          .catch(() => {});
      }
    };
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
      setExportError(
        `In-browser encoder failed to load (${error instanceof Error ? error.message : 'network or CSP error'}). ` +
        'Check connectivity, then reopen this window to retry.',
      );
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
    if (!canvasRef.current || !song) {
      // Status truthfulness: this guard used to return silently, leaving an
      // enabled render CTA that did nothing (native QA blocker 2026-06-10).
      console.warn('[Video Studio] Render blocked:', { hasCanvas: !!canvasRef.current, hasSong: !!song });
      setExportError(!song
        ? 'No song is loaded into the renderer. Select a song, then try again.'
        : 'The preview canvas is not mounted yet. Open the preview, then try again.');
      return;
    }
    setExportError(null);

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
          if (!ffmpegRef.current) {
            // Encoder load failed (error surfaced by loadFFmpeg via exportError). Reset
            // render state so the panel stays actionable instead of sticking
            // at "Rendering frames 0%". (Handoff 2026-06-07.)
            setIsExporting(false);
            setExportStage('idle');
            setExportProgress(0);
            return;
          }
        }
        await renderOffline();
      }
    } catch (error) {
      console.error('Rendering failed:', error);
      setExportError(
        `Rendering failed: ${error instanceof Error ? error.message : String(error)}. ` +
        'Nothing was saved. Try again; if it persists, file a bug report.',
      );
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
    if (!song || !ffmpegRef.current) {
      setExportError('Renderer lost its inputs (song or encoder). Reopen the window and try again.');
      return;
    }

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
      renderSlideshow(ctx, width, height, normBass, frameIndex * (1000 / fps), slideshowRenderState);

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

    const blob = new Blob([outputData as BlobPart], { type: 'video/mp4' });
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

    if (registerCpuExport && registerVideo) {
      try {
        const shimSaveRes = await fetch(
          `${apiBase}/api/video/save?title=${encodeURIComponent(song.title || 'strands-sounds')}`,
          { method: 'POST', body: blob, headers: { 'Content-Type': 'video/mp4' } }
        );
        if (shimSaveRes.ok) {
          const shimData = await shimSaveRes.json();
          await registerVideo({
            title: `${song.title || 'Video'} ${new Date().toISOString().slice(0, 10)}`,
            filePath: shimData.path,
            durationSeconds: typeof song.duration === 'number' ? song.duration : undefined,
            tags: [vaultTag, 'video', 'cpu-encode'],
          });
        }
      } catch (vaultErr) {
        console.warn('[Video] Vault registration failed (CPU path):', vaultErr);
      }
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
      const worker = new VideoRenderWorker();
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
        renderSlideshow(ctx, width, height, normBass, frameIndex * (1000 / fps), slideshowRenderState);

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

    console.log(`[GPU Encode] Downloading from ${downloadUrl}`);

    const videoTitle = (song.title || 'strands-sounds')
      .replace(/\s*\((reference|cover)\)/gi, '')
      .replace(/\s*\(\d+\)\s*$/, '')
      .trim();
    let saveRes: Response | null = null;
    let saveData: { path?: string; file_path?: string; size?: number; size_bytes?: number; file_size_bytes?: number } | null = null;
    let vaultAlreadyRegistered = false;
    if (gpuSaveMode === 'save-from-encoder') {
      const encoderSessionId = downloadUrl.split('/').filter(Boolean).pop();
      if (!encoderSessionId) {
        throw new Error('Encoder did not return a usable download session.');
      }
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const vaultItem = await invoke<{
          file_path?: string;
          file_size_bytes?: number;
        }>('vault_register_video_from_encoder', {
          sessionId: encoderSessionId,
          title: videoTitle,
          durationSeconds: typeof song.duration === 'number' ? song.duration : undefined,
          width: renderRes.w,
          height: renderRes.h,
          frameRate: 24,
          generationMode: 'video_visualizer',
          prompt: song.title,
          hasAudio: true,
          tags: [vaultTag, 'video', 'gpu-encode'],
          sourceAppId: vaultTag,
          appletScope: vaultTag,
          libraryScope: 'videos',
        });
        saveData = {
          path: vaultItem.file_path,
          size_bytes: vaultItem.file_size_bytes,
        };
        vaultAlreadyRegistered = true;
      } catch (nativeSaveErr) {
        console.warn('[GPU Encode] Native encoder-to-vault save unavailable, falling back to legacy API:', nativeSaveErr);
        saveRes = await fetch(
          `${apiBase}/api/video/save-from-encoder?session_id=${encodeURIComponent(encoderSessionId)}&title=${encodeURIComponent(videoTitle)}`,
          { method: 'POST' }
        );
      }
    } else {
      const mp4Response = await fetch(`http://127.0.0.1:9877${downloadUrl}`);
      const mp4Blob = await mp4Response.blob();
      saveRes = await fetch(
        `${apiBase}/api/video/save?title=${encodeURIComponent(videoTitle)}`,
        { method: 'POST', body: mp4Blob, headers: { 'Content-Type': 'video/mp4' } }
      );
    }
    if (!saveData && saveRes && !saveRes.ok) {
      const errText = await saveRes.text();
      console.error('[GPU Encode] Save failed:', errText);
      showToast({ kind: 'error', message: 'Video save failed. Check disk space.' });
    } else {
      if (!saveData && saveRes) {
        saveData = await saveRes.json();
      }
      const savedPath = saveData?.path ?? saveData?.file_path;
      const sizeBytes = saveData?.size_bytes ?? saveData?.file_size_bytes ?? saveData?.size ?? 0;
      console.log(`[GPU Encode] Saved to: ${savedPath} (${sizeBytes} bytes)`);
      const sizeMb = (sizeBytes / (1024 * 1024)).toFixed(1);
      showToast({ kind: 'success', message: `Video saved (${sizeMb} MB) → Videos/Strands Sound Studio`, durationMs: 5000 });

      // Register with Everywear Vault
      try {
        if (!vaultAlreadyRegistered && savedPath) await registerVideo?.({
          title: videoTitle,
          filePath: savedPath,
          durationSeconds: typeof song.duration === 'number' ? song.duration : undefined,
          tags: [vaultTag, 'video', 'gpu-encode'],
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
    renderSlideshow(ctx, width, height, normBass, Date.now(), slideshowRenderState);

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
        if (rawAlbumArtUrl) {
          const albumArtUrl = rawAlbumArtUrl && rawAlbumArtUrl.startsWith('http')
              ? `/api/proxy/image?url=${encodeURIComponent(rawAlbumArtUrl)}`
              : rawAlbumArtUrl ?? '';
          drawAlbumArt(ctx, centerX, centerY, pulse, albumArtUrl, currentConfig.primaryColor, customAlbumArtImageRef.current);
        }
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
                 {exportError && (
                   <p className="text-[11px] text-red-400 text-center" role="alert">
                     {exportError}
                   </p>
                 )}
                 <p className="text-[10px] text-zinc-600 text-center">
                   {gpuEncoderAvailable
                     ? `${gpuEncoderInfo?.label}${gpuEncoderInfo?.gpu ? ` • ${gpuEncoderInfo.gpu}` : ''} • `
                     : ffmpegLoaded ? 'WASM encoder ready • ' : ''}Do not close this window while rendering.
                 </p>
                 {!gpuEncoderAvailable && (
                   <p className="text-[10px] text-amber-500 text-center">
                     Native GPU encoder unavailable: the local encoder service did not
                     respond on port 9877. Export will use the slower in-browser encoder.
                     Reopen this window to retry.
                   </p>
                 )}
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
