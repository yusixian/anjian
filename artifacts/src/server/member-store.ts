import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export interface GitHubIdentity { id: number; login: string }
export interface Member {
  id: string;
  githubId: number;
  login: string;
  status: 'active' | 'suspended';
  sessionVersion: number;
  quotaBytes: number;
  joinedAt: number;
}
export interface Principal {
  id: string;
  role: 'owner' | 'member';
  githubId?: number;
  sessionVersion: number;
}
interface Invitation {
  id: string;
  githubId: number;
  login: string;
  tokenHash: string;
  quotaBytes: number;
  createdAt: number;
  expiresAt: number;
}
interface State {
  version: 1;
  members: Member[];
  invitations: Invitation[];
  projects: Array<{ project: string; memberId: string }>;
}

export class MemberError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}
const validId = (id: unknown): id is number => Number.isSafeInteger(id) && Number(id) > 0;
const validBytes = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;
const validLogin = (login: unknown): login is string => typeof login === 'string' && /^[a-z\d](?:[a-z\d-]{0,38})$/i.test(login);
const memberId = (githubId: number) => `github:${githubId}`;
const digest = (token: string) => crypto.createHash('sha256').update(token).digest('hex');
const fail = (status: number, code: string, message: string): never => { throw new MemberError(status, code, message); };

