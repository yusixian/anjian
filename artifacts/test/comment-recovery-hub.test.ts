import fs from 'node:fs';
import path from 'node:path';

import { expect, test } from 'vitest';

import { startHub } from '../src/server/hub';
import { machinePaths, registerProject } from '../src/server/machine';
import type { CommentsFile } from '../src/shared/comments';
import { tempRoot, waitFor, writeFiles } from './helpers';

const sources = {
  slides: {
    name: 'deck.json',
    value: {
      version: 1,
      title: 'Slides',
      slides: [{ id: 'intro', title: 'Title', body: '', notes: '' }],
    },
    anchor: { slideId: 'intro' },
  },
  storyboard: {
    name: 'timeline.json',
    value: {
      version: 1,
      title: 'Storyboard',
      tracks: [
        {
          id: 'main',
          kind: 'video',
          name: 'Main',
          clips: [
            { id: 'intro', asset: 'assets/demo.mp4', startMs: 0, trimMs: 0, durationMs: 1000 },
          ],
        },
      ],
    },
    anchor: { clipId: 'intro' },
  },
  whiteboard: {
    name: 'scene.excalidraw',
    value: {
      version: 2,
      type: 'excalidraw',
      elements: [{ id: 'intro', type: 'rectangle', x: 0, y: 0, width: 100, height: 50 }],
    },
    anchor: { elementIds: ['intro'] },
  },
  artboard: {
    name: 'canvas.json',
    value: {
      version: 1,
      pages: [{ id: 'p', name: 'Page' }],
      boards: { intro: { page: 'p', file: 'pages/a.html', x: 0, y: 0, w: 100, h: 50 } },
      groups: { review: { boards: ['intro'], verify: true } },
    },
    anchor: { anchor: { page: 'p', board: 'intro', x: 12, y: 18 } },
  },
} as const;

test('workspace comment recovery uses each artifact writer and preserves artboard review records', async () => {
  const { root, viewer, runtime } = tempRoot();
  const project = path.join(fs.realpathSync(root), 'project');
  const artifacts = path.join(project, '.anjian', 'artifacts');
  for (const [type, source] of Object.entries(sources)) {
    for (const id of ['local', 'backup']) {
      writeFiles(path.join(artifacts, type, id), {
        [source.name]: JSON.stringify(source.value),
        ...(type === 'artboard' ? { 'pages/a.html': '<p>Review</p>' } : {}),
      });
    }
  }
  const paths = machinePaths({ ANJIAN_SERVER_HOME: path.join(root, 'home') });
  registerProject(paths.projects, project);
  const hub = await startHub({
    paths,
    host: '127.0.0.1',
    urlHost: '127.0.0.1',
    ports: [0],
    boardPorts: [0],
    token: 'a'.repeat(48),
    version: 'test',
    viewerDir: viewer,
    runtimeDir: runtime,
  });
  try {
    const origin = `http://127.0.0.1:${hub.port}`;
    for (const [type, source] of Object.entries(sources)) {
      const raw = (id: string) => path.join(artifacts, type, id, 'comments.json');
      const read = (id: string): CommentsFile<unknown> =>
        JSON.parse(fs.readFileSync(raw(id), 'utf8'));
      const post = (id: string, action: string, data: unknown) =>
        fetch(`${origin}/api/${type}/${id}/comments${action}`, {
          method: 'POST',
          headers: { 'Origin': origin, 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        });
      for (const id of ['local', 'backup']) {
        const res = await post(id, '', { op: 'create', ...source.anchor, text: 'From ' + id });
        expect(res.status, type + ' ' + (await res.text())).toBe(200);
      }
      const initial = read('local');
      const [archived] = read('backup').threads;
      const protectedThread =
        type === 'artboard'
          ? {
              ...archived!,
              id: 'protected',
              anchor: { ...sources.artboard.anchor.anchor, verdict: 'pass', group: 'review' },
            }
          : null;
      fs.writeFileSync(
        raw('local'),
        JSON.stringify({
          version: 1,
          threads: [...initial.threads, archived, ...(protectedThread ? [protectedThread] : [])],
        }),
      );
      const checkpoint = path.join(artifacts, '.state', type, 'local', 'comment-recovery.json');
      await waitFor(() => fs.existsSync(checkpoint));
      expect(JSON.parse(fs.readFileSync(checkpoint, 'utf8')).threads).toEqual([archived]);
      const reply = await post('local', '', {
        op: 'reply',
        threadId: initial.threads[0]!.id,
        text: 'Keep this too',
      });
      expect(reply.status, type + ' ' + (await reply.text())).toBe(200);
      expect(read('local').threads).toHaveLength(1);
      const preview = await post('local', '/recovery/review', {});
      expect(preview.status, type).toBe(200);
      const { recovery } = await preview.json();
      expect(recovery.backup.threads, type).toEqual([archived]);
      const applied = await post('local', '/recovery/apply', { revision: recovery.revision });
      expect(applied.status, type + ' ' + (await applied.text())).toBe(200);
      expect(read('local').threads).toEqual([
        expect.objectContaining({
          messages: [
            initial.threads[0]!.messages[0],
            expect.objectContaining({ text: 'Keep this too' }),
          ],
        }),
        archived,
      ]);
      if (protectedThread) {
        const imported = await post('local', '/restore', {
          version: 1,
          threads: [protectedThread],
        });
        expect(imported.status).toBe(200);
        expect(read('local').threads).toHaveLength(2);
      }
    }
  } finally {
    await hub.close();
    for (const dir of [root, viewer, runtime]) fs.rmSync(dir, { force: true, recursive: true });
  }
});
