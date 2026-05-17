/**
 * Gener8 applet Tailwind config.
 * Extends the shared EWDS preset for skin-aware colour tokens.
 */
import ewdsPreset from '@everywear/ewds/tailwind-preset';

/** @type {import('tailwindcss').Config} */
export default {
  presets: [ewdsPreset],
  content: [
    './index.html',
    './src/**/*.{ts,tsx,js,jsx}',
  ],
  plugins: [],
};
