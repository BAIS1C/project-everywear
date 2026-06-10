/**
 * S³ Video Encoder Sidecar
 *
 * Local-only WebSocket server that receives raw RGBA frames from the
 * browser, pipes them to FFmpeg with GPU-accelerated encoding (NVENC,
 * QSV, AMF) or CPU fallback (libx264), and serves the final MP4.
 *
 * Port: 9877 (localhost only, never exposed to network)
 *
 * Protocol:
 *   1. Browser connects to ws://127.0.0.1:9877/encode
 *   2. Sends JSON: { type: 'init', fps, width, height, totalFrames, format: 'raw' }
 *   3. Sends JSON: { type: 'audio', data: '<base64 mp3>' }  (chunked)
 *   4. Sends JSON: { type: 'start', fps, width, height }
 *   5. Sends binary: raw RGBA frame data (width*height*4 bytes per frame)
 *   6. Sends JSON: { type: 'end' }
 *   7. Receives JSON: { type: 'complete', downloadUrl: '/download/{id}' }
 */

import express from 'express';
import cors from 'cors';
import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { detectEncoder, profileSystem, type EncoderInfo, type SystemProfile } from './detect-gpu.js';
import {
  createSession, writeAudio, startEncode, writeFrame,
  finishFrames, getSession, cleanupAll, setSystemProfile,
} from './encoder.js';
import { createHealthRouter } from './routes/health.js';
import { createDownloadRouter } from './routes/download.js';

const PORT = 9877;
const HOST = '127.0.0.1';

// ── Startup ─────────────────────────────────────────────────────

console.log('');
console.log('  ╔══════════════════════════════════════════╗');
console.log('  ║   S³ VIDEO ENCODER                       ║');
console.log('  ║   Local GPU-accelerated video encoding    ║');
console.log('  ╚══════════════════════════════════════════╝');
console.log('');

// Profile system first
console.log('[S³ Startup] Profiling system...');
const systemProfile: SystemProfile = profileSystem();

console.log(`[S³ Startup] CPU: ${systemProfile.logicalCores} logical / ${systemProfile.physicalCores} physical cores`);
console.log(`[S³ Startup] RAM: ${systemProfile.totalMemoryGB} GB`);
if (systemProfile.vramGB) {
  console.log(`[S³ Startup] VRAM: ${systemProfile.vramGB} GB`);
}
console.log(`[S³ Startup] Thread budgets: GPU encode=${systemProfile.gpuEncodeThreads}, CPU encode=${systemProfile.cpuEncodeThreads}, Muse max=${systemProfile.museMaxThreads}`);
console.log('');

// Inject profile into encoder
setSystemProfile(systemProfile);

// Detect encoder
console.log('[S³ Startup] Detecting encoders...');

let encoderInfo: EncoderInfo;

try {
  encoderInfo = detectEncoder();
  console.log('');
  console.log(`  Encoder:  ${encoderInfo.label} (${encoderInfo.encoder})`);
  if (encoderInfo.gpu) {
    console.log(`  GPU:      ${encoderInfo.gpu}`);
  }
  console.log(`  Hardware: ${encoderInfo.hardware ? 'YES' : 'NO (software fallback)'}`);
  console.log(`  Threads:  ${encoderInfo.hardware ? systemProfile.gpuEncodeThreads : systemProfile.cpuEncodeThreads}`);
  console.log('');
} catch (err: unknown) {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`[S³ Startup] FATAL: ${msg}`);
  console.error('[S³ Startup] Cannot start. Exiting.');
  process.exit(1);
}

// ── Express App ─────────────────────────────────────────────────

const app = express();

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || origin.includes('localhost') || origin.includes('127.0.0.1')) {
      callback(null, true);
    } else if (/^https:\/\/(.*\.)?s3studio\.xyz$/.test(origin || '')) {
      callback(null, true);
    } else if (/^https:\/\/(.*\.)?strandsnation\.(xyz|vercel\.app)$/.test(origin || '')) {
      callback(null, true);
    } else {
      callback(new Error('Localhost only'));
    }
  },
}));

app.use(express.json());
app.use(createHealthRouter(encoderInfo, systemProfile));
app.use(createDownloadRouter());

// ── HTTP + WebSocket ────────────────────────────────────────────

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/encode' });

