import fs from 'node:fs';
import path from 'node:path';
import { MemberError, type Principal, type createMemberStore } from './member-store';

/** Member paths are server-assigned; no browser-provided path can become a workspace. */
export function createMemberWorkspace(options: {
  home: string;
  members: ReturnType<typeof createMemberStore>;
  register: (project: string) => Promise<unknown>;
  available?: (owner: string) => boolean;
}) {
  const root = path.join(fs.realpathSync(options.home), 'workspaces');
  const pending = new Map<string, Promise<void>>();
  const directory = (dir: string) => {
    fs.mkdirSync(dir, { mode: 0o700, recursive: true });
    const stat = fs.lstatSync(dir);
    if (!stat.isDirectory() || stat.isSymbolicLink() || fs.realpathSync(dir) !== dir)
      throw new MemberError(503, 'unsafe_workspace', '个人空间暂不可用，请联系管理员。');
  };
  return (identity: Principal): Promise<void> => {
    if (identity.role !== 'member') return Promise.resolve();
    const existing = pending.get(identity.id);
    if (existing) return existing;
    const work = Promise.resolve().then(async () => {
      const current = identity.githubId === undefined ? null : options.members.principal(identity.githubId, identity.sessionVersion);
      if (!current || current.id !== identity.id) throw new MemberError(403, 'member_disabled', '成员访问权限已失效。');
      // Login remains available so the member can repair their storage configuration.
      if (options.available && !options.available(identity.id)) return;
      directory(root);
      const project = path.join(root, `github-${identity.githubId}`);
      directory(project);
      options.members.assignProject(project, identity.id);
      await options.register(project);
      if (!options.members.principal(identity.githubId!, identity.sessionVersion))
        throw new MemberError(403, 'member_disabled', '成员访问权限已失效。');
    }).finally(() => { pending.delete(identity.id); });
    pending.set(identity.id, work);
    return work;
  };
}
