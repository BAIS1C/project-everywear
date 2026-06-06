// Deprecated duplicate retained until a shell-launched video export parity smoke
// proves the package worker path end-to-end. The live modal imports
// packages/video-modal/src/workers/videoRenderWorker.ts through
// @everywear/video-modal.
// @ts-nocheck
/* eslint-disable no-restricted-globals */
import { drawS3Hero, drawDJAtWork } from '../lib/silhouetteEngine';
import { parseLrc, getCurrentLine, type LrcLine } from '../lib/lrcParser';

// Worker global scope — typed as 'any' to avoid DOM/WebWorker lib conflicts
const workerSelf = self as unknown as {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  onmessage: ((e: MessageEvent) => void) | null;
};

/**
 * videoRenderWorker — OffscreenCanvas render pipeline for S3 Vid.
 *
 * Runs entirely off the main thread. Receives render config + pre-analyzed
 * FFT data, renders each frame to an OffscreenCanvas, compresses to JPEG
 * (~50KB vs ~2MB raw RGBA), and posts buffers back to main thread for
 * WebSocket transport to the sidecar's image2pipe FFmpeg input.
 *
 * Messages IN:
 *   { type: 'init', width, height, fps, totalFrames, config, effects, intensities, texts, showWatermark, frequencyData, bgImageData? }
 *   { type: 'start' }
 *   { type: 'pause' }   — backpressure signal from main thread
 *   { type: 'resume' }  — backpressure cleared
 *   { type: 'abort' }
 *
 * Messages OUT:
 *   { type: 'frame_blob', buffer: ArrayBuffer, frameIndex: number }  (JPEG as ArrayBuffer, Transferable)
 *   { type: 'progress', frameIndex: number, totalFrames: number }
 *   { type: 'done' }
 *   { type: 'error', message: string }
 */

// ─── Types ──────────────────────────────────────────────────────────

interface RenderConfig {
  preset: string;
  primaryColor: string;
  secondaryColor: string;
  bgDim: number;
  particleCount: number;
  showVoidImage?: boolean;
  particleScale?: number;
  particleOffsetX?: number;
  particleOffsetY?: number;
}

interface TextLayer {
  id: string;
  text: string;
  x: number;
  y: number;
  size: number;
  color: string;
  font: string;
  visible?: boolean;
  vertical?: boolean;
  background?: string;
}

interface EffectsMap {
  scanlines: boolean;
  cctv: boolean;
  pixelate: boolean;
  letterbox: boolean;
  bloom: boolean;
  filmGrain: boolean;
  aberration: boolean;
  vignette: boolean;
  hueShift: boolean;
  strobe: boolean;
}

interface IntensitiesMap {
  [key: string]: number;
  scanlines: number;
  pixelate: number;
  letterbox: number;
  bloom: number;
  filmGrain: number;
  aberration: number;
  vignette: number;
  hueShift: number;
  strobe: number;
}

// ─── State ──────────────────────────────────────────────────────────

let canvas: OffscreenCanvas | null = null;
let ctx: OffscreenCanvasRenderingContext2D | null = null;
let paused = false;
let aborted = false;

// Strands Particle state (persistent across frames)
let strandsParticleState: {
  px: Float32Array; py: Float32Array;
  pr: Float32Array; pg: Float32Array; pb: Float32Array;
  baseSize: Float32Array; speed: Float32Array;
  phase: number; phaseProgress: number; phaseAccum: number;
  lastBassHit: number; initialised: boolean;
} | null = null;

// ─── Silhouette Particle Engine (S3 Hero, DJ At Work) ────────────────
// Extracted to lib/silhouetteEngine.ts on 2026-04-26 SGT. Imported at
// top of file. Shared with the live preview path in
// components/VideoGeneratorModal.tsx so preview matches render-to-file.

// ─── Strands Logo Data ──────────────────────────────────────────────

