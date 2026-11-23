import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { get } from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';
import { createInterface } from 'node:readline';

import { expect, test } from 'vitest';

import { type Hub, startHub } from '../src/server/hub';
import { machinePaths, registerProject } from '../src/server/machine';
import { tempRoot, waitFor, writeFiles } from './helpers';

type Sources = Map<string, Set<string>>;
type Event = { event: { artifact: string; type: string } };
const require = createRequire(import.meta.url);
const { createLocalCommentEvents } =
  require('../../skills/artifacts/app/local-comment-events.cjs') as {
    createLocalCommentEvents: (
      wake: () => void,
      env: NodeJS.ProcessEnv,
    ) => {
      scope: (sources: Sources) => Sources;
      close: () => void;
    };
  };
const { createProjectPoll } = require('../../skills/artifacts/app/comment-watch.cjs') as {
  createProjectPoll: (host: string) => (sources: Sources, changed: Sources) => Event[];
};

test('a local Hub pushes saved comments and replies to the subscribed project and resyncs a reconnect', async () => {
  const { root, viewer, runtime } = tempRoot();
  const project = path.join(fs.realpathSync(root), 'project');
  const other = path.join(fs.realpathSync(root), 'another');
  const key = 'a'.repeat(48);
  const credential = createHash('sha256').update(`anjian-comment-events:${key}`).digest('hex');
  const env = { ANJIAN_SERVER_HOME: path.join(root, 'server') };
  const paths = machinePaths(env);
  for (const dir of [project, other]) {
    for (const id of ['local', 'ignored']) {
      writeFiles(path.join(dir, '.anjian/artifacts/slides', id), {
        'deck.json': JSON.stringify({
          version: 1,
          title: 'Review',
          slides: [{ id: 'intro', title: 'Title', body: '', notes: '' }],
        }),
      });
    }
    registerProject(paths.projects, dir);
  }
  fs.writeFileSync(paths.key, key);
  let hub: Hub | undefined;
  const start = async () => {
    hub = await startHub({
      paths,
      host: '127.0.0.1',
      urlHost: '127.0.0.1',
      ports: [0],
      boardPorts: [0],
      viewerDir: viewer,
      runtimeDir: runtime,
      token: key,
      version: 'test',
      debounceMs: 15,
    });
    fs.writeFileSync(paths.info, JSON.stringify({ localUrl: hub.localUrl, pid: process.pid }));
    return hub;
  };
  const sources = new Map([[project, new Set(['slides/local'])]]);
  const poll = createProjectPoll('Claude Code');
  const events: Event[] = [];
  let wakes = 0;
  const channel = createLocalCommentEvents(() => {
    wakes++;
    events.push(...poll(sources, channel.scope(sources)));
  }, env);
  const post = async (id: string, data: unknown, dir = project) => {
    const origin = new URL(hub!.localUrl).origin;
    const response = await fetch(`${origin}/api/slides/${id}/comments`, {
      method: 'POST',
      headers: {
        'Origin': origin,
        'Referer': await hub!.linkFor(dir, 'slides', id),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(data),
    });
    expect(response.status).toBe(200);
  };
  const commentsPath = (dir: string) =>
    path.join(dir, '.anjian/artifacts/slides/local/comments.json');
  try {
    const first = await start();
    const url = new URL('/api/local/comment-events', first.localUrl);
    expect((await fetch(url)).status).toBe(404);
    expect(
      (
        await fetch(url, {
          headers: {
            Authorization: `Bearer ${credential}`,
            Origin: new URL(first.localUrl).origin,
          },
        })
      ).status,
    ).toBe(404);
    const create = { op: 'create', slideId: 'intro', text: 'Draft review' };
    channel.scope(sources);
    await waitFor(() => wakes === 1);
    expect(channel.scope(sources).size).toBe(0);
    await post('ignored', create);
    await post('local', create);
    expect(fs.existsSync(commentsPath(project))).toBe(true);
    await waitFor(() => events.length === 1);
    expect(events[0]?.event).toMatchObject({ artifact: 'slides/local', type: 'anjian-comments' });
    const file = JSON.parse(fs.readFileSync(commentsPath(project), 'utf8'));
    fs.writeFileSync(commentsPath(other), JSON.stringify(file));
    const beforeReply = wakes;
    await post('local', { op: 'reply', threadId: file.threads[0].id, text: 'New reply' });
    await waitFor(() => events.length === 2);
    expect(wakes).toBeGreaterThan(beforeReply);
    await first.close();
    const afterReply = fs.readFileSync(commentsPath(project), 'utf8');
    const offline = JSON.parse(afterReply);
    offline.threads[0].messages.push({
      id: 'offline-message',
      at: new Date().toISOString(),
      author: 'human',
      text: 'Written while the Hub was down',
    });
    fs.writeFileSync(commentsPath(project), JSON.stringify(offline));
    await start();
    await waitFor(() => events.length === 3, 5000);
    expect(poll(sources, channel.scope(sources))).toEqual([]);

    const streamUrl = new URL('/api/local/comment-events?scope=1', hub!.localUrl);
    const frames: Record<string, unknown>[] = [];
    let closing = false;
    const streamError = (error: NodeJS.ErrnoException) => {
      if (!closing || error.code !== 'ECONNRESET') throw error;
    };
    const raw = get(streamUrl, { headers: { Authorization: `Bearer ${credential}` } }, (res) => {
      expect(res.statusCode).toBe(200);
      const lines = createInterface({ input: res });
      lines.on('error', streamError);
      lines.on('line', (line) => frames.push(JSON.parse(line)));
    });
    raw.on('error', streamError);
    try {
      await waitFor(() => frames.length === 1);
      expect(frames[0]).toMatchObject({ ready: true, channel: expect.any(String) });
      const control = new URL(streamUrl.pathname, streamUrl);
      control.searchParams.set('channel', String(frames[0]?.channel));
      const projectId = createHash('sha256').update(project).digest('hex').slice(0, 32);
      const put = (body: unknown, authorized = true) =>
        fetch(control, {
          method: 'PUT',
          headers: authorized ? { Authorization: `Bearer ${credential}` } : {},
          body: JSON.stringify(body),
        });
      const both = [{ project: projectId, artifacts: ['slides/local', 'slides/ignored'] }];
      expect((await put(both, false)).status).toBe(404);
      expect((await put(both)).status).toBe(204);
      await post('ignored', create);
      await waitFor(() => frames.length === 2);
      expect(frames[1]).toEqual({ project: projectId, artifact: 'slides/ignored' });

      expect((await put([{ project: projectId, artifacts: ['../local'] }])).status).toBe(400);
      expect((await put([{ project: projectId, artifacts: ['slides/local'] }])).status).toBe(204);
      await post('local', create, other);
      await post('ignored', create);
      await post('local', create);
      await waitFor(() => frames.some((frame) => frame.artifact === 'slides/local'));
      expect(frames.slice(1)).toEqual([
        { project: projectId, artifact: 'slides/ignored' },
        { project: projectId, artifact: 'slides/local' },
      ]);
      closing = true;
      raw.destroy();
      await expect.poll(async () => (await put(both)).status).toBe(404);
    } finally {
      closing = true;
      raw.destroy();
    }
  } finally {
    channel.close();
    await hub?.close();
  }
}, 16000);
