import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    // the fits of a voice's delivery take up to 100 s here and half as long again on a shared CI runner
    testTimeout: 360000,
  },
});
