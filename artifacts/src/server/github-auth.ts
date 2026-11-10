import crypto from 'node:crypto';
import type http from 'node:http';

import { parseCookies, safeEqual } from './http';
import type { createMemberStore, Principal } from './member-store';

const FLOW_SECONDS = 10 * 60;
const SESSION_SECONDS = 24 * 60 * 60;
const REMEMBER_SECONDS = 30 * SESSION_SECONDS;
const MAX_FLOWS = 1024;
const CALLBACK_PATH = '/auth/github/callback';

export interface GitHubConfig {
  clientId: string;
  clientSecret: string;
  ownerId: number;
}

export class GitHubAuthError extends Error {
  returnTo?: string;
  invitation?: string;

  constructor(readonly code: 'expired' | 'denied' | 'provider', message: string) {
    super(message);
    this.name = 'GitHubAuthError';
  }
}

export function readGitHubConfig(env: NodeJS.ProcessEnv = process.env): GitHubConfig | undefined {
  const clientId = env.ANJIAN_GITHUB_CLIENT_ID?.trim() ?? '';
  const clientSecret = env.ANJIAN_GITHUB_CLIENT_SECRET?.trim() ?? '';
  const owner = env.ANJIAN_GITHUB_OWNER_ID?.trim() ?? '';
  if (!clientId && !clientSecret && !owner) return undefined;
  if (!clientId || !clientSecret || !/^[1-9]\d*$/.test(owner) || !Number.isSafeInteger(Number(owner)))
    throw new Error('GitHub 登录配置不完整：需要 Client ID、Client Secret 和有效的 Owner ID。');
  return { clientId, clientSecret, ownerId: Number(owner) };
}

interface Flow {
  state: string;
  verifier: string;
  returnTo: string;
  remember: boolean;
  expires: number;
  invitation?: string;
}

interface Session {
  ownerId?: number;
  githubId?: number;
  sessionVersion?: number;
  expires: number;
  nonce: string;
}

interface GitHubAuthOptions {
  config: GitHubConfig;
  token: string;
  origin: string;
  cookieName: string;
  fetch?: typeof fetch;
  members?: ReturnType<typeof createMemberStore>;
  prepareMember?: (identity: Principal) => Promise<void>;
}

function callbackOrigin(origin: string): string {
  const url = new URL(origin);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) ||
    url.username || url.password || url.pathname !== '/' || url.search || url.hash)
    throw new Error('GitHub 登录需要 HTTPS 公网地址或本机 HTTP 地址。');
  return url.origin;
}

function validReturnTo(value: string): boolean {
  return value.length <= 2048 && value.startsWith('/') && !value.startsWith('//') &&
    !/[\\\x00-\x20\x7f]/.test(value);
}

