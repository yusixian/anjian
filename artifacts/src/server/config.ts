import fs from 'node:fs';
import path from 'node:path';

import { writeJsonAtomic } from './state';

const IGNORED = [
  'config.json',
  'artifacts/*',
  '!artifacts/document/',
  'artifacts/document/*/.artifact-id',
];

function ensureGitignore(dir: string) {
  const file = path.join(dir, '.gitignore');
  let current = '';
  try {
    current = fs.readFileSync(file, 'utf8');
  } catch {}
  const present = new Set(current.split(/\r?\n/).map((line) => line.trim()));
  const missing = IGNORED.filter((line) => !present.has(line));
  if (missing.length === 0) return;
  fs.writeFileSync(
    file,
    `${current}${current === '' || current.endsWith('\n') ? '' : '\n'}${missing.join('\n')}\n`,
  );
}

export function ensureConfig(file: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  ensureGitignore(path.dirname(file));
  if (!fs.existsSync(file)) writeJsonAtomic(file, { version: 1 });
}
