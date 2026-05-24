import ewdsPreset from '@everywear/ewds/tailwind-preset';

/** @type {import('tailwindcss').Config} */
export default {
  presets: [ewdsPreset],
  content: [
    './index.html',
    './src/**/*.{ts,tsx,js,jsx}',
    '../../applets/gener8/web/src/**/*.{ts,tsx,js,jsx}',
    '../../applets/1magen/src/**/*.{ts,tsx,js,jsx}',
    '../../applets/kasai/src/**/*.{ts,tsx,js,jsx}',
    '../../applets/loom/src/**/*.{ts,tsx,js,jsx}',
    '../../applets/character-studio/src/**/*.{ts,tsx,js,jsx}',
  ],
  plugins: [],
};
