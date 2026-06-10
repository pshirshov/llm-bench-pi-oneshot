import js from '@eslint/js';
import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import importPlugin from 'eslint-plugin-import';

export default [
  js.configs.recommended,
  {
    files: ['**/*.ts', '**/*.tsx'],
    ignores: ['vite.config.ts', 'vitest.config.ts', 'eslint.config.js'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        project: './tsconfig.json',
        ecmaVersion: 2022,
        sourceType: 'module',
      },
      globals: {
        window: 'readonly',
        document: 'readonly',
        console: 'readonly',
        performance: 'readonly',
        requestAnimationFrame: 'readonly',
        cancelAnimationFrame: 'readonly',
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
      'import': importPlugin,
    },
    rules: {
      ...tsPlugin.configs['recommended'].rules,
      ...tsPlugin.configs['strict'].rules,
      'import/no-unresolved': 'off',
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-console': 'off',
      'no-undef': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
    },
  },
  {
    files: ['vite.config.ts', 'vitest.config.ts'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
  {
    ignores: ['node_modules', 'dist', 'coverage'],
  },
];