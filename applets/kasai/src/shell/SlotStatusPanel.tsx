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

interface SlotEventPayload {
  event?: string;
  slot_event?: {
    kind?: string;
    turn_id?: string;
    calls?: number;
    audit?: unknown;
    tool_call?: unknown;
  };
}

interface SlotDisplayProps {
  label: string;
  modelName: string;
  size: 'big' | 'small';
}

function SlotDisplay({ label, modelName, size }: SlotDisplayProps) {
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

function formatSlotEvent(payload: SlotEventPayload): string | null {
  const event = payload.slot_event;
  if (!event?.kind) return null;

  switch (event.kind) {
    case 'big_planning':
      return 'Primary is planning the turn';
    case 'small_tool_loop_start':
      return 'Agent tool loop started';
    case 'small_tool_loop_complete':
      return `Agent tool loop complete${typeof event.calls === 'number' ? `, ${event.calls} call${event.calls === 1 ? '' : 's'}` : ''}`;
    case 'big_auditing':
      return 'Primary is auditing tool results';
    case 'done':
      return 'Turn complete';
    case 'error':
      return 'Slot event error';
    default:
      return event.kind.replace(/_/g, ' ');
  }
}

export function SlotStatusPanel() {
  const [status, setStatus] = useState<EngineStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recentEvent, setRecentEvent] = useState<string | null>(null);
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
    const transport = getTransport();
    const unlistenSlotEvent = transport.listen<SlotEventPayload>('kasai://slot-event', (payload) => {
      const label = formatSlotEvent(payload);
      if (label) setRecentEvent(label);
    });

    poll();
    timerRef.current = setInterval(poll, POLL_INTERVAL);
    return () => {
      unlistenSlotEvent();
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
  const isWarming = status.runtime_status === 'warming';

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
      {isWarming && <div className="ssp-event">Model warming up...</div>}
      {recentEvent && <div className="ssp-event">{recentEvent}</div>}

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
