/**
 * S³ Video Encoder — FFmpeg Session Manager
 *
 * Manages encode sessions: creates temp dirs, spawns ffmpeg with the
 * correct encoder + thread budget, streams raw RGBA frames via stdin,
 * and serves the final MP4.
 *
 * Thread allocation is driven by SystemProfile from detect-gpu.ts:
 *   - GPU encode: gpuEncodeThreads (2-4, just for RGBA→YUV conversion)
 *   - CPU encode: cpuEncodeThreads (~60% of logical cores)
 */

import { spawn, ChildProcess } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { v4 as uuidv4 } from 'uuid';
import type { SystemProfile } from './detect-gpu.js';

// ── Types ───────────────────────────────────────────────────────

export type FrameFormat = 'jpeg' | 'raw';

export interface EncodeSession {
  id: string;
  tempDir: string;
  audioPath: string;
  outputPath: string;
  ffmpeg: ChildProcess | null;
  framesReceived: number;
  totalFrames: number;
  stage: 'receiving' | 'encoding' | 'complete' | 'error';
  encoder: string;
  frameFormat: FrameFormat;
  startTime: number;
  error?: string;
}

// ── State ───────────────────────────────────────────────────────

const activeSessions = new Map<string, EncodeSession>();
const CLEANUP_DELAY_MS = 5 * 60 * 1000;

// System profile is injected at startup from index.ts
let _systemProfile: SystemProfile | null = null;

export function setSystemProfile(profile: SystemProfile): void {
  _systemProfile = profile;
}

// ── Session Lifecycle ───────────────────────────────────────────

export function createSession(
  encoder: string,
  totalFrames: number,
  frameFormat: FrameFormat = 'jpeg',
): EncodeSession {
  const id = uuidv4();
  const tempDir = path.join(os.tmpdir(), `s3-encode-${id}`);
  fs.mkdirSync(tempDir, { recursive: true });

  const session: EncodeSession = {
    id,
    tempDir,
    audioPath: path.join(tempDir, 'audio.mp3'),
    outputPath: path.join(tempDir, 'output.mp4'),
    ffmpeg: null,
    framesReceived: 0,
    totalFrames,
    stage: 'receiving',
    encoder,
    frameFormat,
    startTime: Date.now(),
  };

  activeSessions.set(id, session);
  return session;
}

export function writeAudio(sessionId: string, audioData: Buffer): void {
  const session = activeSessions.get(sessionId);
  if (!session) throw new Error(`Session ${sessionId} not found`);
  fs.writeFileSync(session.audioPath, audioData);
  console.log(`[S³ Encode ${sessionId.slice(0, 8)}] Audio: ${(audioData.length / 1024 / 1024).toFixed(1)}MB`);
}

// ── FFmpeg Spawning ─────────────────────────────────────────────

