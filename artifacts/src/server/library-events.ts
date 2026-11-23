import type http from 'node:http';

const CHANGE_DELAY_MS = 300;
const MAX_CHANGE_DELAY_MS = 2000;
const KEEPALIVE_MS = 15000;

export function createLibraryEvents(
  visibleProjects: (req: http.IncomingMessage) => string[],
  authenticated: (req: http.IncomingMessage, url: URL) => boolean,
) {
  const clients = new Map<
    http.ServerResponse,
    {
      req: http.IncomingMessage;
      url: URL;
      projects: Set<string>;
    }
  >();
  const pending = new Set<string>();
  let delay: ReturnType<typeof setTimeout> | undefined;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  let heartbeat: ReturnType<typeof setInterval> | undefined;

  const flush = () => {
    clearTimeout(delay);
    clearTimeout(deadline);
    deadline = undefined;
    for (const [res, client] of clients) {
      if (res.writableEnded || res.destroyed) continue;
      if (!authenticated(client.req, client.url)) {
        res.end();
        continue;
      }
      const projects = new Set(visibleProjects(client.req));
      const affected = [...pending].some(
        (project) => projects.has(project) || client.projects.has(project),
      );
      client.projects = projects;
      if (affected && !res.write('data: changed\n\n')) res.destroy();
    }
    pending.clear();
  };

  return {
    subscribe(req: http.IncomingMessage, res: http.ServerResponse, url: URL) {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-store',
        'X-Accel-Buffering': 'no',
        'X-Content-Type-Options': 'nosniff',
      });
      clients.set(res, { req, url, projects: new Set(visibleProjects(req)) });
      heartbeat ??= setInterval(() => {
        for (const [stream, client] of clients) {
          if (stream.writableEnded || stream.destroyed) continue;
          if (!authenticated(client.req, client.url)) stream.end();
          else if (!stream.write(': heartbeat\n\n')) stream.destroy();
        }
      }, KEEPALIVE_MS);
      res.once('close', () => {
        clients.delete(res);
        if (clients.size === 0) {
          clearInterval(heartbeat);
          heartbeat = undefined;
          flush();
        }
      });
      res.write(': connected\n\n');
    },
    changed(project: string) {
      if (clients.size === 0) return;
      pending.add(project);
      clearTimeout(delay);
      delay = setTimeout(flush, CHANGE_DELAY_MS);
      deadline ??= setTimeout(flush, MAX_CHANGE_DELAY_MS);
    },
    close() {
      for (const res of clients.keys()) res.end();
      clients.clear();
      clearInterval(heartbeat);
      heartbeat = undefined;
      flush();
    },
  };
}
