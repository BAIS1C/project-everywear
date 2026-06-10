/**
 * S³ Video Encoder — Hardware Detection
 *
 * Detects the best available H.264 encoder (GPU or CPU fallback)
 * and profiles the system for optimal thread allocation.
 *
 * Encoder priority: NVENC > QuickSync > AMF > libx264
 * Thread strategy:
 *   - GPU encode: reserve 2 threads for ffmpeg pixel conversion,
 *     leave the rest free for canvas rendering (browser main thread)
 *   - CPU encode: allocate ~60% of logical cores to libx264,
 *     leave headroom for the OS + browser + audio engine
 *   - Muse Video (future): expose full thread budget for
 *     multi-model orchestration (Wan 2.2, CogVideoX, etc.)
 */

import { execSync } from 'child_process';
import os from 'os';
import path from 'path';
import fs from 'fs';

// ── Types ───────────────────────────────────────────────────────

export interface EncoderInfo {
  encoder: string;        // e.g. 'h264_nvenc', 'libx264'
  label: string;          // Human-readable label
  gpu: string | null;     // GPU name from nvidia-smi
  hardware: boolean;      // Whether this is a hardware encoder
}

export interface SystemProfile {
  /** Logical CPU cores (includes hyperthreads) */
  logicalCores: number;
  /** Physical CPU cores (no hyperthreads) */
  physicalCores: number;
  /** Total system RAM in GB */
  totalMemoryGB: number;
  /** NVIDIA VRAM in GB, or null */
  vramGB: number | null;
  /** Platform string */
  platform: string;

  // ── Thread budgets (pre-computed for each context) ──────────

  /** Threads for ffmpeg pixel conversion when GPU encoding */
  gpuEncodeThreads: number;
  /** Threads for libx264 when CPU encoding */
  cpuEncodeThreads: number;
  /** Max threads available for Muse Video orchestration (future) */
  museMaxThreads: number;
}

const IS_WINDOWS = process.platform === 'win32';

// Priority-ordered encoder probes
const ENCODER_CHAIN: { id: string; label: string; hardware: boolean }[] = [
  { id: 'h264_nvenc',  label: 'NVIDIA NVENC',    hardware: true },
  { id: 'h264_qsv',   label: 'Intel QuickSync',  hardware: true },
  { id: 'h264_amf',   label: 'AMD AMF',           hardware: true },
  { id: 'libx264',    label: 'x264 (Software)',    hardware: false },
];

// ── System Profiling ────────────────────────────────────────────

/**
 * Count physical CPU cores (excludes hyperthreads).
 * Falls back to logical / 2 if platform detection fails.
 */
function getPhysicalCores(): number {
  const logical = os.cpus().length;

  try {
    if (process.platform === 'win32') {
      // WMIC returns physical core count per socket
      const output = execSync(
        'wmic cpu get NumberOfCores /value',
        { stdio: 'pipe', timeout: 5000 }
      ).toString();
      const match = output.match(/NumberOfCores=(\d+)/);
      if (match) return parseInt(match[1]);
    } else if (process.platform === 'linux') {
      const output = execSync(
        'lscpu -p=Core,Socket | grep -v "^#" | sort -u | wc -l',
        { stdio: 'pipe', timeout: 5000 }
      ).toString().trim();
      const cores = parseInt(output);
      if (cores > 0) return cores;
    } else if (process.platform === 'darwin') {
      const output = execSync(
        'sysctl -n hw.physicalcpu',
        { stdio: 'pipe', timeout: 5000 }
      ).toString().trim();
      const cores = parseInt(output);
      if (cores > 0) return cores;
    }
  } catch {
    // Fall through to estimate
  }

  // Conservative estimate: logical / 2 (assumes hyperthreading)
  return Math.max(1, Math.floor(logical / 2));
}

/**
 * Get NVIDIA VRAM in GB via nvidia-smi
 */