const STRANDS_LOGO_RAW: [number, number][] = [
  [0.0261,-0.4899],[0.0442,-0.4655],[0.0562,-0.4422],[0.0837,-0.4269],[0.1111,-0.4114],
  [0.1384,-0.3958],[0.1657,-0.3801],[0.1931,-0.3646],[0.2206,-0.3492],[0.2472,-0.3483],
  [0.277,-0.354],[0.304,-0.3409],[0.3169,-0.3133],[0.311,-0.283],[0.2865,-0.2639],
  [0.2553,-0.2632],[0.2317,-0.2832],[0.2258,-0.3128],[0.2095,-0.3343],[0.1818,-0.3493],
  [0.1546,-0.365],[0.1271,-0.3804],[0.0997,-0.3959],[0.0724,-0.4116],[0.0451,-0.4272],
  [0.0226,-0.4099],[-0.0078,-0.4066],[-0.0294,-0.3981],[-0.0478,-0.3726],[-0.0662,-0.347],
  [-0.0846,-0.3215],[-0.1029,-0.2959],[-0.1207,-0.2699],[-0.1395,-0.2446],[-0.1291,-0.2262],
  [-0.1019,-0.2103],[-0.0747,-0.1945],[-0.0477,-0.1783],[-0.0203,-0.1627],[0.007,-0.1471],
  [0.034,-0.1309],[0.061,-0.1147],[0.0881,-0.0987],[0.1151,-0.0825],[0.1419,-0.066],
  [0.1687,-0.0495],[0.1955,-0.033],[0.2223,-0.0164],[0.2507,-0.0082],[0.281,-0.0129],
  [0.3079,0.0014],[0.3192,0.0294],[0.3109,0.0583],[0.2856,0.0753],[0.2791,0.1008],
  [0.2794,0.1322],[0.2798,0.1637],[0.2802,0.1952],[0.2805,0.2267],[0.2804,0.2582],
  [0.3078,0.2698],[0.3219,0.2973],[0.3167,0.3281],[0.2923,0.347],[0.2621,0.3492],
  [0.2358,0.3362],[0.2078,0.3505],[0.1802,0.3658],[0.1527,0.381],[0.1249,0.3958],
  [0.0971,0.4107],[0.0695,0.4256],[0.0415,0.4399],[0.0409,0.4686],[0.0231,0.4934],
  [-0.0068,0.5],[-0.0339,0.4877],[-0.0486,0.461],[-0.0592,0.4358],[-0.0865,0.4201],
  [-0.1142,0.4051],[-0.1418,0.3899],[-0.1691,0.3743],[-0.1966,0.359],[-0.2236,0.3428],
  [-0.2494,0.3454],[-0.2792,0.3509],[-0.306,0.337],[-0.3204,0.3096],[-0.3128,0.2793],
  [-0.2879,0.2608],[-0.2574,0.2616],[-0.2334,0.2805],[-0.2271,0.3106],[-0.21,0.3311],
  [-0.1822,0.346],[-0.155,0.3618],[-0.1275,0.3771],[-0.0999,0.3922],[-0.0725,0.4077],
  [-0.0451,0.4233],[-0.0193,0.4092],[0.0068,0.3962],[0.0249,0.3704],[0.0429,0.3446],
  [0.0609,0.3187],[0.079,0.293],[0.0971,0.2673],[0.1152,0.2415],[0.1325,0.2152],
  [0.1065,0.1998],[0.0794,0.1837],[0.0523,0.1677],[0.0253,0.1516],[-0.0016,0.1351],
  [-0.0284,0.1186],[-0.0552,0.1022],[-0.0823,0.0861],[-0.1097,0.0707],[-0.137,0.055],
  [-0.1641,0.0389],[-0.1913,0.0231],[-0.2185,0.0073],[-0.2451,-0.0067],[-0.274,0.0025],
  [-0.3029,-0.0076],[-0.3187,-0.0344],[-0.316,-0.0643],[-0.2943,-0.0861],[-0.2842,-0.1075],
  [-0.2842,-0.1389],[-0.2842,-0.1704],[-0.2842,-0.2019],[-0.2841,-0.2334],[-0.2854,-0.2639],
  [-0.3112,-0.2795],[-0.3219,-0.3084],[-0.3114,-0.3376],[-0.2844,-0.3533],[-0.2542,-0.3495],
  [-0.2275,-0.3455],[-0.2003,-0.3612],[-0.1729,-0.3768],[-0.1455,-0.3922],[-0.1181,-0.4077],
  [-0.0906,-0.4231],[-0.0629,-0.4381],[-0.0429,-0.4588],[-0.0297,-0.4854],[-0.0031,-0.5],
  [0.0525,-0.1016],[0.088,-0.0796],[0.1233,-0.0574],[0.1591,-0.036],[0.1944,-0.0138],
  [0.2303,0.0075],[0.2103,0.0318],[0.1697,0.0416],[0.1289,0.0504],[0.0884,0.0604],
  [0.0478,0.0701],[0.0071,0.0791],[-0.0334,0.0891],[-0.0702,0.0737],[-0.1061,0.0524],
  [-0.1423,0.0316],[-0.1785,0.0108],[-0.2144,-0.0104],[-0.2286,-0.0421],[-0.1893,-0.0542],
  [-0.1486,-0.0635],[-0.1083,-0.0741],[-0.0678,-0.0842],[-0.0273,-0.0944],[0.0132,-0.104],
  [-0.1569,-0.2216],[-0.1341,-0.2086],[-0.1115,-0.1952],[-0.0885,-0.1823],[-0.0657,-0.1692],
  [-0.0427,-0.1562],[-0.0196,-0.1435],[0.0034,-0.1308],[0.0108,-0.1178],[-0.0148,-0.1116],
  [-0.0405,-0.1058],[-0.066,-0.0993],[-0.0917,-0.0933],[-0.1174,-0.0873],[-0.1429,-0.0809],
  [-0.1685,-0.0746],[-0.1941,-0.0682],[-0.2197,-0.062],[-0.2393,-0.0725],[-0.2483,-0.0927],
  [-0.2333,-0.1143],[-0.2176,-0.1355],[-0.2025,-0.1571],[-0.1873,-0.1786],[-0.1718,-0.1999],
  [0.2292,0.042],[0.2415,0.0643],[0.2281,0.0863],[0.2127,0.1072],[0.1974,0.1281],
  [0.1828,0.1494],[0.1671,0.1701],[0.1524,0.1914],[0.1333,0.1961],[0.1112,0.1826],
  [0.089,0.1691],[0.0668,0.1558],[0.0444,0.1427],[0.022,0.1296],[-0.0003,0.1165],
  [-0.0214,0.1017],[0.0021,0.0946],[0.0273,0.0887],[0.0526,0.0829],[0.0779,0.0771],
  [0.1031,0.0713],[0.1283,0.0652],[0.1535,0.0592],[0.1787,0.0533],[0.2041,0.0479],
  [0.1486,0.225],[0.1707,0.2364],[0.1921,0.2493],[0.2132,0.2624],[0.2348,0.275],
  [0.2291,0.2972],[0.2286,0.3208],[0.2067,0.3328],[0.1847,0.3445],[0.1626,0.356],
  [0.1407,0.3681],[0.1188,0.38],[0.0969,0.3918],[0.075,0.4039],[0.0532,0.416],
  [0.0312,0.4256],[0.0188,0.4081],[0.033,0.3877],[0.0474,0.3674],[0.0618,0.347],
  [0.0762,0.3266],[0.0906,0.3062],[0.1052,0.286],[0.1196,0.2656],[0.134,0.2453],
  [-0.0391,-0.4309],[-0.0416,-0.4106],[-0.0553,-0.3923],[-0.0685,-0.3738],[-0.0816,-0.355],
  [-0.0945,-0.3362],[-0.1077,-0.3177],[-0.1213,-0.2993],[-0.1347,-0.2809],[-0.1476,-0.2621],
  [-0.1618,-0.2449],[-0.1816,-0.2562],[-0.201,-0.2682],[-0.2204,-0.2802],[-0.2319,-0.2954],
  [-0.2316,-0.3178],[-0.2185,-0.332],[-0.1986,-0.3431],[-0.1788,-0.3545],[-0.1591,-0.366],
  [-0.1391,-0.377],[-0.119,-0.3878],[-0.099,-0.3988],[-0.0791,-0.4098],[-0.0591,-0.4208],
  [0.2556,0.073],[0.2633,0.0847],[0.2633,0.104],[0.2633,0.1234],[0.2633,0.1428],
  [0.2633,0.1621],[0.2633,0.1815],[0.2633,0.2009],[0.2633,0.2203],[0.2633,0.2396],
  [0.2633,0.259],[0.247,0.2646],[0.2301,0.2552],[0.2136,0.245],[0.1971,0.2348],
  [0.1807,0.2246],[0.1643,0.2143],[0.1652,0.1989],[0.1762,0.1829],[0.1873,0.1671],
  [0.1989,0.1516],[0.2105,0.1361],[0.2217,0.1202],[0.233,0.1045],[0.2445,0.0889],
  [-0.2438,-0.2743],[-0.2279,-0.2666],[-0.2126,-0.2575],[-0.1974,-0.2483],[-0.1821,-0.2392],
  [-0.1724,-0.2265],[-0.1825,-0.2122],[-0.1931,-0.1979],[-0.2034,-0.1834],[-0.2136,-0.1687],
  [-0.2237,-0.1541],[-0.2339,-0.1395],[-0.2443,-0.1251],[-0.2548,-0.1107],[-0.2653,-0.0963],
  [-0.2673,-0.1119],[-0.2677,-0.1297],[-0.268,-0.1475],[-0.2683,-0.1653],[-0.2686,-0.1831],
  [-0.2687,-0.2009],[-0.2688,-0.2187],[-0.2687,-0.2365],[-0.2686,-0.2543],[-0.2591,-0.2657],
];

