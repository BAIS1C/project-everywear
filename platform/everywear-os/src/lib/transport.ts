/**
 * Typed Tauri IPC wrappers for Everywear OS shell commands.
 */
import { invoke } from '@tauri-apps/api/core';

// ─── Types ──────────────────────────────────────────────────────────────────

// ─── GPU / Compute Backend ─────────────────────────────────────────────────

export type GpuVendor = 'Nvidia' | 'Amd' | 'Intel' | 'Apple' | 'Unknown' | 'None';

export interface CudaStatus {
  driver_version: string;
  toolkit_version: string | null;
  cublas_available: boolean;
  cublas_path: string | null;
  compute_capability: [number, number] | null;
}

export interface VulkanStatus {
  api_version: string | null;
  device_name: string;
  vram_mb: number;
}

export type ComputeBackend =
  | { type: 'Cuda'; device_name: string; vram_mb: number; cuda: CudaStatus; needs_provisioning: boolean }
  | { type: 'Vulkan'; device_name: string; vram_mb: number; vulkan: VulkanStatus }
  | { type: 'Cpu'; has_blas: boolean; ram_mb: number };

export type VramTier = 'Ultra' | 'Standard' | 'Constrained' | 'Minimal' | 'CpuFallback';

export interface GpuInfo {
  index: number;
  name: string;
  vram_total_mb: number;
  vram_used_mb: number;
  vram_free_mb: number;
  utilization_gpu: number;
  utilization_memory: number;
  temperature_c: number;
  driver_version: string;
  cuda_version: string;
  compute_capability: string;
}

export interface SystemGpuState {
  gpus: GpuInfo[];
  nvml_available: boolean;
  total_vram_mb: number;
  total_free_mb: number;
  primary_gpu: string | null;
  backend: ComputeBackend;
  vram_tier: VramTier;
}

export type AssessmentStatus = 'Ready' | 'Reduced' | 'SetupRequired' | 'Unsupported';

export interface ModelAssessment {
  applet_id: string;
  applet_name: string;
  status: AssessmentStatus;
  total_vram_mb: number;
  min_required_vram_mb: number;
  recommended_group: string | null;
  recommended_vram_mb: number | null;
  recommended_primary_model: string | null;
  rationale: string;
}

export interface UserProfile {
  id: string;
  display_name: string;
  alias: string | null;
  email: string | null;
  avatar_path: string | null;
  bio: string | null;
  created_at: string;
  updated_at: string;
  discourse_username: string | null;
  discourse_session_valid: boolean;
  wallet_address: string | null;
  wallet_connected: boolean;
}

export interface ProfileUpdate {
  display_name?: string;
  alias?: string;
  email?: string;
  avatar_path?: string;
  bio?: string;
}

export interface WalletInfo {
  address: string;
  public_key_hex: string;
  balance: WalletBalance;
  connected: boolean;
  chain_id: string;
  network: string;
}

export interface WalletBalance {
  strands: number;
  founders_passes: number;
  tokens: TokenBalance[];
}

export interface TokenBalance {
  symbol: string;
  name: string;
  amount: number;
  decimals: number;
}

export interface Transaction {
  hash: string;
  from: string;
  to: string;
  amount: number;
  token: string;
  timestamp: string;
  status: 'Pending' | 'Confirmed' | 'Failed';
  block: number | null;
}

// Discourse types removed: community.strandsnation.xyz is embedded as a web applet (iframe).

export interface AppletEntry {
  id: string;
  name: string;
  description: string;
  version: string;
  icon: string;
  status: 'Active' | 'Locked' | 'NotBuilt';
  launch_kind: 'BinaryLocal' | 'FrontendInline' | 'ExternalUrl' | 'Placeholder';
  launchKind?: 'BinaryLocal' | 'FrontendInline' | 'ExternalUrl' | 'Placeholder';
  engine_type: string;
  engineType?: string;
  min_vram_mb: number;
  minVramMb?: number;
  tags: string[];
  launch_url: string | null;
  launchUrl?: string | null;
  launch_binary: string | null;
  launchBinary?: string | null;
  required_tier: LicenceTier | null;
  requiredTier?: LicenceTier | null;
  required_entitlements: string[];
  requiredEntitlements?: string[];
  frontend_port: number | null;
  frontendPort?: number | null;
  frontend_route: string | null;
  frontendRoute?: string | null;
  shares_backend: string | null;
  sharesBackend?: string | null;
  lockedModel?: 'song' | 'pro' | null;
  allowedAudioModes?: ('song' | 'reference' | 'cover')[] | null;
  stepCeiling?: number | null;
  vaultScope?: 'full' | null;
  vidTarget?: 'vid' | null;
  locked_model?: 'song' | 'pro' | null;
  allowed_audio_modes?: ('song' | 'reference' | 'cover')[] | null;
  step_ceiling?: number | null;
  vault_scope?: 'full' | null;
  vid_target?: 'vid' | null;
}

