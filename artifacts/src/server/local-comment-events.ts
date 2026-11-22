import { createHash } from 'node:crypto';
import type http from 'node:http';

import { isLoopbackHost } from './access';
import { safeEqual, send } from './http';

export function createLocalCommentEvents(token: string) {
  const streams = new Set<http.ServerResponse>();
  const credential = createHash('sha256').update(`anjian-comment-events:${token}`).digest('hex');

  return {
    handle(req: http.IncomingMessage, res: http.ServerResponse, pathname: string) {
      if (pathname !== '/api/local/comment-events') return false;
      if (
        !isLoopbackHost(req.socket.remoteAddress ?? '') ||
        req.headers.origin !== undefined ||
        req.headers['sec-fetch-site'] !== undefined ||
        !safeEqual(req.headers.authorization ?? '', `Bearer ${credential}`)
      ) {
        send(res, 404, 'Not found');
      } else if (req.method !== 'GET') {
        send(res, 405, 'Method not allowed');
      } else {
        res.writeHead(200, {
          'Content-Type': 'application/x-ndjson',
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff',
        });
        streams.add(res);
        res.once('close', () => streams.delete(res));
        res.write('{"ready":true}\n');
      }
      return true;
    },
    notify(project: string, artifact: string) {
      if (!streams.size) return;
      const event = JSON.stringify({ project, artifact }) + '\n';
      for (const res of streams) {
        if (!res.write(event)) res.destroy();
      }
    },
    close() {
      for (const res of streams) res.end();
      streams.clear();
    },
  };
}
