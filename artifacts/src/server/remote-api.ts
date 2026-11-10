import type http from 'node:http';
import { withRequestStorageAdmission } from './storage/request-admission';

import type { ArtifactType } from '../shared/types';
import type { MountedProject } from './app';
import { sendJson } from './http';
import { withProjectMutation } from './project-mutations';
import { ArtifactTrashError, assertArtifactNotTrashed } from './artifact-trash';
import { setRemoteDevice } from './remote-identity';
import { RemoteCursorError, type createRemoteEvents } from './remote-events';
import { decodeDocumentUpload, readRemoteArtifact, RemoteTransferError, writeRemoteArtifact } from './remote-transfer';

interface Device { id: string; name: string; projects: string[] }
interface Project { id: string; name: string; dir: string }
interface Options {
  authenticate: (req: http.IncomingMessage) => Device | null;
  projects: () => Project[];
  mount: (dir: string) => Promise<MountedProject>;
  events: ReturnType<typeof createRemoteEvents>;
  token: string;
  upload?: <T>(project: string, work: (prepare: () => Promise<(deltaBytes: number) => void>) => Promise<T>) => Promise<T>;
}
const MAX_BODY = 46 * 1024 * 1024;
const ARTIFACT_ROUTE = /^\/api\/remote\/projects\/([a-f0-9]{32})\/artifacts\/(document|artboard|html)\/([a-z0-9][a-z0-9-]*)$/;
const AGENT_ROUTE = /^\/api\/remote\/projects\/([a-f0-9]{32})\/agent\/(document|artboard|html)\/([a-z0-9][a-z0-9-]*)\/(comments|check)$/;
const EVENTS_ROUTE = /^\/api\/remote\/projects\/([a-f0-9]{32})\/events$/;

async function readBody(req: http.IncomingMessage) {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const part of req) {
    const chunk = Buffer.from(part);
    size += chunk.length;
    if (size > MAX_BODY) throw new RemoteTransferError(413, 'body_too_large', '上传内容超过限制');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new RemoteTransferError(400, 'invalid_json', '请求正文必须是 JSON'); }
}

