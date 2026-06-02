/**
 * skinSync.js — EWDS skin propagation for Avatar Studio.
 *
 * Three contexts:
 *   1. Standalone dev (npm run dev) — localStorage with fallback to classic
 *   2. Embedded in S3 shell as iframe — receives via postMessage
 *   3. Embedded as Tauri webview — receives via __TAURI__ event channel
 */

const VALID_SKINS = ['classic', 'refined', 'terminal'];
const VALID_MODES = ['light', 'dark'];

export function applySkin(skin, mode = 'dark') {
  if (!VALID_SKINS.includes(skin)) skin = 'classic';
  if (!VALID_MODES.includes(mode)) mode = 'dark';

  // Set on both html and body for selector compatibility
  // (EWDS tokens target body[data-skin], brief targets html[data-skin])
  document.documentElement.setAttribute('data-skin', skin);
  document.documentElement.setAttribute('data-mode', mode);
  document.body?.setAttribute('data-skin', skin);
  document.body?.setAttribute('data-mode', mode);

  try {
    localStorage.setItem('ew-skin', skin);
    localStorage.setItem('ew-mode', mode);
  } catch { /* storage unavailable */ }
}

export function initSkinSync() {
  // 1. Boot from localStorage (or default classic/dark)
  const initSkin = (() => {
    try { return localStorage.getItem('ew-skin'); } catch { return null; }
  })() ?? 'classic';
  const initMode = (() => {
    try { return localStorage.getItem('ew-mode'); } catch { return null; }
  })() ?? 'dark';
  applySkin(initSkin, initMode);

  // 2. Listen for postMessage from embedding shell
  window.addEventListener('message', (e) => {
    if (e.data?.type === 's3:skin') {
      applySkin(e.data.skin, e.data.mode);
    }
  });

  // 3. Tauri event channel (best-effort, non-blocking)
  // Use __TAURI__ global directly to avoid Vite trying to resolve @tauri-apps/api
  if (window.__TAURI__?.event?.listen) {
    window.__TAURI__.event.listen('s3:skin', (evt) => applySkin(evt.payload?.skin, evt.payload?.mode));
  }
}
