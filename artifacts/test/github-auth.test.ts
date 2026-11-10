import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type http from 'node:http';

import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import { createGitHubAuth, type GitHubConfig, readGitHubConfig } from '../src/server/github-auth';

import { createMemberStore } from '../src/server/member-store';

const homes: string[] = [];
const config: GitHubConfig = { clientId: 'client-id', clientSecret: 'client-secret', ownerId: 1234 };
const token = 'server-master-key';
const origin = 'https://anjian.example';
const cookieName = 'anjian_artifacts_27319';
const destination = '/artboard/example?page=devices';
const pair = (cookie: string) => cookie.split(';')[0]!;
const request = (cookie?: string) => ({ headers: { cookie } }) as http.IncomingMessage;
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-09T00:00:00Z'));
});
afterEach(() => { vi.useRealTimers(); for (const home of homes.splice(0)) fs.rmSync(home, { recursive: true, force: true }); });

function fixture(overrides: Partial<Parameters<typeof createGitHubAuth>[0]> = {}) {
  const fetch = vi.fn<typeof globalThis.fetch>();
  const auth = createGitHubAuth({ config, token, origin, cookieName, fetch, ...overrides });
  const begin = (remember = false) => {
    const flow = auth.start(destination, remember);
    const authorization = new URL(flow.location);
    const callback = new URL('/auth/github/callback', origin);
    callback.searchParams.set('state', authorization.searchParams.get('state')!);
    callback.searchParams.set('code', 'github-code');
    return { ...flow, authorization, callback, req: request(pair(flow.cookie)) };
  };
  const acceptOwner = () => fetch.mockResolvedValueOnce(json({ access_token: 'provider-token', token_type: 'bearer' }))
    .mockResolvedValueOnce(json({ id: config.ownerId, login: 'renamed-owner' }));
  return { auth, fetch, begin, acceptOwner };
}

function decodeCookie(cookie: string) {
  const value = pair(cookie).slice(pair(cookie).indexOf('=') + 1);
  return JSON.parse(Buffer.from(value.split('.')[0]!, 'base64url').toString('utf8'));
}

test('GitHub configuration is absent by default and partial or invalid configuration fails closed', () => {
  expect(readGitHubConfig({})).toBeUndefined();
  const valid = { ANJIAN_GITHUB_CLIENT_ID: ' client-id ', ANJIAN_GITHUB_CLIENT_SECRET: ' client-secret ', ANJIAN_GITHUB_OWNER_ID: ' 1234 ' };
  expect(readGitHubConfig(valid)).toEqual(config);
  for (const missing of Object.keys(valid)) expect(() => readGitHubConfig({ ...valid, [missing]: '' })).toThrow();
  for (const owner of ['0', '-1', '1.2', 'owner-name', '9007199254740992'])
    expect(() => readGitHubConfig({ ...valid, ANJIAN_GITHUB_OWNER_ID: owner })).toThrow();
});

test('OAuth callback configuration allows HTTPS and local HTTP only', () => {
  for (const invalid of ['http://anjian.example', 'https://user:pass@anjian.example', 'https://anjian.example/path', 'https://anjian.example/?q=1', 'https://anjian.example/#fragment'])
    expect(() => fixture({ origin: invalid })).toThrow();
  for (const local of ['http://localhost:27319', 'http://127.0.0.1:27319', 'http://[::1]:27319']) {
    const { auth } = fixture({ origin: local });
    const flow = auth.start('/', false);
    expect(new URL(flow.location).searchParams.get('redirect_uri')).toBe(local + '/auth/github/callback');
    expect(flow.cookie).not.toContain('; Secure');
  }
});

test('authorization uses random state, S256 PKCE and a short lived host-only Lax flow cookie', () => {
  const { begin } = fixture();
  const flow = begin(true);
  const stored = decodeCookie(flow.cookie);
  expect(flow.authorization.origin + flow.authorization.pathname).toBe('https://github.com/login/oauth/authorize');
  expect(flow.authorization.searchParams.get('client_id')).toBe(config.clientId);
  expect(flow.authorization.searchParams.get('redirect_uri')).toBe(origin + '/auth/github/callback');
  expect(flow.authorization.searchParams.get('code_challenge_method')).toBe('S256');
  expect(flow.authorization.searchParams.get('code_challenge')).toBe(crypto.createHash('sha256').update(stored.verifier).digest('base64url'));
  expect(flow.authorization.searchParams.get('state')).toBe(stored.state);
  expect(stored.state).toHaveLength(43);
  expect(stored.verifier).toHaveLength(43);
  expect(flow.location).not.toContain(config.clientSecret);
  expect(flow.authorization.searchParams.has('scope')).toBe(false);
  expect(flow.cookie).toContain('HttpOnly; SameSite=Lax; Path=/; Secure; Max-Age=600');
  expect(flow.cookie).not.toContain('Domain=');
  expect(begin().authorization.searchParams.get('state')).not.toBe(stored.state);
});