function getNvidiaVram(): number | null {
  try {
    const output = execSync(
      'nvidia-smi --query-gpu=memory.total --format=csv,noheader,nounits',
      { stdio: 'pipe', timeout: 5000 }
    ).toString().trim();
    const mb = parseInt(output.split('\n')[0]);
    return mb > 0 ? Math.round(mb / 1024 * 10) / 10 : null;
  } catch {
    return null;
  }
}

/**
 * Profile the system and compute thread budgets for each encode context.
 */
export function profileSystem(): SystemProfile {
  const logicalCores = os.cpus().length;
  const physicalCores = getPhysicalCores();
  const totalMemoryGB = Math.round(os.totalmem() / (1024 ** 3) * 10) / 10;
  const vramGB = getNvidiaVram();

  // ── Thread budget calculations ──────────────────────────────
  //
  // GPU encode (NVENC/QSV/AMF):
  //   The GPU does the heavy lifting. FFmpeg only needs threads for
  //   rawvideo RGBA → YUV420p conversion. 2-4 threads is plenty;
  //   more wastes CPU cycles the browser/engine could use.
  //
  // CPU encode (libx264):
  //   x264 is CPU-bound. Allocate ~60% of logical cores.
  //   Leave 40% headroom for: OS, browser render loop, audio engine,
  //   and the Node sidecar itself.
  //
  // Muse Video (future):
  //   Multi-model orchestration (Wan 2.2, CogVideoX, LTX).
  //   These are GPU-bound but need CPU threads for data loading,
  //   preprocessing, and frame extraction. Expose ~80% of logical
  //   cores as the budget; the orchestrator partitions them.

  const gpuEncodeThreads = Math.min(4, Math.max(2, Math.floor(logicalCores / 4)));

  const cpuEncodeThreads = Math.max(2, Math.floor(logicalCores * 0.6));

  const museMaxThreads = Math.max(4, Math.floor(logicalCores * 0.8));

  return {
    logicalCores,
    physicalCores,
    totalMemoryGB,
    vramGB,
    platform: `${process.platform} ${os.arch()}`,
    gpuEncodeThreads,
    cpuEncodeThreads,
    museMaxThreads,
  };
}

// ── FFmpeg Detection ────────────────────────────────────────────

/**
 * Resolve the ffmpeg executable. Task #51: the Rust launcher probes for
 * ffmpeg (bundled / winget / PATH / download) and passes the resolved
 * absolute path via FFMPEG_PATH. If unset (dev tests, legacy path),
 * fall back to bare `ffmpeg` on PATH.
 *
 * Returns a shell-safe quoted form for command-string callers and the
 * raw path for argv-form callers.
 */
function ffmpegBin(): string {
  return process.env.FFMPEG_PATH || 'ffmpeg';
}

function ffmpegBinQuoted(): string {
  const p = ffmpegBin();
  // Quote if path contains whitespace (Windows user dirs like
  // "C:\Users\MAG MSI\...") or punctuation that cmd.exe would split on.
  return /\s/.test(p) ? `"${p}"` : p;
}

