import type http from 'node:http';

import type { BoardThread } from '../../shared/board-comments';
import type { FeedbackClaim } from '../../shared/feedback';
import { ARTIFACT_LOCATOR_SOURCE } from '../../shared/ids';
import type { MountedProject } from '../app';
import { ArtifactTrashError, assertArtifactNotTrashed } from '../artifact-trash';
import { sendJson } from '../http';
import { withProjectMutation } from '../project-mutations';
import { readRemoteArtifact, RemoteTransferError } from '../remote-transfer';
import { feedbackSelection } from './comments';
import { applyResult } from './result';
import { feedbackRounds, roundSubmissionHash, submitRound } from './rounds';
import { feedbackError, feedbackStore, hash } from './store';
import {
  claim,
  claimAvailability,
  connect,
  connectionOf,
  fence,
  LEASE_MS,
  publicConnection,
  publicTask,
  rebind,
  requestRecovery,
  setEnabled,
  submit,
  taskOf,
  text,
} from './tasks';

type Project = { id: string; dir: string };
interface Options {
  authenticate: (req: http.IncomingMessage) => { id: string; projects: string[] } | null;
  browserProject: (
    req: http.IncomingMessage,
    artifact: string,
  ) => (Project & { artifact: string }) | null;
  deviceAuthorized: (id: string, project: string) => boolean;
  home: string;
  mount: (dir: string) => Promise<MountedProject>;
  projects: () => Project[];
  upload: <T>(
    project: string,
    work: (prepare: () => Promise<(delta: number) => void>) => Promise<T>,
  ) => Promise<T>;
}
async function bodyOf(req: http.IncomingMessage, limit: number): Promise<Record<string, unknown>> {
  if (!req.headers['content-type']?.startsWith('application/json'))
    feedbackError('json_required', undefined, 415);
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const part of req) {
    const chunk = Buffer.from(part);
    size += chunk.length;
    if (size > limit) feedbackError('body_too_large', undefined, 413);
    chunks.push(chunk);
  }
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!body || typeof body !== 'object' || Array.isArray(body))
      throw new Error('Expected a JSON object');
    return body;
  } catch {
    return feedbackError('invalid_json', undefined, 400);
  }
}
const REMOTE = /^\/api\/remote\/projects\/([a-f0-9]{32})\/feedback(?:\/(.*))?$/;
const BROWSER = new RegExp(
  `^/api/(document|artboard)/(${ARTIFACT_LOCATOR_SOURCE})/feedback(?:/(.*))?$`,
);
export function createFeedbackApi(options: Options) {
  return async (req: http.IncomingMessage, res: http.ServerResponse, url: URL) => {
    const remote = REMOTE.exec(url.pathname);
    const browser = BROWSER.exec(url.pathname);
    if (!remote && !browser) return false;
    res.setHeader('Cache-Control', 'no-store');
    try {
      const requestedArtifact = browser ? `${browser[1]}/${browser[2]}` : undefined;
      const device = remote && req.headers.origin === undefined ? options.authenticate(req) : null;
      if (remote && !device) feedbackError('unauthorized', undefined, 401);
      const project = remote
        ? options.projects().find((p) => p.id === remote[1] && device!.projects.includes(p.id))
        : options.browserProject(req, requestedArtifact!);
      if (!project) feedbackError('not_found', undefined, 404);
      const target = project!;
      const artifact = browser ? (project as Project & { artifact: string }).artifact : undefined;
      const authorize = () => {
        if (remote) {
          const current = options.authenticate(req);
          if (
            !current ||
            current.id !== device!.id ||
            !current.projects.includes(target.id) ||
            !options.projects().some((p) => p.id === target.id && p.dir === target.dir)
          )
            feedbackError('unauthorized', undefined, 401);
        } else if (options.browserProject(req, requestedArtifact!)?.id !== target.id)
          feedbackError('not_found', undefined, 404);
      };
      const suffix = remote ? (remote[2] ?? '') : (browser![3] ?? '');
      const parts = suffix.split('/');
      if (req.method !== 'GET' && req.method !== 'POST')
        feedbackError('method_not_allowed', undefined, 405);
      const body =
        req.method === 'POST'
          ? await bodyOf(req, parts[2] === 'result' ? 46 * 1024 * 1024 : 256 * 1024)
          : {};
      const store = feedbackStore(options.home, target.id);
      const run = async (prepare?: () => Promise<(delta: number) => void>) => {
        authorize();
        const data = store.load();
        const projectTask = (task: Parameters<typeof publicTask>[0]) => ({
          ...publicTask(task),
          ...claimAvailability(
            data,
            task,
            Date.now(),
            options.deviceAuthorized(connectionOf(data, task.connectionId).deviceId, target.id),
          ),
        });
        let checkWrite = authorize;
        const save = async () => {
          if (!prepare) throw new Error('Read-only feedback request');
          const admit = await prepare();
          checkWrite();
          store.save(data, admit);
        };
        const visibleConnections = data.connections.filter((c) =>
          remote ? c.deviceId === device!.id : c.artifacts.includes(artifact!),
        );
        const visibleTasks = data.tasks.filter(
          (t) =>
            visibleConnections.some((c) => c.id === t.connectionId) &&
            (!artifact || t.artifact === artifact),
        );
        if (req.method === 'GET') {
          if (suffix === 'input' && artifact) {
            const mounted = await options.mount(target.dir);
            authorize();
            const [type, id] = artifact.split('/') as ['document' | 'artboard', string];
            assertArtifactNotTrashed(target.dir, type, id);
            const snapshot = readRemoteArtifact(target.dir, artifact);
            if (!snapshot.revision || !mounted.feedbackComments)
              feedbackError('artifact_not_found', undefined, 404);
            const threads = mounted.feedbackComments!(type, id);
            return {
              artifact,
              revision: snapshot.revision,
              threads,
              selection: feedbackSelection(threads),
              ...(type === 'artboard'
                ? {
                    rounds: feedbackRounds(
                      target.dir,
                      id,
                      threads as BoardThread[],
                      snapshot.revision!,
                    ).map(({ preview }) => ({
                      ...preview,
                      state: data.tasks.some(
                        (t) =>
                          t.artifact === artifact &&
                          t.roundId === preview.id &&
                          t.state !== 'cancelled',
                      )
                        ? 'submitted'
                        : preview.state,
                    })),
                  }
                : {}),
            };
          }
          if (suffix === '' || suffix === 'connections')
            return {
              connections: visibleConnections.map((c) => ({
                ...publicConnection(c),
                authorized: options.deviceAuthorized(c.deviceId, target.id),
              })),
            };
          if (suffix === 'tasks')
            return {
              tasks: visibleTasks
                .filter(
                  (t) =>
                    (!url.searchParams.has('connectionId') ||
                      t.connectionId === url.searchParams.get('connectionId')) &&
                    (!url.searchParams.has('state') || t.state === url.searchParams.get('state')),
                )
                .map((t) => {
                  const {
                    threads: _threads,
                    operation: _operation,
                    roundContext: _round,
                    ...safe
                  } = projectTask(t);
                  return safe;
                }),
            };
          if (parts[0] === 'tasks' && parts.length === 2) {
            const task = visibleTasks.find((t) => t.id === parts[1]);
            if (!task) feedbackError('task_not_found', undefined, 404);
            return { task: projectTask(task!) };
          }
          return feedbackError('not_found', undefined, 404);
        }
        if (suffix === 'connections' && remote) {
          const connection = connect(data, target.id, device!.id, body, Date.now());
          for (const key of connection.artifacts) {
            if (!readRemoteArtifact(target.dir, key).revision)
              feedbackError('artifact_not_found', undefined, 404);
          }
          await save();
          return { connection: publicConnection(connection) };
        }
        if (remote && parts[0] === 'connections' && parts.length === 3 && parts[2] === 'rebind') {
          const connection = connectionOf(data, parts[1]!);
          rebind(data, connection, body, Date.now(), device!.id);
          await save();
          return { connection: publicConnection(connection) };
        }
        if (
          parts[0] === 'connections' &&
          parts.length === 3 &&
          ['pause', 'resume'].includes(parts[2]!)
        ) {
          const connection = connectionOf(data, parts[1]!, device?.id);
          if (artifact && !connection.artifacts.includes(artifact))
            feedbackError('not_found', undefined, 404);
          setEnabled(data, connection, parts[2] === 'resume', Date.now());
          await save();
          return { connection: publicConnection(connection) };
        }
        if (suffix === 'submit' && artifact) {
          const connection = connectionOf(data, text(body.connectionId, 'connectionId'));
          if (!options.deviceAuthorized(connection.deviceId, target.id))
            feedbackError('connection_unauthorized');
          const key = text(body.submissionKey, 'submissionKey');
          const hasRound = body.round !== undefined;
          if (hasRound === (body.selection !== undefined))
            feedbackError('invalid_submission', undefined, 400);
          const requested = hasRound ? (body.round as { id: string; version: string }) : undefined;
          if (
            hasRound &&
            (!requested ||
              typeof requested !== 'object' ||
              Array.isArray(requested) ||
              !artifact.startsWith('artboard/'))
          )
            feedbackError('invalid_round', undefined, 400);
          if (requested) {
            text(requested.id, 'round.id');
            text(requested.version, 'round.version');
          }
          const submissionHash = requested
            ? roundSubmissionHash(connection.id, artifact, requested)
            : hash({ connectionId: connection.id, artifact, selection: body.selection });
          const prior = data.tasks.find((t) => t.submissionKey === key);
          if (prior) {
            if (prior.submissionHash !== submissionHash) feedbackError('idempotency_conflict');
            return { task: projectTask(prior) };
          }
          const [type, id] = artifact.split('/') as ['document' | 'artboard', string];
          assertArtifactNotTrashed(target.dir, type, id);
          const mounted = await options.mount(target.dir);
          authorize();
          const revision = readRemoteArtifact(target.dir, artifact).revision;
          if (!revision || !mounted.feedbackComments)
            feedbackError('artifact_not_found', undefined, 404);
          if (!requested && !Array.isArray(body.selection))
            feedbackError('invalid_selection', undefined, 400);
          checkWrite = () => {
            authorize();
            if (!options.deviceAuthorized(connection.deviceId, target.id))
              feedbackError('connection_unauthorized');
          };
          const threads = mounted.feedbackComments!(type, id);
          const task = requested
            ? submitRound(
                data,
                connection,
                artifact,
                key,
                requested,
                feedbackRounds(target.dir, id, threads as BoardThread[], revision!),
                revision!,
                Date.now(),
              )
            : submit(
                data,
                connection,
                artifact,
                key,
                body.selection as Array<{
                  threadId: string;
                  messageIds: string[];
                  version: string;
                }>,
                threads,
                revision!,
                Date.now(),
              );
          if (requested) {
            const authorizedWrite = checkWrite;
            checkWrite = () => {
              authorizedWrite();
              const currentRevision = readRemoteArtifact(target.dir, artifact).revision;
              const current = feedbackRounds(
                target.dir,
                id,
                mounted.feedbackComments!(type, id) as BoardThread[],
                currentRevision ?? '',
              ).find((r) => r.preview.id === requested.id);
              if (!current || current.preview.version !== requested.version)
                feedbackError('feedback_changed');
            };
          }
          await save();
          return { task: projectTask(task) };
        }
        if (parts[0] !== 'tasks' || parts.length !== 3) feedbackError('not_found', undefined, 404);
        const task = taskOf(data, parts[1]!, device?.id);
        if (artifact && task.artifact !== artifact) feedbackError('not_found', undefined, 404);
        const action = parts[2];
        if (browser) {
          if (
            action === 'accept' &&
            (task.state === 'awaiting_review' || task.state === 'accepted')
          )
            task.state = 'accepted';
          else if (
            action === 'cancel' &&
            ['queued', 'running', 'needs_attention', 'cancelled'].includes(task.state)
          ) {
            if (task.state !== 'cancelled') {
              task.state = 'cancelled';
              task.attempt++;
            }
          } else if (action === 'retry') requestRecovery(task, Date.now());
          else feedbackError('invalid_task_transition');
          task.updatedAt = Date.now();
          await save();
          return { task: projectTask(task) };
        }
        if (!['claim', 'recover', 'renew', 'fail', 'result'].includes(action!))
          feedbackError('not_found', undefined, 404);
        const [type, id] = task.artifact.split('/') as ['document' | 'artboard', string];
        assertArtifactNotTrashed(target.dir, type, id);
        if (action === 'claim' || action === 'recover') {
          const revision = readRemoteArtifact(target.dir, task.artifact).revision;
          if (!revision) feedbackError('artifact_not_found', undefined, 404);
          const previousAttempt = task.attempt;
          const result = claim(
            data,
            task,
            device!.id,
            body,
            revision!,
            Date.now(),
            action === 'recover',
          );
          if (task.attempt === previousAttempt) return { task: projectTask(task) };
          checkWrite = () => {
            authorize();
            fence(data, task, device!.id, { ...result, token: body.token as string }, Date.now());
          };
          const mounted = await options.mount(target.dir);
          checkWrite();
          if (type === 'document') {
            const admit = await prepare!();
            checkWrite();
            await mounted.settleDocument(id, undefined, (delta) => {
              checkWrite();
              admit(delta);
            });
            checkWrite();
          }
          if (!task.operation)
            task.inputRevision = readRemoteArtifact(target.dir, task.artifact).revision!;
          await save();
          return { task: projectTask(task) };
        }
        const guard = () => {
          authorize();
          fence(
            data,
            task,
            device!.id,
            body as unknown as FeedbackClaim,
            Date.now(),
            action === 'result' &&
              task.state === 'awaiting_review' &&
              task.operation?.stage === 'complete',
          );
        };
        guard();
        const prior = structuredClone(task);
        checkWrite = () => {
          authorize();
          fence(data, prior, device!.id, body as unknown as FeedbackClaim, Date.now());
        };
        if (action === 'result') {
          checkWrite = guard;
        }
        if (action === 'result') {
          const mounted = await options.mount(target.dir);
          guard();
          await applyResult({
            project: target.dir,
            task,
            mounted,
            body,
            guard,
            prepare: prepare!,
            save: async () => {
              guard();
              await save();
            },
          });
        } else {
          if (task.state !== 'running') feedbackError('invalid_task_transition');
          if (action === 'renew') task.leaseUntil = Date.now() + LEASE_MS;
          else if (action === 'fail') {
            task.state = 'needs_attention';
            task.errorCode = text(body.errorCode, 'errorCode');
          } else feedbackError('not_found', undefined, 404);
          task.updatedAt = Date.now();
          await save();
        }
        return { task: projectTask(task) };
      };
      const result =
        req.method === 'GET'
          ? await withProjectMutation(target.dir, () => run())
          : await options.upload(target.dir, (prepare) =>
              withProjectMutation(target.dir, () => run(prepare)),
            );
      sendJson(res, 200, result);
    } catch (error) {
      if (error instanceof RemoteTransferError || error instanceof ArtifactTrashError)
        sendJson(res, error.status, { code: error.code, error: error.message });
      else
        sendJson(res, 500, {
          code: 'feedback_failed',
          error: '反馈操作失败，请检查服务端状态后重试',
        });
    }
    return true;
  };
}
