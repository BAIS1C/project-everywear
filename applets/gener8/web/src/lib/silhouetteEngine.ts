// @ts-nocheck
/**
 * silhouetteEngine — shared silhouette particle engine.
 *
 * Drives N particles toward a pre-sampled target-point array. Targets
 * are computed once on first frame for a given canvas size and cached
 * (per preset). Particles spawn at random positions, drift toward
 * their assigned target, and pulse with bass.
 *
 * Single source of truth for S3 Hero ("S³" wordmark) and DJ At Work
 * (stick-figure DJ) presets. Imported by both the OffscreenCanvas
 * worker (workers/videoRenderWorker.ts) and the live preview canvas
 * (components/VideoGeneratorModal.tsx) so preview matches render.
 *
 * Extracted from videoRenderWorker.ts on 2026-04-26 SGT to kill the
 * preview vs render-to-file mismatch (live preview was falling through
 * to drawStrandsParticle when S3 Hero / DJ At Work were selected).
 *
 * Internal state (silhouetteStates, target caches) is module-scoped.
 * Acceptable because the worker spins up a fresh module per worker
 * instance and the main-thread preview only renders one canvas at a
 * time. If we ever need multiple concurrent silhouette canvases on
 * the main thread, refactor the caches into a returned engine
 * instance.
 */

// Both context types share the 2D primitives we use (beginPath, arc,
// fill, save, restore, fillStyle, globalAlpha, fillText, lineWidth,
// strokeStyle, stroke, lineCap, roundRect, globalCompositeOperation).
type Ctx2D = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;

// 2026-04-26 SGT (later): the OffscreenCanvas-based sample generation
// was still producing sparse/partial silhouettes in the Vid Editor
// preview even with willReadFrequently set, because some Chromium
// builds ignore the hint and GPU-back the OffscreenCanvas anyway,
// then race on getImageData. The DesktopSurface boot intro uses
// HTMLCanvasElement and works perfectly — same primitives, different
// backing store. So we mirror that: HTMLCanvasElement when document
// exists (main thread), OffscreenCanvas only in worker contexts where
// we have no choice. Both surfaces support the same 2D API.
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
  px: Float32Array; py: Float32Array;     // current pos
  tx: Float32Array; ty: Float32Array;     // target pos
  baseSize: Float32Array;
  cachedW: number; cachedH: number;
  initialised: boolean;
}

const silhouetteStates: Record<string, SilhouetteState | null> = {
  s3hero: null,
  djatwork: null,
};

let s3HeroTargetsCache: { w: number; h: number; targets: [number, number][] } | null = null;

/**
 * DJ cache holds the static base in world coords plus the right arm
 * in normalized coords + the shoulder pivot in world coords. The arm
 * is rotated per frame around the shoulder based on the audio bass
 * intensity; static base is recomputed only on canvas resize.
 */
let djAtWorkTargetsCache: {
  w: number;
  h: number;
  baseWorld: [number, number][];
  armNormalized: [number, number][];
  shoulderWorld: [number, number];
} | null = null;

/*
 * Font-load cache invalidation (fix attempt 3, 2026-05-01 SGT).
 *
 * The S³ wordmark depends on Orbitron / Inter being available before
 * sample time; on a cold reload the first sample runs while the web
 * font is still in flight, drops to the sans-serif fallback, and
 * produces a sparse alpha map. Listen for document.fonts.ready and
 * invalidate the cache once — the next frame re-samples cleanly with
 * the actual Orbitron glyph and the recognisable wordmark forms.
 *
 * No-op in worker contexts (no document) and on browsers that lack
 * the Font Loading API. DJ At Work doesn't depend on fonts but we
 * invalidate it here too as a belt-and-braces measure for the same
 * cold-reload race window.
 */
if (typeof document !== 'undefined' && (document as Document & { fonts?: FontFaceSet }).fonts) {
  const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
  fonts?.ready
    .then(() => {
      s3HeroTargetsCache = null;
      djAtWorkTargetsCache = null;
    })
    .catch(() => undefined);
}

