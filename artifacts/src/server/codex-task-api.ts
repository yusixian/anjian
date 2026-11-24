import type { IncomingMessage, ServerResponse } from 'node:http';

import { isObject } from '../shared/comments';
import { createCodexTaskSession } from './codex-task-session';
import { sendJson } from './http';

type Options = {
  authorize: (req: IncomingMessage, url: URL) => boolean;
  project: (req: IncomingMessage, url: URL) => string | null;
  available: (project: string) => boolean;
  readBody: (req: IncomingMessage) => Promise<unknown>;
};

export function createCodexTaskApi(options: Options) {
  const sessions = new Map<string, ReturnType<typeof createCodexTaskSession>>();

  function stop(project: string) {
    const session = sessions.get(project);
    sessions.delete(project);
    session?.close();
  }

  return {
    stop,
    close() {
      for (const project of sessions.keys()) stop(project);
    },
    async handle(req: IncomingMessage, res: ServerResponse, url: URL) {
      if (url.pathname !== '/api/hub/codex-tasks') return false;
      res.setHeader('Cache-Control', 'no-store');
      if (!options.authorize(req, url)) {
        sendJson(res, 403, { error: 'forbidden' });
        return true;
      }

      const project = options.project(req, url);
      if (!project || !options.available(project)) {
        sendJson(res, 404, { error: 'project_unavailable' });
        return true;
      }

      const session = sessions.get(project);
      if (req.method === 'GET') {
        sendJson(res, 200, { pending: session?.pendingQuestions() ?? [] });
        return true;
      }
      if (req.method !== 'POST') {
        res.setHeader('Allow', 'GET, POST');
        sendJson(res, 405, { error: 'method_not_allowed' });
        return true;
      }

      const body = await options.readBody(req).catch(() => null);
      if (!options.available(project) || options.project(req, url) !== project) {
        sendJson(res, 404, { error: 'project_unavailable' });
        return true;
      }

      if (!isObject(body)) {
        sendJson(res, 400, { error: 'invalid_request' });
        return true;
      }
      if (
        body.action === 'start' &&
        typeof body.prompt === 'string' &&
        body.prompt.trim() &&
        body.prompt.length <= 16_000
      ) {
        try {
          let current = sessions.get(project);
          if (!current || current.closed) {
            const connection = createCodexTaskSession('codex', project, () => {
              if (connection.closed && sessions.get(project) === connection)
                sessions.delete(project);
            });
            sessions.set(project, connection);
            current = connection;
          }
          const threadId = await current.start(body.prompt.trim());
          sendJson(res, 201, { threadId });
        } catch {
          sendJson(res, 502, { error: 'codex_start_failed' });
        }
        return true;
      }
      if (
        body.action === 'answer' &&
        typeof body.threadId === 'string' &&
        (typeof body.requestId === 'string' ||
          (typeof body.requestId === 'number' && Number.isSafeInteger(body.requestId))) &&
        isObject(body.answers)
      ) {
        const entries = Object.entries(body.answers);
        if (
          entries.length >= 1 &&
          entries.length <= 3 &&
          entries.every(([, value]) => typeof value === 'string' && value.length <= 16_000)
        ) {
          try {
            const sent = await sessions
              .get(project)
              ?.answer(
                body.threadId,
                body.requestId,
                Object.fromEntries(entries) as Record<string, string>,
              );
            sendJson(
              res,
              sent ? 200 : 409,
              sent ? { sent: true } : { error: 'question_unavailable' },
            );
          } catch {
            sendJson(res, 502, { error: 'codex_reply_failed' });
          }
          return true;
        }
      }

      sendJson(res, 400, { error: 'invalid_request' });
      return true;
    },
  };
}
