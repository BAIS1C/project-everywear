/**
 * silhouetteEngine -- shared silhouette particle engine.
 * Ported verbatim from s3studio-web/src/lib/silhouetteEngine.ts.
 *
 * Drives N particles toward pre-sampled target-point arrays. Used by
 * S3 Hero ("S3" wordmark) and DJ At Work (stick-figure DJ) presets.
 * Imported by both the OffscreenCanvas worker (videoRenderWorker.ts)
 * and the live preview canvas (VideoGeneratorModal.tsx).
 */

type Ctx2D = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;
type SourceCanvas = OffscreenCanvas | HTMLCanvasElement;
type SourceCtx = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;

function makeSourceCanvas(w: number, h: number): { canvas: SourceCanvas; ctx: SourceCtx | null } {
  if (typeof document !== 'undefined') {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D | null;
    return { canvas: c, ctx };
  }
  const c = new OffscreenCanvas(w, h);
  const ctx = c.getContext('2d', { willReadFrequently: true }) as OffscreenCanvasRenderingContext2D | null;
  return { canvas: c, ctx };
}

interface SilhouetteState {
  px: Float32Array; py: Float32Array;
  tx: Float32Array; ty: Float32Array;
  baseSize: Float32Array;
  cachedW: number; cachedH: number;
  initialised: boolean;
}

const silhouetteStates: Record<string, SilhouetteState | null> = {
  s3hero: null,
  djatwork: null,
};

let s3HeroTargetsCache: { w: number; h: number; targets: [number, number][] } | null = null;
let djAtWorkTargetsCache: {
  w: number;
  h: number;
  baseWorld: [number, number][];
  armNormalized: [number, number][];
  shoulderWorld: [number, number];
} | null = null;

// Font-load cache invalidation
if (typeof document !== 'undefined' && (document as Document & { fonts?: FontFaceSet }).fonts) {
  const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
  fonts?.ready
    .then(() => {
      s3HeroTargetsCache = null;
      djAtWorkTargetsCache = null;
    })
    .catch(() => undefined);
}

function sampleShape(
  source: SourceCanvas,
  ctx: SourceCtx,
  cx: number, cy: number,
  fitDim: number,
  gap = 4,
): [number, number][] {
  const w = source.width;
  const h = source.height;
  const img = ctx.getImageData(0, 0, w, h);
  const data = img.data;
  const points: [number, number][] = [];
  const k = fitDim / Math.max(w, h);
  const offX = cx - (w * k) / 2;
  const offY = cy - (h * k) / 2;
  for (let y = 0; y < h; y += gap) {
    for (let x = 0; x < w; x += gap) {
      const i = (y * w + x) * 4;
      if (data[i + 3] > 128) {
        points.push([offX + x * k, offY + y * k]);
      }
    }
  }
  return points;
}

const MIN_TARGETS = 30;
const SILHOUETTE_FIT_FACTOR = 0.85;

// -- Static normalised target arrays ------------------------------------------

function buildS3HeroNormalized(): [number, number][] {
  const points: [number, number][] = [];
  const N_S = 80;
  const SX = -0.06;
  for (let i = 0; i < N_S; i++) {
    const t = i / (N_S - 1);
    const y = -0.36 + t * 0.72;
    const x = SX - Math.sin(Math.PI * t * 2) * 0.18;
    points.push([x, y]);
    points.push([x - 0.025, y]);
    points.push([x + 0.025, y]);
    points.push([x - 0.05, y]);
    points.push([x + 0.05, y]);
  }
  const supCx = 0.30;
  const supCy = -0.28;
  const supR = 0.05;
  const upperCy = supCy - supR;
  const lowerCy = supCy + supR;
  for (let i = 0; i < 14; i++) {
    const angle = -Math.PI / 2 + (i / 13) * Math.PI;
    const dx = Math.cos(angle) * supR;
    points.push([supCx + dx, upperCy + Math.sin(angle) * supR]);
    points.push([supCx + dx, lowerCy + Math.sin(angle) * supR]);
  }
  return points;
}

interface DJTopology {
  base: [number, number][];
  rightArm: [number, number][];
  rightArmShoulder: [number, number];
}

