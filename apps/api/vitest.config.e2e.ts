import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    root: './',
    include: ['test/**/*.e2e-spec.ts'],
    testTimeout: 30_000,
    env: {
      // Import main.ts without starting a server; tests call createApp().
      NEPHOSCOPE_NO_BOOTSTRAP: '1',
      // Never pick up the developer's own credentials or probe a metadata server.
      GOOGLE_APPLICATION_CREDENTIALS: '',
      METADATA_SERVER_DETECTION: 'none',
      CLOUDSDK_CONFIG: '/nonexistent-nephoscope-test',
    },
  },
});
