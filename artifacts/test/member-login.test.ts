import fs from 'node:fs';
import path from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { startHub } from '../src/server/hub';
import { machinePaths } from '../src/server/machine';
import { tempRoot, writeHtml } from './helpers';

const close: (() => Promise<void>)[] = [];
afterEach(async () => { for (const stop of close.splice(0)) await stop(); });
async function fixture() {
  const temp = tempRoot();
  let githubId = 123;
  const provider: typeof fetch = async (input) => {
    const url = String(input);
    if (url.includes('/users/')) return new Response(JSON.stringify({ id: url.endsWith('/alice') ? 2 : 3, login: url.endsWith('/alice') ? 'alice' : 'bob', type: 'User' }));
    return new Response(JSON.stringify(url.endsWith('/user') ? { id: githubId, login: githubId === 2 ? 'alice' : 'bob' } : { access_token: 'provider-token', token_type: 'bearer' }));
  };
  const home = path.join(temp.root, 'server');
  const hub = await startHub({ host: '0.0.0.0', urlHost: 'localhost', ports: [0], boardPorts: [0],
    viewerDir: temp.viewer, runtimeDir: temp.runtime, paths: machinePaths({ ANJIAN_SERVER_HOME: home }),
    token: 'master'.repeat(10), version: 'test', github: { ownerId: 123, clientId: 'id', clientSecret: 'secret' }, fetch: provider });
  close.push(hub.close);
  const ownerProject = path.join(temp.root, 'owner');
  writeHtml(path.join(ownerProject, '.anjian/artifacts'), 'private', { 'index.html': '<h1>Owner secret</h1>' });
  await hub.register(ownerProject);
  const base = `http://localhost:${hub.port}`;
  const ownerCookie = `anjian_artifacts_${hub.port}=${hub.token}`;
  const request = (url: string, cookie = ownerCookie, body?: object, referer?: string) => fetch(base + url, {
    method: body ? 'POST' : 'GET', redirect: 'manual', headers: { Cookie: cookie, Origin: base, 'Content-Type': 'application/json', ...(referer ? { Referer: base + referer } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const join = async (login: string, id: number, invitation?: string) => {
    if (!invitation) {
      const response = await request('/api/hub/members', ownerCookie, { action: 'invite', login, quotaBytes: 1024 * 1024 });
      expect(response.status).toBe(201);
      invitation = new URL((await response.json()).url).searchParams.get('invite')!;
    }
    githubId = id;
    const start = await fetch(base + '/auth/github', { method: 'POST', redirect: 'manual', headers: { Origin: base },
      body: new URLSearchParams({ returnTo: '/', invitation }) });
    const state = new URL(start.headers.get('location')!).searchParams.get('state');
    const callback = await request('/auth/github/callback?code=test&state=' + state, start.headers.getSetCookie()[0]!.split(';')[0]!);
    expect(callback.status).toBe(303);
    expect(callback.headers.get('location')).toBe('/');
    const cookie = callback.headers.getSetCookie().find((item) => item.includes('_github='))!.split(';')[0]!;
    return { cookie, project: path.join(fs.realpathSync(home), 'workspaces', `github-${id}`), invitation };
  };
  return { hub, request, ownerCookie, ownerProject, join };
}

test('invited members enter isolated workspaces and cannot read owner or other member resources', async () => {
  const f = await fixture();
  const alice = await f.join('alice', 2);
  const bob = await f.join('bob', 3);
  expect((await f.request('/', alice.cookie)).status).toBe(200);
  expect((await f.request('/devices', alice.cookie)).status).toBe(200);
  expect((await f.request('/members', alice.cookie)).status).toBe(403);
  expect((await f.request('/members', f.ownerCookie)).status).toBe(200);
  expect(await (await f.request('/api/browser-session', alice.cookie)).json()).toMatchObject({ authenticated: true });
  const initial = await (await f.request('/api/hub/artifacts', alice.cookie)).json();
  expect(await (await f.request('/api/account', alice.cookie)).json()).toEqual({ role: 'member', login: 'alice', quotaBytes: 1024 * 1024 });
  expect(initial.artifacts).toEqual([]);
  expect(initial.projects).toHaveLength(1);
  expect(JSON.stringify(initial)).not.toContain(alice.project);
  for (const member of [alice, bob]) writeHtml(path.join(member.project, '.anjian/artifacts'), 'private', { 'index.html': `<h1>${member === alice ? 'Alice' : 'Bob'}</h1>` });
  const aliceUrl = new URL(await f.hub.linkFor(alice.project, 'html', 'private')).pathname;
  const bobUrl = new URL(await f.hub.linkFor(bob.project, 'html', 'private')).pathname;
  const ownerUrl = new URL(await f.hub.linkFor(fs.realpathSync(f.ownerProject), 'html', 'private')).pathname;
  expect((await f.request(aliceUrl, alice.cookie)).status).toBe(200);
  for (const foreign of [bobUrl, ownerUrl]) {
    expect((await f.request(foreign, alice.cookie)).status).toBe(404);
    expect((await f.request('/api/artifacts' + foreign, alice.cookie)).status).toBe(404);
  }
  const list = await (await f.request('/api/hub/artifacts', alice.cookie)).json();
  expect(list.artifacts).toHaveLength(1);
  expect(list.artifacts[0].url).toBe(aliceUrl);
  const metadata = await f.request('/api/artifacts/html/private', alice.cookie, undefined, aliceUrl);
  expect(metadata.status).toBe(200);
  const meta = await metadata.json();
  expect(await (await f.request(meta.contentBase + 'index.html', '')).text()).toContain('Alice');
  for (const endpoint of ['/api/status', '/api/hub/members', '/api/hub/projects', '/api/hub/log'])
    expect((await f.request(endpoint, alice.cookie)).status).toBe(403);
  expect((await f.request('/api/hub/stop', alice.cookie, {})).status).toBe(403);
  await f.request('/api/hub/members', f.ownerCookie, { action: 'update', id: 'github:2', status: 'suspended' });
  expect((await f.request('/api/hub/artifacts', alice.cookie)).status).toBe(403);
  expect((await f.request(meta.contentBase + 'index.html', '')).status).toBe(404);
  await f.request('/api/hub/members', f.ownerCookie, { action: 'update', id: 'github:2', status: 'active' });
  expect((await f.request('/api/hub/artifacts', alice.cookie)).status).toBe(403);
  expect((await f.request('/api/hub/artifacts', bob.cookie)).status).toBe(200);
  // Retrying the old invite as an already admitted member is a normal fresh login.
  const again = await f.join('alice', 2, alice.invitation);
  expect((await f.request('/api/hub/artifacts', again.cookie)).status).toBe(200);
  expect(f.hub.projects().filter((p) => p.dir === alice.project)).toHaveLength(1);
});