test('wrong state, missing or another browser cookie, expired flows and foreign-instance callbacks cannot exchange codes', async () => {
  const { auth, fetch, begin } = fixture();
  const flow = begin();
  const wrong = new URL(flow.callback);
  wrong.searchParams.set('state', 'wrong-state');
  await expect(auth.callback(flow.req, wrong)).rejects.toMatchObject({ code: 'expired' });
  await expect(auth.callback(request(), flow.callback)).rejects.toMatchObject({ code: 'expired' });
  await expect(auth.callback(begin().req, flow.callback)).rejects.toMatchObject({ code: 'expired' });
  await expect(fixture().auth.callback(flow.req, flow.callback)).rejects.toMatchObject({ code: 'expired' });
  vi.setSystemTime(Date.now() + 600_000);
  await expect(auth.callback(flow.req, flow.callback)).rejects.toMatchObject({ code: 'expired' });
  expect(fetch).not.toHaveBeenCalled();
});

test('cancelled authorization consumes the flow without contacting GitHub', async () => {
  const { auth, fetch, begin } = fixture();
  const flow = begin();
  flow.callback.searchParams.set('error', 'access_denied');
  await expect(auth.callback(flow.req, flow.callback)).rejects.toMatchObject({ code: 'denied' });
  await expect(auth.callback(flow.req, flow.callback)).rejects.toMatchObject({ code: 'expired' });
  expect(fetch).not.toHaveBeenCalled();
});

test.each(['http', 'network', 'json', 'oversized'] as const)('provider %s failures do not create a session or leave a reusable flow', async (failure) => {
  const { auth, fetch, begin } = fixture();
  const flow = begin();
  if (failure === 'http') fetch.mockResolvedValueOnce(json({}, 503));
  if (failure === 'network') fetch.mockRejectedValueOnce(new Error('upstream connection lost'));
  if (failure === 'json') fetch.mockResolvedValueOnce(new Response('invalid json'));
  if (failure === 'oversized') fetch.mockResolvedValueOnce(new Response('x'.repeat(16_385)));
  await expect(auth.callback(flow.req, flow.callback)).rejects.toMatchObject({ code: 'provider' });
  await expect(auth.callback(flow.req, flow.callback)).rejects.toMatchObject({ code: 'expired' });
  expect(auth.authorized(pair(flow.cookie))).toBe(false);
});

test('a different GitHub user is denied even when the username matches the owner', async () => {
  const { auth, fetch, begin } = fixture();
  const flow = begin();
  fetch.mockResolvedValueOnce(json({ access_token: 'provider-token', token_type: 'bearer' }))
    .mockResolvedValueOnce(json({ id: 9999, login: 'owner' }));
  await expect(auth.callback(flow.req, flow.callback)).rejects.toMatchObject({ code: 'denied' });
  expect(auth.authorized(pair(flow.cookie))).toBe(false);
});

test.each([false, true])('owner login issues a signed non-master session and preserves remember=%s and return target', async (remember) => {
  const { auth, fetch, begin, acceptOwner } = fixture();
  const flow = begin(remember);
  acceptOwner();
  const result = await auth.callback(flow.req, flow.callback);
  expect(result.returnTo).toBe(destination);
  const sessionCookie = result.cookies[1]!;
  expect(result.cookies[0]).toContain('_github_state=;');
  expect(result.cookies[0]).toContain('Max-Age=0');
  expect(sessionCookie).toContain('HttpOnly; SameSite=Lax; Path=/; Secure');
  expect(sessionCookie).not.toContain(token);
  expect(sessionCookie).not.toContain('provider-token');
  expect(sessionCookie).not.toContain(config.clientSecret);
  expect(auth.authorized(pair(sessionCookie))).toBe(true);
  expect(auth.authorized(`${cookieName}_github=${token}`)).toBe(false);
  expect(sessionCookie.includes('Max-Age=2592000')).toBe(remember);
  const exchange = fetch.mock.calls[0]!;
  expect(exchange[0]).toBe('https://github.com/login/oauth/access_token');
  expect(exchange[1]?.redirect).toBe('error');
  expect(JSON.parse(exchange[1]!.body as string)).toMatchObject({ code: 'github-code', client_secret: config.clientSecret, code_verifier: decodeCookie(flow.cookie).verifier });
  expect(fetch.mock.calls[1]![0]).toBe('https://api.github.com/user');
  await expect(auth.callback(flow.req, flow.callback)).rejects.toMatchObject({ code: 'expired' });
  expect(fetch).toHaveBeenCalledTimes(2);
  const ttl = (remember ? 30 : 1) * 86400;
  expect(decodeCookie(sessionCookie).expires).toBe(Math.floor(Date.now() / 1000) + ttl);
  vi.setSystemTime(Date.now() + ttl * 1000);
  expect(auth.authorized(pair(sessionCookie))).toBe(false);
});

