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
  expect((await f.request('/storage', alice.cookie)).status).toBe(200);
  expect(await (await f.request('/api/storage/migrations', alice.cookie)).json()).toEqual({ jobs: [] });
  expect((await f.request('/api/storage/migrations?scope=shared', alice.cookie)).status).toBe(403);
  expect((await f.request('/api/storage/migrations', '')).status).toBe(403);
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

test('storage settings isolate personal credentials and reserve shared settings for Owner', async () => {
  const f = await fixture();
  const alice = await f.join('alice', 2);
  const bob = await f.join('bob', 3);
  const settings = { endpoint: 'https://objects.example', bucket: 'private-bucket', region: 'auto', prefix: 'files', forcePathStyle: true };
  const credentials = { accessKeyId: 'alice-key', secretAccessKey: 'alice-secret' };
  const saved = await f.request('/api/storage', alice.cookie, { action: 'save', settings, credentials, scope: 'github:3' });
  expect(saved.status).toBe(200);
  const result = await saved.json();
  expect(result.profile.scope).toBe('github:2');
  expect(result.backend).toBe('local');
  expect(result.tested).toBe(false);
  expect(JSON.stringify(result)).not.toContain('alice-secret');
  const own = await (await f.request('/api/storage', alice.cookie)).json();
  expect(own.configured).toBe(true);
  expect(own.profile.credentialsConfigured).toBe(true);
  expect(JSON.stringify(own)).not.toContain('alice-key');
  expect((await (await f.request('/api/storage', bob.cookie)).json()).configured).toBe(false);
  expect((await f.request('/api/storage?scope=github:2', bob.cookie)).status).toBe(403);
  expect((await f.request('/api/storage?scope=shared', alice.cookie)).status).toBe(403);
  expect((await f.request('/api/storage?scope=shared', alice.cookie, { action: 'save', settings, credentials })).status).toBe(403);
  expect((await f.request('/api/storage?scope=shared', f.ownerCookie, { action: 'limit', bytes: 1024 })).status).toBe(200);
  const shared = await (await f.request('/api/storage?scope=shared', f.ownerCookie)).json();
  expect(shared.sharedLimitBytes).toBe(1024);
  expect(shared.configured).toBe(false);
  expect((await f.request('/api/storage', '')).status).toBe(403);
  const deniedProfile = await (await f.request('/api/storage', alice.cookie, { action: 'save', settings: { ...settings, endpoint: 'https://127.0.0.1' } })).json();
  expect((await f.request('/api/storage', bob.cookie, { action: 'test', id: deniedProfile.profile.id })).status).toBe(404);
  const checked = await (await f.request('/api/storage', alice.cookie, { action: 'test', id: deniedProfile.profile.id })).json();
  expect(checked.test.ok).toBe(false);
  expect(checked.test.steps).toEqual({ write: false, read: false, delete: false });
  const checkedSummary = await (await f.request('/api/storage', alice.cookie)).json();
  expect(checkedSummary.tested).toBe(false);
  expect(checkedSummary.profile.test).toEqual(checked.test);
  expect((await f.request('/api/storage', alice.cookie, { action: 'test', id: deniedProfile.profile.id })).status).toBe(429);

});

test('storage usage exposes only the current member', async () => {
  const f = await fixture();
  const alice = await f.join('alice', 2);
  const bob = await f.join('bob', 3);
  for (const [member, bytes] of [[alice, 17], [bob, 31]] as const) {
    const root = path.join(member.project, '.anjian/artifacts');
    fs.mkdirSync(root, { recursive: true }); fs.writeFileSync(path.join(root, 'usage-fixture'), Buffer.alloc(bytes));
  }
  const own = await (await f.request('/api/storage', alice.cookie)).json();
  expect(own.usage.artifacts).toBe(17);
  expect(own.usage.total).toBe(17 + own.usage.history);
  expect(JSON.stringify(own)).not.toContain(bob.project);
  expect((await (await f.request('/api/storage', bob.cookie)).json()).usage.artifacts).toBe(31);
  const shared = await (await f.request('/api/storage?scope=shared', f.ownerCookie)).json();
  expect(shared.usage.total).toBeGreaterThan(48);
  expect((await f.request('/api/storage?scope=shared', alice.cookie)).status).toBe(403);
});


test('storage configuration remains available when usage cannot be safely scanned', async () => {
  const f = await fixture();
  const alice = await f.join('alice', 2);
  const root = path.join(alice.project, '.anjian/artifacts');
  fs.mkdirSync(root, { recursive: true });
  fs.symlinkSync(f.ownerProject, path.join(root, 'unsafe-link'));
  const response = await f.request('/api/storage', alice.cookie);
  expect(response.status).toBe(200);
  const result = await response.json();
  expect(result.usage).toBeNull();
  expect(result.configured).toBe(false);
  expect(result.backend).toBe('local');
});

test('share publication uses the project member quota and permits revocation while over quota', async () => {
  const f = await fixture();
  const alice = await f.join('alice', 2);
  writeHtml(path.join(alice.project, '.anjian/artifacts'), 'shared', { 'index.html': '<h1>Alice</h1>' });
  const url = new URL(await f.hub.linkFor(alice.project, 'html', 'shared')).pathname;
  const action = (action: string) => f.request('/api/hub/share', alice.cookie,
    { action, type: 'html', id: 'shared', expiresInDays: 7 }, url);
  expect((await f.request('/api/hub/members', f.ownerCookie, { action: 'update', id: 'github:2', quotaBytes: 0 })).status).toBe(200);
  const denied = await action('publish');
  expect(denied.status).toBe(413);
  expect((await denied.json()).code).toBe('storage_quota_exceeded');
  const ownerUrl = new URL(await f.hub.linkFor(fs.realpathSync(f.ownerProject), 'html', 'private')).pathname;
  expect((await f.request('/api/hub/share', f.ownerCookie,
    { action: 'publish', type: 'html', id: 'private', expiresInDays: 7 }, ownerUrl)).status).toBe(200);
  await f.request('/api/hub/members', f.ownerCookie, { action: 'update', id: 'github:2', quotaBytes: 1024 * 1024 });
  const published = await action('publish'); expect(published.status).toBe(200);
  const publicUrl = new URL((await published.json()).share.url).pathname;
  await f.request('/api/hub/members', f.ownerCookie, { action: 'update', id: 'github:2', quotaBytes: 0 });
  expect((await action('publish')).status).toBe(413);
  expect((await f.request(`${publicUrl}/data`, '')).status).toBe(200);
  expect((await action('revoke')).status).toBe(200);
  expect((await f.request(`${publicUrl}/data`, '')).status).toBe(404);
});
