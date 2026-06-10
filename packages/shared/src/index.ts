/**
 * @everywear/shared: common types and utilities.
 *
 * Exports:
 * - Model manifest types (mirroring model-manager crate)
 * - GPU info types (mirroring nvml-wrapper outputs)
 * - Progress event types
 * - Shared constants (default ports, paths, limits)
 */

export type { ModelInfo, ModelType, GpuInfo, ProgressEvent } from './types';
export { DEFAULTS } from './constants';
export { LockedFeatureCard } from './components/LockedFeatureCard';
export type { LockedFeatureCardProps, FeatureProgress, FeatureTier } from './components/LockedFeatureCard';
export {
  ENGINE_HEALTH_WINDOW_EVENT,
  findEngineEndpoint,
  formatEngineLastChecked,
  publishEngineHealth,
  readEngineHealth,
  subscribeEngineHealth,
} from './engineHealth';
export type { EngineHealthEndpoint, EngineHealthPayload } from './engineHealth';

// Logging
export {
  EverywearLogger,
  getLogger,
  initLogger,
  getAllBufferedEntries,
  getRecentLogEntries,
  getErrorCount,
  getLastError,
} from './lib/logger';
