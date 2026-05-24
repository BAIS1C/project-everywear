// @ts-nocheck
/**
 * SvgControls — SVG-based mixer controls ported from openDAW reference.
 *
 * Knob:        Arc-based rotary control for pan (bipolar, center anchor).
 * VolumeFader: Vertical mini-fader for volume (0..1, drawn as thin bar).
 * PeakMeter:   Stereo level indicator with green/yellow/red gradient.
 *
 * 2026-05-15 SGT — Initial port. Simplified from openDAW's Lifecycle
 * model to React controlled components with drag interaction.
 */
import React, { useRef, useCallback, useEffect, useState } from "react";

// ─── SVG Path Helpers (from openDAW lib-dom/svg.ts) ────────────────

function circleSegment(cx: number, cy: number, r: number, a0: number, a1: number): string {
  const x0 = cx + Math.cos(a0) * r;
  const y0 = cy + Math.sin(a0) * r;
  const x1 = cx + Math.cos(a1) * r;
  const y1 = cy + Math.sin(a1) * r;
  let range = a1 - a0;
  while (range < 0) range += Math.PI * 2;
  const large = range > Math.PI ? 1 : 0;
  return `M${x0.toFixed(3)} ${y0.toFixed(3)}A${r} ${r} 0 ${large} 1 ${x1.toFixed(3)} ${y1.toFixed(3)}`;
}

// ─── Knob ──────────────────────────────────────────────────────────

interface KnobProps {
  value: number;         // 0..1 unit value
  anchor?: number;       // 0..1 anchor point (0.5 = center for pan)
  size?: number;         // pixel diameter
  color?: string;        // track color
  onChange?: (v: number) => void;
  label?: string;
}

