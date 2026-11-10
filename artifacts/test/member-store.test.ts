import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';
import { createMemberStore } from '../src/server/member-store';

const homes: string[] = [];
afterEach(() => { vi.restoreAllMocks(); for (const home of homes.splice(0)) fs.rmSync(home, { recursive: true, force: true }); });
function fixture() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'anjian-members-'));
  homes.push(home);
  let time = 1_800_000_000_000;
  return { home, store: createMemberStore(home, 1, () => time), advance: (ms: number) => { time += ms; } };
}
const alice = { id: 2, login: 'alice' };

test('invitations are account-bound, single use and store only a token hash', () => {
  const { home, store } = fixture();
  const invitation = store.invite(alice, 1024);
  expect(store.principal(2)).toBeNull();
  expect(JSON.stringify(store.list())).not.toContain(invitation.token);
  expect(fs.readFileSync(path.join(home, 'members/index.json'), 'utf8')).not.toContain(invitation.token);
  expect(() => store.accept({ id: 3, login: 'other' }, invitation.token)).toThrow('受邀');
  expect(store.accept(alice, invitation.token)).toMatchObject({ role: 'member', id: 'github:2' });
  expect(() => store.accept(alice, invitation.token)).toThrow('邀请无效');
  expect(createMemberStore(home, 1).principal(2)).toMatchObject({ role: 'member' });
  expect(store.list().members[0]?.quotaBytes).toBe(1024);
});

test('expired, revoked and replaced invitations cannot admit an account', () => {
  const { store, advance } = fixture();
  const first = store.invite(alice, 10, 100);
  advance(100);
  expect(() => store.accept(alice, first.token)).toThrow('邀请无效');
  const revoked = store.invite(alice, 10);
  store.revokeInvitation(revoked.id);
  expect(() => store.accept(alice, revoked.token)).toThrow('邀请无效');
  const replaced = store.invite(alice, 10);
  const current = store.invite(alice, 20);
  expect(() => store.accept(alice, replaced.token)).toThrow('邀请无效');
  store.accept(alice, current.token);
  expect(store.list().members[0]?.quotaBytes).toBe(20);
});

test('suspension invalidates old sessions even after reactivation and across store instances', () => {
  const { home, store } = fixture();
  const session = store.accept(alice, store.invite(alice, 1024).token);
  const second = createMemberStore(home, 1);
  second.update(session.id, { status: 'suspended' });
  expect(store.principal(2)).toBeNull();
  expect(() => store.invite(alice, 10)).toThrow('已是成员');
  second.update(session.id, { status: 'active' });
  expect(store.principal(2, session.sessionVersion)).toBeNull();
  expect(store.principal(2, 2)).toMatchObject({ sessionVersion: 2 });
  expect(store.principal(1)).toMatchObject({ id: 'owner', role: 'owner' });
});

test('legacy projects default to Owner and assigned projects cannot silently change owners', () => {
  const { home, store } = fixture();
  const member = store.accept(alice, store.invite(alice, 1).token);
  const project = path.join(home, 'project');
  expect(store.projectOwner(project)).toBe('owner');
  store.assignProject(project, member.id);
  expect(createMemberStore(home, 1).projectOwner(project)).toBe(member.id);
  expect(() => store.assignProject(project, 'owner')).toThrow('归属于');
  expect(() => store.assignProject('/another', 'github:999')).toThrow('成员不存在');
});

test('corrupt or symlinked metadata fails closed without resetting membership', () => {
  const { home, store } = fixture();
  const file = path.join(home, 'members/index.json');
  fs.writeFileSync(file, '{broken');
  expect(() => store.principal(2)).toThrow('成员数据不可用');
  expect(() => store.invite(alice, 1)).toThrow('成员数据不可用');
  fs.unlinkSync(file);
  fs.symlinkSync(path.join(home, 'missing'), file);
  expect(() => store.list()).toThrow('成员数据不可用');
});

test('failed persistence does not consume an invitation or grant membership', () => {
  const { home, store } = fixture();
  const invitation = store.invite(alice, 1024);
  const rename = vi.spyOn(fs, 'renameSync').mockImplementationOnce(() => { throw new Error('disk full'); });
  expect(() => store.accept(alice, invitation.token)).toThrow('disk full');
  rename.mockRestore();
  expect(store.principal(2)).toBeNull();
  expect(store.accept(alice, invitation.token)).toMatchObject({ role: 'member' });
  expect(fs.readdirSync(path.join(home, 'members')).filter((f) => f.endsWith('.tmp'))).toEqual([]);
});

test('invalid quota and Owner changes are rejected', () => {
  const { store } = fixture();
  expect(() => store.invite({ id: 1, login: 'owner' }, 10)).toThrow('无需邀请');
  for (const bytes of [-1, 1.5, Infinity, Number.MAX_SAFE_INTEGER + 1])
    expect(() => store.invite(alice, bytes)).toThrow('额度无效');
  expect(() => store.update('owner', { status: 'suspended' })).toThrow('成员不存在');
});
