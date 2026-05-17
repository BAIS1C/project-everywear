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

export interface DiscourseUser {
  username: string;
  name: string | null;
  avatar_url: string | null;
  trust_level: number;
  unread_notifications: number;
}

export interface DiscoursePost {
  id: number;
  topic_title: string;
  topic_url: string;
  author: string;
  excerpt: string;
  created_at: string;
  category: string;
}

export interface AppletEntry {
  id: string;
  name: string;
  description: string;
  version: string;
  icon: string;
  status: 'Active' | 'Locked' | 'NotBuilt';
  engine_type: string;
  min_vram_mb: number;
  tags: string[];
  launch_url: string | null;
  launch_binary: string | null;
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

// ─── Auth (Supabase session + licence tier) ────────────────────────────────

export type LicenceTier = 'demo' | 'gener8' | 'gener8_pro' | 'creator_studio';

export interface AuthStateUpdate {
  access_token?: string;
  tier: string;
  exp?: number;
}

export interface AuthReport {
  user_id: string | null;
  handle: string | null;
  email: string | null;
  tier: string;
  is_paid: boolean;
  is_pro: boolean;
}

export interface AuthContext {
  id: string;
  email: string | null;
  username: string;
  tier: LicenceTier;
  is_paid: boolean;
  is_pro: boolean;
}

// ─── GPU ────────────────────────────────────────────────────────────────────

export const getGpuStatus = () => invoke<SystemGpuState>('get_gpu_status');
export const pollVram = (gpuIndex: number) =>
  invoke<{ used_mb: number; free_mb: number }>('poll_vram', { gpuIndex });
export const getComputeBackend = () => invoke<ComputeBackend>('get_compute_backend');
export const getVramTier = () => invoke<VramTier>('get_vram_tier');
export const listModelAssessments = () => invoke<ModelAssessment[]>('list_model_assessments');

// ─── Profile ────────────────────────────────────────────────────────────────

export const getProfile = () => invoke<UserProfile>('get_profile');
export const updateProfile = (update: ProfileUpdate) =>
  invoke<UserProfile>('update_profile', { update });
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

// ─── Discourse ──────────────────────────────────────────────────────────────

export const discourseOAuthUrl = () => invoke<string>('discourse_oauth_url');
export const discourseUser = () => invoke<DiscourseUser | null>('discourse_user');
export const discourseLatest = (limit?: number) =>
  invoke<DiscoursePost[]>('discourse_latest', { limit });
export const discourseDisconnect = () => invoke<void>('discourse_disconnect');

// ─── Registry ───────────────────────────────────────────────────────────────

export const listApplets = () => invoke<AppletEntry[]>('list_applets');
export const getApplet = (id: string) => invoke<AppletEntry | null>('get_applet', { id });
export const launchApplet = (id: string) => invoke<void>('launch_applet', { id });

// ─── Platform ───────────────────────────────────────────────────────────────

export const platformStatus = () => invoke<PlatformStatus>('platform_status');

// ─── Auth (Supabase session + licence tier) ────────────────────────────────

export const pushAuthState = (update: AuthStateUpdate) =>
  invoke<AuthReport>('push_auth_state', { update });
export const getAuthContext = () => invoke<AuthContext | null>('get_auth_context');
export const checkLicence = () => invoke<AuthReport>('check_licence');
export const clearAuth = () => invoke<void>('clear_auth');