export interface PlatformStatus {
  version: string;
  gpu: {
    available: boolean;
    primary: string | null;
    total_vram_mb: number;
    free_vram_mb: number;
    backend: string;
    vram_tier: string;
  };
  auth: {
    authenticated: boolean;
    user_id: string | null;
    handle: string | null;
    email: string | null;
    tier: string;
    is_paid: boolean;
    is_pro: boolean;
  };
  profile: { display_name: string; alias: string | null };
  wallet: { connected: boolean; address: string | null };
  discourse: { connected: boolean };
  applets: { active: number };
}

const hasTauriRuntime = () =>
  typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

const nowIso = () => new Date().toISOString();
const canonicalAppletId = (id: string) => (id === 'gener8' ? 'gener8-4ever' : id);
const normalizeAppletEntry = (entry: AppletEntry): AppletEntry => ({
  ...entry,
  launch_kind: entry.launch_kind ?? entry.launchKind ?? 'Placeholder',
  engine_type: entry.engine_type ?? entry.engineType ?? 'none',
  min_vram_mb: entry.min_vram_mb ?? entry.minVramMb ?? 0,
  launch_url: entry.launch_url ?? entry.launchUrl ?? null,
  launch_binary: entry.launch_binary ?? entry.launchBinary ?? null,
  required_tier: entry.required_tier ?? entry.requiredTier ?? null,
  required_entitlements: entry.required_entitlements ?? entry.requiredEntitlements ?? [],
  frontend_port: entry.frontend_port ?? entry.frontendPort ?? null,
  frontend_route: entry.frontend_route ?? entry.frontendRoute ?? null,
  shares_backend: entry.shares_backend ?? entry.sharesBackend ?? null,
  lockedModel: entry.lockedModel ?? entry.locked_model ?? null,
  allowedAudioModes: entry.allowedAudioModes ?? entry.allowed_audio_modes ?? null,
  stepCeiling: entry.stepCeiling ?? entry.step_ceiling ?? null,
  vaultScope: entry.vaultScope ?? entry.vault_scope ?? null,
  vidTarget: entry.vidTarget ?? entry.vid_target ?? null,
});

function browserProfileFallback(): UserProfile {
  return {
    id: 'browser-preview',
    display_name: 'Sean Uddin',
    alias: 'seanie',
    email: null,
    avatar_path: null,
    bio: 'Everywear browser preview session',
    created_at: nowIso(),
    updated_at: nowIso(),
    discourse_username: null,
    discourse_session_valid: false,
    wallet_address: null,
    wallet_connected: false,
  };
}

function browserGpuFallback(): SystemGpuState {
  return {
    gpus: [],
    nvml_available: false,
    total_vram_mb: 0,
    total_free_mb: 0,
    primary_gpu: null,
    backend: { type: 'Cpu', has_blas: false, ram_mb: 0 },
    vram_tier: 'CpuFallback',
  };
}

