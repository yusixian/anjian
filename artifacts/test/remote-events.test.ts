import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { createRemoteEvents, RemoteCursorError } from '../src/server/remote-events';

const homes: string[] = [];
const home = () => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'anjian-events-')); homes.push(dir); return dir; };
afterEach(() => { for (const dir of homes.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });
const project = 'a'.repeat(32);
test('persists ordered events and resumes without replaying acknowledged events after restart', () => {
  const dir = home();
  const events = createRemoteEvents(dir);
  const baseline = events.since(project, null).cursor;
  events.append(project, 'document/plan', 'doc-comments', { text: '第一条' });
  const first = events.since(project, baseline);
  events.append(project, 'document/plan', 'doc-comments', { text: '第二条' });
  const restored = createRemoteEvents(dir).since(project, first.cursor);
  expect(restored.events.map((event) => event.data)).toEqual([{ text: '第二条' }]);
  expect(createRemoteEvents(dir).since(project, restored.cursor).events).toEqual([]);
  expect(fs.statSync(path.join(dir, 'remote-events', `${project}.json`)).mode & 0o777).toBe(0o600);
});
test('rejects cross-project, future and evicted cursors explicitly', () => {
  const events = createRemoteEvents(home());
  const cursor = events.since(project, null).cursor;
  expect(() => events.since('b'.repeat(32), cursor)).toThrow(RemoteCursorError);
  expect(() => events.since(project, cursor.replace(':0', ':99'))).toThrow(RemoteCursorError);
  expect(() => events.since(project, 'invalid')).toThrow(RemoteCursorError);
  for (let i = 0; i < 1001; i++) events.append(project, 'html/demo', 'change', i);
  expect(() => events.since(project, cursor)).toThrow(RemoteCursorError);
}, 15000);
test('fails closed on corrupt or symlinked journals', () => {
  const dir = home();
  const events = createRemoteEvents(dir);
  events.since(project, null);
  const file = path.join(dir, 'remote-events', `${project}.json`);
  fs.writeFileSync(file, 'broken');
  expect(() => createRemoteEvents(dir).since(project, null)).toThrow();
  fs.unlinkSync(file);
  const target = path.join(dir, 'secret'); fs.writeFileSync(target, '{}'); fs.symlinkSync(target, file);
  expect(() => createRemoteEvents(dir).since(project, null)).toThrow();
});