const STRANDS_GRADIENT = ['#13F8FD','#29CEFD','#44ADFB','#628BF9','#8E6BFC','#B550FF','#DA34F2','#EA32FD'];

// ─── Draw Functions (extracted from VideoGeneratorModal) ────────────

function drawNCSCircle(ctx: OffscreenCanvasRenderingContext2D, cx: number, cy: number, data: Uint8Array, pulse: number, time: number, c1: string, c2: string) {
  const radius = 150 + (pulse - 1) * 50;
  const bars = 80;
  const step = (Math.PI * 2) / bars;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(time * 0.15);
  for (let i = 0; i < bars; i++) {
    const val = data[i + 10];
    const normalized = val / 255;
    const h = 8 + Math.pow(normalized, 1.5) * 120;
    ctx.save();
    ctx.rotate(i * step);
    const grad = ctx.createLinearGradient(0, radius, 0, radius + h);
    grad.addColorStop(0, c1);
    grad.addColorStop(1, c2);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.roundRect(-3, radius + 10, 6, h, 3);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.15)';
    ctx.beginPath();
    ctx.roundRect(-3, radius + 10 + h + 2, 6, 3, 2);
    ctx.fill();
    ctx.restore();
  }
  ctx.beginPath();
  ctx.arc(0, 0, radius + 150, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();
}

function drawLinearBars(ctx: OffscreenCanvasRenderingContext2D, w: number, h: number, data: Uint8Array, c1: string, c2: string) {
  const bars = 64;
  const barW = w / bars;
  const gap = 2;
  for (let i = 0; i < bars; i++) {
    const val = data[i * 2];
    const normalized = val / 255;
    const barH = 10 + Math.pow(normalized, 1.3) * (h * 0.35);
    const grad = ctx.createLinearGradient(0, h / 2, 0, h / 2 - barH);
    grad.addColorStop(0, c1);
    grad.addColorStop(1, c2);
    ctx.fillStyle = grad;
    ctx.fillRect(i * barW + gap / 2, h / 2 - barH, barW - gap, barH);
    ctx.fillStyle = 'rgba(255,255,255,0.2)';
    ctx.fillRect(i * barW + gap / 2, h / 2, barW - gap, barH * 0.3);
  }
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.fillRect(0, h / 2, w, 1);
}

function drawDualMirror(ctx: OffscreenCanvasRenderingContext2D, w: number, h: number, data: Uint8Array, color: string) {
  const bars = 40;
  const barH = h / bars;
  const cy = h / 2;
  for (let i = 0; i < bars; i++) {
    const val = data[i * 3];
    const normalized = val / 255;
    const len = 20 + Math.pow(normalized, 1.4) * (w * 0.3);
    const alpha = 0.4 + normalized * 0.6;
    ctx.fillStyle = color;
    ctx.globalAlpha = alpha;
    ctx.fillRect(0, cy - (i * barH), len, barH - 2);
    ctx.fillRect(0, cy + (i * barH), len, barH - 2);
    ctx.fillRect(w - len, cy - (i * barH), len, barH - 2);
    ctx.fillRect(w - len, cy + (i * barH), len, barH - 2);
  }
  ctx.globalAlpha = 1;
}

function drawOrbital(ctx: OffscreenCanvasRenderingContext2D, cx: number, cy: number, data: Uint8Array, time: number, c1: string, c2: string) {
  for (let i = 0; i < 5; i++) {
    const r = 100 + (i * 55);
    const val = data[i * 10];
    const normalized = val / 255;
    const w = 4 + normalized * 6;
    ctx.beginPath();
    ctx.strokeStyle = i % 2 === 0 ? c1 : c2;
    ctx.lineWidth = w;
    ctx.shadowBlur = 20;
    ctx.shadowColor = ctx.strokeStyle;
    const direction = i % 2 === 0 ? 1 : -1;
    const speed = direction * (0.5 + i * 0.1);
    const start = time * speed;
    const arcLength = Math.PI * 1.2 + normalized * Math.PI * 0.3;
    ctx.arc(cx, cy, r, start, start + arcLength);
    ctx.stroke();
  }
  ctx.shadowBlur = 0;
}

function drawHexagon(ctx: OffscreenCanvasRenderingContext2D, cx: number, cy: number, data: Uint8Array, pulse: number, time: number, color: string) {
  const sides = 6;
  const r = 180 * pulse;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(time * 0.4);
  ctx.beginPath();
  ctx.lineWidth = 12;
  ctx.strokeStyle = color;
  ctx.lineJoin = 'round';
  ctx.shadowBlur = 25;
  ctx.shadowColor = color;
  for (let i = 0; i <= sides; i++) {
    const angle = i * 2 * Math.PI / sides;
    const x = r * Math.cos(angle);
    const y = r * Math.sin(angle);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
  ctx.restore();
  ctx.shadowBlur = 0;
}

function drawOscilloscope(ctx: OffscreenCanvasRenderingContext2D, w: number, h: number, data: Uint8Array, color: string) {
  ctx.lineWidth = 3;
  ctx.strokeStyle = color;
  ctx.shadowBlur = 15;
  ctx.shadowColor = color;
  ctx.beginPath();
  const sliceWidth = w / data.length;
  let x = 0;
  for (let i = 0; i < data.length; i++) {
    const normalized = (data[i] - 128) / 128.0;
    const dampened = normalized * 0.6;
    const yPos = (h / 2) + (dampened * h / 2);
    if (i === 0) ctx.moveTo(x, yPos);
    else ctx.lineTo(x, yPos);
    x += sliceWidth;
  }
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,0.1)';
  ctx.shadowBlur = 0;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, h / 2);
  ctx.lineTo(w, h / 2);
  ctx.stroke();
}