export function createRemoteApi(options: Options) {
  return async (req: http.IncomingMessage, res: http.ServerResponse, url: URL): Promise<boolean> => {
    if (!url.pathname.startsWith('/api/remote/')) return false;
    res.setHeader('Cache-Control', 'no-store');
    const device = req.headers.origin === undefined ? options.authenticate(req) : null;
    if (!device) {
      sendJson(res, 401, { error: '请重新登录，设备凭证无效或已撤销', code: 'unauthorized' });
      return true;
    }
    if (url.pathname === '/api/remote/projects' && req.method === 'GET') {
      sendJson(res, 200, { projects: options.projects().filter((p) => device.projects.includes(p.id)).map(({ id, name }) => ({ id, name })) });
      return true;
    }
    const artifactMatch = ARTIFACT_ROUTE.exec(url.pathname);
    const agentMatch = AGENT_ROUTE.exec(url.pathname);
    const eventsMatch = EVENTS_ROUTE.exec(url.pathname);
    const match = artifactMatch ?? agentMatch ?? eventsMatch;
    const project = match && options.projects().find((p) => p.id === match[1] && device.projects.includes(p.id));
    if (!project || !match) {
      sendJson(res, 404, { error: '项目或接口不存在', code: 'not_found' });
      return true;
    }
    try {
      if (eventsMatch) {
        if (req.method !== 'GET') { sendJson(res, 405, { error: 'Method not allowed' }); return true; }
        await options.mount(project.dir);
        if (!options.authenticate(req)?.projects.includes(project.id)) {
          sendJson(res, 401, { error: '设备授权已撤销', code: 'unauthorized' }); return true;
        }
        sendJson(res, 200, options.events.since(project.id, url.searchParams.get('cursor')));
        return true;
      }
      const type = match[2] as ArtifactType;
      const id = match[3]!;
      const artifact = `${type}/${id}`;
      if (agentMatch) {
        if (req.method !== 'POST' || (agentMatch[4] === 'comments' && type === 'html')) {
          sendJson(res, 405, { error: 'Method not allowed' }); return true;
        }
        const forward = async (prepare?: () => Promise<(delta: number) => void>) => {
          const mounted = await options.mount(project.dir);
          const admit = await prepare?.();
          if (!options.authenticate(req)?.projects.includes(project.id)) {
            sendJson(res, 401, { error: '设备授权已撤销', code: 'unauthorized' }); return;
          }
          // Forward only the fixed agent route, never caller-selected paths.
          req.url = `/api/agent/${artifact}/${agentMatch[4]}?key=${encodeURIComponent(options.token)}`;
          delete req.headers['x-anjian-project'];
          setRemoteDevice(req, device.id);
          if (admit) await withRequestStorageAdmission(req, admit, () => mounted.handleRequest(req, res));
          else await mounted.handleRequest(req, res);
        };
        if (agentMatch[4] === 'comments' && options.upload)
          await options.upload(project.dir, (prepare) => withProjectMutation(project.dir, () => forward(prepare)));
        else await forward();
        return true;
      }
      if (req.method !== 'GET' && req.method !== 'PUT') {
        sendJson(res, 405, { error: 'Method not allowed' }); return true;
      }
      if (req.method === 'PUT' && !req.headers['content-type']?.startsWith('application/json')) {
        sendJson(res, 415, { error: 'Expected application/json' }); return true;
      }
      const body = req.method === 'PUT' ? await readBody(req) : null;
      const perform = (prepare?: () => Promise<(deltaBytes: number) => void>) => withProjectMutation(project.dir, async () => {
        assertArtifactNotTrashed(project.dir, type, id);
        const mounted = await options.mount(project.dir);
        if (type === 'document') {
          try { await mounted.settleDocument(id, undefined, await prepare?.()); }
          catch (error) {
            // A full quota cannot turn a download into a write bypass or hide the
            // already persisted source. Its revision still describes disk bytes.
            if (req.method !== 'GET' || !(error instanceof RemoteTransferError) ||
                error.code !== 'storage_quota_exceeded') throw error;
          }
        }
        if (!options.authenticate(req)?.projects.includes(project.id))
          throw new RemoteTransferError(401, 'unauthorized', '设备授权已撤销');
        const decoded = req.method === 'PUT' && type === 'document' ? decodeDocumentUpload(body) : undefined;
        const prepared = decoded
          ? await mounted.prepareDocumentUpload(id, decoded.source, decoded.files, await prepare?.()) : undefined;
        const admit = req.method === 'PUT' ? await prepare?.() : undefined;
        if (!options.authenticate(req)?.projects.includes(project.id))
          throw new RemoteTransferError(401, 'unauthorized', '设备授权已撤销');
        let snapshot = req.method === 'PUT'
          ? writeRemoteArtifact(project.dir, artifact, body, admit, prepared,
              type === 'document' ? undefined : (stagedDir) => mounted.prepareArtifactUpload(type, id, stagedDir))
          : readRemoteArtifact(project.dir, artifact);
        if (prepared) {
          await mounted.settleDocument(id, undefined, await prepare?.());
          snapshot = readRemoteArtifact(project.dir, artifact);
        }
        const link = new URL(mounted.linkFor(type, id));
        link.searchParams.delete('key');
        return { ...snapshot, url: link.href };
      });
      const result = (req.method === 'PUT' || type === 'document') && options.upload
        ? await options.upload(project.dir, perform) : await perform();
      sendJson(res, 200, result);
    } catch (error) {
      if (error instanceof RemoteCursorError) sendJson(res, 410, { code: 'cursor_expired', error: error.message });
      else if (error instanceof ArtifactTrashError) sendJson(res, error.status, { code: error.code, error: error.message });
      else if (error instanceof RemoteTransferError) sendJson(res, error.status, { code: error.code, error: error.message });
      else sendJson(res, 500, { code: 'remote_operation_failed', error: '远程操作失败，请检查服务端日志后重试' });
    }
    return true;
  };
}