export function startEncode(
  sessionId: string,
  fps: number,
  width: number,
  height: number,
  onProgress: (progress: number) => void,
): { process: ChildProcess; stdinReady: boolean } {
  const session = activeSessions.get(sessionId);
  if (!session) throw new Error(`Session ${sessionId} not found`);

  const encoderArgs = getEncoderArgs(session.encoder);
  const threadCount = getThreadCount(session.encoder);

  // Input format
  const inputArgs = session.frameFormat === 'raw'
    ? ['-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${width}x${height}`, '-r', String(fps), '-i', 'pipe:0']
    : ['-f', 'image2pipe', '-framerate', String(fps), '-i', 'pipe:0'];

  // Thread args: always set for both GPU and CPU paths
  const threadArgs = [
    '-threads', String(threadCount),
    '-filter_threads', String(threadCount),
  ];

  const args = [
    '-y',
    ...inputArgs,
    '-i', session.audioPath,
    ...threadArgs,
    '-c:v', session.encoder,
    ...encoderArgs,
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    '-b:a', '192k',
    '-shortest',
    session.outputPath,
  ];

  // Honour the Rust launcher's resolved ffmpeg (task #51). Falls back
  // to bare `ffmpeg` for dev contexts that bypass the launcher.
  const ffmpegPath = process.env.FFMPEG_PATH || 'ffmpeg';
  console.log(`[S³ Encode ${sessionId.slice(0, 8)}] ${ffmpegPath} ${args.join(' ')}`);
  console.log(`[S³ Encode ${sessionId.slice(0, 8)}] Threads: ${threadCount} (${session.encoder.includes('libx264') ? 'CPU encode' : 'GPU pixel conv'})`);

  const ffmpeg = spawn(ffmpegPath, args, {
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  session.ffmpeg = ffmpeg;
  session.stage = 'receiving';

  // Progress parsing
  let lastProgressReport = 0;
  ffmpeg.stderr?.on('data', (data: Buffer) => {
    const line = data.toString();
    const frameMatch = line.match(/frame=\s*(\d+)/);
    if (frameMatch) {
      const encodedFrames = parseInt(frameMatch[1]);
      const progress = Math.min(encodedFrames / session.totalFrames, 1);
      if (progress - lastProgressReport >= 0.02 || progress >= 1) {
        lastProgressReport = progress;
        onProgress(progress);
      }
    }
  });

  ffmpeg.on('close', (code) => {
    if (code === 0 && fs.existsSync(session.outputPath)) {
      const stats = fs.statSync(session.outputPath);
      const elapsed = ((Date.now() - session.startTime) / 1000).toFixed(1);
      console.log(`[S³ Encode ${sessionId.slice(0, 8)}] Done: ${(stats.size / 1024 / 1024).toFixed(1)}MB in ${elapsed}s`);
      session.stage = 'complete';
    } else {
      console.error(`[S³ Encode ${sessionId.slice(0, 8)}] FFmpeg exit code ${code}`);
      session.stage = 'error';
      session.error = `FFmpeg exited with code ${code}`;
    }
  });

  ffmpeg.on('error', (err) => {
    console.error(`[S³ Encode ${sessionId.slice(0, 8)}] Spawn error:`, err);
    session.stage = 'error';
    session.error = err.message;
  });

  return { process: ffmpeg, stdinReady: true };
}

// ── Frame I/O ───────────────────────────────────────────────────

export function writeFrame(sessionId: string, frameData: Buffer): boolean {
  const session = activeSessions.get(sessionId);
  if (!session || !session.ffmpeg || !session.ffmpeg.stdin) return false;

  try {
    const canWrite = session.ffmpeg.stdin.write(frameData);
    session.framesReceived++;
    return canWrite;
  } catch (err) {
    console.error(`[S³ Encode ${sessionId.slice(0, 8)}] Write error:`, err);
    return false;
  }
}

export function finishFrames(sessionId: string): void {
  const session = activeSessions.get(sessionId);
  if (!session || !session.ffmpeg || !session.ffmpeg.stdin) return;

  console.log(`[S³ Encode ${sessionId.slice(0, 8)}] ${session.framesReceived} frames received, closing stdin`);
  session.stage = 'encoding';
  session.ffmpeg.stdin.end();
}

// ── Session Queries ─────────────────────────────────────────────

export function getOutputPath(sessionId: string): string | null {
  const session = activeSessions.get(sessionId);
  if (!session || session.stage !== 'complete') return null;
  if (!fs.existsSync(session.outputPath)) return null;
  return session.outputPath;
}

export function getSession(sessionId: string): EncodeSession | undefined {
  return activeSessions.get(sessionId);
}

// ── Cleanup ─────────────────────────────────────────────────────

export function scheduleCleanup(sessionId: string): void {
  setTimeout(() => {
    const session = activeSessions.get(sessionId);
    if (!session) return;

    try {
      fs.rmSync(session.tempDir, { recursive: true, force: true });
      console.log(`[S³ Encode ${sessionId.slice(0, 8)}] Cleaned up`);
    } catch (err) {
      console.error(`[S³ Encode ${sessionId.slice(0, 8)}] Cleanup error:`, err);
    }

    activeSessions.delete(sessionId);
  }, CLEANUP_DELAY_MS);
}

export function cleanupAll(): void {
  for (const [, session] of activeSessions) {
    try {
      if (session.ffmpeg && !session.ffmpeg.killed) {
        session.ffmpeg.kill('SIGTERM');
      }
      fs.rmSync(session.tempDir, { recursive: true, force: true });
    } catch {
      // Best effort
    }
  }
  activeSessions.clear();
}

// ── Thread Allocation ───────────────────────────────────────────

/**
 * Determine the optimal thread count for ffmpeg based on encoder type.
 *
 * GPU encode path: only needs threads for RGBA→YUV pixel conversion.
 *   The GPU does the actual H.264 encoding asynchronously.
 *
 * CPU encode path: libx264 is CPU-bound. We allocate ~60% of logical
 *   cores, leaving headroom for the browser render loop, audio engine,
 *   OS, and this Node sidecar.
 */
function getThreadCount(encoder: string): number {
  if (!_systemProfile) {
    // Fallback if profile wasn't injected (shouldn't happen)
    const cores = os.cpus().length;
    return encoder === 'libx264'
      ? Math.max(2, Math.floor(cores * 0.6))
      : Math.min(4, Math.max(2, Math.floor(cores / 4)));
  }

  return encoder === 'libx264'
    ? _systemProfile.cpuEncodeThreads
    : _systemProfile.gpuEncodeThreads;
}

// ── Encoder Presets ─────────────────────────────────────────────

function getEncoderArgs(encoder: string): string[] {
  switch (encoder) {
    case 'h264_nvenc':
      return [
        '-preset', 'p1',     // Fastest (540p draft; quality via Vid Pro)
        '-tune', 'll',       // Low latency, no B-frames
        '-b:v', '4M',
        '-maxrate', '6M',
        '-bufsize', '8M',
        '-rc', 'vbr',
      ];

    case 'h264_qsv':
      return [
        '-preset', 'medium',
        '-b:v', '8M',
        '-maxrate', '12M',
      ];

    case 'h264_amf':
      return [
        '-quality', 'balanced',
        '-b:v', '8M',
        '-maxrate', '12M',
      ];

    case 'libx264':
      return [
        '-preset', 'fast',
        '-crf', '20',
        '-movflags', '+faststart',
      ];

    default:
      return ['-b:v', '8M'];
  }
}