function buildDJAtWorkTopology(): DJTopology {
  const base: [number, number][] = [];

  // Head circle
  const headCy = -0.28;
  const headR = 0.10;
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    base.push([Math.cos(a) * headR, headCy + Math.sin(a) * headR]);
  }

  // Earcups
  const earR = 0.035;
  const earCy = headCy + 0.005;
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    base.push([-headR - 0.01 + Math.cos(a) * earR, earCy + Math.sin(a) * earR]);
    base.push([+headR + 0.01 + Math.cos(a) * earR, earCy + Math.sin(a) * earR]);
  }

  // Headphone band arc
  const bandR = headR + 0.025;
  for (let i = 0; i < 12; i++) {
    const a = Math.PI + (i / 11) * Math.PI;
    base.push([Math.cos(a) * bandR, headCy + Math.sin(a) * bandR]);
  }

  // Torso outline
  const torsoTop = headCy + headR + 0.01;
  const torsoBottom = torsoTop + 0.22;
  const torsoHalfW = 0.13;
  for (let i = 0; i <= 20; i++) {
    const x = -torsoHalfW + (i / 20) * (torsoHalfW * 2);
    base.push([x, torsoTop]);
    base.push([x, torsoBottom]);
  }
  for (let i = 1; i < 18; i++) {
    const y = torsoTop + (i / 17) * (torsoBottom - torsoTop);
    base.push([-torsoHalfW, y]);
    base.push([torsoHalfW, y]);
  }

  // Right arm (separate for beat-pump rotation)
  const rightArm: [number, number][] = [];
  const rArmShoulder: [number, number] = [torsoHalfW, torsoTop + 0.005];
  const rArmEnd: [number, number] = [0.30, torsoTop - 0.10];
  for (let i = 0; i <= 18; i++) {
    const t = i / 18;
    const x = rArmShoulder[0] + (rArmEnd[0] - rArmShoulder[0]) * t;
    const y = rArmShoulder[1] + (rArmEnd[1] - rArmShoulder[1]) * t;
    rightArm.push([x, y]);
    rightArm.push([x, y - 0.015]);
    rightArm.push([x, y + 0.015]);
  }

  // Left arm down on deck
  const lArmStart: [number, number] = [-torsoHalfW, torsoTop + 0.005];
  const lArmEnd: [number, number] = [-0.22, torsoBottom + 0.04];
  for (let i = 0; i <= 18; i++) {
    const t = i / 18;
    const x = lArmStart[0] + (lArmEnd[0] - lArmStart[0]) * t;
    const y = lArmStart[1] + (lArmEnd[1] - lArmStart[1]) * t;
    base.push([x, y]);
    base.push([x, y - 0.015]);
    base.push([x, y + 0.015]);
  }

  // Deck
  const deckY = torsoBottom + 0.04;
  const deckH = 0.06;
  const deckHalfW = 0.42;
  for (let i = 0; i <= 30; i++) {
    const x = -deckHalfW + (i / 30) * (deckHalfW * 2);
    base.push([x, deckY]);
    base.push([x, deckY + deckH]);
  }
  for (let i = 1; i < 4; i++) {
    const y = deckY + (i / 4) * deckH;
    base.push([-deckHalfW, y]);
    base.push([deckHalfW, y]);
  }

  // Two record discs
  const discR = 0.06;
  const discCy = deckY + deckH * 0.5;
  const discCx1 = -0.18;
  const discCx2 = 0.18;
  for (let i = 0; i < 20; i++) {
    const a = (i / 20) * Math.PI * 2;
    base.push([discCx1 + Math.cos(a) * discR, discCy + Math.sin(a) * discR]);
    base.push([discCx2 + Math.cos(a) * discR, discCy + Math.sin(a) * discR]);
  }

  return { base, rightArm, rightArmShoulder: rArmShoulder };
}

const S3_HERO_NORMALIZED: [number, number][] = buildS3HeroNormalized();
const DJ_AT_WORK_TOPOLOGY: DJTopology = buildDJAtWorkTopology();
const DJ_ARM_PUMP_MAX = -0.45;

function normalizedToWorld(
  normalized: [number, number][],
  cx: number, cy: number, dim: number,
): [number, number][] {
  const fit = SILHOUETTE_FIT_FACTOR * dim;
  const out: [number, number][] = new Array(normalized.length);
  for (let i = 0; i < normalized.length; i++) {
    const [nx, ny] = normalized[i];
    out[i] = [cx + nx * fit, cy + ny * fit];
  }
  return out;
}

