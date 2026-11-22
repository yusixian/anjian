import fs from 'node:fs';
import path from 'node:path';

import { afterEach, expect, test } from 'vitest';

import type { ServerContext } from '../src/server/context';
import { storyboardCommentsOf } from '../src/server/storyboard-comments';
import { tempRoot } from './helpers';

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((dir) => fs.rmSync(dir, { force: true, recursive: true })));

test('keeps review threads attached to a clip after its track and time change', () => {
  const { root, viewer, runtime } = tempRoot();
  dirs.push(root, viewer, runtime);
  const dir = path.join(root, 'storyboard', 'review');
  fs.mkdirSync(dir, { recursive: true });
  const source = path.join(dir, 'timeline.json');
  const clip = { id: 'demo', asset: 'assets/demo.mp4', startMs: 0, trimMs: 0, durationMs: 1000 };
  const tracks = [
    { id: 'main', kind: 'video', name: 'Main', clips: [clip] },
    { id: 'overlay', kind: 'video', name: 'Overlay', clips: [] },
  ];
  const write = () =>
    fs.writeFileSync(source, JSON.stringify({ version: 1, title: 'Review', tracks }));
  write();
  const ctx = { stateDir: path.join(root, '.state') } as ServerContext;
  const store = storyboardCommentsOf(ctx, dir);
  const result = store.apply({ op: 'create', clipId: 'demo', text: 'Shorten this cut' });
  const threadId = result.threads[0]!.id;
  tracks[0]!.clips = [];
  tracks[1]!.clips = [{ ...clip, startMs: 500 }];
  write();
  expect(store.list('agent', false)).toMatchObject([{ id: threadId, anchor: { clipId: 'demo' } }]);
  expect(store.list('agent', false)).toEqual([]);
  store.applyAgent({ op: 'reply', threadId, text: 'Updated the timing' });
  expect(store.current().threads[0]?.messages.at(-1)?.text).toBe('Updated the timing');
  expect(() => store.apply({ op: 'create', clipId: 'gone', text: 'Should fail' })).toThrow(
    'no longer exists',
  );
});