function drawCenterWave(ctx: OffscreenCanvasRenderingContext2D, cx: number, cy: number, data: Uint8Array, time: number, color: string) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.shadowBlur = 8;
  ctx.shadowColor = color;
  for (let i = 0; i < 12; i++) {
    ctx.beginPath();
    const baseR = 60 + (i * 35);
    const val = data[i * 4];
    const normalized = val / 255;
    const r = baseR + Math.pow(normalized, 1.5) * 25;
    ctx.globalAlpha = 0.8 - (i / 15);
    ctx.ellipse(cx, cy, r, r * 0.75, time * 0.5 + i * 0.3, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  ctx.shadowBlur = 0;
}

function drawDigitalRain(ctx: OffscreenCanvasRenderingContext2D, w: number, h: number, data: Uint8Array, time: number, color: string) {
  const cols = 50;
  const colW = w / cols;
  ctx.fillStyle = color;
  ctx.font = 'bold 14px monospace';
  ctx.shadowBlur = 8;
  ctx.shadowColor = color;
  for (let i = 0; i < cols; i++) {
    const val = data[i * 2];
    const normalized = val / 255;
    const len = 8 + Math.floor(Math.pow(normalized, 1.3) * 15);
    const baseSpeed = 40 + (i % 5) * 10;
    const speedOffset = (time * baseSpeed) % h;
    for (let j = 0; j < len; j++) {
      const char = String.fromCharCode(0x30A0 + Math.floor(Math.random() * 96));
      const y = (speedOffset + (j * 18)) % h;
      ctx.globalAlpha = (1 - (j / len)) * 0.8;
      ctx.fillText(char, i * colW, y);
    }
  }
  ctx.globalAlpha = 1;
  ctx.shadowBlur = 0;
}

function drawShockwave(ctx: OffscreenCanvasRenderingContext2D, cx: number, cy: number, bass: number, time: number, color: string) {
  const normBass = bass / 255;
  const maxRadius = 500;
  const rings = 6;
  ctx.shadowColor = color;
  for (let i = 0; i < rings; i++) {
    const phase = (time * 0.8 + (i * 0.4)) % 2;
    const progress = phase / 2;
    const radius = 50 + progress * maxRadius;
    const alpha = (1 - progress) * (0.5 + normBass * 0.5);
    const lineWidth = (1 - progress) * (8 + normBass * 12);
    if (alpha > 0.05) {
      ctx.beginPath();
      ctx.strokeStyle = color;
      ctx.lineWidth = lineWidth;
      ctx.globalAlpha = alpha;
      ctx.shadowBlur = 20 + normBass * 30;
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  const coreSize = 30 + normBass * 40;
  const coreGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, coreSize);
  coreGrad.addColorStop(0, color);
  coreGrad.addColorStop(0.5, color);
  coreGrad.addColorStop(1, 'transparent');
  ctx.globalAlpha = 0.6 + normBass * 0.4;
  ctx.fillStyle = coreGrad;
  ctx.beginPath();
  ctx.arc(cx, cy, coreSize, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.shadowBlur = 0;
}

function getStrandsGlobePoint(index: number, total: number, time: number) {
  const latLines = 12, lonLines = 20;
  const gridIdx = index % (latLines * lonLines);
  const lat = (Math.floor(gridIdx / lonLines) / (latLines - 1)) * Math.PI - Math.PI / 2;
  const lon = ((gridIdx % lonLines) / lonLines) * Math.PI * 2 + time * 0.001;
  const r = 0.38;
  const x = Math.cos(lat) * Math.sin(lon) * r;
  const y = Math.sin(lat) * r;
  const z = Math.cos(lat) * Math.cos(lon) * r;
  const perspective = 2 / (2 + z);
  const lonSector = Math.floor((((lon % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) / (Math.PI * 2) * 8);
  return { x: x * perspective, y: y * perspective, z, scale: perspective, isPeel: lonSector % 2 === 0 };
}

function drawStrandsParticle(
  ctx: OffscreenCanvasRenderingContext2D,
  cx: number, cy: number,
  w: number, h: number,
  normBass: number,
  time: number,
  deltaTime: number
) {
  const COUNT = 300;
  const dim = Math.min(w, h);

  if (!strandsParticleState || !strandsParticleState.initialised) {
    const state = {
      px: new Float32Array(COUNT), py: new Float32Array(COUNT),
      pr: new Float32Array(COUNT), pg: new Float32Array(COUNT), pb: new Float32Array(COUNT),
      baseSize: new Float32Array(COUNT), speed: new Float32Array(COUNT),
      phase: 0, phaseProgress: 0, phaseAccum: 0,
      lastBassHit: 0, initialised: true,
    };
    for (let i = 0; i < COUNT; i++) {
      const gp = getStrandsGlobePoint(i, COUNT, time * 1000);
      state.px[i] = cx + gp.x * dim;
      state.py[i] = cy + gp.y * dim;
      state.pr[i] = 200; state.pg[i] = 200; state.pb[i] = 200;
      state.baseSize[i] = 1.5 + (i % 10) * 0.15;
      state.speed[i] = 0.5 + (i % 7) * 0.07;
    }
    strandsParticleState = state;
  }

  const S = strandsParticleState;
  const { px, py, pr, pg, pb, baseSize, speed } = S;

  const bassBoost = normBass > 0.55 ? normBass * 2.0 : 0.3;
  S.phaseAccum += deltaTime * (0.5 + bassBoost);
  const phaseDuration = 1.8 - normBass * 0.6;
  if (S.phaseAccum >= phaseDuration) {
    S.phaseAccum = 0;
    S.phase = (S.phase + 1) % 5;
  }
  S.phaseProgress = Math.min(1, S.phaseAccum / phaseDuration);
  const phase = S.phase;
  const elapsed = time * 1000;
  const moveSpeed2 = phase === 0 || phase === 4 ? 0.12 : phase === 1 ? 0.08 + S.phaseProgress * 0.12 : 0.1;

  // Globe wireframe
  if (phase === 0 || phase === 4) {
    const wireOpacity = phase === 0 ? 0.2 : 0.2 * S.phaseProgress;
    if (wireOpacity > 0.01) {
      const r = 0.38 * dim;
      const rotY = elapsed * 0.001;
      ctx.strokeStyle = `rgba(100,100,100,${wireOpacity})`;
      ctx.lineWidth = 0.5;
      for (let lat = -80; lat <= 80; lat += 20) {
        const latR = (lat / 180) * Math.PI;
        ctx.beginPath();
        let started = false;
        for (let lon = 0; lon <= 360; lon += 5) {
          const lonR = (lon / 180) * Math.PI + rotY;
          const z3 = Math.cos(latR) * Math.cos(lonR);
          if (z3 < -0.1) { started = false; continue; }
          const p = 2 / (2 + z3);
          const sx = cx + Math.cos(latR) * Math.sin(lonR) * p * r;
          const sy = cy + Math.sin(latR) * p * r;
          if (!started) { ctx.moveTo(sx, sy); started = true; } else ctx.lineTo(sx, sy);
        }
        ctx.stroke();
      }
      for (let lon = 0; lon < 360; lon += 45) {
        const lonR = (lon / 180) * Math.PI + rotY;
        ctx.beginPath();
        let started = false;
        for (let lat2 = -90; lat2 <= 90; lat2 += 5) {
          const latR = (lat2 / 180) * Math.PI;
          const z3 = Math.cos(latR) * Math.cos(lonR);
          if (z3 < -0.1) { started = false; continue; }
          const p = 2 / (2 + z3);
          const sx = cx + Math.cos(latR) * Math.sin(lonR) * p * r;
          const sy = cy + Math.sin(latR) * p * r;
          if (!started) { ctx.moveTo(sx, sy); started = true; } else ctx.lineTo(sx, sy);
        }
        ctx.stroke();
      }
    }
  }

  // Connection lines
  if (phase >= 1 && phase <= 3) {
    const lineOp = phase === 1 ? S.phaseProgress * 0.08 : 0.08;
    ctx.strokeStyle = `rgba(255,255,255,${lineOp})`;
    ctx.lineWidth = 0.4;
    for (let i = 0; i < COUNT; i += 2) {
      for (let j = i + 3; j < COUNT; j += 3) {
        const ddx = px[i] - px[j], ddy = py[i] - py[j];
        if (ddx * ddx + ddy * ddy < 900) {
          ctx.beginPath(); ctx.moveTo(px[i], py[i]); ctx.lineTo(px[j], py[j]); ctx.stroke();
        }
      }
    }
  }

  // Update and draw particles
  for (let i = 0; i < COUNT; i++) {
    let tx: number, ty: number;
    let trr: number, tgg: number, tbb: number;
    let op: number, sz: number;
    switch (phase) {
      case 0: {
        const gp = getStrandsGlobePoint(i, COUNT, elapsed);
        tx = cx + gp.x * dim; ty = cy + gp.y * dim;
        trr = gp.isPeel ? 200 : 120; tgg = trr; tbb = trr;
        op = (gp.scale * 0.5 + 0.3) * (gp.isPeel ? 0.8 : 0.45);
        sz = baseSize[i] * gp.scale;
        break;
      }
      case 1:
      case 2: {
        const coord = STRANDS_LOGO_RAW[i % STRANDS_LOGO_RAW.length];
        tx = cx + coord[0] * 0.85 * dim;
        ty = cy + coord[1] * 0.85 * dim;
        trr = 248; tgg = 248; tbb = 248;
        op = 0.85; sz = baseSize[i] * 1.2;
        break;
      }
      case 3: {
        const coord2 = STRANDS_LOGO_RAW[i % STRANDS_LOGO_RAW.length];
        tx = cx + coord2[0] * 0.85 * dim;
        ty = cy + coord2[1] * 0.85 * dim;
        const norm = Math.max(0, Math.min(1, (coord2[0] + 0.35) / 0.7));
        const ci = Math.min(STRANDS_GRADIENT.length - 1, Math.floor(norm * STRANDS_GRADIENT.length));
        const hex = STRANDS_GRADIENT[ci];
        trr = parseInt(hex.slice(1, 3), 16);
        tgg = parseInt(hex.slice(3, 5), 16);
        tbb = parseInt(hex.slice(5, 7), 16);
        op = 0.9; sz = baseSize[i] * 1.2;
        sz += normBass * 0.8;
        break;
      }
      case 4: {
        const gp = getStrandsGlobePoint(i, COUNT, elapsed);
        tx = cx + gp.x * dim; ty = cy + gp.y * dim;
        trr = 200; tgg = 200; tbb = 200;
        op = (gp.scale * 0.5 + 0.3) * (gp.isPeel ? 0.8 : 0.45);
        sz = baseSize[i] * gp.scale;
        break;
      }
      default:
        tx = cx; ty = cy; trr = 200; tgg = 200; tbb = 200; op = 0.5; sz = 1.5;
    }
    pr[i] += (trr - pr[i]) * 0.25;
    pg[i] += (tgg - pg[i]) * 0.25;
    pb[i] += (tbb - pb[i]) * 0.25;
    let vx = (tx - px[i]) * moveSpeed2 * speed[i];
    let vy = (ty - py[i]) * moveSpeed2 * speed[i];
    vx += Math.sin(elapsed * 0.002 + i * 0.7) * 0.15;
    vy += Math.cos(elapsed * 0.002 + i * 1.1) * 0.15;
    if (normBass > 0.5) {
      const dx = px[i] - cx, dy = py[i] - cy;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const pushForce = (normBass - 0.5) * 3;
      vx += (dx / dist) * pushForce;
      vy += (dy / dist) * pushForce;
    }
    px[i] += vx; py[i] += vy;
    if (op < 0.02) continue;
    ctx.globalAlpha = Math.min(1, op);
    ctx.fillStyle = `rgb(${pr[i] | 0},${pg[i] | 0},${pb[i] | 0})`;
    ctx.shadowBlur = phase === 3 ? 6 + normBass * 8 : 0;
    ctx.shadowColor = phase === 3 ? `rgb(${pr[i] | 0},${pg[i] | 0},${pb[i] | 0})` : 'transparent';
    ctx.beginPath();
    ctx.arc(px[i], py[i], Math.max(0.5, sz), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.shadowBlur = 0;
}

function drawParticles(ctx: OffscreenCanvasRenderingContext2D, w: number, h: number, time: number, bass: number, count: number, color: string) {
  const normBass = bass / 255;
  const cx = w / 2;
  const cy = h / 2;
  const risingCount = Math.floor(count * 0.4);
  for (let i = 0; i < risingCount; i++) {
    const seed = i * 127.1;
    const xBase = ((Math.sin(seed) * 10000) % w + w) % w;
    const drift = Math.sin(time * 2 + seed) * 30;
    const x = xBase + drift;
    const spd = 20 + (i % 7) * 15;
    const y = h - ((time * spd + seed * 10) % (h + 100));
    const size = 2 + (i % 4) + normBass * 3;
    const twinkle = 0.5 + Math.sin(time * 8 + seed) * 0.3;
    ctx.beginPath();
    ctx.fillStyle = color;
    ctx.shadowBlur = 15 + normBass * 10;
    ctx.shadowColor = color;
    ctx.globalAlpha = twinkle * (0.4 + normBass * 0.4);
    ctx.arc(x, y, size, 0, Math.PI * 2);
    ctx.fill();
  }
  const burstCount = Math.floor(count * 0.35);
  for (let i = 0; i < burstCount; i++) {
    const angle = (i / burstCount) * Math.PI * 2 + time * 0.3;
    const seed = i * 234.5;
    const burstPhase = (time * 1.5 + seed * 0.01) % 3;
    const burstProgress = burstPhase / 3;
    const maxDist = 300 + normBass * 200;
    const dist = burstProgress * maxDist;
    const x = cx + Math.cos(angle) * dist;
    const y = cy + Math.sin(angle) * dist;
    const size = (1 - burstProgress) * (3 + normBass * 4);
    const alpha = (1 - burstProgress) * (0.6 + normBass * 0.4);
    if (size > 0.5 && alpha > 0.1) {
      ctx.beginPath();
      ctx.fillStyle = color;
      ctx.shadowBlur = 10;
      ctx.shadowColor = color;
      ctx.globalAlpha = alpha;
      ctx.arc(x, y, size, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  const orbitalCount = Math.floor(count * 0.15);
  for (let i = 0; i < orbitalCount; i++) {
    const orbitRadius = 150 + (i % 4) * 80 + normBass * 50;
    const spd = (i % 2 === 0 ? 1 : -1) * (0.8 + (i % 3) * 0.3);
    const angle = time * spd + (i / orbitalCount) * Math.PI * 2;
    const x = cx + Math.cos(angle) * orbitRadius;
    const y = cy + Math.sin(angle) * orbitRadius;
    const sparkle = 0.5 + Math.sin(time * 12 + i * 5) * 0.5;
    const size = 2 + sparkle * 2 + normBass * 2;
    ctx.beginPath();
    ctx.fillStyle = '#fff';
    ctx.shadowBlur = 20;
    ctx.shadowColor = color;
    ctx.globalAlpha = sparkle * 0.8;
    ctx.arc(x, y, size, 0, Math.PI * 2);
    ctx.fill();
  }
  const dustCount = Math.floor(count * 0.1);
  for (let i = 0; i < dustCount; i++) {
    const seed = i * 567.8;
    const x = ((Math.sin(seed) * 10000) % w + w) % w;
    const y = ((Math.cos(seed) * 10000) % h + h) % h;
    const drift = Math.sin(time + seed) * 2;
    const size = 1 + Math.sin(time * 3 + seed) * 0.5;
    ctx.beginPath();
    ctx.fillStyle = '#fff';
    ctx.shadowBlur = 5;
    ctx.shadowColor = '#fff';
    ctx.globalAlpha = 0.2 + normBass * 0.2;
    ctx.arc(x + drift, y, size, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.shadowBlur = 0;
}

/* Silhouette engine functions (sampleShape, buildS3HeroTargets,
   buildDJAtWorkTargets, drawSilhouette, drawS3Hero, drawDJAtWork)
   moved to ../lib/silhouetteEngine on 2026-04-26 SGT. Imported at
   top of file. Shared with the live preview path in
   components/VideoGeneratorModal.tsx. */


function drawStrandsWatermark(ctx: OffscreenCanvasRenderingContext2D, w: number, h: number) {
  ctx.save();
  ctx.globalAlpha = 0.4;
  ctx.shadowBlur = 0;

  const margin = Math.round(w * 0.02);
  const brandSize = Math.round(w * 0.022);
  const linkSize = Math.round(w * 0.011);
  const superSize = Math.round(brandSize * 0.55);

  // Watermark string updated 2026-05-01 SGT to point at the product
  // domain (s3studio.xyz) rather than the holding entity. Two visual
  // lines: brand mark (S³ Strands Sound Studio) on the upper line,
  // product URL (s3studio.xyz) on the lower line.
  ctx.textAlign = 'right';
  ctx.textBaseline = 'bottom';
  ctx.fillStyle = '#ffffff';
  ctx.font = `bold ${brandSize}px 'Orbitron', 'Inter', sans-serif`;
  const studioText = ' Strands Sound Studio';
  const studioWidth = ctx.measureText(studioText).width;
  const cubeWidth = (() => { ctx.font = `bold ${superSize}px 'Orbitron', 'Inter', sans-serif`; return ctx.measureText('\u00B3').width; })();
  const brandY = h - margin - linkSize - 4;

  // Draw "STUDIO"
  ctx.font = `bold ${brandSize}px 'Orbitron', 'Inter', sans-serif`;
  ctx.fillStyle = '#ffffff';
  ctx.fillText(studioText, w - margin, brandY);

  // Draw superscript "³"
  ctx.font = `bold ${superSize}px 'Orbitron', 'Inter', sans-serif`;
  ctx.fillStyle = '#00C2FF';
  ctx.fillText('\u00B3', w - margin - studioWidth, brandY - brandSize * 0.35);

  // Draw "S"
  ctx.font = `bold ${brandSize}px 'Orbitron', 'Inter', sans-serif`;
  ctx.fillStyle = '#ffffff';
  ctx.fillText('S', w - margin - studioWidth - cubeWidth, brandY);

  // "s3studio.xyz" link
  ctx.textAlign = 'right';
  ctx.font = `${linkSize}px 'Rajdhani', 'Inter', sans-serif`;
  ctx.fillStyle = '#00C2FF';
  ctx.fillText('s3studio.xyz', w - margin, h - margin);

  ctx.restore();
}

// ─── Main Render Loop ───────────────────────────────────────────────

interface InitMessage {
  type: 'init';
  width: number;
  height: number;
  fps: number;
  totalFrames: number;
  config: RenderConfig;
  effects: EffectsMap;
  intensities: IntensitiesMap;
  texts: TextLayer[];
  showWatermark: boolean;
  // Serialized FFT data: array of Uint8Array (as ArrayBuffer[])
  frequencyData: ArrayBuffer[];
  // Background image as ImageBitmap (transferable)
  bgImageBitmap?: ImageBitmap;
  // Slideshow layer (beat-synced image bank)
  slideshowBitmaps?: ImageBitmap[];
  slideshowEnabled?: boolean;
  slideshowOpacity?: number;
  slideshowFit?: 'cover' | 'contain';
  /** LRC string for timed-lyrics resolution during export */
  lrcData?: string;
}

// ─── Slideshow Beat Detection (worker-side) ────────────────────────

const SLIDESHOW_BEAT_THRESHOLD = 0.25;
const SLIDESHOW_COOLDOWN_FRAMES = 5; // minimum frames between triggers at any fps

function drawSlideshowCoverContain(
  ctx: OffscreenCanvasRenderingContext2D,
  img: ImageBitmap,
  w: number, h: number,
  fit: 'cover' | 'contain',
  opacity: number
) {
  ctx.save();
  ctx.globalAlpha = opacity;
  const imgRatio = img.width / img.height;
  const canvasRatio = w / h;
  if (fit === 'cover') {
    let sw: number, sh: number, sx: number, sy: number;
    if (imgRatio > canvasRatio) {
      sh = img.height;
      sw = sh * canvasRatio;
      sx = (img.width - sw) / 2;
      sy = 0;
    } else {
      sw = img.width;
      sh = sw / canvasRatio;
      sx = 0;
      sy = (img.height - sh) / 2;
    }
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, w, h);
  } else {
    let dw: number, dh: number;
    if (imgRatio > canvasRatio) { dw = w; dh = w / imgRatio; }
    else { dh = h; dw = h * imgRatio; }
    ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
  }
  ctx.restore();
}

async function renderLoop(msg: InitMessage) {
  const { width, height, fps, totalFrames, config, effects, intensities, texts, showWatermark, bgImageBitmap } = msg;
  const slideshowBitmaps = msg.slideshowBitmaps || [];
  const slideshowEnabled = msg.slideshowEnabled ?? false;
  const slideshowOpacity = msg.slideshowOpacity ?? 0.8;
  const slideshowFit = msg.slideshowFit ?? 'cover';
  let slideshowIndex = 0;
  let slideshowPrevBass = 0;
  let slideshowCooldown = 0;

  // Parse LRC data once for timed-lyrics resolution
  const parsedLrc: LrcLine[] = msg.lrcData ? parseLrc(msg.lrcData) : [];

  // Deserialize FFT data
  const frequencyDataFrames = msg.frequencyData.map(buf => new Uint8Array(buf));

  canvas = new OffscreenCanvas(width, height);
  ctx = canvas.getContext('2d');
  if (!ctx) {
    workerSelf.postMessage({ type: 'error', message: 'Failed to create OffscreenCanvas 2D context' });
    return;
  }

  const centerX = width / 2;
  const centerY = height / 2;

  // Reset particle state for new render
  strandsParticleState = null;

  for (let frameIndex = 0; frameIndex < totalFrames; frameIndex++) {
    // Check abort
    if (aborted) {
      workerSelf.postMessage({ type: 'error', message: 'Render aborted' });
      return;
    }

    // Wait while paused (backpressure from main thread)
    while (paused && !aborted) {
      await new Promise(r => setTimeout(r, 5));
    }

    const time = frameIndex / fps;
    const dataArray = frequencyDataFrames[Math.min(frameIndex, frequencyDataFrames.length - 1)];

    ctx.save();
    ctx.clearRect(0, 0, width, height);

    // Background
    if (bgImageBitmap) {
      ctx.drawImage(bgImageBitmap, 0, 0, width, height);
    } else {
      ctx.fillStyle = '#0a0a0a';
      ctx.fillRect(0, 0, width, height);
    }

    // Dimming
    ctx.fillStyle = `rgba(0,0,0,${config.bgDim})`;
    ctx.fillRect(0, 0, width, height);

    // Audio metrics
    let bass = 0;
    for (let i = 0; i < 10; i++) bass += dataArray[i] || 0;
    bass /= 10;
    const normBass = bass / 255;
    const pulse = 1 + normBass * 0.15;

    // Synthesize time-domain waveform for Oscilloscope
    const timeDomain = new Uint8Array(1024);
    for (let i = 0; i < timeDomain.length; i++) {
      timeDomain[i] = 128 + Math.sin(i * 0.1 + time * 10) * 64 * normBass;
    }

    // Slideshow layer (beat-synced)
    if (slideshowEnabled && slideshowBitmaps.length > 0) {
      const delta = normBass - slideshowPrevBass;
      slideshowPrevBass = normBass;
      if (delta > SLIDESHOW_BEAT_THRESHOLD && (frameIndex - slideshowCooldown) > SLIDESHOW_COOLDOWN_FRAMES && slideshowBitmaps.length > 1) {
        slideshowIndex = (slideshowIndex + 1) % slideshowBitmaps.length;
        slideshowCooldown = frameIndex;
      }
      drawSlideshowCoverContain(ctx, slideshowBitmaps[slideshowIndex], width, height, slideshowFit, slideshowOpacity);
    }

    // Apply particle transform (zoom + offset)
    ctx.save();
    const pScale = config.particleScale ?? 1.0;
    const pOffX = ((config.particleOffsetX ?? 0) / 100) * width;
    const pOffY = ((config.particleOffsetY ?? 0) / 100) * height;
    ctx.translate(centerX + pOffX, centerY + pOffY);
    ctx.scale(pScale, pScale);
    ctx.translate(-centerX, -centerY);

    // Draw preset
    switch (config.preset) {
      case 'NCS Circle':
        drawNCSCircle(ctx, centerX, centerY, dataArray, pulse, time, config.primaryColor, config.secondaryColor);
        break;
      case 'Linear Bars':
        drawLinearBars(ctx, width, height, dataArray, config.primaryColor, config.secondaryColor);
        break;
      case 'Dual Mirror':
        drawDualMirror(ctx, width, height, dataArray, config.primaryColor);
        break;
      case 'Center Wave':
        drawCenterWave(ctx, centerX, centerY, dataArray, time, config.primaryColor);
        break;
      case 'Orbital':
        drawOrbital(ctx, centerX, centerY, dataArray, time, config.primaryColor, config.secondaryColor);
        break;
      case 'Hexagon':
        drawHexagon(ctx, centerX, centerY, dataArray, pulse, time, config.primaryColor);
        break;
      case 'Oscilloscope':
        drawOscilloscope(ctx, width, height, timeDomain, config.primaryColor);
        break;
      case 'Digital Rain':
        drawDigitalRain(ctx, width, height, dataArray, time, config.primaryColor);
        break;
      case 'Shockwave':
        drawShockwave(ctx, centerX, centerY, bass, time, config.primaryColor);
        break;
      case 'Strands Particle':
        drawStrandsParticle(ctx, centerX, centerY, width, height, normBass, time, 1 / fps);
        break;
      case 'S3 Hero':
        // Particle field that resolves into the "S³" wordmark.
        drawS3Hero(ctx, centerX, centerY, width, height, normBass, config.primaryColor);
        break;
      case 'DJ At Work':
        // Particle field that resolves into the iconic DJ silhouette.
        drawDJAtWork(ctx, centerX, centerY, width, height, normBass, config.primaryColor);
        break;
      case 'Minimal':
      default:
        break;
    }

    // Particles
    drawParticles(ctx, width, height, time, bass, config.particleCount, config.primaryColor);
    ctx.restore(); // End particle transform

    // Effects
    if (effects.pixelate) {
      const pixelSize = Math.max(4, Math.floor(16 * intensities.pixelate));
      ctx.imageSmoothingEnabled = false;
      const tempCanvas = new OffscreenCanvas(Math.floor(width / pixelSize), Math.floor(height / pixelSize));
      const tempCtx = tempCanvas.getContext('2d')!;
      tempCtx.drawImage(canvas, 0, 0, tempCanvas.width, tempCanvas.height);
      ctx.clearRect(0, 0, width, height);
      ctx.drawImage(tempCanvas, 0, 0, tempCanvas.width, tempCanvas.height, 0, 0, width, height);
      ctx.imageSmoothingEnabled = true;
    }

    // Scanlines / CCTV
    if (effects.scanlines || effects.cctv) {
      ctx.fillStyle = `rgba(0,0,0,${intensities.scanlines * 0.8})`;
      for (let i = 0; i < height; i += 4) ctx.fillRect(0, i, width, 2);
    }

    // Letterbox
    if (effects.letterbox) {
      const barHeight = height * 0.12 * intensities.letterbox;
      ctx.fillStyle = 'black';
      ctx.fillRect(0, 0, width, barHeight);
      ctx.fillRect(0, height - barHeight, width, barHeight);
    }

    // Text layers (scale font size from preview res 1080 to render res)
    const fontScale = Math.min(width / 1920, height / 1080);
    ctx.shadowBlur = 10 * fontScale;
    ctx.shadowColor = 'black';
    ctx.textAlign = 'center';
    texts.filter(layer => layer.visible !== false).forEach(layer => {
      // Resolve timed-lyrics: replace placeholder with current LRC line
      let displayText = layer.text;
      if (layer.id === 'timed-lyrics' && parsedLrc.length > 0) {
        const currentTime = frameIndex / fps;
        displayText = getCurrentLine(parsedLrc, currentTime);
        if (!displayText) return; // nothing to show yet
      }

      ctx!.fillStyle = layer.color;
      const dynamicSize = (layer.id === '1' && config.preset === 'Minimal' ? layer.size * pulse : layer.size) * fontScale;
      ctx!.font = `bold ${dynamicSize}px ${layer.font}, sans-serif`;
      const xPos = (layer.x / 100) * width;
      const yPos = (layer.y / 100) * height;

      // Draw background pill behind text if specified
      if (layer.background && displayText) {
        const metrics = ctx!.measureText(displayText);
        const padX = 12 * fontScale;
        const padY = 6 * fontScale;
        const textHeight = dynamicSize;
        ctx!.fillStyle = layer.background;
        ctx!.fillRect(
          xPos - metrics.width / 2 - padX,
          yPos - textHeight + padY,
          metrics.width + padX * 2,
          textHeight + padY
        );
        ctx!.fillStyle = layer.color;
      }

      if (layer.vertical) {
        const chars = Array.from(displayText);
        const lineHeight = dynamicSize * 1.1;
        const startY = yPos - ((chars.length - 1) * lineHeight) / 2;
        chars.forEach((char, i) => { ctx!.fillText(char, xPos, startY + i * lineHeight); });
      } else {
        ctx!.fillText(displayText, xPos, yPos);
      }
    });

    // Watermark
    if (showWatermark) drawStrandsWatermark(ctx, width, height);

    ctx.restore();

    // ── Stage 2: Compress to JPEG ──
    // ~50KB/frame vs ~2MB raw RGBA. Sidecar receives MJPEG via image2pipe.
    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.85 });
    const buffer = await blob.arrayBuffer();

    // Post JPEG as ArrayBuffer (universally Transferable, zero-copy)
    workerSelf.postMessage({ type: 'frame_blob', buffer, frameIndex }, [buffer]);

    // Progress update every 10 frames
    if (frameIndex % 10 === 0) {
      workerSelf.postMessage({ type: 'progress', frameIndex, totalFrames });
    }

    // Yield every frame to allow message processing (pause/resume/abort)
    if (frameIndex % 3 === 0) {
      await new Promise(r => setTimeout(r, 0));
    }
  }

  workerSelf.postMessage({ type: 'done' });
}

// ─── Message Handler ────────────────────────────────────────────────

workerSelf.onmessage = (e: MessageEvent) => {
  const msg = e.data;

  switch (msg.type) {
    case 'init':
      paused = false;
      aborted = false;
      renderLoop(msg as InitMessage).catch(err => {
        workerSelf.postMessage({ type: 'error', message: String(err) });
      });
      break;

    case 'pause':
      paused = true;
      break;

    case 'resume':
      paused = false;
      break;

    case 'abort':
      aborted = true;
      break;
  }
};
