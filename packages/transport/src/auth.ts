import { invoke } from '@tauri-apps/api/core';

export type LicenceTier = 'demo' | 'gener8' | 'gener8_pro' | 'creator_studio';

export interface ShellAuthContext {
  id: string;
  email?: string;
  username?: string;
  tier: LicenceTier;
  is_paid?: boolean;
  is_pro?: boolean;
  entitlements?: Record<string, boolean>;
}

export function getAuthContext(): Promise<ShellAuthContext | null> {
  return invoke('get_auth_context');
}
