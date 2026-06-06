export type VideoModalToast = (
  msg: string | { kind: string; message: string; durationMs?: number },
  opts?: unknown,
) => void;

export type VideoModalTier = 'demo' | 'gener8' | 'gener8_pro' | 'creator_studio';

export interface VideoModalSong {
  id?: string;
  title: string;
  lyrics: string;
  style?: string;
  coverUrl?: string;
  duration?: string | number;
  audioUrl?: string;
  lrc_data?: string | null;
}

export interface VaultVideoRegistration {
  title: string;
  filePath: string;
  durationSeconds?: number;
  tags: string[];
}

export interface VideoGeneratorModalProps {
  isOpen: boolean;
  onClose: () => void;
  song: VideoModalSong | null;
  /** When true, renders inline (no fixed overlay/backdrop). Used by VidApp. */
  embedded?: boolean;
  tier?: VideoModalTier;
  vaultTag?: string;
  registerVideo?: (payload: VaultVideoRegistration) => Promise<unknown>;
  isMobile?: boolean;
  proEnabled?: boolean;
  isTrialActive?: boolean;
  canRemoveWatermark?: boolean;
  apiBase?: string;
  gpuSaveMode?: 'upload-blob' | 'save-from-encoder';
  registerCpuExport?: boolean;
  onToast?: VideoModalToast;
}

export type PresetType =
  | 'NCS Circle'
  | 'Linear Bars'
  | 'Dual Mirror'
  | 'Center Wave'
  | 'Orbital'
  | 'Digital Rain'
  | 'Hexagon'
  | 'Shockwave'
  | 'Oscilloscope'
  | 'Minimal'
  | 'Strands Particle'
  | 'S3 Hero'
  | 'DJ At Work';

export interface VisualizerConfig {
  preset: PresetType;
  primaryColor: string;
  secondaryColor: string;
  bgDim: number;
  particleCount: number;
  showVoidImage: boolean;
  particleScale: number;
  particleOffsetX: number;
  particleOffsetY: number;
}

export interface EffectConfig {
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

export interface EffectIntensities {
  [key: string]: number;
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

export interface TextLayer {
  id: string;
  text: string;
  x: number;
  y: number;
  size: number;
  color: string;
  font: string;
  visible: boolean;
  background?: string;
}

export interface PexelsPhoto {
  id: number;
  src: { large: string; original: string };
  photographer: string;
}

export interface PexelsVideo {
  id: number;
  image: string;
  video_files: { link: string; quality: string; width: number }[];
  user: { name: string };
}
