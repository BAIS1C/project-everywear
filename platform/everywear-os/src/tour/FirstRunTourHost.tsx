import { useCallback, useEffect, useMemo, useState } from 'react';
import { getPreference, setPreference } from '../lib/transport';
import { FIRST_RUN_TOUR, type TourPlacement, type TourStep } from './tourManifests';

const COMPLETED_KEY = 'tour.firstRun.completed';
const STEP_KEY = 'tour.firstRun.step';

interface TargetRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

function hasTauriRuntime() {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

async function readPreference(key: string) {
  if (hasTauriRuntime()) {
    try {
      return await getPreference(key);
    } catch {
      return null;
    }
  }
  return window.localStorage.getItem(key);
}

async function writePreference(key: string, value: string) {
  if (hasTauriRuntime()) {
    try {
      await setPreference(key, value);
      return;
    } catch {
      // Fall through to localStorage so preview builds still behave.
    }
  }
  window.localStorage.setItem(key, value);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function getTargetRect(step: TourStep): TargetRect | null {
  if (!step.selector) return null;
  const target = document.querySelector<HTMLElement>(step.selector);
  if (!target) return null;

  const rect = target.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;

  return {
    top: rect.top,
    left: rect.left,
    width: rect.width,
    height: rect.height,
  };
}

function cardPosition(rect: TargetRect | null, placement: TourPlacement | undefined) {
  const cardWidth = 360;
  const cardHeight = 230;
  const margin = 18;
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;

  if (!rect || placement === 'center') {
    return {
      left: Math.round((viewportWidth - cardWidth) / 2),
      top: Math.round((viewportHeight - cardHeight) / 2),
    };
  }

  const place = placement ?? 'bottom';
  let left = rect.left + rect.width / 2 - cardWidth / 2;
  let top = rect.top + rect.height + margin;

  if (place === 'top') top = rect.top - cardHeight - margin;
  if (place === 'right') {
    left = rect.left + rect.width + margin;
    top = rect.top + rect.height / 2 - cardHeight / 2;
  }
  if (place === 'left') {
    left = rect.left - cardWidth - margin;
    top = rect.top + rect.height / 2 - cardHeight / 2;
  }

  return {
    left: Math.round(clamp(left, margin, viewportWidth - cardWidth - margin)),
    top: Math.round(clamp(top, margin + 28, viewportHeight - cardHeight - margin)),
  };
}

export function FirstRunTourHost() {
  const [ready, setReady] = useState(false);
  const [open, setOpen] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [targetRect, setTargetRect] = useState<TargetRect | null>(null);
  const [targetMissing, setTargetMissing] = useState(false);

  const steps = FIRST_RUN_TOUR.steps;
  const step = steps[stepIndex] ?? steps[0];
  const isFirst = stepIndex === 0;
  const isLast = stepIndex === steps.length - 1;

  const updateTarget = useCallback(() => {
    if (!open || !step) return;
    const rect = getTargetRect(step);
    setTargetRect(rect);
    setTargetMissing(Boolean(step.selector && !rect));
  }, [open, step]);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const completed = await readPreference(COMPLETED_KEY);
      const savedStep = await readPreference(STEP_KEY);
      if (cancelled) return;

      const parsedStep = Number.parseInt(savedStep ?? '', 10);
      if (Number.isFinite(parsedStep)) {
        setStepIndex(clamp(parsedStep, 0, steps.length - 1));
      }
      setOpen(completed !== 'true');
      setReady(true);
    })();

    return () => {
      cancelled = true;
    };
  }, [steps.length]);

  useEffect(() => {
    if (!open) return;
    updateTarget();
    const interval = window.setInterval(updateTarget, 500);
    window.addEventListener('resize', updateTarget);
    window.addEventListener('scroll', updateTarget, true);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('resize', updateTarget);
      window.removeEventListener('scroll', updateTarget, true);
    };
  }, [open, updateTarget]);

  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        void finishTour();
      }
      if (event.key === 'ArrowRight' || event.key === 'Enter') {
        event.preventDefault();
        void advance();
      }
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        back();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  });

  const persistStep = useCallback(async (nextIndex: number) => {
    await writePreference(STEP_KEY, String(nextIndex));
  }, []);

  const finishTour = useCallback(async () => {
    await writePreference(COMPLETED_KEY, 'true');
    await writePreference(STEP_KEY, '0');
    setOpen(false);
  }, []);

  const advance = useCallback(async () => {
    if (isLast) {
      await finishTour();
      return;
    }
    const nextIndex = clamp(stepIndex + 1, 0, steps.length - 1);
    setStepIndex(nextIndex);
    await persistStep(nextIndex);
  }, [finishTour, isLast, persistStep, stepIndex, steps.length]);

  const back = useCallback(() => {
    if (isFirst) return;
    const nextIndex = clamp(stepIndex - 1, 0, steps.length - 1);
    setStepIndex(nextIndex);
    void persistStep(nextIndex);
  }, [isFirst, persistStep, stepIndex, steps.length]);

  const cardStyle = useMemo(
    () => cardPosition(targetRect, targetMissing ? 'center' : step.placement),
    [step.placement, targetMissing, targetRect],
  );

  if (!ready || !open || !step) return null;

  const progressLabel = `${stepIndex + 1}/${steps.length}`;
  const haloStyle = targetRect
    ? {
        top: Math.round(targetRect.top - 6),
        left: Math.round(targetRect.left - 6),
        width: Math.round(targetRect.width + 12),
        height: Math.round(targetRect.height + 12),
      }
    : undefined;

  return (
    <div className="ew-tour-host" role="dialog" aria-modal="true" aria-label={FIRST_RUN_TOUR.title}>
      <div className="ew-tour-mask" />
      {haloStyle && <div className="ew-tour-halo" style={haloStyle} />}
      <section className="ew-tour-card" style={cardStyle}>
        <div className="ew-tour-card__head">
          <span className="ew-tour-card__progress">{progressLabel}</span>
          <span className="ew-tour-card__progress">{step.eyebrow}</span>
        </div>
        <h2 className="ew-tour-card__title">{step.title}</h2>
        <p className="ew-tour-card__body">
          {targetMissing ? 'This stop is currently hidden. ' : ''}
          {step.body}
        </p>
        <div className="ew-tour-card__footer">
          <button type="button" className="ew-btn ew-btn--ghost ew-btn--sm" onClick={() => void finishTour()}>
            Skip
          </button>
          <div className="ew-tour-card__nav">
            <button type="button" className="ew-btn ew-btn--ghost ew-btn--sm" onClick={back} disabled={isFirst}>
              Back
            </button>
            <button type="button" className="ew-btn ew-btn--primary ew-btn--sm" onClick={() => void advance()}>
              {isLast ? 'Done' : step.cta ?? 'Next'}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
