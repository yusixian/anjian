import { createHash, randomUUID } from 'node:crypto';
import type http from 'node:http';

import { isLoopbackHost } from './access';
import { safeEqual, send } from './http';

const PROJECT = /^[a-f0-9]{32}$/;
const ARTIFACT = /^(?:artboard|document|slides|storyboard|whiteboard)\/[a-z0-9][a-z0-9-]*$/;
type Scope = Map<string, Set<string>>;

function parseScope(body: unknown): Scope | null {
  if (!Array.isArray(body)) return null;
  const scope: Scope = new Map();
  for (const row of body) {
    if (
      typeof row?.project !== 'string' ||
      !PROJECT.test(row.project) ||
      scope.has(row.project) ||
      !Array.isArray(row.artifacts) ||
      !row.artifacts.every(
        (value: unknown) => typeof value === 'string' && (value === '*' || ARTIFACT.test(value)),
      )
    )
      return null;
    scope.set(row.project, new Set(row.artifacts));
  }
  return scope;
}

export function createLocalCommentEvents(
  token: string,
  readBody: (req: http.IncomingMessage) => Promise<unknown>,
) {
  const streams = new Map<http.ServerResponse, Scope | undefined>();
  const channels = new Map<string, http.ServerResponse>();
  const credential = createHash('sha256').update(`anjian-comment-events:${token}`).digest('hex');

  return {
    async handle(req: http.IncomingMessage, res: http.ServerResponse, url: URL) {
      if (url.pathname !== '/api/local/comment-events') return false;
      if (
        !isLoopbackHost(req.socket.remoteAddress ?? '') ||
        req.headers.origin !== undefined ||
        req.headers['sec-fetch-site'] !== undefined ||
        !safeEqual(req.headers.authorization ?? '', `Bearer ${credential}`)
      ) {
        send(res, 404, 'Not found');
      } else if (req.method === 'PUT') {
        const channel = url.searchParams.get('channel');
        const stream = channel && channels.get(channel);
        if (!stream) {
          send(res, 404, 'Unknown comment event channel');
          return true;
        }
        const scope = parseScope(await readBody(req).catch(() => null));
        if (!scope) send(res, 400, 'Invalid comment event subscriptions');
        else if (stream.destroyed || !streams.has(stream))
          send(res, 404, 'Unknown comment event channel');
        else {
          streams.set(stream, scope);
          send(res, 204, '');
        }
      } else if (req.method !== 'GET') {
        send(res, 405, 'Method not allowed');
      } else {
        res.writeHead(200, {
          'Content-Type': 'application/x-ndjson',
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff',
        });
        const channel = url.searchParams.get('scope') === '1' ? randomUUID() : undefined;
        streams.set(res, channel ? new Map() : undefined);
        if (channel) channels.set(channel, res);
        res.once('close', () => {
          streams.delete(res);
          if (channel) channels.delete(channel);
        });
        res.write(JSON.stringify({ ready: true, channel }) + '\n');
      }
      return true;
    },
    notify(project: string, artifact: string) {
      if (!streams.size) return;
      const event = JSON.stringify({ project, artifact }) + '\n';
      for (const [res, scope] of streams) {
        const artifacts = scope?.get(project);
        if (scope && !artifacts?.has('*') && !artifacts?.has(artifact)) continue;
        if (!res.write(event)) res.destroy();
      }
    },
    close() {
      for (const res of streams.keys()) res.end();
      streams.clear();
      channels.clear();
    },
  };
}
