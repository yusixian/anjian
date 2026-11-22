import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { afterEach, expect, test } from 'vitest';

import { type ArtifactsServer, startArtifactsServer } from '../src/server/app';
import { readHtml } from '../src/server/html';
import { tempRoot, writeHtml } from './helpers';

const session = '5f3cb285-956f-4f31-bd79-97e6cb6a4988';
const otherSession = 'ba1e2534-4cf9-4daa-b247-6b6bf14f7086';
let server: ArtifactsServer | undefined;

afterEach(async () => {
  await server?.close();
  server = undefined;
});

async function fixture() {
  const { root, viewer } = tempRoot();
  const artifact = writeHtml(root, 'sample', {
    'index.html': '<p id="feedback">Alpha selection</p>',
  });
  writeHtml(root, 'other', { 'index.html': '<p>Unrelated preview</p>' });
  server = await startArtifactsServer({
    root,
    viewerDir: viewer,
    host: '127.0.0.1',
    urlHost: '127.0.0.1',
  });
  const origin = `http://127.0.0.1:${server.port}`;
  const endpoint = `${origin}/api/html/sample/selection-send`;
  const state = path.join(root, '.state');
  const outbox = path.join(state, 'html/sample/selection-sends');
  const beat = (who: string, id: string, slug: string, time = Date.now()) => {
    const dir = path.join(state, `${who}-comment-watch/opened/html`, slug);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${id}.alive`), String(time));
  };
  const data = () => ({
    text: 'Alpha selection',
    selector: '#feedback',
    revision: readHtml(artifact, 'sample').version,
    capturedAt: Date.now(),
  });
  const post = (body: object, from = origin) =>
    fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Origin': from },
      body: JSON.stringify(body),
    });
  return { artifact, outbox, origin, endpoint, beat, data, post };
}

test('sends one immutable snapshot to the chosen active session and returns the same receipt on retry', async () => {
  const fx = await fixture();
  fx.beat('codex', session, 'sample');
  fx.beat('claude', otherSession, 'sample');
  fx.beat('codex', randomUUID(), 'sample', Date.now() - 60_000);
  fx.beat('codex', randomUUID(), 'other');
  const { recipients } = await (await fetch(fx.endpoint)).json();
  expect(recipients.map((target: { host: string }) => target.host)).toEqual(['claude', 'codex']);
  expect(JSON.stringify(recipients)).not.toContain(session);
  const body = { id: randomUUID(), recipient: recipients[1].id, selection: fx.data() };
  expect(fs.existsSync(fx.outbox)).toBe(false);
  expect((await fx.post(body, 'null')).status).toBe(403);
  expect((await fx.post(body)).status).toBe(202);
  expect(await (await fx.post(body)).json()).toEqual({ status: 'queued' });
  const files = fs.readdirSync(fx.outbox);
  expect(files).toEqual([`${body.id}.json`]);
  const record = JSON.parse(fs.readFileSync(path.join(fx.outbox, files[0]!), 'utf8'));
  expect(record).toMatchObject({
    artifact: 'html/sample',
    session,
    host: 'codex',
    selection: body.selection,
  });
  expect(
    (await fx.post({ ...body, selection: { ...body.selection, text: 'Updated selection' } }))
      .status,
  ).toBe(409);
  fs.writeFileSync(path.join(fx.outbox, `${body.id}.delivered`), '');
  expect(await (await fetch(`${fx.endpoint}?request=${body.id}`)).json()).toEqual({
    status: 'delivered',
  });
  expect(await (await fx.post(body)).json()).toEqual({ status: 'delivered' });
  expect(
    (await fetch(`${fx.origin}/api/html/other/selection-send?request=${body.id}`)).status,
  ).toBe(404);
});

test('a stale preview or expired selection stays unsent, even with a previous recipient token', async () => {
  const fx = await fixture();
  fx.beat('codex', session, 'sample');
  const {
    recipients: [recipient],
  } = await (await fetch(fx.endpoint)).json();
  const body = { id: randomUUID(), recipient: recipient.id, selection: fx.data() };
  expect(
    await (
      await fx.post({ ...body, selection: { ...body.selection, capturedAt: Date.now() - 180_000 } })
    ).json(),
  ).toEqual({ code: 'selection_expired' });
  const html = path.join(fx.artifact, 'index.html');
  fs.writeFileSync(html, '<p>Updated during selection</p>');
  fs.utimesSync(html, new Date(), new Date(Date.now() + 1000));
  expect(await (await fx.post(body)).json()).toEqual({ code: 'selection_expired' });
  fx.beat('codex', session, 'sample', Date.now() - 120_000);
  expect(await (await fx.post({ ...body, selection: fx.data() })).json()).toEqual({
    code: 'recipient_unavailable',
  });
  expect(fs.existsSync(fx.outbox)).toBe(false);
});
