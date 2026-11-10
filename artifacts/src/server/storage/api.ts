import type http from 'node:http';
import type { Principal } from '../member-store';
import { sendJson } from '../http';
import { StorageSettingsError, type createStorageSettings } from './settings';

export function createStorageApi(options: {
  settings: ReturnType<typeof createStorageSettings>;
  origin: string;
  principal: (req: http.IncomingMessage, url: URL) => Principal | null;
  readBody: (req: http.IncomingMessage) => Promise<unknown>;
}) {
  return async (req: http.IncomingMessage, res: http.ServerResponse, url: URL): Promise<boolean> => {
    if (url.pathname !== '/api/storage') return false;
    const identity = options.principal(req, url);
    if (!identity || (req.headers.origin && req.headers.origin !== options.origin) ||
        (req.headers['sec-fetch-site'] && req.headers['sec-fetch-site'] !== 'same-origin')) {
      sendJson(res, 403, { error: 'Forbidden' }); return true;
    }
    const scopeName = url.searchParams.get('scope') ?? 'personal';
    if (!['personal', 'shared'].includes(scopeName) || (scopeName === 'shared' && identity.role !== 'owner')) {
      sendJson(res, 403, { error: '无权访问此存储配置。' }); return true;
    }
    const scope = scopeName === 'shared' ? 'shared' : identity.id;
    try {
      if (req.method === 'GET') {
        sendJson(res, 200, { ...options.settings.summary(scope), backend: 'local', tested: false });
        return true;
      }
      if (req.method !== 'POST') { sendJson(res, 405, { error: 'Method not allowed' }); return true; }
      if (req.headers.origin !== options.origin || req.headers['content-type']?.split(';')[0]?.trim() !== 'application/json') {
        sendJson(res, 403, { error: 'Expected same-origin JSON request' }); return true;
      }
      let body: Record<string, unknown>;
      try {
        const value = await options.readBody(req);
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid request');
        body = value as Record<string, unknown>;
      } catch { sendJson(res, 400, { error: '请求格式无效。' }); return true; }
      const current = options.principal(req, url);
      if (!current || current.id !== identity.id || current.sessionVersion !== identity.sessionVersion || current.role !== identity.role) {
        sendJson(res, 403, { error: '登录状态已变化。' }); return true;
      }
      if (body.action === 'save') {
        const profile = options.settings.save(scope, body.settings, body.credentials);
        sendJson(res, 200, { profile, backend: 'local', tested: false });
      } else if (body.action === 'limit' && scope === 'shared') {
        options.settings.setSharedLimit(body.bytes as number);
        sendJson(res, 200, options.settings.summary(scope));
      } else sendJson(res, 400, { error: '操作无效。' });
    } catch (error) {
      sendJson(res, error instanceof StorageSettingsError ? error.status : 503, {
        error: error instanceof StorageSettingsError ? error.message : '存储配置暂不可用，请稍后重试。',
      });
    }
    return true;
  };
}
