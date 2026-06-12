import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.ts', 'tests/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      'max-lines': ['error', { max: 500, skipBlankLines: true, skipComments: true }],
      'no-restricted-properties': [
        'error',
        {
          object: 'Math',
          property: 'random',
          message: 'Use seeded PRNG instead of Math.random. Only allowed in src/core/prng.ts.',
        },
      ],
    },
  },
  {
    files: ['src/core/prng.ts'],
    rules: {
      'no-restricted-properties': 'off',
    },
  },
  {
    ignores: ['dist/**', 'node_modules/**'],
  },
);
