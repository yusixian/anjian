import fs from 'node:fs';

import { build } from 'esbuild';

import { buildInfo } from '../../scripts/release/build-info.mjs';

await build({
  entryPoints: ['src/server/main.ts'],
  bundle: true,
  platform: 'node',
  target: 'node18',
  format: 'cjs',
  alias: { 'loro-crdt': 'loro-crdt/base64' },
  define: { ANJIAN_BUILD_INFO: JSON.stringify(buildInfo()) },
  outfile: 'dist/server.cjs',
});
fs.copyFileSync('dist/server.cjs', '../skills/artifacts/app/server.cjs');
