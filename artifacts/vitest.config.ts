import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.{ts,tsx}'],
    environment: 'node',
    globalSetup: ['test/global-setup.ts'],
    setupFiles: [
      'test/setup-isolation.ts',
      'test/setup-tokens.ts',
      'test/setup-locale.ts',
      'test/setup-text-measurement.ts',
    ],
    hookTimeout: 120000,
    // Spawned CLIs and servers inherit these, so no test can sign in with the developer's real account.
    env: {
      XDG_CONFIG_HOME: fs.mkdtempSync(path.join(os.tmpdir(), 'anjian-test-config-')),
      ANJIAN_RUNTIME_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'anjian-test-runtime-')),
      ANJIAN_CLOUD_ORIGIN: 'http://127.0.0.1:9',
      ANJIAN_ARTIFACTS_PORTS: '0',
      ANJIAN_ARTIFACTS_BOARD_PORTS: '0',
      ANJIAN_NO_UPDATE_CHECK: '1',
    },
  },
});