const BROWSER_APPLET_REGISTRY: AppletEntry[] = [
  {
    id: '1magen',
    name: '1magen',
    description: 'Local AI image generation and editing',
    version: '0.1.0',
    icon: '1magen',
    status: 'Active',
    launch_kind: 'FrontendInline',
    engine_type: 'diffusion',
    min_vram_mb: 7400,
    tags: ['image', 'generation', 'editing'],
    launch_url: null,
    launch_binary: 'onemagen',
    required_tier: 'gener8',
    required_entitlements: ['1magen', '1magen.image'],
    frontend_port: 3002,
    frontend_route: null,
    shares_backend: null,
  },
  {
    id: 'gener8-4ever',
    name: 'Gener8 4ever',
    description: 'Local AI text-to-song generation',
    version: '0.1.0',
    icon: 'gener8-4ever',
    status: 'Active',
    launch_kind: 'FrontendInline',
    engine_type: 'audio',
    min_vram_mb: 6144,
    tags: ['music', 'audio', 'song', '4ever'],
    launch_url: null,
    launch_binary: null,
    required_tier: 'gener8',
    required_entitlements: ['gener8', 'gener8.audio'],
    frontend_port: null,
    frontend_route: null,
    shares_backend: null,
    lockedModel: 'song',
    allowedAudioModes: ['song'],
    stepCeiling: 12,
    vaultScope: 'full',
    vidTarget: 'vid',
  },
  {
    id: 'gener8-pro',
    name: 'Gener8 Pro',
    description: 'Local AI reference and cover audio generation',
    version: '0.1.0',
    icon: 'gener8-pro',
    status: 'Active',
    launch_kind: 'FrontendInline',
    engine_type: 'audio',
    min_vram_mb: 6144,
    tags: ['music', 'audio', 'reference', 'cover'],
    launch_url: null,
    launch_binary: null,
    required_tier: 'gener8_pro',
    required_entitlements: ['gener8_pro'],
    frontend_port: null,
    frontend_route: null,
    shares_backend: null,
    lockedModel: 'pro',
    allowedAudioModes: ['reference', 'cover'],
    stepCeiling: 75,
    vaultScope: 'full',
    vidTarget: 'vid',
  },
  {
    id: 'vid',
    name: 'Vid Studio',
    description: 'Audio-reactive visualiser and music video creation',
    version: '0.1.0',
    icon: 'vid',
    status: 'Active',
    launch_kind: 'FrontendInline',
    engine_type: 'none',
    min_vram_mb: 0,
    tags: ['video', 'visualiser', 'music'],
    launch_url: null,
    launch_binary: null,
    required_tier: 'gener8',
    required_entitlements: ['vid'],
    frontend_port: null,
    frontend_route: null,
    shares_backend: 'gener8-4ever',
  },
  {
    id: 'ai-director',
    name: 'AI Director',
    description: 'Creator Studio shot planning and music-video direction',
    version: '0.1.0',
    icon: 'ai-director',
    status: 'Active',
    launch_kind: 'FrontendInline',
    engine_type: 'video',
    min_vram_mb: 0,
    tags: ['video', 'director', 'creator-studio'],
    launch_url: null,
    launch_binary: null,
    required_tier: 'creator_studio',
    required_entitlements: ['ai_director', 'ai_director.planner'],
    frontend_port: null,
    frontend_route: null,
    shares_backend: 'gener8-4ever',
  },
  {
    id: 'daw',
    name: 'DAW',
    description: 'Multi-track timeline, stem mixing, and arrangement',
    version: '0.1.0',
    icon: 'daw',
    status: 'Active',
    launch_kind: 'FrontendInline',
    engine_type: 'none',
    min_vram_mb: 0,
    tags: ['daw', 'audio', 'mixing', 'stems'],
    launch_url: null,
    launch_binary: null,
    required_tier: 'creator_studio',
    required_entitlements: ['daw_pro'],
    frontend_port: null,
    frontend_route: null,
    shares_backend: 'gener8-4ever',
  },
  {
    id: 's3studio',
    name: 'S3 Studio',
    description: 'Strands Sound Studio: cloud music generation',
    version: '0.1.0',
    icon: 's3studio',
    status: 'Active',
    launch_kind: 'ExternalUrl',
    engine_type: 'audio',
    min_vram_mb: 0,
    tags: ['music', 'audio', 'generation', 'web'],
    launch_url: 'https://s3studio.xyz',
    launch_binary: null,
    required_tier: null,
    required_entitlements: ['loom', 'loom.teacher_agent'],
    frontend_port: null,
    frontend_route: null,
    shares_backend: null,
  },
  {
    id: 'strands-game',
    name: 'Strands Nation',
    description: 'The game: Three.js desktop OS world',
    version: '0.1.0',
    icon: 'strands-game',
    status: 'Active',
    launch_kind: 'ExternalUrl',
    engine_type: 'none',
    min_vram_mb: 0,
    tags: ['game', 'social', 'world'],
    launch_url: 'https://strandsnation.xyz',
    launch_binary: null,
    required_tier: null,
    required_entitlements: [],
    frontend_port: null,
    frontend_route: null,
    shares_backend: null,
  },
  {
    id: 'kasai',
    name: 'My Mait',
    description: 'Local MAIT agent with planning, orchestration, and full system access',
    version: '0.1.0',
    icon: 'kasai',
    status: 'Active',
    launch_kind: 'BinaryLocal',
    engine_type: 'llm',
    min_vram_mb: 4096,
    tags: ['agent', 'llm', 'assistant', 'planning'],
    launch_url: null,
    launch_binary: 'everywear-kasai',
    required_tier: null,
    required_entitlements: [],
    frontend_port: 3003,
    frontend_route: null,
    shares_backend: null,
  },
  {
    id: 'layeru-osint',
    name: 'Layer U OSINT',
    description: 'Compact OSINT worldview with flights, map layers, RSS, video, and source posture',
    version: '0.1.0',
    icon: 'layeru-osint',
    status: 'Active',
    launch_kind: 'FrontendInline',
    engine_type: 'none',
    min_vram_mb: 0,
    tags: ['osint', 'worldview', 'feeds', 'map'],
    launch_url: null,
    launch_binary: null,
    required_tier: null,
    required_entitlements: [],
    frontend_port: null,
    frontend_route: null,
    shares_backend: null,
  },
  {
    id: '3nvizen',
    name: '3nvizen',
    description: 'AI video generation with Wan 2.2 and LTX',
    version: '0.1.0',
    icon: '3nvizen',
    // Build-availability only; lock state is derived from entitlements via
    // resolveAppletStatus(), not hardcoded here. (WIKI.md v1.1.16)
    status: 'Active',
    launch_kind: 'BinaryLocal',
    engine_type: 'diffusion',
    min_vram_mb: 12288,
    tags: ['video', 'generation'],
    launch_url: null,
    launch_binary: 'everywear-3nvizen',
    required_tier: 'creator_studio',
    required_entitlements: ['3nvizen', '3nvizen.video'],
    frontend_port: 3004,
    frontend_route: null,
    shares_backend: null,
  },
  {
    id: 'character-studio',
    name: 'Avatar Studio',
    description: '3D avatar creation and customization for Strands Blanks',
    version: '0.1.0',
    icon: 'character-studio',
    status: 'Active',
    launch_kind: 'FrontendInline',
    engine_type: 'none',
    min_vram_mb: 0,
    tags: ['avatar', '3d', 'character', 'blanks'],
    launch_url: null,
    launch_binary: null,
    required_tier: null,
    required_entitlements: [],
    frontend_port: 3007,
    frontend_route: null,
    shares_backend: null,
  },
  {
    id: 'loom',
    name: 'The Loom',
    description: 'The Loom: Weaving Agentic Education into your Home.',
    version: '0.1.0',
    icon: 'loom',
    status: 'Active',
    launch_kind: 'FrontendInline',
    engine_type: 'none',
    min_vram_mb: 0,
    tags: ['knowledge', 'offline', 'rag', 'education'],
    launch_url: null,
    launch_binary: null,
    required_tier: null,
    required_entitlements: [],
    frontend_port: 3008,
    frontend_route: null,
    shares_backend: null,
  },
];

