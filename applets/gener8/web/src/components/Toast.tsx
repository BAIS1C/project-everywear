/**
 * Toast — backwards-compatible adapter on top of EWDS ToastHost.
 *
 * Two ways to use:
 *
 *   1. Imperative (preferred for new code):
 *        import { showToast } from '@/components/ToastHost';
 *        showToast({ kind: 'success', message: 'Saved' });
 *
 *   2. Declarative legacy API (existing call sites in App.tsx, Gener8Core):
 *        <Toast message="Saved" type="success" isVisible={visible} onClose={...} />
 *
 *      The legacy <Toast /> component now bridges to the global ToastHost:
 *      when `isVisible` flips to true, it dispatches a showToast() and
 *      immediately calls onClose() on the next tick so the parent's
 *      `isVisible` state can return to false. The host owns dismissal.
 *
 * Both APIs render through the same .ew-toast styling driven by tokens,
 * so chamfer in classic/refined and sharp 0px in terminal both work.
 *
 * Migrated out of @ts-nocheck on 2026-05-27 (Track C Gener8
 * web type-bridge migration, batch 1). Inspection found no
 * real type errors; the pragma was port-time blanket noise.
 */
import { useEffect, useRef } from 'react';
import { showToast as showToastImperative, type ToastKind } from './ToastHost';

// Legacy type kept exported so existing imports continue to type-check.
export type ToastType = 'success' | 'error' | 'info';

interface ToastProps {
  message: string;
  type?: ToastType;
  isVisible: boolean;
  onClose: () => void;
  duration?: number;
}

const LEGACY_TYPE_TO_KIND: Record<ToastType, ToastKind> = {
  success: 'success',
  error: 'error',
  info: 'info',
};

/**
 * Legacy declarative Toast. Renders nothing; pushes to the global host
 * each time `isVisible` transitions false → true. Calls onClose on the
 * next tick so the parent state machine doesn't get stuck.
 */
export function Toast({
  message,
  type = 'success',
  isVisible,
  onClose,
  duration = 3000,
}: ToastProps) {
  // Track the last (message, type) we pushed so a re-render with the same
  // visible state doesn't re-fire.
  const lastPushedRef = useRef<{ msg: string; type: ToastType } | null>(null);

  useEffect(() => {
    if (!isVisible || !message) return;
    const last = lastPushedRef.current;
    if (last && last.msg === message && last.type === type) return;
    lastPushedRef.current = { msg: message, type };

    showToastImperative({
      kind: LEGACY_TYPE_TO_KIND[type],
      message,
      durationMs: duration > 0 ? duration : 5000,
    });

    // Reset parent's isVisible flag on the next tick. Toast lifecycle
    // moves to the host.
    const t = setTimeout(() => onClose(), 0);
    return () => clearTimeout(t);
    // We deliberately don't depend on `onClose` to avoid re-fire loops
    // when the parent passes a fresh function each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isVisible, message, type, duration]);

  return null;
}

export { showToast } from './ToastHost';
export type { ToastKind, ShowToastInput } from './ToastHost';
