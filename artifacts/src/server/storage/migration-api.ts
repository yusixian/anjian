import type http from 'node:http';

import type { Principal } from '../member-store';
import { sendJson } from '../http';
import { MigrationSourceError, type MigrationSourcePlan } from './sources';
import { StorageMigrationError, type MigrationRoot, type createStorageMigration } from './migration';
import { StorageSettingsError, type createStorageSettings } from './settings';

interface Options {
  migration: ReturnType<typeof createStorageMigration>;
  maintain?: <T>(scope: string, guard: () => void, work: () => Promise<T>) => Promise<T>;
  plan: (scope: string) => Promise<MigrationSourcePlan>;
  settings: ReturnType<typeof createStorageSettings>;
  origin: string;
  principal: (req: http.IncomingMessage, url: URL) => Principal | null;
  readBody: (req: http.IncomingMessage) => Promise<unknown>;
}

class MigrationApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}

/** Migration copies and verifies source bytes; activation is a separate, gated operation. */
export function createStorageMigrationApi(options: Options) {
  const running = new Map<string, { id: string; task: Promise<void> }>();
  let stopping = false;
  const handler = async (req: http.IncomingMessage, res: http.ServerResponse, url: URL): Promise<boolean> => {
    if (url.pathname !== '/api/storage/migrations') return false;
    res.setHeader('Cache-Control', 'no-store');
    const identity = options.principal(req, url);
    const originAllowed = !req.headers.origin || req.headers.origin === options.origin;
    if (!identity || !originAllowed || req.headers['sec-fetch-site'] && req.headers['sec-fetch-site'] !== 'same-origin') {
      sendJson(res, 403, { code: 'forbidden', error: '无权访问迁移任务。' }); return true;
    }
    const requested = url.searchParams.get('scope') ?? 'personal';
    if (requested !== 'personal' && requested !== 'shared' || requested === 'shared' && identity.role !== 'owner') {
      sendJson(res, 403, { code: 'forbidden', error: '无权访问此存储空间。' }); return true;
    }
    const scope = requested === 'shared' ? 'shared' : identity.id;
    const assertCurrent = () => {
      if (stopping) throw new MigrationApiError(503, 'stopping', '服务器正在停止，请稍后重试。');
      const current = options.principal(req, url);
      if (!current || current.id !== identity.id || current.role !== identity.role || current.sessionVersion !== identity.sessionVersion)
        throw new MigrationApiError(403, 'session_changed', '登录状态已变化，请重新登录。');
    };
    const assertSources = async (roots: readonly MigrationRoot[]) => {
      assertCurrent();
      let current: MigrationSourcePlan;
      try { current = await options.plan(scope); }
      catch { throw new StorageMigrationError('source_changed', '迁移来源或归属已变化，请重新准备迁移。'); }
      assertCurrent();
      const signature = (items: readonly MigrationRoot[]) => JSON.stringify(items.map((root) => ({
        id: root.id, directory: root.directory, kind: root.kind, owner: root.owner,
        exclude: [...(root.exclude ?? [])].sort(),
      })).sort((a, b) => a.id.localeCompare(b.id)));
      if (current.scope !== scope || signature(current.roots) !== signature(roots))
        throw new StorageMigrationError('source_changed', '迁移来源或归属已变化，请重新准备迁移。');
    };
    try {
      assertCurrent();
      if (req.method === 'GET') {
        const jobs = await options.migration.list(scope);
        assertCurrent();
        sendJson(res, 200, { jobs: jobs.map((job) => ({ ...job, running: running.get(scope)?.id === job.id })) });
        return true;
      }
      if (req.method !== 'POST') { sendJson(res, 405, { code: 'method_not_allowed', error: 'Method not allowed' }); return true; }
      if (req.headers.origin !== options.origin || req.headers['content-type']?.split(';')[0]?.trim() !== 'application/json') {
        sendJson(res, 403, { code: 'forbidden', error: '需要同源 JSON 请求。' }); return true;
      }
      let body: Record<string, unknown>;
      try {
        const input = await options.readBody(req);
        if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid JSON body');
        body = input as Record<string, unknown>;
      } catch { throw new MigrationApiError(400, 'invalid_request', '请求格式无效。'); }
      assertCurrent();
      if (body.action === 'prepare') {
        if (typeof body.profileId !== 'string' || body.roots !== undefined || body.paths !== undefined)
          throw new MigrationApiError(400, 'invalid_request', '迁移配置无效。');
        const configured = options.settings.summary(scope).profile;
        if (!configured || configured.id !== body.profileId || configured.test?.ok !== true)
          throw new MigrationApiError(409, 'connection_not_tested', '请先测试当前 S3 配置连接。');
        const prepare = async () => {
          assertCurrent();
          const plan = await options.plan(scope);
          assertCurrent();
          if (plan.scope !== scope) throw new MigrationApiError(503, 'invalid_plan', '迁移来源不可用。');
          const latest = options.settings.summary(scope).profile;
          if (!latest || latest.id !== body.profileId || latest.test?.ok !== true)
            throw new MigrationApiError(409, 'configuration_changed', '存储配置已变化，请重新准备迁移。');
          const job = await options.migration.prepare(scope, body.profileId as string, plan.roots);
          assertCurrent();
          return job;
        };
        const job = options.maintain ? await options.maintain(scope, assertCurrent, prepare) : await prepare();
        sendJson(res, 201, { job });
        return true;
      }
      if (body.action === 'resume') {
        if (typeof body.id !== 'string') throw new MigrationApiError(400, 'invalid_request', '迁移标识无效。');
        if (running.has(scope) || running.size >= 2)
          throw new MigrationApiError(409, 'busy', '迁移任务正在运行，请稍后重试。');
        const job = await options.migration.status(scope, body.id);
        assertCurrent();
        if (job.state === 'verified') throw new MigrationApiError(409, 'already_verified', '迁移已经完成校验。');
        if (running.has(scope) || running.size >= 2)
          throw new MigrationApiError(409, 'busy', '迁移任务正在运行，请稍后重试。');
        const task = Promise.resolve().then(() => options.migration.resume(scope, body.id as string, assertSources))
          .then(() => undefined, () => undefined)
          .finally(() => { if (running.get(scope)?.id === job.id) running.delete(scope); });
        running.set(scope, { id: job.id, task });
        sendJson(res, 202, { job, running: true });
        return true;
      }
      throw new MigrationApiError(400, 'invalid_action', '操作无效。');
    } catch (error) {
      const known = error instanceof MigrationApiError ? error : null;
      const migration = error instanceof StorageMigrationError ? error : null;
      const source = error instanceof MigrationSourceError ? error : null;
      const status = known?.status ?? (migration?.code === 'not_found' ? 404 : migration?.code === 'busy' ? 409 :
        migration?.code === 'invalid_request' || source?.code === 'invalid_source' ? 400 :
          migration?.code === 'source_changed' || source?.code === 'source_changed' || migration?.code === 'profile_changed' ? 409 :
            error instanceof StorageSettingsError ? error.status : 503);
      sendJson(res, status, { code: known?.code ?? migration?.code ?? source?.code ?? 'migration_unavailable',
        error: known?.message ?? migration?.message ?? source?.message ?? '迁移暂不可用，请稍后重试。' });
    }
    return true;
  };
  return Object.assign(handler, {
    async close() {
      stopping = true;
      await Promise.allSettled([...running.values()].map(({ task }) => task));
    },
  });
}