export function createGitHubAuth({ config, token, origin, cookieName, members, prepareMember, fetch: request = fetch }: GitHubAuthOptions) {
  const publicOrigin = callbackOrigin(origin);
  const callbackUrl = `${publicOrigin}${CALLBACK_PATH}`;
  const secure = publicOrigin.startsWith('https:');
  const sessionName = `${cookieName}_github`;
  const flowName = `${cookieName}_github_state`;
  // A server key rotation, owner change, or OAuth application change invalidates old sessions.
  const signingKey = crypto.createHmac('sha256', token)
    .update(`anjian:github-auth:v1:${config.clientId}:${config.ownerId}`)
    .digest();
  const issued = new Map<string, number>();
  const random = () => crypto.randomBytes(32).toString('base64url');
  const now = () => Math.floor(Date.now() / 1000);
  const cookie = (name: string, value: string, sameSite: 'Lax' | 'Strict', maxAge?: number) =>
    `${name}=${value}; HttpOnly; SameSite=${sameSite}; Path=/${secure ? '; Secure' : ''}${maxAge === undefined ? '' : `; Max-Age=${maxAge}`}`;
  const clear = (name: string, sameSite: 'Lax' | 'Strict') => cookie(name, '', sameSite, 0);
  const signature = (purpose: string, encoded: string) =>
    crypto.createHmac('sha256', signingKey).update(`${purpose}.${encoded}`).digest('base64url');
  const seal = (purpose: string, value: Flow | Session) => {
    const encoded = Buffer.from(JSON.stringify(value)).toString('base64url');
    return `${encoded}.${signature(purpose, encoded)}`;
  };
  const unseal = (purpose: string, value: string | undefined): unknown => {
    if (!value || value.length > 4096 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value)) return null;
    const dot = value.indexOf('.');
    const encoded = value.slice(0, dot);
    if (!safeEqual(value.slice(dot + 1), signature(purpose, encoded))) return null;
    try { return JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as unknown; }
    catch { return null; }
  };
  const cleanup = () => {
    for (const [state, expires] of issued) if (expires <= now()) issued.delete(state);
    while (issued.size >= MAX_FLOWS) issued.delete(issued.keys().next().value!);
  };
  const fetchJson = async (url: string, init: RequestInit): Promise<Record<string, unknown>> => {
    try {
      const response = await request(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(10_000) });
      if (!response.ok) throw new GitHubAuthError('provider', 'GitHub 登录服务暂不可用，请稍后重试。');
      const body = await response.text();
      if (body.length > 16_384) throw new GitHubAuthError('provider', 'GitHub 登录服务返回了无效响应。');
      const parsed: unknown = JSON.parse(body);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
        throw new GitHubAuthError('provider', 'GitHub 登录服务返回了无效响应。');
      return parsed as Record<string, unknown>;
    } catch {
      throw new GitHubAuthError('provider', 'GitHub 登录服务暂不可用，请稍后重试。');
    }
  };

  const principal = (header: string | undefined): Principal | null => {
    const session = unseal('session', parseCookies(header)[sessionName]) as Session | null;
    if (!session || typeof session.expires !== 'number' || session.expires <= now() ||
        typeof session.nonce !== 'string' || session.nonce.length !== 43) return null;
    // Existing signed Owner sessions remain valid; members never use the legacy owner field.
    if (session.ownerId === config.ownerId || session.githubId === config.ownerId)
      return { id: 'owner', role: 'owner', githubId: config.ownerId, sessionVersion: 0 };
    if (session.ownerId !== undefined || !Number.isSafeInteger(session.githubId) ||
        !Number.isSafeInteger(session.sessionVersion) || Number(session.sessionVersion) < 0) return null;
    return members?.principal(session.githubId!, session.sessionVersion) ?? null;
  };

  return {
    principal,
    start(returnTo: string, remember: boolean, invitation?: string): { location: string; cookie: string } {
      if (!validReturnTo(returnTo)) throw new Error('登录后的返回地址无效。');
      if (invitation !== undefined && !/^[A-Za-z0-9_-]{43}$/.test(invitation))
        throw new Error('邀请链接无效。');
      cleanup();
      const state = random();
      const verifier = random();
      const expires = now() + FLOW_SECONDS;
      issued.set(state, expires);
      const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
      const url = new URL('https://github.com/login/oauth/authorize');
      url.searchParams.set('client_id', config.clientId);
      url.searchParams.set('redirect_uri', callbackUrl);
      url.searchParams.set('state', state);
      url.searchParams.set('code_challenge', challenge);
      url.searchParams.set('code_challenge_method', 'S256');
      url.searchParams.set('allow_signup', 'false');
      const flow: Flow = { state, verifier, returnTo, remember, expires, ...(invitation ? { invitation } : {}) };
      return { location: url.toString(), cookie: cookie(flowName, seal('flow', flow), 'Lax', FLOW_SECONDS) };
    },

    async callback(req: http.IncomingMessage, url: URL): Promise<{ cookies: string[]; returnTo: string }> {
      const flow = unseal('flow', parseCookies(req.headers.cookie)[flowName]) as Flow | null;
      const state = url.searchParams.get('state');
      const code = url.searchParams.get('code');
      if (!flow || typeof flow.state !== 'string' || typeof flow.verifier !== 'string' ||
        typeof flow.expires !== 'number' || flow.expires <= now() ||
        !validReturnTo(flow.returnTo) || typeof flow.remember !== 'boolean' ||
        !state || !safeEqual(state, flow.state) || !issued.has(state))
        throw new GitHubAuthError('expired', 'GitHub 登录已失效，请重新尝试。');
      // Consume before network calls so simultaneous callbacks cannot exchange a code twice.
      issued.delete(state);
      try {
        if (url.searchParams.get('error') === 'access_denied')
          throw new GitHubAuthError('denied', 'GitHub 授权已取消。');
        if (!code || code.length > 2048 || !/^[A-Za-z0-9_-]+$/.test(code))
          throw new GitHubAuthError('expired', 'GitHub 登录已失效，请重新尝试。');
        const result = await fetchJson('https://github.com/login/oauth/access_token', {
          method: 'POST',
          headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: config.clientId, client_secret: config.clientSecret,
            code, redirect_uri: callbackUrl, code_verifier: flow.verifier }),
        });
        if (typeof result.access_token !== 'string' ||
          typeof result.token_type !== 'string' || result.token_type.toLowerCase() !== 'bearer')
          throw new GitHubAuthError('denied', 'GitHub 登录未获授权，请重新尝试。');
        const user = await fetchJson('https://api.github.com/user', {
          headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${result.access_token}`, 'User-Agent': 'Anjian' },
        });
        if (!Number.isSafeInteger(user.id) || Number(user.id) <= 0)
          throw new GitHubAuthError('denied', 'GitHub 账号信息无效。');
        const githubId = user.id as number;
        let member: Principal | null = null;
        if (githubId !== config.ownerId) {
          member = members?.principal(githubId) ?? null;
          if (!member && members && flow.invitation && typeof user.login === 'string') {
            try { member = members.accept({ id: githubId, login: user.login }, flow.invitation); }
            catch { throw new GitHubAuthError('denied', '邀请已失效或账号不匹配，请联系邀请人。'); }
          }
          if (!member || member.role !== 'member')
            throw new GitHubAuthError('denied', '此 GitHub 账号尚未获得案间访问权限。');
        }
        if (member) {
          await prepareMember?.(member);
          if (!members?.principal(githubId, member.sessionVersion))
            throw new GitHubAuthError('denied', '成员访问权限已失效。');
        }
        const seconds = flow.remember ? REMEMBER_SECONDS : SESSION_SECONDS;
        const session: Session = { ...(member ? { githubId, sessionVersion: member.sessionVersion } : { ownerId: config.ownerId }), expires: now() + seconds, nonce: random() };
        return {
          cookies: [clear(flowName, 'Lax'), cookie(sessionName, seal('session', session), 'Lax', flow.remember ? seconds : undefined)],
          returnTo: flow.returnTo,
        };
      } catch (error) {
        const safeError = error instanceof GitHubAuthError
          ? error : new GitHubAuthError('provider', 'GitHub 登录服务暂不可用，请稍后重试。');
        safeError.returnTo = flow.returnTo;
        safeError.invitation = flow.invitation;
        throw safeError;
      }
    },

    authorized(header: string | undefined): boolean {
      // Legacy callers mean instance administrator, not merely a signed-in user.
      return principal(header)?.role === 'owner';
    },

    clearCookie(): string[] {
      return [clear(sessionName, 'Lax'), clear(flowName, 'Lax')];
    },

    clearStateCookie(): string {
      return clear(flowName, 'Lax');
    },
  };
}
