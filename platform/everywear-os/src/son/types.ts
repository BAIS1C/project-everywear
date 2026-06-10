export interface LayerURuntimeHealth {
  status?: string;
  uptime?: number;
  lastSweep?: string | null;
  nextSweep?: string | null;
  sweepInProgress?: boolean;
  sweepStartedAt?: string | null;
  sourcesOk?: number;
  sourcesFailed?: number;
  llmEnabled?: boolean;
  llmProvider?: string | null;
  llmReachable?: boolean | null;
  refreshIntervalMinutes?: number;
}

export interface LayerUPosture {
  direction: string;
  totalChanges: number | null;
  criticalChanges: number;
  vix: string;
  brent: string;
  wti: string;
}

export interface LayerUFeedItem {
  title: string;
  source: string;
  url?: string;
  publishedAt?: string;
}

export interface LayerUSourceRollup {
  ok: number;
  failed: number;
  total: number;
}

export interface LayerUSnapshot {
  online: boolean;
  health: LayerURuntimeHealth | null;
  data: Record<string, any> | null;
  posture: LayerUPosture;
  feeds: LayerUFeedItem[];
  sourceRollup: LayerUSourceRollup;
  updatedAt: string | null;
  lastOnlineAt?: string | null;
  restoredFromSession?: boolean;
  error: string | null;
}
