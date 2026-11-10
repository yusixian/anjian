import type http from 'node:http';
import { testS3Connection } from './s3';
import type { createStorageUsage } from './usage';
import type { Principal } from '../member-store';
import { sendJson } from '../http';
import { StorageSettingsError, type createStorageSettings } from './settings';
import type { createStorageRuntime } from './runtime';

export function createStorageApi(options: {
  settings: ReturnType<typeof createStorageSettings>;
  usage: ReturnType<typeof createStorageUsage>;
  backend?: (scope: string) => 'local' | 's3';
  recoveryPending?: (scope: string) => boolean;
  syncStatus?: (scope: string) => ReturnType<ReturnType<typeof createStorageRuntime>['status']>;
  synchronize?: (scope: string) => Promise<void>;
  recover?: (scope: string, authorize: () => void) => Promise<void>;
  origin: string;
  principal: (req: http.IncomingMessage, url: URL) => Principal | null;
  readBody: (req: http.IncomingMessage) => Promise<unknown>;
}) {
  const testing = new Set<string>();
  const recent = new Map<string, number>();
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
        const summary = options.settings.summary(scope);
        const usage = await options.usage.read(scope).catch(() => null);
        const current = options.principal(req, url);
        if (!current || current.id !== identity.id || current.role !== identity.role || current.sessionVersion !== identity.sessionVersion) {
          sendJson(res, 403, { error: '登录状态已变化。' }); return true;
        }
        sendJson(res, 200, { ...summary, recoveryPending: options.recoveryPending?.(scope) ?? false, backend: options.backend?.(scope) ?? 'local', tested: summary.profile?.test?.ok ?? false, usage, sync: options.syncStatus?.(scope) });
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
      if (body.action === 'recover-local' && body.confirm === 'use-retained-local-files' && options.recover) {
        await options.recover(scope, () => {
          const latest = options.principal(req, url);
          if (!latest || latest.id !== identity.id || latest.sessionVersion !== identity.sessionVersion || latest.role !== identity.role)
            throw new Error('Session changed');
        });
        sendJson(res, 200, { sync: options.syncStatus?.(scope) });
      } else if (body.action === 'sync' && options.synchronize) {
        await options.synchronize(scope);
        const latest = options.principal(req, url);
        if (!latest || latest.id !== identity.id || latest.sessionVersion !== identity.sessionVersion || latest.role !== identity.role) {
          sendJson(res, 403, { error: '登录状态已变化。' }); return true;
        }
        sendJson(res, 200, { sync: options.syncStatus?.(scope) });
      } else if (body.action === 'test' && typeof body.id === 'string') {
        for (const [key, until] of recent) if (until <= Date.now()) recent.delete(key);
        if (testing.size >= 4 || testing.has(scope) || recent.has(scope)) {
          sendJson(res, 429, { error: '连接测试进行中或过于频繁，请稍后再试。' }); return true;
        }
        const profile = options.settings.resolve(scope, body.id);
        testing.add(scope); recent.set(scope, Date.now() + 30_000);
        try {
          const result = await testS3Connection(profile, profile.credentials);
          const latest = options.principal(req, url);
          if (!latest || latest.id !== identity.id || latest.sessionVersion !== identity.sessionVersion) {
            sendJson(res, 403, { error: '登录状态已变化。' }); return true;
          }
          options.settings.recordTest(scope, profile.id, result);
          sendJson(res, 200, { test: result, backend: options.backend?.(scope) ?? 'local' });
        } finally { testing.delete(scope); }
      } else if (body.action === 'save') {
        const profile = options.settings.save(scope, body.settings, body.credentials);
        sendJson(res, 200, { profile, backend: options.backend?.(scope) ?? 'local', tested: false });
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
