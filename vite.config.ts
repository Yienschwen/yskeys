import { defineConfig } from 'vitest/config';

/**
 * Deployed as a GitHub Pages project site: https://<user>.github.io/yskeys/
 * The base must match the repository name, or every built asset 404s.
 */
const BASE = '/yskeys/';

export default defineConfig({
  base: BASE,
  build: {
    target: 'es2022',
    sourcemap: false,
  },
  test: {
    environment: 'node',
    include: ['src/test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/core/**/*.ts', 'src/store/**/*.ts'],
      reporter: ['text', 'html'],
      thresholds: {
        lines: 80,
        statements: 80,
        functions: 80,
        branches: 80,
      },
    },
  },
});
