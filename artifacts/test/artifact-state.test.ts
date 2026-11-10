import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';
import { writeArtifactState } from '../src/server/state';

const roots: string[] = [];
afterEach(() => {
  vi.useRealTimers();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'anjian-state-'));
  roots.push(root);
  return root;
}

test('unchanged watcher refresh preserves uploaded metadata bytes and timestamps', () => {
  const root = fixture();
  const ref = { type: 'artboard', id: 'board' };
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
  writeArtifactState(root, ref, { warnings: [], pending: [], layout: null });
  const files = ['layout.json', 'warnings.json'].map((name) => path.join(root, 'artboard/board', name));
  const before = files.map((file) => fs.readFileSync(file, 'utf8'));
  vi.setSystemTime(new Date('2026-01-02T00:00:00Z'));
  writeArtifactState(root, ref, { warnings: [], pending: [], layout: null });
  expect(files.map((file) => fs.readFileSync(file, 'utf8'))).toEqual(before);
  writeArtifactState(root, ref, { warnings: ['missing image'], pending: [], layout: null });
  expect(fs.readFileSync(files[0]!, 'utf8')).toBe(before[0]);
  expect(JSON.parse(fs.readFileSync(files[1]!, 'utf8'))).toMatchObject({
    warnings: ['missing image'], checkedAt: '2026-01-02T00:00:00.000Z',
  });
});

test('runtime changes persist and malformed state is repaired', () => {
  const root = fixture();
  const ref = { type: 'document', id: 'doc' };
  const file = path.join(root, 'document/doc/warnings.json');
  writeArtifactState(root, ref, { warnings: [] }, { dynamic: { image: { ran: false } } });
  writeArtifactState(root, ref, { warnings: [] }, { dynamic: { image: { ran: true } } });
  expect(JSON.parse(fs.readFileSync(file, 'utf8')).dynamic.image.ran).toBe(true);
  fs.writeFileSync(file, '{broken');
  writeArtifactState(root, ref, { warnings: ['repaired'] });
  expect(JSON.parse(fs.readFileSync(file, 'utf8')).warnings).toEqual(['repaired']);
});

test('metadata admits the combined delta and rolls back both files on installation failure', () => {
  const root = fixture(); const ref = { type: 'artboard', id: 'board' };
  writeArtifactState(root, ref, { warnings: [], layout: null });
  const files = ['layout.json', 'warnings.json'].map(name => path.join(root, 'artboard/board', name));
  const before = files.map(file => fs.readFileSync(file));
  const next = { warnings: ['new warning'], layout: { pages: { p: { bounds: null, groups: {}, notes: {} } } } };
  expect(() => writeArtifactState(root, ref, next, {}, () => { throw new Error('quota'); })).toThrow('quota');
  expect(files.map(file => fs.readFileSync(file))).toEqual(before);
  const rename = fs.renameSync.bind(fs);
  const spy = vi.spyOn(fs, 'renameSync').mockImplementation((source, target) => {
    if (target === files[1] && String(source).endsWith('.tmp')) throw new Error('write failure');
    rename(source, target);
  });
  try { expect(() => writeArtifactState(root, ref, next)).toThrow('write failure'); }
  finally { spy.mockRestore(); }
  expect(files.map(file => fs.readFileSync(file))).toEqual(before);
  let delta = 0;
  writeArtifactState(root, ref, next, {}, bytes => { delta = bytes; });
  expect(delta).toBe(files.reduce((sum, file, index) => sum + fs.statSync(file).size - before[index]!.byteLength, 0));
});