// ─── Auth (Supabase session + licence tier) ────────────────────────────────

export type LicenceTier = 'demo' | 'gener8' | 'gener8_pro' | 'creator_studio';

export interface AuthStateUpdate {
  access_token?: string;
  tier: string;
  exp?: number;
  handle?: string;
  display_name?: string;
  email?: string;
  entitlements?: Record<string, boolean>;
}

export interface AuthReport {
  user_id: string | null;
  handle: string | null;
  email: string | null;
  tier: string;
  is_paid: boolean;
  is_pro: boolean;
  entitlement_resolved: boolean;
  entitlements?: Record<string, boolean>;
}

export interface AuthContext {
  id: string;
  email: string | null;
  username: string;
  tier: LicenceTier;
  is_paid: boolean;
  is_pro: boolean;
  entitlement_resolved: boolean;
  entitlements?: Record<string, boolean>;
}

// ─── GPU ────────────────────────────────────────────────────────────────────

export const getGpuStatus = async () =>
  hasTauriRuntime() ? invoke<SystemGpuState>('get_gpu_status') : browserGpuFallback();
export const pollVram = (gpuIndex: number) =>
  invoke<{ used_mb: number; free_mb: number }>('poll_vram', { gpuIndex });
export const getComputeBackend = () => invoke<ComputeBackend>('get_compute_backend');
export const getVramTier = () => invoke<VramTier>('get_vram_tier');
export const listModelAssessments = async () =>
  hasTauriRuntime() ? invoke<ModelAssessment[]>('list_model_assessments') : [];

// ─── Profile ────────────────────────────────────────────────────────────────

export const getProfile = async () =>
  hasTauriRuntime() ? invoke<UserProfile>('get_profile') : browserProfileFallback();
export const updateProfile = async (update: ProfileUpdate) =>
  hasTauriRuntime()
    ? invoke<UserProfile>('update_profile', { update })
    : { ...browserProfileFallback(), ...update, updated_at: nowIso() };
