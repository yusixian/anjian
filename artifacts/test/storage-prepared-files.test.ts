import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';

import { createPreparedStateFiles } from '../src/server/storage/prepared-files';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

test('retrying a partial rollback preserves files already restored in the first attempt', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'anjian-prepared-'));
  roots.push(root);
  const first = path.join(root, 'first.json');
  const second = path.join(root, 'second.json');
  fs.writeFileSync(first, 'old-first');
  fs.writeFileSync(second, 'old-second');
  const prepared = createPreparedStateFiles(root, [
    { file: first, data: 'new-first' }, { file: second, data: 'new-second' },
  ]);
  prepared.stage();
  prepared.commit();
  expect(fs.readFileSync(first, 'utf8')).toBe('new-first');
  expect(fs.readFileSync(second, 'utf8')).toBe('new-second');

  const rename = fs.renameSync.bind(fs);
  let fail = true;
  const spy = vi.spyOn(fs, 'renameSync').mockImplementation((source, destination) => {
    if (fail && String(source).includes('.before') && destination === second) {
      fail = false;
      throw new Error('temporary restore failure');
    }
    return rename(source, destination);
  });
  try { expect(() => prepared.abort()).toThrow('Artifact state rollback failed'); }
  finally { spy.mockRestore(); }
  expect(fs.readFileSync(first, 'utf8')).toBe('old-first');
  expect(fs.existsSync(second)).toBe(false);
  prepared.abort();
  expect(fs.readFileSync(first, 'utf8')).toBe('old-first');
  expect(fs.readFileSync(second, 'utf8')).toBe('old-second');
  expect(fs.readdirSync(root).sort()).toEqual(['first.json', 'second.json']);
});
