import type http from 'node:http';

import type { ArtifactType } from '../shared/types';
import { sendJson } from './http';
import { withProjectMutation } from './project-mutations';
import { parseShareReferenceSelection, referencedDocuments, shareReferences, verifyShareReferences } from './share-references';
import type { createShareStore, ShareRecord } from './share-store';

export interface ShareTarget { project: string; type: ArtifactType; id: string; url: string; title: string }
interface Options {
  store: ReturnType<typeof createShareStore>;
  origin: string;
  authorized: (req: http.IncomingMessage, url: URL) => boolean;
  resolve: (req: http.IncomingMessage, input: Record<string, unknown>) => ShareTarget | null;
  readBody: (req: http.IncomingMessage) => Promise<unknown>;
  referenceTargets: (req: http.IncomingMessage, project: string) => ShareTarget[];
  settle: (target: ShareTarget, admit?: (bytes: number) => void) => Promise<void>;
  publish?: <T>(project: string, work: (prepare: () => Promise<(bytes: number) => void>) => Promise<T>) => Promise<T>;
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
    const referenceLookup = () => {
      const byUrl = new Map<string, ShareTarget | null>();
      for (const artifact of options.referenceTargets(req, target.project))
        byUrl.set(artifact.url, byUrl.has(artifact.url) ? null : artifact);
      return ({ type, target: address }: { type: ArtifactType; target: string }) =>
        byUrl.get(`/${type}/${address}`) ?? null;
    };
    const requireCurrent = () => {
      const current = options.resolve(req, input);
      if (!allowed(req, url) || !current || current.project !== target.project ||
          current.id !== target.id || current.url !== target.url)
        throw new Error('作品或登录状态已变化，请刷新后重试。');
    };
    let referencePreview: unknown;
    try {
      const perform = (prepare?: () => Promise<(bytes: number) => void>) => withProjectMutation(target.project, async () => {
        requireCurrent();
        const settle = async (artifact: ShareTarget) => {
          const admit = await prepare?.();
          requireCurrent();
          await options.settle(artifact, admit);
          requireCurrent();
        };
        if (req.method === 'GET') return options.store.status(target.project, target);
        if (input.action === 'preview' && target.type === 'document') {
          await settle(target);
          for (const doc of referencedDocuments(target, referenceLookup())) await settle(doc);
          const preview = shareReferences(target, referenceLookup());
          if (preview) referencePreview = {
            ...preview,
            choices: preview.choices.map(({ target: _target, ...choice }) => choice),
          };
          return options.store.status(target.project, target);
        }
        if (input.action === 'revoke') { options.store.revoke(target.project, target); return null; }
        if (input.action === 'rotate') return options.store.rotate(target.project, target);
        if (input.action !== 'publish' || ![1, 7, 30, null, undefined].includes(input.expiresInDays as number | null | undefined))
          throw new Error('请选择有效的分享期限。');
        const selection = parseShareReferenceSelection(input.referenceSelection);
        if (selection && target.type !== 'document')
          throw new Error('只能从文档发布引用作品。');
        await settle(target);
        if (selection?.revisions.size) {
          const references = verifyShareReferences(target, referenceLookup(), selection);
          for (const { artifact } of references) {
            if (artifact.type === 'document') await settle(artifact);
          }
        }
        requireCurrent();
        options.store.cleanupExpired();
        const admit = await prepare?.();
        requireCurrent();
        return options.store.publish(target.project, target, {
          title: target.title,
          expiresInDays: input.expiresInDays as 1 | 7 | 30 | null | undefined,
          ...(selection ? {
            expectedRevision: selection.revision,
            references: verifyShareReferences(target, referenceLookup(), selection),
          } : {}),
        }, admit);
      });
      const result = req.method === 'POST' && (input.action === 'publish' || input.action === 'preview') && options.publish
        ? await options.publish(target.project, perform) : await perform();
      sendJson(res, 200, { ...response(target, result), ...(referencePreview ? { referencePreview } : {}) });
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error &&
          (error.code === 'reference_revision_changed' || error.code === 'revision_conflict')) {
        sendJson(res, 409, { code: 'reference_revision_changed', error: '作品内容已变化，请重新选择要发布的引用。' });
        return true;
      }
      // Never leak server paths or underlying filesystem messages to the browser.
      const status = error && typeof error === 'object' && 'status' in error && typeof error.status === 'number' ? error.status : 409;
      if (error && typeof error === 'object' && 'code' in error && error.code === 'storage_quota_exceeded') {
        sendJson(res, 413, { code: 'storage_quota_exceeded', error: '存储额度不足。发布需要容纳一份完整的新快照，成功后才会释放旧快照；请释放空间后重试。' });
        return true;
      }
      sendJson(res, status, { error: status === 413 ? '分享快照超过容量限制，请减少资源后重试。' : '分享操作未完成。请刷新状态后重试，原有分享不会因发布失败而替换。' });
    }
    return true;
  };
}
