import fs from 'node:fs';

import { build } from 'esbuild';

const { version } = JSON.parse(
  fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
);
const skillRoot = new URL('../../skills/artifacts/', import.meta.url);
const documents = Object.fromEntries(
  [
    'SKILL.md',
    'artboard.md',
    'artboard-prototype.md',
    'claude-artifacts.md',
    'document.md',
    'html.md',
    'icons.md',
    'remote.md',
    'ui.md',
    'examples/today-inbox.html',
  ].map((name) => [name, fs.readFileSync(new URL(name, skillRoot), 'utf8')]),
);
await build({
  entryPoints: ['src/cli/main.ts'],
  bundle: true,
  platform: 'node',
  target: 'node18',
  format: 'cjs',
  banner: { js: '#!/usr/bin/env node' },
  define: { CLI_VERSION: JSON.stringify(version), CLI_SKILL_DOCUMENTS: JSON.stringify(documents) },
  outfile: 'dist/cli.cjs',
});
fs.copyFileSync('dist/cli.cjs', '../skills/artifacts/app/cli.cjs');
