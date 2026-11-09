import type http from 'node:http';

import type { HubArtifact } from '../shared/hub';
import { artifactSelectionKey, trashSelectionKey, type TrashResult } from '../shared/trash';
import { isArtifactId, isArtifactType } from './artifacts';
import {
  ArtifactTrashError, findTrashedArtifact, listTrash, moveArtifactToTrash, purgeTrash, restoreTrash,
} from './artifact-trash';
import { sendJson } from './http';
import { withProjectMutation } from './project-mutations';

interface Options {
  projects: () => string[];
  artifacts: () => HubArtifact[];
  readBody: (req: http.IncomingMessage) => Promise<unknown>;
  suspend: <T>(project: string, work: () => T) => Promise<T>;
  deployment: 'local' | 'self-hosted';
}

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export function createHubTrash(options: Options) {
  return async (req: http.IncomingMessage, res: http.ServerResponse, pathname: string) => {
    res.setHeader('Cache-Control', 'no-store');
    if (req.method === 'GET' && pathname === '/api/hub/trash') {
      const entries = [];
      const warnings: string[] = [];
      for (const project of options.projects()) {
        try { entries.push(...await withProjectMutation(project, async () => listTrash(project))); }
        catch { warnings.push('部分项目的回收站暂时无法读取，请重试。'); }
      }
      sendJson(res, 200, { entries: entries.sort((a, b) => b.deletedAt - a.deletedAt), warnings, deployment: options.deployment });
      return;
    }
    if (req.method !== 'POST') { sendJson(res, 405, { error: 'Method not allowed' }); return; }
    if (!req.headers['content-type']?.startsWith('application/json')) {
      sendJson(res, 415, { error: 'Expected application/json' }); return;
    }
    let body: unknown;
    try { body = await options.readBody(req); }
    catch { sendJson(res, 400, { error: 'Invalid request body' }); return; }
    if (!record(body) || !Array.isArray(body.items) || body.items.length < 1 || body.items.length > 100) {
      sendJson(res, 400, { error: 'Expected 1–100 items' }); return;
    }
    const moving = pathname === '/api/hub/trash';
    const valid = body.items.every((item: unknown) => record(item) && typeof item.project === 'string' &&
      (moving
        ? typeof item.type === 'string' && isArtifactType(item.type) && typeof item.id === 'string' && isArtifactId(item.id) &&
          typeof item.url === 'string' && new RegExp(`^/${item.type}/[A-Za-z0-9_-]+$`).test(item.url)
        : typeof item.trashId === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(item.trashId)));
    if (!valid) { sendJson(res, 400, { error: 'Invalid item' }); return; }
    const results: TrashResult[] = [];
    for (const item of body.items as Record<string, string>[]) {
      const project = item.project!;
      const key = moving
        ? artifactSelectionKey({ project, url: item.url! })
        : trashSelectionKey({ project, trashId: item.trashId! });
      try {
        const entry = await withProjectMutation(project, async () => {
          if (!options.projects().includes(project)) throw new ArtifactTrashError(404, 'project_not_found', '项目不存在或已移除');
          return options.suspend(project, () => {
            if (!moving) return pathname.endsWith('/restore')
              ? restoreTrash(project, item.trashId!) : purgeTrash(project, item.trashId!);
            const artifact = options.artifacts().find((a) => a.project === project && a.url === item.url && a.type === item.type && a.id === item.id);
            if (artifact) return moveArtifactToTrash(project, artifact);
            const deleted = findTrashedArtifact(project, item.type as HubArtifact['type'], item.id!);
            if (deleted && deleted.url === item.url) return deleted;
            throw new ArtifactTrashError(404, 'artifact_not_found', '作品不存在或已发生变化，请刷新列表');
          });
        });
        results.push({ key, ok: true, entry });
      } catch (error) {
        results.push({ key, ok: false,
          code: error instanceof ArtifactTrashError ? error.code : 'operation_failed',
          error: error instanceof ArtifactTrashError ? error.message : '操作未完成，请刷新状态后重试',
        });
      }
    }
    sendJson(res, 200, { results });
  };
}
