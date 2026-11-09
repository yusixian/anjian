import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

import { afterEach, expect, test } from 'vitest';

import { startArtifactsServer } from '../src/server/app';
import { loginReturnTo } from '../src/server/browser-auth';
import { type Hub, startHub } from '../src/server/hub';
import { machinePaths } from '../src/server/machine';
import { get, tempRoot } from './helpers';

const hubs: Hub[] = [];
const close: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const hub of hubs.splice(0)) await hub.close();
  for (const stop of close.splice(0)) await stop();
});

async function start(publicOrigin?: string) {
  const { root, viewer, runtime } = tempRoot();
  fs.writeFileSync(path.join(viewer, 'index.html'), '<!doctype html><title>案间</title>');
  const hub = await startHub({
    host: '0.0.0.0', urlHost: 'localhost', viewerDir: viewer, runtimeDir: runtime,
    ports: [0], boardPorts: [0],
    paths: machinePaths({ ANJIAN_SERVER_HOME: fs.mkdtempSync(path.join(os.tmpdir(), 'anjian-browser-auth-')) }),
    token: 'a'.repeat(48), version: '0.1.0', publicOrigin,
  });
  hubs.push(hub);
  await hub.register(path.dirname(path.dirname(root)));
  const base = `http://localhost:${hub.port}`;
  const login = (fields: Record<string, string>, origin = base) => fetch(`${base}/login`, {
    method: 'POST', redirect: 'manual', headers: { Origin: origin }, body: new URLSearchParams(fields),
  });
  return { hub, base, login };
}