wss.on('connection', (ws: WebSocket) => {
  console.log('[S³ WS] New connection');

  let sessionId: string | null = null;

  ws.on('message', (data: Buffer | string, isBinary: boolean) => {
    // Text messages: JSON commands
    if (!isBinary && typeof data !== 'object') {
      try {
        const msg = JSON.parse(data.toString());
        handleJsonMessage(ws, msg);
      } catch {
        ws.send(JSON.stringify({ type: 'error', message: 'Invalid JSON' }));
      }
      return;
    }

    // Buffer: might be text or binary
    if (Buffer.isBuffer(data)) {
      const str = data.toString('utf8', 0, Math.min(data.length, 20));
      if (str.startsWith('{') || str.startsWith('[')) {
        try {
          const msg = JSON.parse(data.toString());
          handleJsonMessage(ws, msg);
          return;
        } catch {
          // Not JSON, treat as binary
        }
      }

      // Binary frame data
      if (sessionId) {
        const backpressure = !writeFrame(sessionId, data);
        if (backpressure) {
          ws.send(JSON.stringify({ type: 'backpressure', slow: true }));
        }
      }
    }
  });

  function handleJsonMessage(ws: WebSocket, msg: Record<string, unknown>) {
    switch (msg.type) {
      case 'init': {
        const fps = (msg.fps as number) || 30;
        const width = (msg.width as number) || 1920;
        const height = (msg.height as number) || 1080;
        const totalFrames = (msg.totalFrames as number) || 0;
        const frameFormat = ((msg.format as string) === 'raw' ? 'raw' : 'jpeg') as import('./encoder.js').FrameFormat;

        const session = createSession(encoderInfo.encoder, totalFrames, frameFormat);
        sessionId = session.id;

        console.log(`[S³ WS] Session ${sessionId.slice(0, 8)}: ${width}x${height}@${fps}fps, ~${totalFrames} frames, ${frameFormat}, ${encoderInfo.encoder}`);

        ws.send(JSON.stringify({
          type: 'session',
          sessionId: session.id,
          encoder: encoderInfo.encoder,
          label: encoderInfo.label,
          hardware: encoderInfo.hardware,
          threads: encoderInfo.hardware
            ? systemProfile.gpuEncodeThreads
            : systemProfile.cpuEncodeThreads,
        }));
        break;
      }

      case 'audio': {
        if (sessionId && msg.data) {
          const audioBuffer = Buffer.from(msg.data as string, 'base64');
          writeAudio(sessionId, audioBuffer);
          ws.send(JSON.stringify({ type: 'audio_received' }));
        }
        break;
      }

      case 'start': {
        if (!sessionId) {
          ws.send(JSON.stringify({ type: 'error', message: 'No session initialized' }));
          return;
        }

        const fps = (msg.fps as number) || 30;
        const width = (msg.width as number) || 1920;
        const height = (msg.height as number) || 1080;

        startEncode(sessionId, fps, width, height, (progress) => {
          ws.send(JSON.stringify({ type: 'progress', stage: 'encoding', progress }));
        });

        ws.send(JSON.stringify({ type: 'ready', message: 'Send frames now' }));
        break;
      }

      case 'end': {
        if (sessionId) {
          finishFrames(sessionId);
          ws.send(JSON.stringify({ type: 'finalizing' }));

          const checkInterval = setInterval(() => {
            if (!sessionId) { clearInterval(checkInterval); return; }
            const session = getSession(sessionId);
            if (!session) { clearInterval(checkInterval); return; }

            if (session.stage === 'complete') {
              clearInterval(checkInterval);
              const elapsed = ((Date.now() - session.startTime) / 1000).toFixed(1);
              ws.send(JSON.stringify({
                type: 'complete',
                sessionId: session.id,
                downloadUrl: `/download/${session.id}`,
                elapsed: parseFloat(elapsed),
                framesEncoded: session.framesReceived,
              }));
            } else if (session.stage === 'error') {
              clearInterval(checkInterval);
              ws.send(JSON.stringify({
                type: 'error',
                message: session.error || 'Encoding failed',
              }));
            }
          }, 250);
        }
        break;
      }

      default:
        ws.send(JSON.stringify({ type: 'error', message: `Unknown: ${msg.type}` }));
    }
  }

  ws.on('close', () => {
    console.log(`[S³ WS] Closed${sessionId ? ` (${sessionId.slice(0, 8)})` : ''}`);
  });

  ws.on('error', (err) => {
    console.error('[S³ WS] Error:', err);
  });
});

// ── Start ───────────────────────────────────────────────────────

server.listen(PORT, HOST, () => {
  console.log(`[S³ Server] http://${HOST}:${PORT}`);
  console.log(`[S³ Server] ${encoderInfo.label} (${encoderInfo.encoder})`);
  if (encoderInfo.gpu) {
    console.log(`[S³ Server] ${encoderInfo.gpu}`);
  }
  console.log('');
});

// ── Shutdown ────────────────────────────────────────────────────

function shutdown() {
  console.log('\n[S³ Shutdown] Cleaning up...');
  cleanupAll();
  server.close();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
