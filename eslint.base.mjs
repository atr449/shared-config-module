// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

/**
 * Shared ESLint flat-config base for FusionX VASP services.
 *
 * Consume from a service's eslint.config.mjs:
 *   import base from '@fusionxglobal/shared-config/eslint';
 *   export default [...base, { rules: { ...service overrides... } }];
 *
 * Philosophy: establish enforcement without blocking CI on the existing
 * backlog. Style/type-debt rules are `warn` (notably no-explicit-any — the
 * `any` cleanup is a separate type-hardening pass); only genuinely-broken
 * things (debugger, etc.) are `error`. Teams can ratchet rules up over time.
 */
export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // Lazy `require()` is used intentionally for optional peer deps.
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/no-var-requires': 'off',
      '@typescript-eslint/no-empty-object-type': 'warn',
      '@typescript-eslint/ban-ts-comment': 'warn',
      // `declare global { namespace Express { interface Request } }` is the
      // standard Express type-augmentation pattern — not a real namespace.
      '@typescript-eslint/no-namespace': 'off',
      'no-console': 'warn',
      'prefer-const': 'warn',
      eqeqeq: ['warn', 'smart'],
      'no-debugger': 'error',
    },
  },
  {
    // Bootstrap, migrations, seeders and tests legitimately use console
    // (they run before the logger is configured, or outside the app runtime).
    files: [
      '**/migrations/**',
      '**/seeders/**',
      '**/tests/**',
      '**/*.test.ts',
      '**/*.spec.ts',
      '**/config/**',
      '**/env/**',
      '**/loadEnv.ts',
      '**/tracing.helper.ts',
      '**/server.ts',
      '**/server.init.ts',
      '**/client.initializer.ts',
    ],
    rules: { 'no-console': 'off' },
  },
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'coverage/**',
      '**/*.js',
      '**/*.cjs',
      '**/*.mjs',
    ],
  },
);
