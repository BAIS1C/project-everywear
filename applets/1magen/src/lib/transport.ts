/**
 * Tauri IPC transport layer for 1magen.
 * Wraps @tauri-apps/api/core invoke calls with typed signatures.
 */

import { invoke } from '@tauri-apps/api/core';

// ── Types ────────────────────────────────────────────────────────

export interface ModelInfo {
  key: string;
  name: string;
  filename: string;
  size_bytes: number;
  sha256: string | null;
  hf_repo: string;
  hf_file: string;
  path: string | null;
  downloaded: boolean;
  model_type: 'TextToImage' | 'ImageEdit' | 'Encoder' | 'Vae';
}

export interface EngineStatus {
  engine_loaded: boolean;
  loaded_model: string | null;
  available_models: ModelInfo[];
}

export interface RecommendedStack {
  primary_model_key: string;
  required_model_keys: string[];
  detected_vram_mb: number | null;
  quality_label: string;
  rationale: string;
}

export interface GenerationResult {
  image_base64: string;
  seed: number;
  elapsed_secs: number;
}

// ── IPC calls ────────────────────────────────────────────────────

export async function getStatus(): Promise<EngineStatus> {
  return invoke<EngineStatus>('get_status');
}

export async function listModels(): Promise<ModelInfo[]> {
  return invoke<ModelInfo[]>('list_models');
}

export async function getRecommendedStack(): Promise<RecommendedStack> {
  return invoke<RecommendedStack>('get_recommended_stack');
}

export async function getDefaultOutputDir(): Promise<string> {
  return invoke<string>('get_default_output_dir');
}

export async function downloadModel(modelKey: string): Promise<void> {
  return invoke('download_model', { modelKey });
}

export async function loadModel(modelKey: string): Promise<void> {
  return invoke('load_model', { modelKey });
}

export async function unloadModel(): Promise<void> {
  return invoke('unload_model');
}

export async function generateImage(params: {
  prompt: string;
  negativePrompt?: string;
  width?: number;
  height?: number;
  steps?: number;
  cfgScale?: number;
  seed?: number;
}): Promise<GenerationResult> {
  return invoke<GenerationResult>('generate_image', {
    prompt: params.prompt,
    negative_prompt: params.negativePrompt ?? null,
    width: params.width ?? null,
    height: params.height ?? null,
    steps: params.steps ?? null,
    cfg_scale: params.cfgScale ?? null,
    seed: params.seed ?? null,
  });
}

export async function editImage(params: {
  imagePath: string;
  prompt: string;
  strength?: number;
  steps?: number;
  seed?: number;
}): Promise<GenerationResult> {
  return invoke<GenerationResult>('edit_image', {
    image_path: params.imagePath,
    prompt: params.prompt,
    strength: params.strength ?? null,
    steps: params.steps ?? null,
    seed: params.seed ?? null,
  });
}

export async function saveImage(imageBase64: string, path: string): Promise<string> {
  return invoke<string>('save_image', { imageBase64, path });
}
