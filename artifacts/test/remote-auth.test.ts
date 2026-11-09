import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { createRemoteAuth } from '../src/server/remote-auth';
import type { RemoteDevicesResponse, RemotePairingResponse } from '../src/shared/devices';

const ORIGIN = 'http://127.0.0.1:1';
const OWNER = { Cookie: 'owner=1' };

describe('remote device authorization', () => {
  let home: string;
  let server: http.Server;
  let base: string;
  let time: number;
  let auth: ReturnType<typeof createRemoteAuth>;

  beforeEach(async () => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'anjian-remote-auth-'));
    time = 1_700_000_000_000;
    auth = createRemoteAuth({
      home,
      origin: ORIGIN,
      isAdmin: (req) => req.headers.cookie === 'owner=1',
      projects: () => [{ id: 'project-a', name: '个人作品' }, { id: 'project-b', name: '其他项目' }],
      now: () => time,
    });
    server = http.createServer((req, res) => {
      void auth.handle(req, res, new URL(req.url ?? '/', ORIGIN)).then((handled) => {
        if (!handled) { res.statusCode = 404; res.end(); }
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });

  afterEach(async () => {
    auth.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    fs.rmSync(home, { recursive: true, force: true });
  });

  const json = (body: unknown) => ({
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });

  async function pair(name = 'MacBook') {
    const res = await fetch(`${base}/api/remote/auth/device`, json({ name }));
    expect(res.status).toBe(200);
    return await res.json() as { deviceCode: string; userCode: string; verificationUri: string };
  }

  async function approve(userCode: string, projects = ['project-a']) {
    return fetch(`${base}/api/remote/auth/approve`, {
      method: 'POST',
      headers: { ...OWNER, Origin: ORIGIN, 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: userCode, projects }),
    });
  }

  test('requires explicit browser approval, persists only token hash, and scopes access', async () => {
    const request = await pair();
    expect(request.verificationUri).toBe(`${ORIGIN}/connect`);
    const pending = await fetch(`${base}/api/remote/auth/token`, json({ deviceCode: request.deviceCode }));
    expect(pending.status).toBe(202);
    expect(await pending.json()).toEqual({ status: 'pending' });
    const page = await fetch(`${base}/connect?code=${request.userCode}`, { headers: OWNER });
    expect(page.headers.get('referrer-policy')).toBe('same-origin');
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('个人作品');
    expect((await approve(request.userCode)).status).toBe(200);
    const claim = await fetch(`${base}/api/remote/auth/token`, json({ deviceCode: request.deviceCode }));
    expect(claim.status).toBe(200);
    const result = await claim.json() as { token: string; device: { id: string; projects: string[] } };
    expect(result.device.projects).toEqual(['project-a']);
    expect(result.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const stored = fs.readFileSync(path.join(home, 'remote-devices.json'), 'utf8');
    expect(stored).not.toContain(result.token);
    expect(stored).not.toContain(request.deviceCode);
    expect(stored).not.toContain(request.userCode);
    expect(fs.statSync(path.join(home, 'remote-devices.json')).mode & 0o777).toBe(0o600);
    expect(fs.statSync(home).mode & 0o777).toBe(0o700);
    expect((await fetch(`${base}/api/remote/auth/token`, json({ deviceCode: request.deviceCode }))).status).toBe(410);
    const headers = { Authorization: `Bearer ${result.token}` };
    const session = await fetch(`${base}/api/remote/auth/session`, { headers });
    expect(session.status).toBe(200);
    expect((await session.json()).device.projects).toEqual(['project-a']);
    expect((await fetch(`${base}/api/remote/auth/session`, { headers: { ...headers, Origin: ORIGIN } })).status).toBe(401);
    expect((await fetch(`${base}/api/remote/auth/session`, { method: 'DELETE', headers })).status).toBe(200);
    expect((await fetch(`${base}/api/remote/auth/session`, { headers })).status).toBe(401);
  });

  test('rejects unauthenticated approval, cross-origin mutation and invalid project grants', async () => {
    const request = await pair();
    expect((await fetch(`${base}/connect?code=${request.userCode}`)).status).toBe(403);
    expect((await fetch(`${base}/api/remote/auth/approve`, json({ code: request.userCode, projects: ['project-a'] }))).status).toBe(403);
    const cross = await fetch(`${base}/api/remote/auth/approve`, {
      ...json({ code: request.userCode, projects: ['project-a'] }),
      headers: { ...OWNER, Origin: 'https://attacker.test', 'Content-Type': 'application/json' },
    });
    expect(cross.status).toBe(403);
    expect((await approve(request.userCode, ['project-c'])).status).toBe(400);
    expect((await approve(request.userCode, [])).status).toBe(400);
    expect((await approve(request.userCode, ['project-a', 'project-a'])).status).toBe(400);
    expect((await approve(request.userCode)).status).toBe(200);
  });

  test('denied and expired pairings cannot issue a token', async () => {
    const denied = await pair();
    const deniedRes = await fetch(`${base}/api/remote/auth/deny`, {
      ...json({ code: denied.userCode }), headers: { ...OWNER, Origin: ORIGIN, 'Content-Type': 'application/json' },
    });
    expect(deniedRes.status).toBe(200);
    expect((await fetch(`${base}/api/remote/auth/token`, json({ deviceCode: denied.deviceCode }))).status).toBe(403);
    const expired = await pair();
    time += 10 * 60_000 + 1;
    expect((await fetch(`${base}/api/remote/auth/token`, json({ deviceCode: expired.deviceCode }))).status).toBe(410);
    expect((await approve(expired.userCode)).status).toBe(410);
  });

  test('rejects malformed and oversized pairing requests', async () => {
    expect((await fetch(`${base}/api/remote/auth/device`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{',
    })).status).toBe(400);
    expect((await fetch(`${base}/api/remote/auth/device`, json({ name: 'x'.repeat(101) }))).status).toBe(400);
    expect((await fetch(`${base}/api/remote/auth/device`, json({ name: 'x'.repeat(10_000) }))).status).toBe(413);
    expect((await fetch(`${base}/api/remote/auth/device`, {
      ...json({ name: 'Browser' }),
      headers: { Origin: ORIGIN, 'Content-Type': 'application/json' },
    })).status).toBe(403);
  });

  test('caps pairing requests, marks retry delay, and rejects symlinked credential storage', async () => {
    const request = await pair();
    expect((await fetch(`${base}/api/remote/auth/token`, json({ deviceCode: request.deviceCode }))).status).toBe(202);
    const early = await fetch(`${base}/api/remote/auth/token`, json({ deviceCode: request.deviceCode }));
    expect(early.status).toBe(429);
    expect(early.headers.get('Retry-After')).toBe('2');
    for (let index = 0; index < 11; index++) await pair(`Device ${index}`);
    const capped = await fetch(`${base}/api/remote/auth/device`, json({ name: 'too many' }));
    expect(capped.status).toBe(429);
    expect(capped.headers.get('Retry-After')).toBe('2');

    const alias = path.join(home, 'alias');
    fs.symlinkSync(home, alias, 'dir');
    expect(() => createRemoteAuth({
      home: alias, origin: ORIGIN, isAdmin: () => true, projects: () => [],
    })).toThrow('Invalid device store directory');
    const store = path.join(home, 'remote-devices.json');
    const target = path.join(home, 'target.json');
    fs.writeFileSync(target, '{"devices":[]}');
    fs.symlinkSync(target, store);
    expect(() => createRemoteAuth({
      home, origin: ORIGIN, isAdmin: () => true, projects: () => [],
    })).toThrow('Invalid device store');
  });

  test('admin revocation survives process restart and expired grants fail', async () => {
    const request = await pair();
    expect((await approve(request.userCode)).status).toBe(200);
    const claim = await fetch(`${base}/api/remote/auth/token`, json({ deviceCode: request.deviceCode }));
    const { token, device } = await claim.json() as { token: string; device: { id: string } };
    const current = auth;
    auth = createRemoteAuth({
      home, origin: ORIGIN, isAdmin: (req) => req.headers.cookie === 'owner=1',
      projects: () => [{ id: 'project-a', name: '个人作品' }], now: () => time,
    });
    current.close();
    const headers = { Authorization: `Bearer ${token}` };
    expect((await fetch(`${base}/api/remote/auth/session`, { headers })).status).toBe(200);
    const revoke = await fetch(`${base}/api/remote/auth/revoke`, {
      ...json({ id: device.id }), headers: { ...OWNER, Origin: ORIGIN, 'Content-Type': 'application/json' },
    });
    expect(revoke.status).toBe(200);
    expect((await fetch(`${base}/api/remote/auth/session`, { headers })).status).toBe(401);
    const another = await pair();
    expect((await approve(another.userCode)).status).toBe(200);
    const issued = await fetch(`${base}/api/remote/auth/token`, json({ deviceCode: another.deviceCode }));
    const next = await issued.json() as { token: string };
    time += 90 * 24 * 60 * 60_000 + 1;
    expect((await fetch(`${base}/api/remote/auth/session`, { headers: { Authorization: `Bearer ${next.token}` } })).status).toBe(401);
  });

  test('admin JSON reads list devices and pending pairings without credential secrets', async () => {
    const request = await pair('工作电脑');
    const pairing = await fetch(`${base}/api/remote/auth/pairing?code=${request.userCode.toLowerCase()}`, { headers: OWNER });
    expect(pairing.status).toBe(200);
    expect(await pairing.json()).toEqual({
      pairing: { code: request.userCode, name: '工作电脑', expiresAt: time + 10 * 60_000 },
      projects: [{ id: 'project-a', name: '个人作品' }, { id: 'project-b', name: '其他项目' }],
    } satisfies RemotePairingResponse);
    const approved = await approve(request.userCode);
    expect(await approved.json()).toEqual({ approved: true });
    const claim = await fetch(`${base}/api/remote/auth/token`, json({ deviceCode: request.deviceCode }));
    const { token, device } = await claim.json() as { token: string; device: { id: string } };
    const response = await fetch(`${base}/api/remote/auth/devices`, { headers: OWNER });
    expect(response.status).toBe(200);
    const listing = await response.json() as RemoteDevicesResponse;
    expect(listing).toEqual({
      devices: [{ id: device.id, name: '工作电脑', projects: ['project-a'], createdAt: time, expiresAt: time + 90 * 24 * 60 * 60_000 }],
      projects: [{ id: 'project-a', name: '个人作品' }, { id: 'project-b', name: '其他项目' }],
      origin: ORIGIN,
    });
    expect(JSON.stringify(listing)).not.toContain(token);
    expect(JSON.stringify(listing)).not.toContain(request.deviceCode);
    expect(JSON.stringify(listing)).not.toContain('tokenHash');
    expect((await fetch(`${base}/api/remote/auth/pairing?code=${request.userCode}`, { headers: OWNER })).status).toBe(410);
  });

  test('admin JSON reads reject anonymous, scoped token, foreign origin and cross-site requests', async () => {
    const request = await pair();
    expect((await approve(request.userCode)).status).toBe(200);
    const claim = await fetch(`${base}/api/remote/auth/token`, json({ deviceCode: request.deviceCode }));
    const { token } = await claim.json() as { token: string };
    for (const route of ['/api/remote/auth/devices', `/api/remote/auth/pairing?code=${request.userCode}`]) {
      expect((await fetch(`${base}${route}`)).status).toBe(403);
      expect((await fetch(`${base}${route}`, { headers: { Authorization: `Bearer ${token}` } })).status).toBe(403);
      expect((await fetch(`${base}${route}`, { headers: { ...OWNER, Origin: 'https://attacker.test' } })).status).toBe(403);
      expect((await fetch(`${base}${route}`, { headers: { ...OWNER, 'Sec-Fetch-Site': 'cross-site' } })).status).toBe(403);
      expect((await fetch(`${base}${route}`, { headers: { ...OWNER, 'Sec-Fetch-Site': 'same-site' } })).status).toBe(403);
    }
  });

  test('JSON decisions report status and keep expired or repeated pairing codes unusable', async () => {
    const denied = await pair();
    const deny = await fetch(`${base}/api/remote/auth/deny`, {
      ...json({ code: denied.userCode }), headers: { ...OWNER, Origin: ORIGIN, 'Content-Type': 'application/json' },
    });
    expect(await deny.json()).toEqual({ denied: true });
    const denyAgain = await fetch(`${base}/api/remote/auth/deny`, {
      ...json({ code: denied.userCode }), headers: { ...OWNER, Origin: ORIGIN, 'Content-Type': 'application/json' },
    });
    expect(denyAgain.status).toBe(410);
    expect(await denyAgain.json()).toEqual({ error: 'pairing code expired or invalid' });
    expect((await fetch(`${base}/api/remote/auth/pairing?code=${denied.userCode}`, { headers: OWNER })).status).toBe(410);

    const allowed = await pair();
    expect((await approve(allowed.userCode)).status).toBe(200);
    const repeat = await approve(allowed.userCode);
    expect(repeat.status).toBe(410);
    expect(await repeat.json()).toEqual({ error: 'pairing code expired or invalid' });
    const claim = await fetch(`${base}/api/remote/auth/token`, json({ deviceCode: allowed.deviceCode }));
    const { device } = await claim.json() as { device: { id: string } };
    const revoke = await fetch(`${base}/api/remote/auth/revoke`, {
      ...json({ id: device.id }), headers: { ...OWNER, Origin: ORIGIN, 'Content-Type': 'application/json' },
    });
    expect(await revoke.json()).toEqual({ revoked: true });
    expect((await fetch(`${base}/api/remote/auth/devices`, { headers: OWNER }).then((res) => res.json()) as RemoteDevicesResponse).devices).toEqual([]);

    const expired = await pair();
    time += 10 * 60_000 + 1;
    const lookup = await fetch(`${base}/api/remote/auth/pairing?code=${expired.userCode}`, { headers: OWNER });
    expect(lookup.status).toBe(410);
    expect(await lookup.json()).toEqual({ error: 'pairing code expired or invalid' });
  });

  test('viewerPages hands authenticated device pages to the hub while retaining unauthorized fallback', async () => {
    auth.close();
    auth = createRemoteAuth({
      home, origin: ORIGIN, isAdmin: (req) => req.headers.cookie === 'owner=1',
      projects: () => [], now: () => time, viewerPages: true,
    });
    expect((await fetch(`${base}/devices`, { headers: OWNER })).status).toBe(404);
    expect((await fetch(`${base}/connect`, { headers: OWNER })).status).toBe(404);
    expect((await fetch(`${base}/devices`)).status).toBe(403);
    expect((await fetch(`${base}/connect`)).status).toBe(403);
  });
});
