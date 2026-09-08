// Configuracion compartida de ESLint para todo el monorepo (docs/plan/07 §4).
import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/.turbo/**',
      '**/next-env.d.ts',
      'coverage/**',
      // Scripts de skills de QA (Claude): corren con Node 22 a mano, no son
      // codigo del producto.
      '.claude/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.mjs', '**/*.js'],
    languageOptions: {
      globals: { process: 'readonly', console: 'readonly', Buffer: 'readonly' },
    },
  },
  {
    rules: {
      // Sin `any` salvo justificado con comentario (docs/plan/07 §4):
      // se desactiva puntualmente con eslint-disable + motivo.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    // Reglas de hooks de React (2026-09-07): un hook declarado despues de un
    // return anticipado o dentro de un if rompe la pagina entera en runtime
    // ("Rendered more hooks than during the previous render") y ni tsc ni
    // el build lo detectan. Solo rules-of-hooks: exhaustive-deps queda fuera
    // porque el codigo maneja las dependencias a mano.
    files: ['apps/web/**/*.tsx'],
    plugins: { 'react-hooks': reactHooks },
    rules: { 'react-hooks/rules-of-hooks': 'error' },
  },
  prettier,
);
