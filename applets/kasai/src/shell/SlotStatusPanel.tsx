/**
 * SlotStatusPanel — Big/Small slot visualization for Kasai.
 *
 * Polls get_engine_status every 3 seconds via transport.invoke().
 * Renders a visual panel showing loaded model slots, GPU usage, and tier.
 *
 * Big slot = Primary orchestrator (e.g. Qwen3.6 35B)
 * Small slot = Agent/Encoder (e.g. Qwen3.5 9B)
 *
 * Uses EWDS tokens via the Agent Hub applet stylesheet.
 */
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { getTransport, type EngineStatus } from '../lib/transport';

const POLL_INTERVAL = 3000;

interface SlotDisplayProps {
  label: string;
  modelName: string;
  size: 'big' | 'small';
}

function SlotDisplay({ label, modelName, size }: SlotDisplayProps) {
  const isBig = size === 'big';
  return (
    <div className={`ssp-slot ssp-slot--${size}`}>
      <div className="ssp-slot__indicator" />
      <div className="ssp-slot__info">
        <span className="ssp-slot__label">{label}</span>
        <span className="ssp-slot__model">{modelName}</span>
      </div>
    </div>
  );
}

export function SlotStatusPanel() {
  const [status, setStatus] = useState<EngineStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const poll = useCallback(async () => {
    try {
      const transport = getTransport();
      const result = await transport.invoke<EngineStatus>('get_engine_status');
      setStatus(result);
      setError(null);
    } catch (err) {
      setError('Engine offline');
    }
  }, []);

  useEffect(() => {
    poll();
    timerRef.current = setInterval(poll, POLL_INTERVAL);
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [poll]);

  if (error) {
    return (
      <div className="ssp-root ssp-root--error">
        <span className="ssp-offline-dot" />
        <span className="ssp-offline-label">{error}</span>
      </div>
    );
  }

  if (!status) {
    return (
      <div className="ssp-root ssp-root--loading">
        <span className="ssp-loading-text">Connecting...</span>
      </div>
    );
  }

  // Map slots: first slot is "big" (Primary), rest are "small"
  const slots = status.loaded_slots.map((s, i) => ({
    ...s,
    size: (i === 0 ? 'big' : 'small') as 'big' | 'small',
  }));

  // Parse VRAM from GPU info
  const vramTotal = status.gpu.vram_mb;
  const vramLabel = vramTotal >= 1024
    ? `${(vramTotal / 1024).toFixed(0)} GB`
    : `${vramTotal} MB`;

  return (
    <div className="ssp-root">
      {/* GPU + Tier header */}
      <div className="ssp-header">
        <span className="ssp-header__gpu">{status.gpu.name}</span>
        <span className="ssp-header__vram">{vramLabel}</span>
      </div>

      <div className="ssp-tier">{status.tier}</div>

      {/* Slot visualizations */}
      <div className="ssp-slots">
        {slots.map((s) => (
          <SlotDisplay
            key={s.slot}
            label={s.slot}
            modelName={s.model_name}
            size={s.size}
          />
        ))}
      </div>

      {/* Version footer */}
      <div className="ssp-version">v{status.version}</div>
    </div>
  );
}
