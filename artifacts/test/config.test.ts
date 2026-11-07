import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, test } from 'vitest';

import {
  ensureConfig,
} from '../src/server/config';

function tempAnjianDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'anjian-config-'));
}

describe('ensureConfig', () => {
  test('writes a default config and a .gitignore that hides it', () => {
    const dir = tempAnjianDir();
    const file = path.join(dir, 'config.json');
    ensureConfig(file);
    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual({ version: 1 });
    expect(fs.readFileSync(path.join(dir, '.gitignore'), 'utf8')).toContain('config.json\n');
  });

  test('git tracks only documents and their files', () => {
    const project = fs.mkdtempSync(path.join(os.tmpdir(), 'anjian-ignore-'));
    const dir = path.join(project, '.anjian');
    ensureConfig(path.join(dir, 'config.json'));
    for (const name of [
      'artifacts/document/plan/doc.xml',
      'artifacts/document/plan/assets/a.png',
      'artifacts/document/plan/.artifact-id',
      'artifacts/artboard/a/canvas.json',
      'artifacts/html/b/index.html',
      'artifacts/.state/x.json',
    ]) {
      fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
      fs.writeFileSync(path.join(dir, name), 'x');
    }
    execFileSync('git', ['init', '-q'], { cwd: project });
    const listed = execFileSync(
      'git',
      ['-c', 'core.excludesFile=/dev/null', 'ls-files', '--others', '--exclude-standard'],
      { cwd: project, encoding: 'utf8' },
    );
    expect(listed.trim().split('\n').sort()).toEqual([
      '.anjian/.gitignore',
      '.anjian/artifacts/document/plan/assets/a.png',
      '.anjian/artifacts/document/plan/doc.xml',
    ]);
  });

  test('leaves an existing config untouched', () => {
    const dir = tempAnjianDir();
    const file = path.join(dir, 'config.json');
    fs.writeFileSync(file, '{"version":1,"local":"keep"}');
    ensureConfig(file);
    expect(fs.readFileSync(file, 'utf8')).toBe(
      '{"version":1,"local":"keep"}',
    );
  });

  test('appends only the missing rules to an existing .gitignore', () => {
    const dir = tempAnjianDir();
    const file = path.join(dir, 'config.json');
    fs.writeFileSync(path.join(dir, '.gitignore'), 'notes/\nconfig.json');
    ensureConfig(file);
    ensureConfig(file);
    expect(fs.readFileSync(path.join(dir, '.gitignore'), 'utf8')).toBe(
      'notes/\nconfig.json\nartifacts/*\n!artifacts/document/\nartifacts/document/*/.artifact-id\n',
    );
  });
});