/** Single-server metadata; read each transaction so independent consumers never overwrite stale state. */
export function createMemberStore(home: string, ownerId?: number, now = Date.now) {
  if (ownerId !== undefined && !validId(ownerId)) throw new Error('Invalid owner GitHub ID');
  const root = path.resolve(home, 'members');
  const file = path.join(root, 'index.json');
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  if (!fs.lstatSync(root).isDirectory() || fs.lstatSync(root).isSymbolicLink())
    fail(503, 'unsafe_storage', '成员存储目录不可用。');
  const read = (): State => {
    let state: State;
    try {
      if (!fs.lstatSync(file).isFile() || fs.lstatSync(file).isSymbolicLink() || fs.statSync(file).size > 4 * 1024 * 1024)
        throw new Error('Invalid member file');
      state = JSON.parse(fs.readFileSync(file, 'utf8')) as State;
      if (state.version !== 1 || !Array.isArray(state.members) || !Array.isArray(state.invitations) || !Array.isArray(state.projects))
        throw new Error('Invalid member index');
      if (state.members.some((m) => !m || !validId(m.githubId) || m.id !== memberId(m.githubId) ||
          !validLogin(m.login) || !['active', 'suspended'].includes(m.status) || !validBytes(m.quotaBytes) ||
          !validBytes(m.sessionVersion) || !Number.isFinite(m.joinedAt)) ||
          new Set(state.members.map((m) => m.id)).size !== state.members.length)
        throw new Error('Invalid members');
      if (state.invitations.some((i) => !i || typeof i.id !== 'string' || !/^[a-f\d-]{36}$/.test(i.id) ||
          !validId(i.githubId) || !validLogin(i.login) || !validBytes(i.quotaBytes) ||
          typeof i.tokenHash !== 'string' || !/^[a-f\d]{64}$/.test(i.tokenHash) ||
          !Number.isFinite(i.createdAt) || !Number.isFinite(i.expiresAt))) throw new Error('Invalid invitations');
      if (state.projects.some((p) => !p || typeof p.project !== 'string' || !path.isAbsolute(p.project) ||
          (p.memberId !== 'owner' && !state.members.some((m) => m.id === p.memberId))) ||
          new Set(state.projects.map((p) => p.project)).size !== state.projects.length)
        throw new Error('Invalid project ownership');
      return state;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { version: 1, members: [], invitations: [], projects: [] };
      return fail(503, 'members_unavailable', '成员数据不可用，请检查服务器存储。');
    }
  };
  const write = (state: State) => {
    const temporary = path.join(root, `.${crypto.randomUUID()}.tmp`);
    try {
      fs.writeFileSync(temporary, JSON.stringify(state), { flag: 'wx', mode: 0o600 });
      fs.renameSync(temporary, file);
    } finally { fs.rmSync(temporary, { force: true }); }
  };
  const principal = (githubId: number, version?: number): Principal | null => {
    if (ownerId !== undefined && githubId === ownerId) return { id: 'owner', role: 'owner', githubId, sessionVersion: 0 };
    const member = read().members.find((m) => m.githubId === githubId && m.status === 'active');
    return member && (version === undefined || version === member.sessionVersion)
      ? { id: member.id, role: 'member', githubId, sessionVersion: member.sessionVersion } : null;
  };
  return {
    principal,
    list() {
      const state = read();
      return { members: state.members, invitations: state.invitations.filter((i) => i.expiresAt > now()).map(({ tokenHash: _, ...i }) => i) };
    },
    invite(identity: GitHubIdentity, quotaBytes: number, lifetimeMs = 7 * 24 * 60 * 60_000) {
      if (!validId(identity.id) || !validLogin(identity.login) || !validBytes(quotaBytes) ||
          !Number.isSafeInteger(lifetimeMs) || lifetimeMs <= 0 || lifetimeMs > 7 * 24 * 60 * 60_000)
        return fail(400, 'invalid_invitation', '邀请账号或额度无效。');
      if (identity.id === ownerId) return fail(409, 'owner', '实例所有者无需邀请。');
      const state = read();
      if (state.members.some((m) => m.githubId === identity.id)) return fail(409, 'already_member', '该账号已是成员。');
      if (state.members.length + state.invitations.filter((i) => i.expiresAt > now()).length >= 1000)
        return fail(409, 'member_limit', '成员数量已达上限。');
      const token = crypto.randomBytes(32).toString('base64url');
      const invitation: Invitation = { id: crypto.randomUUID(), githubId: identity.id, login: identity.login,
        tokenHash: digest(token), quotaBytes, createdAt: now(), expiresAt: now() + lifetimeMs };
      state.invitations = state.invitations.filter((i) => i.githubId !== identity.id && i.expiresAt > now());
      state.invitations.push(invitation);
      write(state);
      const { tokenHash: _, ...info } = invitation;
      return { ...info, token };
    },
    revokeInvitation(id: string) {
      const state = read();
      state.invitations = state.invitations.filter((i) => i.id !== id);
      write(state);
    },
    accept(identity: GitHubIdentity, token: string): Principal {
      if (!validId(identity.id) || !validLogin(identity.login) || !/^[A-Za-z0-9_-]{43}$/.test(token))
        return fail(403, 'invalid_invitation', '邀请无效或已过期。');
      const state = read();
      const invitation = state.invitations.find((i) => i.tokenHash === digest(token) && i.expiresAt > now());
      if (!invitation) return fail(403, 'invalid_invitation', '邀请无效或已过期。');
      if (invitation.githubId !== identity.id) return fail(403, 'account_mismatch', '请使用受邀的 GitHub 账号登录。');
      if (state.members.some((m) => m.githubId === identity.id)) return fail(409, 'already_member', '该账号已是成员。');
      const member: Member = { id: memberId(identity.id), githubId: identity.id, login: identity.login,
        status: 'active', sessionVersion: 0, quotaBytes: invitation.quotaBytes, joinedAt: now() };
      state.members.push(member);
      state.invitations = state.invitations.filter((i) => i.githubId !== identity.id);
      write(state);
      return { id: member.id, role: 'member', githubId: identity.id, sessionVersion: 0 };
    },
    update(id: string, change: { status?: Member['status']; quotaBytes?: number }): Member {
      if ((change.status !== undefined && !['active', 'suspended'].includes(change.status)) ||
          (change.quotaBytes !== undefined && !validBytes(change.quotaBytes)))
        return fail(400, 'invalid_member', '成员状态或额度无效。');
      const state = read();
      const member = state.members.find((m) => m.id === id);
      if (!member) return fail(404, 'member_missing', '成员不存在。');
      if (change.status !== undefined && member.status !== change.status) {
        member.status = change.status;
        member.sessionVersion++;
      }
      if (change.quotaBytes !== undefined) member.quotaBytes = change.quotaBytes;
      write(state);
      return member;
    },
    storageProjects() {
      return read().projects.map(({ project, memberId }) => ({ dir: project, owner: memberId }));
    },
    projectOwner(project: string): string {
      // Existing registered projects remain owned by the original instance owner.
      return read().projects.find((p) => p.project === path.resolve(project))?.memberId ?? 'owner';
    },
    assignProject(project: string, id: string) {
      if (!path.isAbsolute(project)) return fail(400, 'invalid_project', '项目路径无效。');
      const state = read();
      if (id !== 'owner' && !state.members.some((m) => m.id === id && m.status === 'active'))
        return fail(404, 'member_missing', '成员不存在或已暂停。');
      const normalized = path.resolve(project);
      const existing = state.projects.find((p) => p.project === normalized);
      if (existing && existing.memberId !== id) return fail(409, 'project_owned', '项目已经归属于其他成员。');
      if (!existing) { state.projects.push({ project: normalized, memberId: id }); write(state); }
    },
  };
}
