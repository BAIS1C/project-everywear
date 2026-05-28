/**
 * @everywear/ewds: Everywear Design System
 *
 * CSS: consumers import '@everywear/ewds/css/global.css' at app root.
 * React: wrap in ThemeProvider, use useTheme() for skin/accent/mode.
 * Tailwind: extend from '@everywear/ewds/tailwind-preset'.
 *
 * All switching is runtime via data attributes on <body>.
 * No build-time theme compilation needed.
 */

// React context
export { ThemeProvider, useTheme, SKINS, ACCENTS, MODES, THEME_PRESETS } from './ThemeContext';

// Types
export type { Skin, Accent, Mode, Theme, WidgetSurface, TrafficSide, ThemeState, SkinPreset, AccentPreset, ModePreset, ThemePreset, ThemeTokens } from './types';
