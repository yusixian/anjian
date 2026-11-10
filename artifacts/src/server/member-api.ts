import type http from 'node:http';

import { sendJson } from './http';
import { MemberError, type createMemberStore } from './member-store';

interface Options {
  members: ReturnType<typeof createMemberStore>;
  origin: string;
  enabled: boolean;
  owner: (req: http.IncomingMessage, url: URL) => boolean;
  readBody: (req: http.IncomingMessage) => Promise<unknown>;
  fetch?: typeof fetch;
}

/** Only the instance owner can grant membership; browser requests never choose a GitHub ID. */
export function createMemberApi(options: Options) {
  const request = options.fetch ?? fetch;
  const allowed = (req: http.IncomingMessage, url: URL) => options.owner(req, url) &&
    (!req.headers.origin || req.headers.origin === options.origin) &&
    (!req.headers['sec-fetch-site'] || req.headers['sec-fetch-site'] === 'same-origin');
  return async (req: http.IncomingMessage, res: http.ServerResponse, url: URL): Promise<boolean> => {
    if (url.pathname !== '/api/hub/members') return false;
    if (!allowed(req, url)) { sendJson(res, 403, { error: '仅管理员可以管理成员。' }); return true; }
    if (req.method === 'GET') {
      sendJson(res, 200, { enabled: options.enabled, ...options.members.list() });
      return true;
    }
    if (req.method !== 'POST') { sendJson(res, 405, { error: 'Method not allowed' }); return true; }
    if (req.headers.origin !== options.origin || req.headers['content-type']?.split(';')[0]?.trim() !== 'application/json') {
      sendJson(res, 403, { error: 'Expected same-origin JSON request' }); return true;
    }
    let input: Record<string, unknown>;
    try {
      const body = await options.readBody(req);
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Invalid body');
      input = body as Record<string, unknown>;
    } catch { sendJson(res, 400, { error: '请求格式无效。' }); return true; }
    if (!allowed(req, url)) { sendJson(res, 403, { error: '登录状态已变化。' }); return true; }
    try {
      if (input.action === 'invite') {
        if (!options.enabled) throw new MemberError(409, 'github_required', '请先配置实例 GitHub 登录。');
        if (typeof input.login !== 'string' || !/^[a-z\d](?:[a-z\d-]{0,38})$/i.test(input.login) ||
            !Number.isSafeInteger(input.quotaBytes) || Number(input.quotaBytes) < 0)
          throw new MemberError(400, 'invalid_invitation', '请输入 GitHub 用户名和有效额度。');
        const response = await request(`https://api.github.com/users/${encodeURIComponent(input.login)}`, {
          redirect: 'error', signal: AbortSignal.timeout(10_000),
          headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Anjian' },
        });
        if (response.status === 404) throw new MemberError(404, 'account_missing', '没有找到该 GitHub 账号。');
        if (!response.ok) throw new MemberError(502, 'github_unavailable', 'GitHub 查询暂不可用，请稍后重试。');
        const text = await response.text();
        if (text.length > 64 * 1024) throw new Error('Invalid GitHub response');
        const identity = JSON.parse(text) as { id?: unknown; login?: unknown; type?: unknown };
        if (!Number.isSafeInteger(identity.id) || Number(identity.id) <= 0 || typeof identity.login !== 'string' || identity.type !== 'User')
          throw new MemberError(400, 'invalid_account', '请选择个人 GitHub 账号。');
        if (!allowed(req, url)) { sendJson(res, 403, { error: '登录状态已变化。' }); return true; }
        const { token, ...invitation } = options.members.invite({ id: Number(identity.id), login: identity.login }, Number(input.quotaBytes));
        sendJson(res, 201, { invitation, url: `${options.origin}/login?invite=${encodeURIComponent(token)}` });
      } else if (input.action === 'revoke-invitation' && typeof input.id === 'string') {
        options.members.revokeInvitation(input.id);
        sendJson(res, 200, { revoked: true });
      } else if (input.action === 'update' && typeof input.id === 'string') {
        if ((input.status !== undefined && input.status !== 'active' && input.status !== 'suspended') ||
            (input.quotaBytes !== undefined && (!Number.isSafeInteger(input.quotaBytes) || Number(input.quotaBytes) < 0)) ||
            (input.status === undefined && input.quotaBytes === undefined))
          throw new MemberError(400, 'invalid_member', '请选择有效状态或额度。');
        const member = options.members.update(input.id, {
          ...(input.status !== undefined ? { status: input.status as 'active' | 'suspended' } : {}),
          ...(input.quotaBytes !== undefined ? { quotaBytes: Number(input.quotaBytes) } : {}),
        });
        sendJson(res, 200, { member });
      } else throw new MemberError(400, 'invalid_action', '操作无效。');
    } catch (error) {
      sendJson(res, error instanceof MemberError ? error.status : 502, {
        error: error instanceof MemberError ? error.message : '成员操作暂未完成，请刷新后重试。',
      });
    }
    return true;
  };
}
