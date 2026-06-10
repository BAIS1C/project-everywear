import type { EngineHealthEndpoint } from "@everywear/shared";

export const VIDEO_ENCODER_ENDPOINT_ID = "video-encoder";
export const DEFAULT_VIDEO_ENCODER_HOST = "127.0.0.1";
export const DEFAULT_VIDEO_ENCODER_PORT = 9877;

function endpointPort(endpoint?: EngineHealthEndpoint | null): number {
  return endpoint?.port || DEFAULT_VIDEO_ENCODER_PORT;
}

function normalizePath(path: string): string {
  return path.startsWith("/") ? path : `/${path}`;
}

export function videoEncoderHttpBase(
  endpoint?: EngineHealthEndpoint | null,
): string {
  return `http://${DEFAULT_VIDEO_ENCODER_HOST}:${endpointPort(endpoint)}`;
}

export function videoEncoderHttpUrl(
  path: string,
  endpoint?: EngineHealthEndpoint | null,
): string {
  return `${videoEncoderHttpBase(endpoint)}${normalizePath(path)}`;
}

export function videoEncoderWsUrl(
  path: string,
  endpoint?: EngineHealthEndpoint | null,
): string {
  return `ws://${DEFAULT_VIDEO_ENCODER_HOST}:${endpointPort(endpoint)}${normalizePath(path)}`;
}

export function videoEncoderDownloadUrl(
  downloadPath: string,
  endpoint?: EngineHealthEndpoint | null,
): string {
  return videoEncoderHttpUrl(downloadPath, endpoint);
}
