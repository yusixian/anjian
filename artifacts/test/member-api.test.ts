import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';
import { createMemberApi } from '../src/server/member-api';
import { createMemberStore } from '../src/server/member-store';

const servers: http.Server[] = [];
const homes: string[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  for (const home of homes.splice(0)) fs.rmSync(home, { recursive: true, force: true });
});
async function fixture(enabled = true) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'anjian-member-api-'));
  homes.push(home);
  const members = createMemberStore(home, 1);
  let ownerActive = true;
  const provider = vi.fn(async () => new Response(JSON.stringify({ id: 2, login: 'Friend', type: 'User' })));
  const origin = 'https://anjian.example';
  const api = createMemberApi({ members, origin, enabled, fetch: provider as typeof fetch,
    owner: (req) => ownerActive && req.headers.cookie === 'owner',
    readBody: async (req) => { const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk)); return JSON.parse(Buffer.concat(chunks).toString()); },
  });
  const server = http.createServer((req, res) => {
    void api(req, res, new URL(req.url!, origin)).then((handled) => { if (!handled) { res.statusCode = 404; res.end(); } }).catch(() => { res.statusCode = 500; res.end(); });
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const request = (body?: unknown, headers: Record<string, string> = {}) => fetch(base + '/api/hub/members', {
    method: body === undefined ? 'GET' : 'POST',
    headers: { Cookie: 'owner', Origin: origin, 'Content-Type': 'application/json', ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { members, request, provider, revoke: () => { ownerActive = false; } };
}

test('invites use provider identity, reveal token once and never expose its hash in lists', async () => {
  const { members, request, provider } = await fixture();
  const response = await request({ action: 'invite', login: 'Friend', githubId: 999, quotaBytes: 1024 });
  expect(response.status).toBe(201);
  const result = await response.json();
  expect(result.invitation.githubId).toBe(2);
  const token = new URL(result.url).searchParams.get('invite')!;
  expect(token).toHaveLength(43);
  expect(provider.mock.calls[0]).toEqual([
    'https://api.github.com/users/Friend', expect.objectContaining({ redirect: 'error' }),
  ]);
  const list = await (await request()).json();
  expect(list.invitations).toHaveLength(1);
  expect(JSON.stringify(list)).not.toContain(token);
  expect(JSON.stringify(list)).not.toContain('tokenHash');
  expect(members.accept({ id: 2, login: 'Friend' }, token).id).toBe('github:2');
});

test('anonymous, member and cross-site requests cannot view or change membership', async () => {
  const { request, provider } = await fixture();
  const attempts: Record<string, string>[] = [{ Cookie: '' }, { Cookie: 'member' }, { Origin: 'https://evil.example' }, { 'Sec-Fetch-Site': 'cross-site' }];
  for (const headers of attempts) {
    expect((await request(undefined, headers)).status).toBe(403);
    expect((await request({ action: 'invite', login: 'Friend', quotaBytes: 1 }, headers)).status).toBe(403);
  }
  expect(provider).not.toHaveBeenCalled();
});

test('suspension invalidates old identity and owner cannot be modified through the members API', async () => {
  const { members, request } = await fixture();
  const invite = members.invite({ id: 2, login: 'Friend' }, 1024);
  const identity = members.accept({ id: 2, login: 'Friend' }, invite.token);
  expect((await request({ action: 'update', id: identity.id, status: 'suspended', quotaBytes: 2048 })).status).toBe(200);
  expect(members.principal(2, identity.sessionVersion)).toBeNull();
  expect((await request({ action: 'update', id: identity.id, status: 'active' })).status).toBe(200);
  expect(members.principal(2, identity.sessionVersion)).toBeNull();
  expect(members.list().members[0]!.quotaBytes).toBe(2048);
  expect((await request({ action: 'update', id: 'owner', status: 'suspended' })).status).toBe(404);
  expect((await request({ action: 'update', id: identity.id, quotaBytes: -1 })).status).toBe(400);
});

test('invitation revocation and disabled GitHub prevent joining', async () => {
  const { members, request } = await fixture(false);
  expect((await request({ action: 'invite', login: 'Friend', quotaBytes: 1 })).status).toBe(409);
  const invite = members.invite({ id: 2, login: 'Friend' }, 1024);
  expect((await request({ action: 'revoke-invitation', id: invite.id })).status).toBe(200);
  expect(() => members.accept({ id: 2, login: 'Friend' }, invite.token)).toThrow();
});

test('provider errors are sanitized and privilege is rechecked after lookup', async () => {
  const { members, request, provider, revoke } = await fixture();
  provider.mockImplementationOnce(async () => { throw new Error('/private/server/secret'); });
  const failure = await request({ action: 'invite', login: 'Friend', quotaBytes: 1 });
  expect(failure.status).toBe(502);
  expect(await failure.text()).not.toContain('/private');
  provider.mockImplementationOnce(async () => { revoke(); return new Response(JSON.stringify({ id: 2, login: 'Friend', type: 'User' })); });
  expect((await request({ action: 'invite', login: 'Friend', quotaBytes: 1 })).status).toBe(403);
  expect(members.list().invitations).toEqual([]);
});
