import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';
import { createMemberWorkspace } from '../src/server/member-workspace';
import { createMemberStore } from '../src/server/member-store';

const homes: string[] = [];
afterEach(() => { for (const home of homes.splice(0)) fs.rmSync(home, { recursive: true, force: true }); });
function fixture() {
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'anjian-workspace-')));
  homes.push(home);
  const members = createMemberStore(home, 1);
  const identity = members.accept({ id: 2, login: 'alice' }, members.invite({ id: 2, login: 'alice' }, 1024).token);
  return { home, members, identity };
}
test('workspace creation is retryable after registration failure and parallel calls share work', async () => {
  const { home, members, identity } = fixture();
  const register = vi.fn(async () => {}).mockRejectedValueOnce(new Error('disk unavailable'));
  const prepare = createMemberWorkspace({ home, members, register });
  await expect(prepare(identity)).rejects.toThrow('disk unavailable');
  const project = path.join(home, 'workspaces/github-2');
  expect(members.projectOwner(project)).toBe(identity.id);
  await Promise.all([prepare(identity), prepare(identity)]);
  expect(register).toHaveBeenCalledTimes(2);
  expect(register).toHaveBeenLastCalledWith(project);
});
test('workspace symlinks cannot redirect registration into existing owner data', async () => {
  const { home, members, identity } = fixture();
  const owner = path.join(home, 'owner');
  fs.mkdirSync(owner);
  fs.symlinkSync(owner, path.join(home, 'workspaces'));
  const register = vi.fn(async () => {});
  await expect(createMemberWorkspace({ home, members, register })(identity)).rejects.toThrow('个人空间暂不可用');
  expect(register).not.toHaveBeenCalled();
  expect(fs.readdirSync(owner)).toEqual([]);
});
test('revocation during registration prevents a successful login', async () => {
  const { home, members, identity } = fixture();
  const register = async () => { members.update(identity.id, { status: 'suspended' }); };
  await expect(createMemberWorkspace({ home, members, register })(identity)).rejects.toThrow('成员访问权限已失效');
});

test('storage recovery does not prevent login or create an empty member workspace', async () => {
  const { home, members, identity } = fixture();
  const register = vi.fn(async () => {});
  let available = false;
  const prepare = createMemberWorkspace({ home, members, register, available: () => available });
  await expect(prepare(identity)).resolves.toBeUndefined();
  expect(register).not.toHaveBeenCalled();
  expect(fs.existsSync(path.join(home, 'workspaces'))).toBe(false);
  available = true;
  await prepare(identity);
  expect(register).toHaveBeenCalledOnce();
});