export const setPreference = (key: string, value: string) =>
  invoke<void>('set_preference', { key, value });
export const getPreference = (key: string) =>
  invoke<string | null>('get_preference', { key });

// ─── Wallet ─────────────────────────────────────────────────────────────────

export const walletGenerate = () => invoke<WalletInfo>('wallet_generate');
export const walletInfo = () => invoke<WalletInfo | null>('wallet_info');
export const walletTransactions = (limit?: number) =>
  invoke<Transaction[]>('wallet_transactions', { limit });
export const walletDisconnect = () => invoke<void>('wallet_disconnect');

// Discourse IPC commands removed: community panel embeds community.strandsnation.xyz directly.

// ─── Registry ───────────────────────────────────────────────────────────────

export const listApplets = async () =>
  hasTauriRuntime()
    ? (await invoke<AppletEntry[]>('list_applets')).map(normalizeAppletEntry)
    : BROWSER_APPLET_REGISTRY.map(normalizeAppletEntry);

/**
 * Resolve an applet's effective display/launch status against the signed-in
 * user's live entitlement flags.
 *
 * The Rust registry and the browser fallback only describe BUILD availability
 * (`Active` / `NotBuilt`); any `Locked` they carry is a presentation default,
 * not an authority. The authoritative lock decision is whether the user holds
 * at least one of the applet's `required_entitlements`. This mirrors
 * `appletLaunchBlocked()` in ShellLayout so the badge and the launch gate
 * agree. See WIKI.md v1.1.16 launcher gating note.
 *
 * Rules:
 *  - `NotBuilt` always wins (cannot launch a missing binary, owned or not).
 *  - No `required_entitlements` => available (never a hard Locked).
 *  - Has `required_entitlements` => `Active` if the user holds any, else `Locked`.
 */
export function resolveAppletStatus(
  applet: AppletEntry,
  entitlements?: Record<string, boolean> | null,
): AppletEntry['status'] {
  if (applet.status === 'NotBuilt') return 'NotBuilt';
  if (!applet.required_entitlements || applet.required_entitlements.length === 0) {
    return applet.status === 'Locked' ? 'Active' : applet.status;
  }
  const owned = applet.required_entitlements.some((key) => entitlements?.[key] === true);
  return owned ? 'Active' : 'Locked';
}
export const getApplet = async (id: string) => {
  const canonicalId = canonicalAppletId(id);
  if (hasTauriRuntime()) {
    const entry = await invoke<AppletEntry | null>('get_applet', { id: canonicalId });
    return entry ? normalizeAppletEntry(entry) : null;
  }
  const entry = BROWSER_APPLET_REGISTRY.find((applet) => applet.id === canonicalId);
  return entry ? normalizeAppletEntry(entry) : null;
};
export const launchApplet = async (id: string) => {
  if (!hasTauriRuntime()) return;
  return invoke<void>('launch_applet', { id: canonicalAppletId(id) });
};
export const requestAppletSwitch = async (appletId: string) => {
  if (!hasTauriRuntime()) return;
  return invoke<void>('request_applet_switch', { appletId: canonicalAppletId(appletId) });
};
export const closeAppletWebview = (appletId: string) =>
  hasTauriRuntime() ? invoke<void>('close_applet_webview', { appletId }) : Promise.resolve();

// ─── Video Encoder Sidecar ──────────────────────────────────────────────────

export interface EncoderHealth {
  encoder: string;
  label: string;
  hardware: boolean;
}

/** Acquire the shared video-encoder sidecar; returns the WS port (9877). */
export const requestVideoEncoder = () => invoke<number>('request_video_encoder');
/** Release one consumer; sidecar stops when count hits 0. */
export const releaseVideoEncoder = () => invoke<void>('release_video_encoder');
/** Health-check the running encoder sidecar. */
export const videoEncoderHealth = () => invoke<EncoderHealth>('video_encoder_health');

// ─── Platform ───────────────────────────────────────────────────────────────

export const platformStatus = () => invoke<PlatformStatus>('platform_status');

// ─── Auth (Supabase session + licence tier) ────────────────────────────────

export const pushAuthState = (update: AuthStateUpdate) =>
  invoke<AuthReport>('push_auth_state', { update });
export const getAuthContext = () => invoke<AuthContext | null>('get_auth_context');
export const checkLicence = () => invoke<AuthReport>('check_licence');
export const clearAuth = () => invoke<void>('clear_auth');
