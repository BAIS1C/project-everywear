import type { EffectConfig, EffectIntensities, VisualizerConfig, VideoModalToast } from './videoModalTypes';

export const useResponsive = () => ({ isMobile: false });

export function defaultShowToast(
  msg: Parameters<VideoModalToast>[0],
  opts?: Parameters<VideoModalToast>[1],
) {
  if (typeof msg === 'object') {
    console.log('[toast]', msg.kind, msg.message);
  } else {
    console.log('[toast]', msg, opts);
  }
}

export const RENDER_PRESETS = [
  { label: 'TikTok / Reels', w: 1080, h: 1920, aspect: '9:16', tier: 'pro' as const },
  { label: 'YouTube Shorts', w: 1080, h: 1920, aspect: '9:16', tier: 'pro' as const },
  { label: 'Snapchat', w: 1080, h: 1920, aspect: '9:16', tier: 'pro' as const },
  { label: 'Pinterest', w: 1000, h: 1500, aspect: '2:3', tier: 'pro' as const },
  { label: 'Instagram Post', w: 1080, h: 1080, aspect: '1:1', tier: 'pro' as const },
  { label: '540p (16:9)', w: 960, h: 540, aspect: '16:9', tier: 'base' as const },
  { label: '720p (16:9)', w: 1280, h: 720, aspect: '16:9', tier: 'pro' as const },
  { label: '1080p (16:9)', w: 1920, h: 1080, aspect: '16:9', tier: 'pro' as const },
  { label: 'Square 720', w: 720, h: 720, aspect: '1:1', tier: 'pro' as const },
  { label: '540p (9:16)', w: 540, h: 960, aspect: '9:16', tier: 'base' as const },
] as const;

export const BASE_DEFAULT_INDEX = 5;

export const DEFAULT_VISUALIZER_CONFIG: VisualizerConfig = {
  preset: 'Strands Particle',
  primaryColor: '#00C2FF',
  secondaryColor: '#3b82f6',
  bgDim: 0.6,
  particleCount: 50,
  showVoidImage: false,
  particleScale: 1.0,
  particleOffsetX: 0,
  particleOffsetY: 0,
};

export const DEFAULT_EFFECTS: EffectConfig = {
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
  letterbox: false,
};

export const DEFAULT_INTENSITIES: EffectIntensities = {
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
  letterbox: 0.5,
};
