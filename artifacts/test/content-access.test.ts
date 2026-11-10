import { expect, test } from 'vitest';
import { createContentAccess } from '../src/server/content-access';
import type { Principal } from '../src/server/member-store';

const member: Principal = { id: 'github:2', role: 'member', sessionVersion: 1 };
const artifact = { type: 'html' as const, id: 'demo' };
const tokenOf = (base: string) => base.split('/')[2]!;

test('private grants are opaque, scoped and reused only within the same identity and artifact', () => {
  const access = createContentAccess(() => true, () => 1000);
  const first = access.issue(member, '/private/project', artifact);
  expect(first.contentBase).toMatch(/^\/p\/[A-Za-z0-9_-]{43}\/$/);
  expect(first.contentBase).not.toContain('project');
  expect(access.issue(member, '/private/project', artifact)).toEqual(first);
  for (const other of [
    access.issue({ ...member, sessionVersion: 2 }, '/private/project', artifact),
    access.issue(member, '/other/project', artifact),
    access.issue(member, '/private/project', { ...artifact, id: 'other' }),
    access.issue({ ...member, id: 'github:3' }, '/private/project', artifact),
  ]) expect(other.contentBase).not.toBe(first.contentBase);
  const grant = access.resolve(tokenOf(first.contentBase))!;
  expect(grant).toEqual({ principal: member, project: '/private/project', artifact, expiresAt: first.contentExpiresAt });
  grant.principal.id = 'forged';
  grant.artifact.id = 'forged';
  expect(access.resolve(tokenOf(first.contentBase))!.principal.id).toBe(member.id);
  expect(access.resolve(tokenOf(first.contentBase))!.artifact.id).toBe('demo');
});

test('expiry rotates paths without breaking in-flight resources and rejects expired paths', () => {
  let now = 1000;
  const access = createContentAccess(() => true, () => now);
  const first = access.issue(member, '/project', artifact);
  now = first.contentExpiresAt - 4 * 60_000;
  const next = access.issue(member, '/project', artifact);
  expect(next.contentBase).not.toBe(first.contentBase);
  expect(access.resolve(tokenOf(first.contentBase))).not.toBeNull();
  now = first.contentExpiresAt;
  expect(access.resolve(tokenOf(first.contentBase))).toBeNull();
  expect(access.resolve(tokenOf(next.contentBase))).not.toBeNull();
});

test('every resource request rechecks authority and rejects forged tokens', () => {
  let version = 1;
  const access = createContentAccess((identity, project) => identity.sessionVersion === version && project === '/project');
  const grant = access.issue(member, '/project', artifact);
  expect(() => access.issue(member, '/other', artifact)).toThrow('Content access denied');
  version++;
  expect(access.resolve(tokenOf(grant.contentBase))).toBeNull();
  expect(() => access.issue(member, '/project', artifact)).toThrow('Content access denied');
  for (const token of ['', '../secret', 'a'.repeat(43)]) expect(access.resolve(token)).toBeNull();
});