function ffmpegAvailable(): boolean {
  try {
    execSync(`${ffmpegBinQuoted()} -version`, { stdio: 'pipe', timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

function getAvailableEncoders(): string[] {
  try {
    const output = execSync(`${ffmpegBinQuoted()} -hide_banner -encoders`, {
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 5000,
    }).toString();
    return output.split('\n')
      .filter(line => line.trim().startsWith('V'))
      .map(line => {
        const parts = line.trim().split(/\s+/);
        return parts[1] || '';
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

function getNvidiaGpuName(): string | null {
  try {
    const output = execSync(
      'nvidia-smi --query-gpu=name --format=csv,noheader,nounits',
      { stdio: 'pipe', timeout: 5000 }
    ).toString().trim();
    return output.split('\n')[0] || null;
  } catch {
    return null;
  }
}

/**
 * Validate an encoder by running a tiny test encode.
 * Uses a real temp file (Windows compatibility) and 256x256 minimum
 * (Blackwell NVENC rejects anything below ~128x128).
 */
function testEncoder(encoder: string): boolean {
  const tempOut = path.join(os.tmpdir(), `s3-encoder-test-${encoder}.mp4`);

  try {
    try { fs.unlinkSync(tempOut); } catch { /* ignore */ }

    const gpuFlag = encoder.includes('nvenc') ? '-gpu 0' : '';
    const cmd = `${ffmpegBinQuoted()} -y -hide_banner -loglevel error -f lavfi -i color=black:s=256x256:d=0.1:rate=30 -frames:v 3 -c:v ${encoder} ${gpuFlag} "${tempOut}"`;

    console.log(`[S³ Detect] Test: ${cmd}`);

    execSync(cmd, {
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 15000,
      shell: IS_WINDOWS ? 'cmd.exe' : '/bin/sh',
    });

    if (fs.existsSync(tempOut)) {
      const stats = fs.statSync(tempOut);
      console.log(`[S³ Detect] ${encoder}: test output ${stats.size} bytes`);
      fs.unlinkSync(tempOut);
      return stats.size > 0;
    }
    return false;
  } catch (err: unknown) {
    try { fs.unlinkSync(tempOut); } catch { /* ignore */ }

    if (err && typeof err === 'object') {
      const errObj = err as Record<string, unknown>;
      if ('stderr' in errObj && errObj.stderr) {
        const stderr = errObj.stderr.toString().trim();
        if (stderr) console.log(`[S³ Detect] ${encoder} stderr: ${stderr}`);
      }
      if ('message' in errObj && errObj.message) {
        console.log(`[S³ Detect] ${encoder} error: ${String(errObj.message).split('\n')[0]}`);
      }
    }
    return false;
  }
}

// ── Public API ──────────────────────────────────────────────────

/**
 * Detect the best available encoder. Walks the priority chain,
 * validates each candidate actually works, returns the first pass.
 */
export function detectEncoder(): EncoderInfo {
  if (!ffmpegAvailable()) {
    throw new Error(
      'FFmpeg is not installed or not in PATH. ' +
      'Install FFmpeg with NVENC support for GPU encoding, ' +
      'or with libx264 for software fallback.'
    );
  }

  const availableEncoders = getAvailableEncoders();
  const gpuName = getNvidiaGpuName();

  console.log(`[S³ Detect] Platform: ${process.platform} (${IS_WINDOWS ? 'Windows' : 'Unix'})`);
  console.log(`[S³ Detect] Encoders in ffmpeg: ${availableEncoders.length}`);
  console.log(`[S³ Detect] NVIDIA GPU: ${gpuName || 'not detected'}`);

  for (const candidate of ENCODER_CHAIN) {
    if (!availableEncoders.includes(candidate.id)) {
      console.log(`[S³ Detect] ${candidate.id}: not in ffmpeg, skipping`);
      continue;
    }

    console.log(`[S³ Detect] ${candidate.id}: found, testing...`);

    if (testEncoder(candidate.id)) {
      console.log(`[S³ Detect] ${candidate.id}: PASSED`);
      return {
        encoder: candidate.id,
        label: candidate.label,
        gpu: candidate.hardware ? gpuName : null,
        hardware: candidate.hardware,
      };
    } else {
      console.log(`[S³ Detect] ${candidate.id}: FAILED, next`);
    }
  }

  throw new Error(
    'No working H.264 encoder found. ' +
    'Ensure FFmpeg is built with at least libx264 support.'
  );
}

/**
 * Get all available encoders (for /capabilities endpoint)
 */
export function getAllEncoders(): { id: string; label: string; available: boolean; working: boolean }[] {
  const availableEncoders = getAvailableEncoders();

  return ENCODER_CHAIN.map(candidate => {
    const available = availableEncoders.includes(candidate.id);
    return {
      id: candidate.id,
      label: candidate.label,
      available,
      working: available ? testEncoder(candidate.id) : false,
    };
  });
}
