import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@react-pug/react-pug-core': resolve(__dirname, 'packages/react-pug-core/src/index.ts'),
    },
  },
  test: {
    include: ['packages/*/test/**/*.test.ts'],
    globals: true,
    testTimeout: 15000,
  },
});
