import { defineConfig } from 'vitest/config';

// SPEC-0001 D-18: scenarios that need the emulators (docker compose --profile emulators).
export default defineConfig({
  test: {
    globals: true,
    root: './',
    include: ['test/**/*.emulator-spec.ts'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    env: { METADATA_SERVER_DETECTION: 'none', GOOGLE_APPLICATION_CREDENTIALS: '' },
  },
});
