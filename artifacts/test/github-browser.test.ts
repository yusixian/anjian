import fs from 'node:fs';
import path from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { startArtifactsServer } from '../src/server/app';
import { startHub } from '../src/server/hub';
import { machinePaths } from '../src/server/machine';
import { get, openWs, tempRoot, writeHtml } from './helpers';

const close: (() => Promise<void>)[] = [];
afterEach(async () => { for (const stop of close.splice(0)) await stop(); });
const github = { clientId: 'client', clientSecret: 'secret', ownerId: 123 };
const provider: typeof fetch = async (input) => new Response(JSON.stringify(String(input).endsWith('/user')
  ? { id: 123, login: 'owner' } : { access_token: 'github-token', token_type: 'bearer' }));

async function login(base: string, returnTo: string) {
  const start = await fetch(base + '/auth/github', { method: 'POST', redirect: 'manual', headers: { Origin: base },
    body: new URLSearchParams({ returnTo, remember: 'yes' }) });
  expect(start.status).toBe(303);
  const state = new URL(start.headers.get('location')!).searchParams.get('state')!;
  const callback = await fetch(base + '/auth/github/callback?code=example&state=' + state, { redirect: 'manual',
    headers: { Cookie: start.headers.getSetCookie()[0]!.split(';')[0]! } });
  expect(callback.status).toBe(303);
  expect(callback.headers.get('location')).toBe(returnTo);
  const cookie = callback.headers.getSetCookie().find(c => /_github=/.test(c))!;
  expect(cookie).toContain('Max-Age=2592000');
  return cookie.split(';')[0]!;
}

test('GitHub session reaches Hub, mounted artifacts, WebSocket and device management without becoming a master-key cookie', async () => {
  const temp = tempRoot();
  const root = path.join(temp.root, '.anjian', 'artifacts');
  writeHtml(root, 'demo', { 'index.html': '<h1>Example</h1>' });
  const hub = await startHub({ host: '0.0.0.0', urlHost: 'localhost', ports: [0], boardPorts: [0],
    viewerDir: temp.viewer, runtimeDir: temp.runtime, paths: machinePaths({ ANJIAN_SERVER_HOME: path.join(temp.root, 'server') }),
    token: 'master'.repeat(10), version: '0.1.0', github, fetch: provider });
  close.push(hub.close);
  await hub.register(temp.root);
  const base = `http://localhost:${hub.port}`;
  const artifact = new URL(await hub.linkFor(fs.realpathSync(temp.root), 'html', 'demo')).pathname;
  const target = artifact + '?view=test';
  const cookie = await login(base, target);
  expect(cookie).not.toContain(hub.token);
  const headers = { Cookie: cookie };
  expect((await get(base + artifact, headers)).status).toBe(200);
  expect((await get(base + '/api/hub/artifacts', headers)).status).toBe(200);
  expect(JSON.parse((await get(base + '/api/browser-session', headers)).body).authenticated).toBe(true);
  expect((await get(base + '/devices', headers)).status).toBe(200);
  fs.writeFileSync(machinePaths({ ANJIAN_SERVER_HOME: path.join(temp.root, 'server') }).log, JSON.stringify({ type: 'server-started', url: hub.url }) + '\n');
  const status = await get(base + '/api/status', headers);
  expect(status.body).not.toContain(hub.token);
  const log = await get(base + '/api/hub/log', headers);
  expect(log.body).toContain('[redacted]');
  expect(log.body).not.toContain(hub.token);
  expect(JSON.parse(status.body).url).toBe(base + '/');
  expect((await get(base + '/?key=anything', headers)).headers['set-cookie']).toBeUndefined();
  const alreadyLoggedIn = await get(base + '/login', headers);
  expect(alreadyLoggedIn.status).toBe(303);
  expect(alreadyLoggedIn.headers['set-cookie']).toBeUndefined();
  const ws = await openWs(hub.port, { ...headers, Origin: base, Host: `localhost:${hub.port}` }, '/ws?at=' + encodeURIComponent(artifact));
  expect(ws.status).toBe(101);ws.socket?.destroy();
  const logout = await fetch(base + '/logout', { method: 'POST', redirect: 'manual', headers: { ...headers, Origin: base } });
  expect(logout.headers.getSetCookie().filter(c=>c.includes('Max-Age=0'))).toHaveLength(3);
  expect((await get(base + '/api/hub/artifacts')).status).toBe(403);
});

