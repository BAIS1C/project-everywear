import { invoke } from '@tauri-apps/api/core';

export interface Gener8UploadAudioRequest {
  fileName?: string;
  contentType?: string;
  dataBase64: string;
}

export interface Gener8UploadAudioResponse {
  key: string;
  path: string;
  audioUrl: string;
  filename: string;
  size: number;
}

export interface Gener8GenerationJob {
  id?: string;
  jobId?: string;
  status: 'pending' | 'queued' | 'running' | 'loading' | 'completed' | 'succeeded' | 'failed';
  progress?: number;
  audio_url?: string;
  file_path?: string;
  title?: string;
  duration?: number;
  result?: {
    audioUrls?: string[];
    audioKey?: string;
    filePath?: string;
    audioContentType?: string;
    duration?: number;
    bpm?: number;
    warnings?: string[];
  };
  error?: string;
  [key: string]: unknown;
}

export type Gener8GenerateParams = Record<string, unknown>;

export async function gener8UploadAudio(
  request: Gener8UploadAudioRequest,
): Promise<Gener8UploadAudioResponse> {
  return invoke('gener8_upload_audio', { request });
}

export async function gener8Generate(
  params: Gener8GenerateParams,
): Promise<Gener8GenerationJob> {
  return invoke('gener8_generate', { params });
}

export async function gener8GenerationStatus(jobId: string): Promise<Gener8GenerationJob> {
  return invoke('gener8_generation_status', { jobId });
}

export async function gener8EngineModels(): Promise<unknown> {
  return invoke('gener8_engine_models');
}

export async function fileToBase64(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}
