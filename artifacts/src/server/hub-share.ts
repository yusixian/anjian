import type http from 'node:http';

import type { ArtifactType } from '../shared/types';
import { sendJson } from './http';
import { withProjectMutation } from './project-mutations';
import type { createShareStore, ShareRecord } from './share-store';

export interface ShareTarget { project: string; type: ArtifactType; id: string; url: string; title: string }
interface Options {
  store: ReturnType<typeof createShareStore>;
  origin: string;
  authorized: (req: http.IncomingMessage, url: URL) => boolean;
  resolve: (req: http.IncomingMessage, input: Record<string, unknown>) => ShareTarget | null;
  readBody: (req: http.IncomingMessage) => Promise<unknown>;
  settle: (target: ShareTarget) => Promise<void>;
}

export function createHubShare(options: Options) {
  const response = (target: ShareTarget, share: ShareRecord | null) => ({
    title: target.title,
    share: share ? { url: `${options.origin}/s/${share.token}`, publishedAt: share.publishedAt, expiresAt: share.expiresAt } : null,
  });
  const allowed = (req: http.IncomingMessage, url: URL) => options.authorized(req, url) &&
    (!req.headers.origin || req.headers.origin === options.origin) &&
    (!req.headers['sec-fetch-site'] || req.headers['sec-fetch-site'] === 'same-origin');
  return async (req: http.IncomingMessage, res: http.ServerResponse, url: URL) => {
    if (url.pathname !== '/api/hub/share') return false;
    if (!allowed(req, url)) { sendJson(res, 403, { error: 'Forbidden' }); return true; }
    if (req.method !== 'GET' && req.method !== 'POST') { sendJson(res, 405, { error: 'Method not allowed' }); return true; }
    if (req.method === 'POST' && (req.headers.origin !== options.origin || req.headers['content-type']?.split(';')[0] !== 'application/json')) {
      sendJson(res, 403, { error: 'Expected same-origin JSON request' }); return true;
    }
    let body: unknown;
    try { body = req.method === 'GET' ? Object.fromEntries(url.searchParams) : await options.readBody(req); }
    catch { sendJson(res, 400, { error: 'Invalid request' }); return true; }
    if (!allowed(req, url)) { sendJson(res, 403, { error: 'Forbidden' }); return true; }
    if (!body || typeof body !== 'object' || Array.isArray(body)) { sendJson(res, 400, { error: 'Invalid request' }); return true; }
    const input = body as Record<string, unknown>;
    const target = options.resolve(req, input);
    if (!target) { sendJson(res, 404, { error: '作品不存在，请刷新后重试。' }); return true; }
    try {
      const result = await withProjectMutation(target.project, async () => {
        if (!allowed(req, url) || !options.resolve(req, input)) throw new Error('作品或登录状态已变化，请刷新后重试。');
        if (req.method === 'GET') return options.store.status(target.project, target);
        if (input.action === 'revoke') { options.store.revoke(target.project, target); return null; }
        if (input.action === 'rotate') return options.store.rotate(target.project, target);
        if (input.action !== 'publish' || ![1, 7, 30, null, undefined].includes(input.expiresInDays as number | null | undefined))
          throw new Error('请选择有效的分享期限。');
        await options.settle(target);
        if (!allowed(req, url) || options.resolve(req, input)?.project !== target.project)
          throw new Error('作品归属或登录状态已变化，请重新登录。');
        return options.store.publish(target.project, target, { title: target.title, expiresInDays: input.expiresInDays as 1 | 7 | 30 | null | undefined });
      });
      sendJson(res, 200, response(target, result));
    } catch (error) {
      // Never leak server paths or underlying filesystem messages to the browser.
      const status = error && typeof error === 'object' && 'status' in error && typeof error.status === 'number' ? error.status : 409;
      sendJson(res, status, { error: status === 413 ? '分享快照超过容量限制，请减少资源后重试。' : '分享操作未完成。请刷新状态后重试，原有分享不会因发布失败而替换。' });
    }
    return true;
  };
}
