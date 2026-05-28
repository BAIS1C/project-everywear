/**
 * Everywear root ESLint flat config (ESLint 9).
 *
 * Policy as of 2026-05-27 (Track A build-hygiene pass):
 * - Recommended @typescript-eslint rules are ON.
 * - `ban-ts-comment` is `error` so the active Gener8 web @ts-nocheck port
 *   debt stays visible in CI. There is NO blanket carve-out for the ported
 *   components: the goal is to migrate them properly, not to hide the debt
 *   behind config indulgence. See:
 *     - WIKI.md "Gener8 web @ts-nocheck migration" section
 *     - CONTEXT.md addendum 2026-05-27 (Track A + migration)
 *     - vault/2026-05-27_eslint-flat-config-and-gener8-ts-nocheck-migration.md
 * - `no-explicit-any` is `warn` so the existing 24 instances are surfaced
 *   without blocking CI. Tighten progressively.
 *
 * Files that legitimately cannot be migrated yet should use
 * `@ts-expect-error: <reason>` per-line, not `@ts-nocheck` per-file.
 */

import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';

export default [
  {
    ignores: [
      '**/node_modules/**',
      '**/target/**',
      '**/dist/**',
      '**/build/**',
      '**/.git/**',
      '**/.next/**',
      '**/coverage/**',
      '**/*.d.ts',
      '**/vendor/**',
      '**/.codex-runlogs/**',
      // EWDS preset is a Tailwind config helper, not lint-relevant source.
      'packages/ewds/tailwind-preset.mjs',
      // Tailwind configs are plain JS and out of TS lint scope here.
      '**/tailwind.config.js',
      '**/postcss.config.js',
      '**/vite.config.{js,ts}',
    ],
  },
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: {
      '@typescript-eslint': tseslint,
    },
    rules: {
      // Pull in the recommended TS rule set explicitly (flat-config style).
      ...tseslint.configs.recommended.rules,

      // Port debt is real; keep it visible. NO carve-out for Gener8 web.
      '@typescript-eslint/ban-ts-comment': [
        'error',
        {
          'ts-nocheck': true,
          'ts-ignore': 'allow-with-description',
          'ts-expect-error': 'allow-with-description',
          'ts-check': false,
          minimumDescriptionLength: 10,
        },
      ],

      // 24 instances currently. Warn now, tighten later.
      '@typescript-eslint/no-explicit-any': 'warn',

      // Common quality-of-life overrides for an active migration codebase.
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-empty-function': 'off',
      '@typescript-eslint/no-empty-object-type': 'off',
    },
  },
];
