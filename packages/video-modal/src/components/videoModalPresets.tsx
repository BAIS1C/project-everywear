import React from 'react';
import { Activity, Aperture, BarChart2, Box, Circle, Disc, Grid, Type, Waves } from 'lucide-react';
import type { PresetType } from './videoModalTypes';

const S3Wordmark = () => (
  <span
    aria-hidden="true"
    style={{
      display: 'inline-block',
      fontFamily: 'var(--ew-font-display)',
      fontWeight: 800,
      fontSize: 14,
      letterSpacing: '0.04em',
      lineHeight: 1,
      color: 'currentColor',
    }}
  >
    S³
  </span>
);

const DJWordmark = () => (
  <span
    aria-hidden="true"
    style={{
      display: 'inline-block',
      fontFamily: 'var(--ew-font-mono)',
      fontWeight: 700,
      fontSize: 12,
      letterSpacing: '0.18em',
      lineHeight: 1,
      color: 'currentColor',
    }}
  >
    DJ
  </span>
);

function ColumnsIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3v18" />
      <rect width="18" height="18" x="3" y="3" rx="2" />
    </svg>
  );
}

export const PRESETS: { id: PresetType; label: string; icon: React.ReactNode }[] = [
  { id: 'S3 Hero', label: 'S³', icon: <S3Wordmark /> },
  { id: 'DJ At Work', label: 'DJ', icon: <DJWordmark /> },
  { id: 'Strands Particle', label: 'Strands', icon: <Disc size={16} /> },
  { id: 'NCS Circle', label: 'Classic NCS', icon: <Circle size={16} /> },
  { id: 'Linear Bars', label: 'Spectrum', icon: <BarChart2 size={16} /> },
  { id: 'Dual Mirror', label: 'Mirror', icon: <ColumnsIcon /> },
  { id: 'Center Wave', label: 'Shockwave', icon: <Waves size={16} /> },
  { id: 'Orbital', label: 'Orbital', icon: <Disc size={16} /> },
  { id: 'Hexagon', label: 'Hex Core', icon: <Box size={16} /> },
  { id: 'Oscilloscope', label: 'Analog', icon: <Activity size={16} /> },
  { id: 'Digital Rain', label: 'Matrix', icon: <Grid size={16} /> },
  { id: 'Shockwave', label: 'Pulse', icon: <Aperture size={16} /> },
  { id: 'Minimal', label: 'Clean', icon: <Type size={16} /> },
];
