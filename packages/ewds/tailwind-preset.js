/**
 * @everywear/ewds — Tailwind CSS Preset
 *
 * Consumers add this to their tailwind.config.js:
 *   import ewdsPreset from '@everywear/ewds/tailwind-preset';
 *   export default { presets: [ewdsPreset], content: [...] };
 *
 * Provides skin-aware color scales, EWDS font families, and
 * shared animation keyframes. All color values route through
 * CSS custom properties set by EWDS tokens.css, so they
 * automatically follow skin + accent changes at runtime.
 */

/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        s3: {
          DEFAULT: 'var(--s3-bg, #0A0B0D)',
          dark: 'var(--s3-dark, #050508)',
          sidebar: 'var(--s3-sidebar, #060709)',
          panel: 'var(--s3-panel, #14151C)',
          card: 'var(--s3-card, #1a1b23)',
          hover: 'var(--s3-hover, #1e2030)',
          surface: 'var(--s3-surface, #1E293B)',
          border: 'var(--s3-border, #27272a)',
          cyan: 'var(--s3-cyan, #00C2FF)',
          purple: 'var(--s3-purple, #8b5cf6)',
          text: {
            primary: 'var(--s3-text-primary, #E2E8F0)',
            muted: 'var(--s3-text-muted, #64748B)',
          },
        },
        accent: {
          DEFAULT: 'var(--accent, var(--ew-primary, #00C2FF))',
          50:  'var(--accent-50,  color-mix(in srgb, var(--ew-primary, #00C2FF) 8%,  transparent))',
          100: 'var(--accent-100, color-mix(in srgb, var(--ew-primary, #00C2FF) 16%, transparent))',
          200: 'var(--accent-200, color-mix(in srgb, var(--ew-primary, #00C2FF) 24%, transparent))',
          300: 'var(--accent-300, color-mix(in srgb, var(--ew-primary, #00C2FF) 40%, transparent))',
          400: 'var(--accent-400, var(--ew-primary-hover, #1aceff))',
          500: 'var(--accent-500, var(--ew-primary, #00C2FF))',
          600: 'var(--accent-600, var(--ew-primary-press, #009bcc))',
          700: 'var(--accent-700, color-mix(in srgb, var(--ew-primary, #00C2FF) 80%, #000))',
          800: 'var(--accent-800, color-mix(in srgb, var(--ew-primary, #00C2FF) 60%, #000))',
          900: 'var(--accent-900, color-mix(in srgb, var(--ew-primary, #00C2FF) 40%, #000))',
        },
        strands: {
          pink: '#F000B8',
          yellow: '#F9E100',
          purple: '#8b5cf6',
          red: '#FF4444',
          green: '#22c55e',
        },
      },
      fontFamily: {
        display: ['var(--ew-font-display)', 'Orbitron', 'system-ui', 'sans-serif'],
        sans:    ['var(--ew-font-body)',    'Rajdhani', 'system-ui', 'sans-serif'],
        mono:    ['var(--ew-font-mono)',    'JetBrains Mono', 'ui-monospace', 'monospace'],
      },
      animation: {
        'gradient-x': 'gradient-x 15s ease infinite',
        'pulse-glow': 'pulseGlow 3s ease-in-out infinite',
      },
      keyframes: {
        'gradient-x': {
          '0%, 100%': { 'background-size': '200% 200%', 'background-position': 'left center' },
          '50%': { 'background-size': '200% 200%', 'background-position': 'right center' },
        },
        pulseGlow: {
          '0%, 100%': { opacity: '0.3' },
          '50%': { opacity: '0.7' },
        },
      },
    },
  },
  plugins: [],
};