/**
 * Sample [x, y] points from any shape rendered into an offscreen canvas.
 * Walks the alpha channel at `gap` stride and collects positions where
 * pixel alpha > 128. Returns absolute coords centered around (cx, cy)
 * after fitting the source canvas into a target box defined by `scale`
 * relative to the smaller of (w, h).
 */
function sampleShape(
  source: SourceCanvas,
  ctx: SourceCtx,
  cx: number, cy: number,
  fitDim: number,
  gap = 4,
): [number, number][] {
  // Take the context the caller already used to draw — calling getContext
  // again on the same canvas with the same type returns the same instance
  // per spec, but pre-2024 Safari sometimes returned a fresh context that
  // didn't see the prior draws. Threading the ctx through eliminates that.
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

/**
 * Minimum target count below which we treat a build as failed and force
 * a re-sample on the next frame. Prevents a stale empty/sparse cache
 * from locking the silhouette picker into fragments forever.
 *
 * Original 2026-04-26 SGT regression hypothesis: GPU-backed
 * OffscreenCanvas getImageData race. Fix attempt 1: willReadFrequently.
 * Did not eliminate the issue in Vid Editor preview (Sean reported
 * partial silhouettes still visible). Fix attempt 2: use HTMLCanvasElement
 * for sample generation in main thread.
 *
 * Fix attempt 3 (current, 2026-05-01 SGT): apply the Strands pattern.
 * Strands works because it uses static pre-baked coordinates and a
 * generous 0.85 fit factor. This file mirrors that approach as
 * faithfully as possible while preserving the dynamic-sampling input
 * (so designers can edit S³ glyph + DJ rig without re-baking arrays):
 *   1. Bumped FIT_FACTOR from 0.55 (S³) / 0.78 (DJ) to 0.85 — matches
 *      Strands so the silhouette fills ~85% of the smaller canvas
 *      dimension instead of being clipped to a third of the canvas.
 *   2. Lowered MIN_TARGETS from 80 to 30 — Sean's preview was hitting
 *      the sparse-bail path repeatedly; 30 is enough for a recognisable
 *      silhouette and survives sub-optimal first-frame samples.
 *   3. Lowered sampling gap from 5 to 3 in sampleShape callers — denser
 *      sample density means even a sub-fully-rendered glyph yields
 *      enough alpha hits to clear MIN_TARGETS.
 *   4. drawS3Hero now awaits document.fonts.ready before the first
 *      sample and caches the result module-globally, so the font-load
 *      race that broke fix attempt 2 is closed.
 */
const MIN_TARGETS = 30;
/** Strands renders its logo at 85% of dim. Mirroring exactly. */
const SILHOUETTE_FIT_FACTOR = 0.85;

// ════════════════════════════════════════════════════════════════════
// Static normalised target arrays (added 2026-05-01 SGT, fix attempt 4).
//
// Strands pattern verbatim: pre-baked [x, y] coordinates in normalised
// space (-0.5 to +0.5), rendered via tx = cx + nx * 0.85 * dim. Strands
// works because it never image-samples at draw time — the offscreen
// readback race that broke fix attempts 1-3 simply doesn't apply when
// the targets are already-resolved scalar arrays.
//
// Generated parametrically rather than authored by hand:
//   S3_HERO_NORMALIZED — vertical sine-wave traced S-curve with five
//   perpendicular offsets for stroke thickness, plus a "³" superscript
//   composed of two right-half semicircles stacked vertically.
//
//   DJ_AT_WORK_TOPOLOGY — split into a static `base` (head, earcups,
//   headphone band, torso outline, LEFT arm, deck outline, two records)
//   and a separately-tracked `rightArm` with a `rightArmShoulder` pivot.
//   The right arm is rotated around the shoulder each frame on normBass
//   to drive the beat-pump motion (see drawDJAtWork). Point density
//   mirrors the bounding boxes used in the now-deprecated
//   buildDJAtWorkTargets so the visual silhouette remains close to the
//   canvas-rendered form.
//
// These arrays are computed once at module load, deterministic, never
// invalidated. No font dependency, no canvas dependency, no font-load
// race, no readback timing — the failure modes that drove Sean's
// 'still clipped out' smoke-test report are structurally absent.
// ════════════════════════════════════════════════════════════════════

function buildS3HeroNormalized(): [number, number][] {
  const points: [number, number][] = [];
  // S body: vertical sine wave traced top to bottom with five
  // perpendicular offsets to give the stroke visible thickness.
  // Centred slightly left of origin to leave room for the ³.
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
  // ³ superscript: two right-half semicircles stacked vertically,
  // top-right of the S. Opens to the LEFT like a real "3" glyph.
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

/**
 * DJ topology: the static body parts (head, earcups, band, torso,
 * left arm, deck, records) live in `base`; the right arm lives
 * separately in `rightArm` so it can be rotated around the shoulder
 * each frame for the beat-driven pump motion. The shoulder is the
 * pivot point in normalized coords.
 *
 * 2026-05-02 SGT: split out from the original single-array build
 * function. Fix-attempt-4 (2026-05-01 SGT) had baked the right arm
 * static, which lost the arm-pump-on-beat motion Sean designed for.
 * Restoring it without re-introducing image sampling: rotate the
 * arm sub-array every frame, hand the union to drawSilhouette, let
 * the particle lerp smooth the trailing motion naturally.
 */
interface DJTopology {
  base: [number, number][];
  rightArm: [number, number][];
  rightArmShoulder: [number, number];
}

function buildDJAtWorkTopology(): DJTopology {
  const base: [number, number][] = [];

  // Head circle.
  const headCy = -0.28;
  const headR = 0.10;
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    base.push([Math.cos(a) * headR, headCy + Math.sin(a) * headR]);
  }

  // Earcups (left + right of head).
  const earR = 0.035;
  const earCy = headCy + 0.005;
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    base.push([-headR - 0.01 + Math.cos(a) * earR, earCy + Math.sin(a) * earR]);
    base.push([+headR + 0.01 + Math.cos(a) * earR, earCy + Math.sin(a) * earR]);
  }

  // Headphone band arc (top half of a circle slightly larger than head).
  const bandR = headR + 0.025;
  for (let i = 0; i < 12; i++) {
    const a = Math.PI + (i / 11) * Math.PI;
    base.push([Math.cos(a) * bandR, headCy + Math.sin(a) * bandR]);
  }

  // Torso outline (rectangle below head).
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

  // Right arm raised 45° upper-right at REST. From shoulder to extended
  // hand. These points are pushed into `rightArm` (NOT `base`) so they
  // can be rotated around the shoulder pivot each frame for the
  // beat-driven pump.
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

  // Left arm down on the deck. Stays in `base` — only the right arm pumps.
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

  // Deck (long horizontal rectangle below torso).
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

  // Two record discs on the deck.
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
/** Maximum upward rotation of the right arm (radians) at full bass.
 *  Negative angle = arm swings up-and-inward in screen coords (Y down).
 *  ~26° feels like a natural pump without flailing. Tweak here. */
const DJ_ARM_PUMP_MAX = -0.45;

/**
 * Transform normalised (-0.5..+0.5) coordinates to world coords by
 * applying the Strands fit factor (0.85) to dim and offsetting to
 * (cx, cy). Mirrors the pattern used by the Strands logo phase
 * exactly: `tx = cx + coord[0] * 0.85 * dim`.
 */
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

/**
 * @deprecated Used by the now-replaced dynamic sampling path. Retained
 * for reference. The active drawS3Hero uses S3_HERO_NORMALIZED instead.
 */
function buildS3HeroTargets(cx: number, cy: number, dim: number): [number, number][] {
  const fontPx = 360;
  const { canvas: src, ctx: sctx } = makeSourceCanvas(fontPx * 2.2, fontPx * 1.6);
  if (!sctx) return [];
  sctx.fillStyle = '#fff';
  sctx.font = `900 ${fontPx}px "Orbitron", "Inter", "Arial Black", sans-serif`;
  sctx.textAlign = 'center';
  sctx.textBaseline = 'middle';
  sctx.fillText('S³', src.width / 2, src.height / 2);
  // 0.85 fit + denser stride per fix attempt 3 (2026-05-01 SGT).
  return sampleShape(src, sctx, cx, cy, dim * SILHOUETTE_FIT_FACTOR, 3);
}

/**
 * Build a "DJ at work" silhouette using canvas primitives that
 * approximate the iconic stick-figure DJ behind a turntable deck.
 * Sampled into target points like the S3 Hero. Composition (rough):
 *   - Round head with two earcup blobs (headphones)
 *   - Headphone band arc connecting earcups
 *   - Torso rectangle behind a long deck rectangle
 *   - One arm raised at 45 degrees, other arm down on the deck
 *   - Two record/disc circles on the deck
 */
function buildDJAtWorkTargets(cx: number, cy: number, dim: number): [number, number][] {
  const W = 800, H = 800;
  const { canvas: src, ctx: sctx } = makeSourceCanvas(W, H);
  if (!sctx) return [];
  sctx.fillStyle = '#fff';

  // Head + earcups
  const headR = 95;
  const headY = 220;
  sctx.beginPath(); sctx.arc(W / 2, headY, headR, 0, Math.PI * 2); sctx.fill();
  const earR = 32;
  sctx.beginPath(); sctx.arc(W / 2 - headR - 6, headY + 8, earR, 0, Math.PI * 2); sctx.fill();
  sctx.beginPath(); sctx.arc(W / 2 + headR + 6, headY + 8, earR, 0, Math.PI * 2); sctx.fill();

  // Headphone band arc (top half)
  sctx.lineWidth = 18;
  sctx.strokeStyle = '#fff';
  sctx.beginPath();
  sctx.arc(W / 2, headY - 4, headR + 18, Math.PI * 1.05, Math.PI * 1.95);
  sctx.stroke();

  // Torso (chunky rounded rect behind deck)
  const torsoX = W / 2 - 130;
  const torsoY = headY + headR + 8;
  const torsoW = 260;
  const torsoH = 220;
  sctx.beginPath();
  sctx.roundRect(torsoX, torsoY, torsoW, torsoH, 30);
  sctx.fill();

  // Raised right arm (going up-right at ~45 degrees, hand at top corner).
  // Shoulder origin sits at the OUTER edge of the torso (top-right corner
  // area), not inset toward the chest. Without this anchor the arms look
  // "T-rex" — sprouting from the clavicle instead of from the actual
  // shoulder. (Backported from claude design/test-dj-particles.html,
  // Sean 2026-04-25 SGT.)
  sctx.lineCap = 'round';
  sctx.lineWidth = 50;
  sctx.beginPath();
  sctx.moveTo(torsoX + torsoW - 8, torsoY + 14);
  sctx.lineTo(W / 2 + 260, torsoY - 100);
  sctx.stroke();

  // Left arm down on the deck. Same outer-shoulder anchoring as the
  // right arm.
  sctx.beginPath();
  sctx.moveTo(torsoX + 8, torsoY + 14);
  sctx.lineTo(W / 2 - 215, torsoY + 230);
  sctx.stroke();

  // Deck (long horizontal slab)
  const deckY = torsoY + torsoH + 8;
  const deckH = 70;
  sctx.beginPath();
  sctx.roundRect(80, deckY, W - 160, deckH, 14);
  sctx.fill();

  // Two record discs on deck
  const discR = 64;
  sctx.beginPath(); sctx.arc(W / 2 - 150, deckY + deckH / 2, discR, 0, Math.PI * 2); sctx.fill();
  sctx.beginPath(); sctx.arc(W / 2 + 150, deckY + deckH / 2, discR, 0, Math.PI * 2); sctx.fill();
  // Disc center holes
  sctx.save();
  sctx.globalCompositeOperation = 'destination-out';
  sctx.beginPath(); sctx.arc(W / 2 - 150, deckY + deckH / 2, 10, 0, Math.PI * 2); sctx.fill();
  sctx.beginPath(); sctx.arc(W / 2 + 150, deckY + deckH / 2, 10, 0, Math.PI * 2); sctx.fill();
  sctx.restore();

  // 0.85 fit + denser stride per fix attempt 3 (2026-05-01 SGT).
  return sampleShape(src, sctx, cx, cy, dim * SILHOUETTE_FIT_FACTOR, 3);
}

/**
 * Generic silhouette draw. Lerps every particle toward its assigned
 * target with audio-reactive size + glow. Targets cycle with wrap so
 * the engine is decoupled from particle count.
 */
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

  // (Re)initialise on first frame or canvas resize.
  if (!S || !S.initialised || S.cachedW !== w || S.cachedH !== h || targets.length === 0) {
    if (targets.length === 0) return;  // shape too small to sample
    S = {
      px: new Float32Array(COUNT), py: new Float32Array(COUNT),
      tx: new Float32Array(COUNT), ty: new Float32Array(COUNT),
      baseSize: new Float32Array(COUNT),
      cachedW: w, cachedH: h, initialised: true,
    };
    for (let i = 0; i < COUNT; i++) {
      // Spawn at random positions across the canvas for an "assemble" entrance.
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

  // Faint glow particles for ambience.
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

/**
 * S3 Hero — particles assemble into the "S³" wordmark.
 *
 * Rewritten 2026-05-01 SGT to mirror the Strands pattern: pre-baked
 * normalised coordinates transformed to world coords on each frame,
 * cached by canvas dimensions. No image sampling, no font dependency,
 * no readback timing — failure modes that drove prior iterations are
 * structurally absent.
 */
export function drawS3Hero(
  ctx: Ctx2D,
  cx: number, cy: number, w: number, h: number,
  normBass: number, primaryColor: string,
) {
  const dim = Math.min(w, h);
  // Cache the world-coord transformation. Recompute only when canvas
  // dimensions change (drawSilhouette also resets its particle state
  // on dimension change, so the two stay synchronised).
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

/**
 * DJ At Work — particles assemble into a stick-figure DJ silhouette.
 *
 * Rewritten 2026-05-01 SGT to mirror the Strands pattern: pre-baked
 * normalised perimeter samples (head, earcups, headphone band, torso
 * outline, two arms, deck outline, two records) transformed to world
 * coords on each frame.
 */
export function drawDJAtWork(
  ctx: Ctx2D,
  cx: number, cy: number, w: number, h: number,
  normBass: number, primaryColor: string,
) {
  const dim = Math.min(w, h);
  const fit = SILHOUETTE_FIT_FACTOR * dim;

  // Cache the static base in world coords on canvas resize. Right arm
  // and shoulder are kept in normalized form because we transform the
  // arm fresh each frame for the pump motion.
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

  // Beat-driven arm rotation. normBass is already smoothed by the
  // audio analyser (it drives sizePulse too). Negative angle = arm
  // swings up in screen coords (Y axis points down). drawSilhouette's
  // per-particle lerp adds another layer of smoothing, so the arm
  // tracks the beat with a soft trail rather than a hard snap.
  const angle = normBass * DJ_ARM_PUMP_MAX;
  const cosA = Math.cos(angle);
  const sinA = Math.sin(angle);
  const [sx, sy] = djAtWorkTargetsCache.shoulderWorld;
  const armN = djAtWorkTargetsCache.armNormalized;

  // Build the live targets array: static base concat with rotated arm.
  // Allocating a fresh array each frame is ~1KB; negligible vs frame
  // budget, and keeps drawSilhouette's contract (single targets array)
  // unchanged.
  const baseLen = djAtWorkTargetsCache.baseWorld.length;
  const armLen = armN.length;
  const targets: [number, number][] = new Array(baseLen + armLen);
  for (let i = 0; i < baseLen; i++) {
    targets[i] = djAtWorkTargetsCache.baseWorld[i];
  }
  for (let i = 0; i < armLen; i++) {
    const [nx, ny] = armN[i];
    // Rotate around shoulder pivot. World coord first, then rotate.
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

/**
 * Reset all cached state. Call this if you need to force a re-sample
 * (e.g. font load, theme change). Worker doesn't need this; preview
 * may want it on hot reload.
 */
export function resetSilhouetteEngine(): void {
  silhouetteStates.s3hero = null;
  silhouetteStates.djatwork = null;
  s3HeroTargetsCache = null;
  djAtWorkTargetsCache = null;
}
