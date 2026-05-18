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

// Logging
export {
  EverywearLogger,
  getLogger,
  initLogger,
  getAllBufferedEntries,
  getErrorCount,
  getLastError,
} from './lib/logger';
