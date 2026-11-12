import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { currentNotes } from './notes.mjs';
import { root, syncVersions } from './versions.mjs';

export function hashFile(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

export function buildInfo(
  directory = root,
  git = (args) =>
    execFileSync('git', args, {
      cwd: directory,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim(),
) {
  const version = syncVersions(directory, true);
  let sha = null;
  let state = 'unknown';
  try {
    // A source export inside another repository must not borrow its parent's identity.
    if (fs.realpathSync(git(['rev-parse', '--show-toplevel'])) !== fs.realpathSync(directory))
      throw new Error('Not this repository');
    const head = git(['rev-parse', 'HEAD']);
    if (!/^[a-f0-9]{40}$/.test(head)) throw new Error('Invalid HEAD');
    state = git(['status', '--porcelain', '--untracked-files=normal']) ? 'dirty' : 'clean';
    sha = head;
  } catch {
    const context = path.join(directory, '.anjian-build.json');
    if (fs.existsSync(context)) {
      const saved = JSON.parse(fs.readFileSync(context, 'utf8'));
      if (
        saved.version !== version ||
        saved.state !== 'clean' ||
        !/^[a-f0-9]{40}$/.test(saved.sha) ||
        !saved.files ||
        Object.keys(saved.files).length === 0
      ) {
        throw new Error('Invalid exported build context');
      }
      for (const [file, hash] of Object.entries(saved.files)) {
        if (
          path.isAbsolute(file) ||
          file.split('/').includes('..') ||
          hash !== hashFile(path.join(directory, file))
        ) {
          throw new Error(`Exported source changed: ${file}`);
        }
      }
      sha = saved.sha;
      state = 'exported';
    }
  }
  return { version, sha, state, notes: currentNotes(directory, version) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const info = buildInfo();
  if (process.argv[2] === '--export') {
    if (info.state !== 'clean') throw new Error('Only a clean checkout can export build identity');
    const files = Object.fromEntries(
      execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' })
        .split('\0')
        .filter(Boolean)
        .map((file) => [file, hashFile(path.join(root, file))]),
    );
    fs.writeFileSync(
      path.join(root, '.anjian-build.json'),
      `${JSON.stringify({ ...info, files }, null, 2)}\n`,
    );
  } else console.info(JSON.stringify(info, null, 2));
}