test('standalone server uses the same OAuth session and rejects cross-origin starts and host substitution', async () => {
  const temp = tempRoot();
  writeHtml(temp.root, 'demo', { 'index.html': '<h1>Example</h1>' });
  const server = await startArtifactsServer({ root: temp.root, viewerDir: temp.viewer, runtimeDir: temp.runtime,
    host: '0.0.0.0', urlHost: 'localhost', github, fetch: provider });
  close.push(server.close);
  const base = `http://localhost:${server.port}`;
  const cookie = await login(base, '/html/demo');
  expect((await get(base + '/html/demo', { Cookie: cookie })).status).toBe(200);
  const foreign = await fetch(base + '/auth/github', { method: 'POST', headers: { Origin: 'https://evil.example' }, body: new URLSearchParams() });
  expect(foreign.status).toBe(403);
  expect((await get(base + '/auth/github/callback?code=stolen', { Host: 'evil.example' })).status).toBe(404);
  const expired = await get(base + '/auth/github/callback?code=stolen');
  expect(expired.status).toBe(401);
  expect(expired.body).toContain('GitHub 登录已失效');
  expect(expired.headers['set-cookie']?.[0]).toContain('Max-Age=0');
});


test('cancelled GitHub authorization preserves the original pairing target for retry', async () => {
  const temp = tempRoot();
  const server = await startArtifactsServer({ root: temp.root, viewerDir: temp.viewer,
    host: '0.0.0.0', urlHost: 'localhost', github, fetch: provider });
  close.push(server.close);
  const base = `http://localhost:${server.port}`;
  const start = await fetch(base + '/auth/github', { method: 'POST', redirect: 'manual', headers: { Origin: base },
    body: new URLSearchParams({ returnTo: '/connect?code=PAIR-CODE' }) });
  const state = new URL(start.headers.get('location')!).searchParams.get('state')!;
  const response = await get(base + '/auth/github/callback?error=access_denied&state=' + state,
    { Cookie: start.headers.getSetCookie()[0]!.split(';')[0]! });
  expect(response.status).toBe(401);
  expect(response.body).toContain('GitHub 授权已取消');
  expect(response.body).toContain('value="/connect?code=PAIR-CODE"');
});

test('invitation login carries the token only in the local form and sealed flow, including retry', async () => {
  const temp = tempRoot();
  const server = await startArtifactsServer({ root: temp.root, viewerDir: temp.viewer,
    host: '0.0.0.0', urlHost: 'localhost', github, fetch: provider });
  close.push(server.close);
  const base = `http://localhost:${server.port}`;
  const invitation = 'a'.repeat(43);
  const page = await get(base + '/login?invite=' + invitation);
  expect(page.status).toBe(200);
  expect(page.body).toContain(`name="invitation" value="${invitation}"`);
  expect(page.body).toContain('管理员邀请');
  const start = await fetch(base + '/auth/github', { method: 'POST', redirect: 'manual', headers: { Origin: base },
    body: new URLSearchParams({ invitation, returnTo: '/' }) });
  expect(start.status).toBe(303);
  expect(start.headers.get('location')).not.toContain(invitation);
  const state = new URL(start.headers.get('location')!).searchParams.get('state')!;
  const cancelled = await get(base + '/auth/github/callback?error=access_denied&state=' + state,
    { Cookie: start.headers.getSetCookie()[0]!.split(';')[0]! });
  expect(cancelled.status).toBe(401);
  expect(cancelled.body).toContain(`name="invitation" value="${invitation}"`);
  expect((await get(base + '/login?invite=invalid')).status).toBe(400);
  const invalid = await fetch(base + '/auth/github', { method: 'POST', redirect: 'manual', headers: { Origin: base },
    body: new URLSearchParams({ invitation: 'invalid', returnTo: '/' }) });
  expect(invalid.status).toBe(400);
});
