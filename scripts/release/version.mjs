import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { parseNotes } from './notes.mjs';
import { root, syncVersions } from './versions.mjs';

syncVersions(root, true);
const pending = fs
  .readdirSync(path.join(root, '.changeset'))
  .filter((name) => name.endsWith('.md') && name !== 'README.md');
for (const name of pending) {
  const text = fs.readFileSync(path.join(root, '.changeset', name), 'utf8');
  if (!/^---\s*\n["']?anjian-workflow["']?: (?:patch|minor|major)\s*\n---/.test(text)) {
    throw new Error(`Only the private root product may be versioned: ${name}`);
  }
  parseNotes(text, true);
}
if (process.argv.includes('--check')) process.exit(0);
if (pending.length)
  execFileSync('pnpm', ['exec', 'changeset', 'version'], { cwd: root, stdio: 'inherit' });
else console.info('No unreleased changesets; versions unchanged.');
syncVersions();