test('browser navigation leads to a login page, while API authorization remains an API failure', async () => {
  const { base } = await start();
  const target = '/artboard/example?page=devices';
  const page = await fetch(base + target, { redirect: 'manual' });
  expect(page.status).toBe(303);
  expect(page.headers.get('location')).toBe(`/login?returnTo=${encodeURIComponent(target)}`);
  const login = await fetch(base + page.headers.get('location'));
  const html = await login.text();
  expect(html).toContain('登录案间');
  expect(html).toContain('type="password"');
  expect(html).toContain('记住此设备 30 天');
  expect(login.headers.get('cache-control')).toBe('no-store');
  expect(login.headers.get('referrer-policy')).toBe('same-origin');
  expect(login.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
  expect((await fetch(base + '/api/hub/artifacts', { redirect: 'manual' })).status).toBe(403);
  expect(await (await fetch(base + '/api/browser-session')).json()).toEqual({ authenticated: false, required: true });
});

test('wrong keys produce a retryable page without echoing secrets and keep the destination', async () => {
  const { login } = await start();
  const response = await login({ key: 'wrong-secret-value', returnTo: '/connect?code=ABCD-EFGH', remember: 'yes' });
  expect(response.status).toBe(401);
  expect(response.headers.get('set-cookie')).toBeNull();
  const html = await response.text();
  expect(html).toContain('访问密钥不正确');
  expect(html).toContain('/connect?code=ABCD-EFGH');
  expect(html).toContain('登录并继续授权');
  expect(html).not.toContain('wrong-secret-value');
  expect(html).toContain('value="yes" checked');
});

test('login persists only when requested, restores the target, and logout clears browser access', async () => {
  const { hub, base, login } = await start();
  const response = await login({ key: hub.token, returnTo: '/artboard/example?page=devices', remember: 'yes' });
  expect(response.status).toBe(303);
  expect(response.headers.get('location')).toBe('/artboard/example?page=devices');
  const setCookie = response.headers.get('set-cookie')!;
  expect(setCookie).toContain('HttpOnly; SameSite=Strict; Path=/');
  expect(setCookie).toContain('Max-Age=2592000');
  const cookie = setCookie.split(';')[0]!;
  const headers = { Cookie: cookie };
  expect(await (await fetch(base + '/api/browser-session', { headers })).json()).toEqual({ authenticated: true, required: true });
  expect((await fetch(base + '/api/hub/artifacts', { headers })).status).toBe(200);
  const oldLink = await fetch(base + `/?key=${hub.token}`, { headers });
  expect(oldLink.status).toBe(200);
  expect(oldLink.headers.get('set-cookie')).toBeNull();
  const session = await login({ key: hub.token });
  expect(session.headers.get('set-cookie')).not.toContain('Max-Age');
  const logout = await fetch(base + '/logout', { method: 'POST', redirect: 'manual', headers: { ...headers, Origin: base } });
  expect(logout.status).toBe(303);
  expect(logout.headers.get('set-cookie')).toContain('Max-Age=0');
  expect(logout.headers.get('location')).toBe('/login?signedOut=1');
});

test('login and logout reject foreign or absent origins, GET logout, unsupported and oversized bodies', async () => {
  const { hub, base, login } = await start();
  expect((await login({ key: hub.token }, 'https://evil.example')).status).toBe(403);
  expect((await fetch(base + '/login', { method: 'POST', body: new URLSearchParams({ key: hub.token }) })).status).toBe(403);
  expect((await fetch(base + '/logout', { method: 'POST', headers: { Origin: 'https://evil.example' } })).status).toBe(403);
  expect((await fetch(base + '/logout')).status).toBe(405);
  expect((await fetch(base + '/login', { method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json' }, body: '{}' })).status).toBe(415);
  expect((await login({ key: 'x'.repeat(9000) })).status).toBe(413);
});

test('return destinations cannot escape the application or retain an access key', async () => {
  for (const value of ['https://evil.example', '//evil.example', '/\\evil.example', '/%2f%2fevil.example', '/login', '/api/hub/stop', '/\r\nLocation:evil'])
    expect(loginReturnTo(value)).toBe('/');
  expect(loginReturnTo('/connect?code=ABCD&key=secret')).toBe('/connect?code=ABCD');
  expect(loginReturnTo('/document/example?view=history#section')).toBe('/document/example?view=history#section');
  const { hub, login } = await start();
  const response = await login({ key: hub.token, returnTo: '//evil.example' });
  expect(response.headers.get('location')).toBe('/');
});

test('device pairing resumes after login but still requires explicit project approval', async () => {
  const { hub, base, login } = await start();
  const device = await (await fetch(base + '/api/remote/auth/device', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'My laptop' }),
  })).json();
  const target = `/connect?code=${device.userCode}`;
  const page = await fetch(base + target, { redirect: 'manual' });
  expect(page.headers.get('location')).toBe('/login?returnTo=' + encodeURIComponent(target));
  const response = await login({ key: hub.token, returnTo: target });
  const cookie = response.headers.get('set-cookie')!.split(';')[0]!;
  const authorized = await fetch(base + response.headers.get('location'), { headers: { Cookie: cookie } });
  expect(await authorized.text()).toContain('允许访问的项目');
  const token = await fetch(base + '/api/remote/auth/token', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ deviceCode: device.deviceCode }),
  });
  expect(token.status).toBe(202);
});

test('HTTPS login sets a secure cookie and standalone servers expose the same flow', async () => {
  const { hub } = await start('https://anjian.example');
  const response = await new Promise<http.IncomingMessage>((resolve, reject) => {
    const request = http.request(`http://localhost:${hub.port}/login`, {
      method: 'POST', headers: { Host: 'anjian.example', Origin: 'https://anjian.example', 'Content-Type': 'application/x-www-form-urlencoded' },
    }, (res) => { res.resume(); res.on('end', () => resolve(res)); });
    request.on('error', reject);
    request.end(new URLSearchParams({ key: hub.token, remember: 'yes' }).toString());
  });
  expect(response.statusCode).toBe(303);
  expect(response.headers['set-cookie']?.[0]).toContain('; Secure; Max-Age=2592000');
  const temp = tempRoot();
  const server = await startArtifactsServer({ root: temp.root, viewerDir: temp.viewer, host: '0.0.0.0', urlHost: 'localhost' });
  close.push(server.close);
  const page = await get(`http://localhost:${server.port}/document/example`);
  expect(page.status).toBe(303);
  expect(page.headers.location).toBe('/login?returnTo=%2Fdocument%2Fexample');
});
