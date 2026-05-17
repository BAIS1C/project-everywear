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