function drawSilhouette(
  ctx: Ctx2D,
  cx: number, cy: number,
  w: number, h: number,
  normBass: number,
  primaryColor: string,
  stateKey: string,
  targets: [number, number][],
) {
  const COUNT = 600;
  let S = silhouetteStates[stateKey];

  if (!S || !S.initialised || S.cachedW !== w || S.cachedH !== h || targets.length === 0) {
    if (targets.length === 0) return;
    S = {
      px: new Float32Array(COUNT), py: new Float32Array(COUNT),
      tx: new Float32Array(COUNT), ty: new Float32Array(COUNT),
      baseSize: new Float32Array(COUNT),
      cachedW: w, cachedH: h, initialised: true,
    };
    for (let i = 0; i < COUNT; i++) {
      S.px[i] = Math.random() * w;
      S.py[i] = Math.random() * h;
      const t = targets[i % targets.length];
      S.tx[i] = t[0]; S.ty[i] = t[1];
      S.baseSize[i] = 1.4 + (i % 11) * 0.18;
    }
    silhouetteStates[stateKey] = S;
  }

  const hex = primaryColor.startsWith('#') ? primaryColor : '#00C2FF';
  const cR = parseInt(hex.slice(1, 3), 16);
  const cG = parseInt(hex.slice(3, 5), 16);
  const cB = parseInt(hex.slice(5, 7), 16);

  const sizePulse = 1 + normBass * 1.6;
  const followSpeed = 0.08 + normBass * 0.06;

  for (let i = 0; i < COUNT; i++) {
    S.px[i] += (S.tx[i] - S.px[i]) * followSpeed;
    S.py[i] += (S.ty[i] - S.py[i]) * followSpeed;
    const sz = S.baseSize[i] * sizePulse;
    ctx.beginPath();
    ctx.fillStyle = `rgba(${cR},${cG},${cB},0.92)`;
    ctx.arc(S.px[i], S.py[i], sz, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.globalAlpha = 0.18 + normBass * 0.25;
  for (let i = 0; i < 40; i++) {
    const x = ((Math.sin(i * 12.97) * 9999) % w + w) % w;
    const y = ((Math.cos(i * 7.31) * 9999) % h + h) % h;
    ctx.beginPath();
    ctx.fillStyle = `rgba(${cR},${cG},${cB},1)`;
    ctx.arc(x, y, 1.2, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

export function drawS3Hero(
  ctx: Ctx2D,
  cx: number, cy: number, w: number, h: number,
  normBass: number, primaryColor: string,
) {
  const dim = Math.min(w, h);
  if (
    !s3HeroTargetsCache
    || s3HeroTargetsCache.w !== w
    || s3HeroTargetsCache.h !== h
  ) {
    s3HeroTargetsCache = {
      w, h,
      targets: normalizedToWorld(S3_HERO_NORMALIZED, cx, cy, dim),
    };
  }
  drawSilhouette(ctx, cx, cy, w, h, normBass, primaryColor, 's3hero', s3HeroTargetsCache.targets);
}

export function drawDJAtWork(
  ctx: Ctx2D,
  cx: number, cy: number, w: number, h: number,
  normBass: number, primaryColor: string,
) {
  const dim = Math.min(w, h);
  const fit = SILHOUETTE_FIT_FACTOR * dim;

  if (
    !djAtWorkTargetsCache
    || djAtWorkTargetsCache.w !== w
    || djAtWorkTargetsCache.h !== h
  ) {
    const [snx, sny] = DJ_AT_WORK_TOPOLOGY.rightArmShoulder;
    djAtWorkTargetsCache = {
      w, h,
      baseWorld: normalizedToWorld(DJ_AT_WORK_TOPOLOGY.base, cx, cy, dim),
      armNormalized: DJ_AT_WORK_TOPOLOGY.rightArm,
      shoulderWorld: [cx + snx * fit, cy + sny * fit],
    };
  }

  const angle = normBass * DJ_ARM_PUMP_MAX;
  const cosA = Math.cos(angle);
  const sinA = Math.sin(angle);
  const [sx, sy] = djAtWorkTargetsCache.shoulderWorld;
  const armN = djAtWorkTargetsCache.armNormalized;

  const baseLen = djAtWorkTargetsCache.baseWorld.length;
  const armLen = armN.length;
  const targets: [number, number][] = new Array(baseLen + armLen);
  for (let i = 0; i < baseLen; i++) {
    targets[i] = djAtWorkTargetsCache.baseWorld[i];
  }
  for (let i = 0; i < armLen; i++) {
    const [nx, ny] = armN[i];
    const wx = cx + nx * fit;
    const wy = cy + ny * fit;
    const dx = wx - sx;
    const dy = wy - sy;
    targets[baseLen + i] = [
      sx + dx * cosA - dy * sinA,
      sy + dx * sinA + dy * cosA,
    ];
  }

  drawSilhouette(ctx, cx, cy, w, h, normBass, primaryColor, 'djatwork', targets);
}

export function resetSilhouetteEngine(): void {
  silhouetteStates.s3hero = null;
  silhouetteStates.djatwork = null;
  s3HeroTargetsCache = null;
  djAtWorkTargetsCache = null;
}
