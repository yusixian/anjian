import crypto from 'node:crypto';

import type { Thread } from '../../shared/comments';
import type { FeedbackClaim, FeedbackConnection, FeedbackTask } from '../../shared/feedback';
import { type FeedbackData, feedbackError, hash } from './store';

export const LEASE_MS = 5 * 60 * 1000;
export const artifactPattern = /^(document|artboard)\/[a-z0-9][a-z0-9-]*$/;
export function text(value: unknown, name: string, max = 200): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max)
    feedbackError(
      'invalid_feedback',
      `${name} must be a nonempty string of at most ${max} characters`,
      400,
    );
  return value as string;
}
export function publicTask(task: FeedbackTask) {
  const {
    tokenHash: _token,
    claimRecoverySeq: _recovery,
    claimOwner: _owner,
    claimRequestId: _request,
    claimRequests: _requests,
    submissionHash: _hash,
    ...safe
  } = task;
  return {
    ...safe,
    recoveryRequestSeq: task.recoveryRequestSeq ?? 0,
    recoveryConsumedSeq: task.recoveryConsumedSeq ?? 0,
    needsRecovery:
      task.state === 'needs_attention' ||
      (task.state === 'running' && (task.leaseUntil ?? 0) <= Date.now()),
  };
}
export function publicConnection(connection: FeedbackConnection) {
  const {
    session: _session,
    deviceId: _device,
    requestId: _request,
    rebindRequests: _rebind,
    ...safe
  } = connection;
  return safe;
}
export function connectionOf(data: FeedbackData, id: string, device?: string) {
  const found = data.connections.find((c) => c.id === id && (!device || c.deviceId === device));
  if (!found) feedbackError('connection_not_found', undefined, 404);
  return found!;
}
export function taskOf(data: FeedbackData, id: string, device?: string) {
  const found = data.tasks.find((t) => t.id === id);
  if (!found) feedbackError('task_not_found', undefined, 404);
  connectionOf(data, found!.connectionId, device);
  return found!;
}
export function connect(
  data: FeedbackData,
  project: string,
  device: string,
  body: Record<string, unknown>,
  now: number,
) {
  if (
    body.host !== 'lody' ||
    !Array.isArray(body.artifacts) ||
    !body.artifacts.length ||
    body.artifacts.length > 100 ||
    !body.artifacts.every(
      (a) => typeof a === 'string' && a.length <= 200 && artifactPattern.test(a),
    )
  )
    feedbackError('invalid_connection', undefined, 400);
  const input = {
    host: 'lody' as const,
    session: text(body.session, 'session'),
    displayName: text(body.displayName, 'displayName', 100),
    artifacts: [...new Set(body.artifacts as string[])].sort(),
    requestId: text(body.requestId, 'requestId'),
  };
  const prior = data.connections.find(
    (c) => c.deviceId === device && c.requestId === input.requestId,
  );
  if (prior) {
    if (
      hash({
        host: prior.host,
        session: prior.session,
        displayName: prior.displayName,
        artifacts: prior.artifacts,
        requestId: prior.requestId,
      }) !== hash(input)
    )
      feedbackError('idempotency_conflict');
    return prior;
  }
  if (
    data.connections.some((c) => c.enabled && c.artifacts.some((a) => input.artifacts.includes(a)))
  )
    feedbackError('artifact_already_connected');
  const connection: FeedbackConnection = {
    ...input,
    id: crypto.randomUUID(),
    project,
    deviceId: device,
    generation: 1,
    enabled: true,
    confirmedAt: now,
  };
  data.connections.push(connection);
  return connection;
}
export function setEnabled(
  data: FeedbackData,
  connection: FeedbackConnection,
  enabled: boolean,
  now: number,
) {
  if (connection.enabled === enabled) return;
  if (
    enabled &&
    data.connections.some(
      (c) =>
        c.id !== connection.id &&
        c.enabled &&
        c.artifacts.some((a) => connection.artifacts.includes(a)),
    )
  )
    feedbackError('artifact_already_connected');
  connection.enabled = enabled;
  connection.confirmedAt = now;
}
/** Replacement requires project authorization and preserves the artifact scope. */
export function rebind(
  data: FeedbackData,
  connection: FeedbackConnection,
  body: Record<string, unknown>,
  now: number,
  device = connection.deviceId,
) {
  const requestId = text(body.requestId, 'requestId');
  const session = text(body.session, 'session');
  const displayName = text(body.displayName, 'displayName', 100);
  const payloadHash = hash({ session, displayName, device, generation: body.generation });
  const prior = connection.rebindRequests?.find((r) => r.requestId === requestId);
  if (prior) {
    if (prior.payloadHash !== payloadHash) feedbackError('idempotency_conflict');
    if (prior.generation !== connection.generation) feedbackError('stale_connection');
    return connection;
  }
  if (body.generation !== connection.generation) feedbackError('stale_connection');
  if ((connection.rebindRequests?.length ?? 0) >= 1000) feedbackError('connection_history_full');
  if (
    data.connections.some(
      (c) =>
        c.id !== connection.id &&
        c.enabled &&
        c.artifacts.some((a) => connection.artifacts.includes(a)),
    )
  )
    feedbackError('artifact_already_connected');
  connection.generation++;
  connection.deviceId = device;
  connection.session = session;
  connection.displayName = displayName;
  connection.enabled = true;
  connection.confirmedAt = now;
  (connection.rebindRequests ??= []).push({
    requestId,
    payloadHash,
    generation: connection.generation,
  });
  for (const task of data.tasks.filter(
    (t) => t.connectionId === connection.id && t.state === 'running',
  )) {
    task.state = 'needs_attention';
    task.errorCode = 'connection_changed';
    task.updatedAt = now;
  }
  return connection;
}
export function submit(
  data: FeedbackData,
  connection: FeedbackConnection,
  artifact: string,
  key: string,
  selection: Array<{ threadId: string; messageIds: string[]; version: string }>,
  threads: Thread<unknown>[],
  revision: string,
  now: number,
) {
  if (!connection.artifacts.includes(artifact)) feedbackError('connection_unavailable');
  const submissionHash = hash({ connectionId: connection.id, artifact, selection });
  const previous = data.tasks.find((t) => t.submissionKey === key);
  if (previous) {
    if (previous.submissionHash !== submissionHash) feedbackError('idempotency_conflict');
    return previous;
  }
  if (
    !selection.length ||
    selection.length > 100 ||
    selection.some((s) => !s || typeof s.threadId !== 'string') ||
    new Set(selection.map((s) => s.threadId)).size !== selection.length
  )
    feedbackError('invalid_selection', undefined, 400);
  const snapshot = selection.map((selected) => {
    const thread = threads.find((t) => t.id === selected.threadId && t.status === 'open');
    if (
      !thread ||
      hash(thread) !== selected.version ||
      !Array.isArray(selected.messageIds) ||
      !selected.messageIds.length ||
      hash(thread.messages.filter((m) => !m.deleted).map((m) => m.id)) !== hash(selected.messageIds)
    )
      feedbackError('feedback_changed');
    return structuredClone(thread!);
  });
  return enqueueTask(data, connection, artifact, key, submissionHash, snapshot, revision, now);
}
export function enqueueTask(
  data: FeedbackData,
  connection: FeedbackConnection,
  artifact: string,
  key: string,
  submissionHash: string,
  threads: Thread<unknown>[],
  revision: string,
  now: number,
) {
  const task: FeedbackTask = {
    id: crypto.randomUUID(),
    connectionId: connection.id,
    artifact,
    submissionKey: key,
    submissionHash,
    threads: structuredClone(threads),
    state: 'queued',
    attempt: 0,
    claimRequests: [],
    generation: connection.generation,
    createdAt: now,
    updatedAt: now,
    inputRevision: revision,
  };
  data.tasks.push(task);
  return task;
}
export function requestRecovery(task: FeedbackTask, now: number) {
  if (!(
    task.state === 'queued' ||
    task.state === 'needs_attention' ||
    (task.state === 'running' && (task.leaseUntil ?? 0) <= now)
  ))
    feedbackError('invalid_task_transition');
  // Coalesce repeated clicks/network retries until this request has been consumed.
  if ((task.recoveryRequestSeq ?? 0) <= (task.recoveryConsumedSeq ?? 0))
    task.recoveryRequestSeq = (task.recoveryRequestSeq ?? 0) + 1;
  if (task.state === 'running') {
    task.state = 'needs_attention';
    task.errorCode = 'lease_expired';
  }
}
function claimBlockReason(
  data: FeedbackData,
  task: FeedbackTask,
  now: number,
  recover: boolean,
  authorized = true,
) {
  const connection = connectionOf(data, task.connectionId);
  if (!authorized) return 'connection_unauthorized';
  if (!connection.enabled || !connection.artifacts.includes(task.artifact))
    return 'connection_unavailable';
  if (
    recover
      ? !(
          task.state === 'needs_attention' ||
          (task.state === 'running' && (task.leaseUntil ?? 0) <= now)
        )
      : task.state !== 'queued'
  )
    return 'task_not_claimable';
  if (
    data.tasks.some(
      (t) =>
        t.id !== task.id &&
        t.artifact === task.artifact &&
        (t.state === 'running' || t.state === 'needs_attention'),
    )
  )
    return 'artifact_busy';
  if (recover && (task.recoveryRequestSeq ?? 0) <= (task.recoveryConsumedSeq ?? 0))
    return 'recovery_not_requested';
  if (task.claimRequests.length >= 1000) return 'claim_history_full';
  return null;
}
export function claimAvailability(
  data: FeedbackData,
  task: FeedbackTask,
  now: number,
  authorized = true,
) {
  const recover =
    task.state === 'needs_attention' || (task.state === 'running' && (task.leaseUntil ?? 0) <= now);
  const blockedReason = claimBlockReason(data, task, now, recover, authorized);
  return {
    claimable: !recover && blockedReason === null,
    recoverable: recover && blockedReason === null,
    blockedReason,
  };
}
function tokenMatches(token: unknown, expected: string | undefined) {
  if (
    typeof token !== 'string' ||
    !/^[a-f0-9]{64}$/.test(token) ||
    !expected ||
    !/^[a-f0-9]{64}$/.test(expected)
  )
    return false;
  return crypto.timingSafeEqual(Buffer.from(hash(token), 'hex'), Buffer.from(expected, 'hex'));
}
export function claim(
  data: FeedbackData,
  task: FeedbackTask,
  device: string,
  body: Record<string, unknown>,
  revision: string,
  now: number,
  recover = false,
) {
  const connection = connectionOf(data, task.connectionId, device);
  if (!connection.artifacts.includes(task.artifact)) feedbackError('connection_unavailable');
  if (body.connectionId !== connection.id || body.generation !== connection.generation)
    feedbackError('stale_connection');
  const requestId = text(body.requestId, 'requestId');
  const owner = text(body.claimant, 'claimant');
  if (typeof body.token !== 'string' || !/^[a-f0-9]{64}$/.test(body.token))
    feedbackError('invalid_claim_token', undefined, 400);
  if (owner !== connection.session) feedbackError('session_mismatch');
  if (task.claimRequests.includes(requestId) && task.claimRequestId !== requestId)
    feedbackError('stale_claim');
  if (task.claimRequestId === requestId) {
    if (
      task.claimOwner !== owner ||
      !tokenMatches(body.token, task.tokenHash) ||
      (task.claimRecoverySeq ?? 0) !== (body.recoveryRequestSeq ?? 0)
    )
      feedbackError('idempotency_conflict');
    if (task.generation !== connection.generation || task.state === 'cancelled')
      feedbackError('stale_claim');
    return publicTask(task);
  }
  const blocked = claimBlockReason(data, task, now, recover);
  if (blocked) feedbackError(blocked);
  if (recover && body.recoveryRequestSeq !== task.recoveryRequestSeq)
    feedbackError('stale_recovery_request');
  if (!recover && body.recoveryRequestSeq !== undefined && body.recoveryRequestSeq !== 0)
    feedbackError('invalid_recovery_request');
  task.claimRequests.push(requestId);
  task.claimRecoverySeq = recover ? task.recoveryRequestSeq : 0;
  // A queued retry is also consumed by the first claim; it cannot authorize a later recovery.
  task.recoveryConsumedSeq = task.recoveryRequestSeq ?? 0;
  task.attempt++;
  task.generation = connection.generation;
  task.claimOwner = owner;
  task.claimRequestId = requestId;
  task.state = 'running';
  task.leaseUntil = now + LEASE_MS;
  task.updatedAt = now;
  if (!task.operation) task.inputRevision = revision;
  delete task.errorCode;
  task.tokenHash = hash(body.token);
  connection.confirmedAt = now;
  return publicTask(task);
}
export function fence(
  data: FeedbackData,
  task: FeedbackTask,
  device: string,
  identity: FeedbackClaim,
  now: number,
  completed = false,
) {
  const connection = connectionOf(data, task.connectionId, device);
  if (
    identity.connectionId !== connection.id ||
    identity.generation !== connection.generation ||
    task.generation !== connection.generation ||
    identity.attempt !== task.attempt ||
    !tokenMatches(identity.token, task.tokenHash) ||
    (!completed && (task.state !== 'running' || !task.leaseUntil || task.leaseUntil <= now))
  )
    feedbackError('stale_claim');
  return connection;
}
