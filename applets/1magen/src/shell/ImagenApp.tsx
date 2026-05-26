/**
 * ImagenApp — standalone Tauri entry point.
 * Wraps ImagenCore in the shared EWDS ThemeProvider for standalone mode.
 * When running inside Everywear OS, the shell provides ThemeProvider
 * and mounts ImagenCore directly.
 */
import React from 'react';
import { ThemeProvider } from '@everywear/ewds';
import { ImagenCore } from './ImagenCore';

export function ImagenApp() {
  return (
    <ThemeProvider>
      <ImagenCore />
    </ThemeProvider>
  );
}