test('simultaneous callback replay is rejected before a second token exchange', async () => {
  const { auth, fetch, begin, acceptOwner } = fixture();
  const flow = begin();
  acceptOwner();
  const first = auth.callback(flow.req, flow.callback);
  await expect(auth.callback(flow.req, flow.callback)).rejects.toMatchObject({ code: 'expired' });
  await expect(first).resolves.toMatchObject({ returnTo: destination });
  expect(fetch).toHaveBeenCalledTimes(2);
});

test('session tampering and server key, owner or OAuth application rotation invalidate authority', async () => {
  const { auth, begin, acceptOwner } = fixture();
  const flow = begin();
  acceptOwner();
  const result = await auth.callback(flow.req, flow.callback);
  const session = pair(result.cookies[1]!);
  expect(auth.authorized(session + 'x')).toBe(false);
  expect(auth.authorized(session.replace('=', '=x'))).toBe(false);
  expect(auth.authorized(pair(flow.cookie).replace('_github_state=', '_github='))).toBe(false);
  expect(fixture({ token: 'rotated-server-key' }).auth.authorized(session)).toBe(false);
  expect(fixture({ config: { ...config, ownerId: 9999 } }).auth.authorized(session)).toBe(false);
  expect(fixture({ config: { ...config, clientId: 'another-oauth-app' } }).auth.authorized(session)).toBe(false);
  expect(fixture().auth.authorized(session)).toBe(true);
});

test('logout clears both GitHub session and pending flow cookies with matching scope', () => {
  const { auth } = fixture();
  expect(auth.clearCookie()).toEqual([
    `${cookieName}_github=; HttpOnly; SameSite=Lax; Path=/; Secure; Max-Age=0`,
    `${cookieName}_github_state=; HttpOnly; SameSite=Lax; Path=/; Secure; Max-Age=0`,
  ]);
  expect(auth.clearStateCookie()).toBe(auth.clearCookie()[1]);
});


function membersFixture() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'anjian-oauth-members-'));
  homes.push(home);
  const members = createMemberStore(home, config.ownerId);
  const base = fixture({ members });
  const login = async (id: number, invitation?: string) => {
    const flow = base.auth.start('/', true, invitation);
    const callback = new URL('/auth/github/callback', origin);
    callback.searchParams.set('state', new URL(flow.location).searchParams.get('state')!);
    callback.searchParams.set('code', 'member-code');
    base.fetch.mockResolvedValueOnce(json({ access_token: 'provider-token', token_type: 'bearer' }))
      .mockResolvedValueOnce(json({ id, login: `user-${id}` }));
    const result = await base.auth.callback(request(pair(flow.cookie)), callback);
    return pair(result.cookies[1]!);
  };
  return { ...base, members, login };
}

test('an invited member receives a distinct identity, never legacy administrator authority', async () => {
  const { auth, members, login } = membersFixture();
  const invite = members.invite({ id: 44, login: 'user-44' }, 2048);
  const cookie = await login(44, invite.token);
  expect(auth.principal(cookie)).toMatchObject({ role: 'member', id: 'github:44', githubId: 44 });
  expect(auth.authorized(cookie)).toBe(false);
  expect(decodeCookie(cookie)).not.toHaveProperty('ownerId');
  expect(fixture().auth.principal(cookie)).toBeNull();
  expect(auth.principal(await login(44))).toMatchObject({ role: 'member' });
  expect(auth.authorized(await login(config.ownerId))).toBe(true);
});

test('member sessions are invalidated on suspension and do not revive after reactivation', async () => {
  const { auth, members, login } = membersFixture();
  const cookie = await login(44, members.invite({ id: 44, login: 'user-44' }, 0).token);
  members.update('github:44', { status: 'suspended' });
  expect(auth.principal(cookie)).toBeNull();
  await expect(login(44)).rejects.toMatchObject({ code: 'denied' });
  members.update('github:44', { status: 'active' });
  expect(auth.principal(cookie)).toBeNull();
  expect(auth.principal(await login(44))).toMatchObject({ role: 'member', sessionVersion: 2 });
});

test('wrong-account and revoked invitations cannot bootstrap a member session', async () => {
  const { members, login } = membersFixture();
  const invite = members.invite({ id: 44, login: 'user-44' }, 1024);
  await expect(login(45, invite.token)).rejects.toMatchObject({ code: 'denied' });
  expect(members.list().members).toHaveLength(0);
  members.revokeInvitation(invite.id);
  await expect(login(44, invite.token)).rejects.toMatchObject({ code: 'denied' });
  await expect(login(44)).rejects.toMatchObject({ code: 'denied' });
});

test('invitation is bound to the signed flow and never sent to GitHub', () => {
  const { auth, members } = membersFixture();
  const invite = members.invite({ id: 44, login: 'user-44' }, 1024);
  const flow = auth.start('/', false, invite.token);
  expect(decodeCookie(flow.cookie).invitation).toBe(invite.token);
  expect(flow.location).not.toContain(invite.token);
  expect(() => auth.start('/', false, 'invalid')).toThrow('邀请链接无效');
});
