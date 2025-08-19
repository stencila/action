import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'c8',
      reporter: ['text', 'lcov', 'html'],
      exclude: [
        'node_modules/**',
        'dist/**',
        'test/**',
        '*.config.js',
        '*.config.mjs'
      ]
    },
    testTimeout: 30000,
    hookTimeout: 30000
  }
});