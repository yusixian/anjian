import { readFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { isAbsolute } from 'node:path';

import { isCommandApprovalDecision } from '../shared/codex-approvals';
import { isObject } from '../shared/comments';
import { createCodexTaskSession, type SharedCodexServer } from './codex-task-session';
import { sendJson } from './http';

type Options = {
  authorize: (req: IncomingMessage, url: URL) => boolean;
  project: (req: IncomingMessage, url: URL) => string | null;
  available: (project: string) => boolean;
  createDocument: (project: string, prompt: string, guard: () => boolean) => Promise<string>;
  readBody: (req: IncomingMessage) => Promise<unknown>;
};

function sharedServer(): SharedCodexServer | undefined {
  const address = process.env.ANJIAN_CODEX_SHARED_URL;
  const tokenFile = process.env.ANJIAN_CODEX_SHARED_TOKEN_FILE;
  const socketPath = process.env.ANJIAN_CODEX_SHARED_SOCKET;
  if (socketPath) {
    if (address || tokenFile || !isAbsolute(socketPath) || process.platform === 'win32')
      throw new Error(
        'Configure one Codex App Server transport using an absolute Unix socket path',
      );
    return { socketPath };
  }
  if (!address && !tokenFile) return undefined;
  const url = URL.parse(address ?? '');
  if (
    !url ||
    !tokenFile ||
    url.protocol !== 'ws:' ||
    !['127.0.0.1', '[::1]'].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/'
  )
    throw new Error('Configure a loopback ANJIAN_CODEX_SHARED_URL and a private token file');
  const token = readFileSync(tokenFile, 'utf8').trim();
  if (!/^[\w.~+/=-]{16,512}$/.test(token)) throw new Error('Invalid Codex shared server token');
  return { url, token };
}

export function createCodexTaskApi(options: Options) {
  const shared = sharedServer();
  const sessions = new Map<string, ReturnType<typeof createCodexTaskSession>>();

  function stop(project: string) {
    const session = sessions.get(project);
    sessions.delete(project);
    session?.close();
  }

  function connectionFor(project: string) {
    const current = sessions.get(project);
    if (current && !current.closed) return current;
    const connection = createCodexTaskSession(
      'codex',
      project,
      () => {
        if (connection.closed && sessions.get(project) === connection) sessions.delete(project);
      },
      shared,
    );
    sessions.set(project, connection);
    return connection;
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
        sendJson(res, 200, {
          sharedAvailable: Boolean(shared),
          approvals: session?.pendingApprovals() ?? [],
          permissions: session?.pendingPermissions() ?? [],
          pending: session?.pendingQuestions() ?? [],
          tasks: url.searchParams.has('results') ? (session?.tasks() ?? []) : [],
        });
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
        body.action === 'attach' &&
        typeof body.threadId === 'string' &&
        /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(body.threadId)
      ) {
        try {
          const attached = shared && (await connectionFor(project).attach(body.threadId));
          sendJson(
            res,
            attached ? 200 : 404,
            attached ? { attached: true } : { error: 'thread_unavailable' },
          );
        } catch {
          sendJson(res, 502, { error: 'codex_attach_failed' });
        }
        return true;
      }
      if (
        (body.action === 'start' || body.action === 'start-document') &&
        typeof body.prompt === 'string' &&
        body.prompt.trim() &&
        body.prompt.length <= 16_000
      ) {
        const prompt = body.prompt.trim();
        const allowed = () =>
          options.authorize(req, url) &&
          options.available(project) &&
          options.project(req, url) === project;
        let documentUrl: string | undefined;
        if (body.action === 'start-document') {
          try {
            documentUrl = await options.createDocument(project, prompt, allowed);
          } catch {
            sendJson(res, 409, { error: 'task_document_failed' });
            return true;
          }
        }
        if (!allowed()) {
          sendJson(res, 409, { error: 'project_unavailable', documentUrl });
          return true;
        }
        try {
          const threadId = await connectionFor(project).start(prompt, documentUrl);
          sendJson(res, 201, { threadId, documentUrl });
        } catch {
          sendJson(res, 502, { error: 'codex_start_failed', documentUrl });
        }
        return true;
      }
      if (
        body.action === 'grant' &&
        typeof body.threadId === 'string' &&
        (typeof body.requestId === 'string' ||
          (typeof body.requestId === 'number' && Number.isSafeInteger(body.requestId))) &&
        Array.isArray(body.selected) &&
        body.selected.every(Number.isSafeInteger)
      ) {
        try {
          const sent = await sessions
            .get(project)
            ?.grant(body.threadId, body.requestId, body.selected);
          sendJson(
            res,
            sent ? 200 : 409,
            sent ? { sent: true } : { error: 'permission_request_unavailable' },
          );
        } catch {
          sendJson(res, 502, { error: 'codex_permission_failed' });
        }
        return true;
      }
      if (
        body.action === 'decide' &&
        typeof body.threadId === 'string' &&
        (typeof body.requestId === 'string' ||
          (typeof body.requestId === 'number' && Number.isSafeInteger(body.requestId))) &&
        isCommandApprovalDecision(body.decision)
      ) {
        try {
          const sent = await sessions
            .get(project)
            ?.decide(body.threadId, body.requestId, body.decision);
          sendJson(
            res,
            sent ? 200 : 409,
            sent ? { sent: true } : { error: 'approval_unavailable' },
          );
        } catch {
          sendJson(res, 502, { error: 'codex_approval_failed' });
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
