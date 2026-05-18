/**
 * Shared types mirroring Rust crate structures.
 * These are the TypeScript equivalents of model-manager and nvml-wrapper outputs.
 */

export type ModelType = 'diffusion' | 'audio' | 'llm' | 'video' | 'tts';

export interface ModelInfo {
  id: string;
  name: string;
  model_type: ModelType;
  size_bytes: number;
  quantization?: string;
  path?: string;
  loaded: boolean;
}

export interface GpuInfo {
  name: string;
  vram_total_mb: number;
  vram_used_mb: number;
  vram_free_mb: number;
  temperature_c?: number;
  utilization_percent?: number;
}

export interface ProgressEvent {
  task_id: string;
  stage: string;
  progress: number; // 0.0 – 1.0
  message?: string;
  eta_seconds?: number;
}