export function Knob({ value, anchor = 0.5, size = 32, color = "#00C2FF", onChange, label }: KnobProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const dragging = useRef(false);
  const startY = useRef(0);
  const startVal = useRef(0);

  const radius = size / 2;
  const trackWidth = 2;
  const trackRadius = radius - trackWidth * 0.5 - 2;
  const angleOffset = Math.PI / 5;
  const angleMin = Math.PI / 2 + angleOffset;
  const angleRange = Math.PI * 2 - angleOffset * 2;
  const indicatorMin = 0.3;
  const indicatorMax = 0.6;

  const angleVal = angleMin + value * angleRange;
  const angleAnc = angleMin + anchor * angleRange;
  const aMin = Math.min(angleVal, angleAnc);
  const aMax = Math.max(angleVal, angleAnc);
  const valuePath = circleSegment(0, 0, trackRadius, aMin - 1 / trackRadius, aMax + 1 / trackRadius);
  const trackPath = circleSegment(0, 0, trackRadius, angleMin, Math.PI / 2 - angleOffset);
  const cos = Math.cos(angleVal) * trackRadius;
  const sin = Math.sin(angleVal) * trackRadius;
  const indicatorD = `M${(cos * indicatorMin).toFixed(3)} ${(sin * indicatorMin).toFixed(3)}L${(cos * indicatorMax).toFixed(3)} ${(sin * indicatorMax).toFixed(3)}`;
  const height = radius + Math.ceil(Math.cos(angleOffset) * radius);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    dragging.current = true;
    startY.current = e.clientY;
    startVal.current = value;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, [value]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragging.current || !onChange) return;
    const delta = (startY.current - e.clientY) / 120;
    const next = Math.max(0, Math.min(1, startVal.current + delta));
    onChange(next);
  }, [onChange]);

  const handlePointerUp = useCallback(() => { dragging.current = false; }, []);

  const handleDoubleClick = useCallback(() => {
    onChange?.(anchor);
  }, [onChange, anchor]);

  return (
    <div
      style={{ display: "inline-flex", alignItems: "center", gap: 2, cursor: "ns-resize", userSelect: "none" }}
      title={label || `${Math.round((value - 0.5) * 200)}%`}
    >
      <span style={{ fontSize: 8, color: "#64748B", fontWeight: 600, lineHeight: 1, userSelect: "none" }}>L</span>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${size} ${height}`}
        width={size}
        height={height}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onDoubleClick={handleDoubleClick}
      >
        <defs>
          <linearGradient id="knob-rim" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgba(255,255,255,0.4)" />
            <stop offset="100%" stopColor="rgba(0,0,0,0.6)" />
          </linearGradient>
        </defs>
        <g
          fill="none"
          stroke={color}
          strokeLinecap="butt"
          strokeWidth={trackWidth}
          transform={`translate(${radius}, ${radius})`}
        >
          {/* Shadow */}
          <circle r={trackRadius * indicatorMax * 1.1} stroke="none" fill="rgba(0,0,0,0.4)" cy={radius * 0.08} />
          {/* Cap */}
          <circle r={trackRadius * indicatorMax} stroke="none" fill="#1E293B" />
          <circle r={trackRadius * indicatorMax} stroke="url(#knob-rim)" strokeWidth={0.5} fill="none" />
          {/* Track background */}
          <path stroke={color} strokeOpacity={0.2} d={trackPath} />
          {/* Value arc */}
          <path d={valuePath} />
          {/* Indicator line */}
          <path d={indicatorD} strokeLinecap="round" strokeWidth={2} stroke="#E2E8F0" />
        </g>
      </svg>
      <span style={{ fontSize: 8, color: "#64748B", fontWeight: 600, lineHeight: 1, userSelect: "none" }}>R</span>
    </div>
  );
}

// ─── VolumeFader ───────────────────────────────────────────────────

interface VolumeFaderProps {
  value: number;         // 0..1
  height?: number;       // pixel height
  color?: string;
  onChange?: (v: number) => void;
}

export function VolumeFader({ value, height = 48, color = "#00C2FF", onChange }: VolumeFaderProps) {
  const dragging = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const barWidth = 6;
  const thumbHeight = 10;
  const padding = 2;
  const trackHeight = height - padding * 2;
  const fillHeight = trackHeight * value;

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    dragging.current = true;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    updateFromPointer(e);
  }, [onChange, height]);

  const updateFromPointer = useCallback((e: React.PointerEvent) => {
    if (!containerRef.current || !onChange) return;
    const rect = containerRef.current.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const v = Math.max(0, Math.min(1, 1 - y / rect.height));
    onChange(v);
  }, [onChange]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragging.current) return;
    updateFromPointer(e);
  }, [updateFromPointer]);

  const handlePointerUp = useCallback(() => { dragging.current = false; }, []);

  return (
    <div
      ref={containerRef}
      style={{ width: barWidth + 4, height, cursor: "ns-resize", position: "relative", userSelect: "none" }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      title={`${Math.round(value * 100)}%`}
    >
      <svg width={barWidth + 4} height={height} style={{ display: "block" }}>
        {/* Track background */}
        <rect x={2} y={padding} width={barWidth} height={trackHeight} rx={2} fill="#1E293B" />
        {/* Fill */}
        <rect
          x={2}
          y={padding + trackHeight - fillHeight}
          width={barWidth}
          height={fillHeight}
          rx={2}
          fill={color}
          opacity={0.7}
        />
        {/* 0dB mark (at ~80% height) */}
        <line x1={0} y1={padding + trackHeight * 0.2} x2={barWidth + 4} y2={padding + trackHeight * 0.2} stroke="#475569" strokeWidth={0.5} strokeDasharray="2,2" />
        {/* Thumb */}
        <rect
          x={0}
          y={padding + trackHeight - fillHeight - thumbHeight / 2}
          width={barWidth + 4}
          height={thumbHeight}
          rx={2}
          fill="#E2E8F0"
          stroke="#0F172A"
          strokeWidth={0.5}
        />
      </svg>
    </div>
  );
}

// ─── PeakMeter ────────────────────────────────────────────────────

interface PeakMeterProps {
  level?: number;        // 0..1 current RMS level
  peak?: number;         // 0..1 peak hold level
  height?: number;
  color?: string;
}

export function PeakMeter({ level = 0, peak, height = 48, color }: PeakMeterProps) {
  const barWidth = 4;
  const padding = 2;
  const trackH = height - padding * 2;
  const fillH = trackH * Math.min(1, level);
  const peakY = peak != null ? padding + trackH * (1 - Math.min(1, peak)) : null;

  return (
    <svg width={barWidth + 2} height={height} style={{ display: "block" }}>
      <defs>
        <linearGradient id="meter-grad" x1="0" y1="1" x2="0" y2="0">
          <stop offset="0%" stopColor="#22C55E" />
          <stop offset="70%" stopColor="#EAB308" />
          <stop offset="90%" stopColor="#EF4444" />
        </linearGradient>
      </defs>
      {/* Background */}
      <rect x={1} y={padding} width={barWidth} height={trackH} rx={1} fill="#0F172A" />
      {/* Level fill */}
      <rect
        x={1}
        y={padding + trackH - fillH}
        width={barWidth}
        height={fillH}
        rx={1}
        fill="url(#meter-grad)"
        opacity={0.85}
      />
      {/* Peak hold line */}
      {peakY != null && (
        <line x1={1} y1={peakY} x2={barWidth + 1} y2={peakY} stroke="#FBBF24" strokeWidth={1} />
      )}
    </svg>
  );
}
