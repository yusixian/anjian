import crypto from 'node:crypto';

import type { FeedbackTask } from '../../shared/feedback';
import type { MountedProject } from '../app';
import { assertArtifactNotTrashed } from '../artifact-trash';
import {
  decodeDocumentUpload,
  readRemoteArtifact,
  type RemoteArtifactWrite,
  remoteUploadRevision,
  writeRemoteArtifact,
} from '../remote-transfer';
import { feedbackError, hash } from './store';
import { text } from './tasks';

/** The caller holds quota and project locks. Every await is followed by reauthorization/fencing. */
export async function applyResult(options: {
  project: string;
  task: FeedbackTask;
  mounted: MountedProject;
  body: Record<string, unknown>;
  guard: () => void;
  save: () => Promise<void>;
  prepare: () => Promise<(delta: number) => void>;
}) {
  const { task, mounted, body, project, guard, save } = options;
  const prepare = async () => {
    const admit = await options.prepare();
    guard();
    return (delta: number) => {
      guard();
      admit(delta);
    };
  };
  const operationId = text(body.operationId, 'operationId');
  const upload = body.upload as RemoteArtifactWrite;
  const replies = body.replies as Array<{ threadId: string; text: string }>;
  if (
    !upload ||
    !Array.isArray(replies) ||
    replies.length !== task.threads.length ||
    new Set(replies.map((r) => r?.threadId)).size !== replies.length ||
    replies.some(
      (r) =>
        !r ||
        !task.threads.some((t) => t.id === r.threadId) ||
        typeof r.text !== 'string' ||
        !r.text.trim() ||
        r.text.length > 20000,
    )
  )
    feedbackError('invalid_result', undefined, 400);
  const payloadHash = hash({ upload, replies });
  const [type, id] = task.artifact.split('/') as ['document' | 'artboard', string];
  if (!mounted.feedbackComments || !mounted.feedbackReply)
    feedbackError('feedback_unavailable', undefined, 503);
  guard();
  assertArtifactNotTrashed(project, type, id);
  if (
    task.operation &&
    (task.operation.id !== operationId || task.operation.payloadHash !== payloadHash)
  )
    feedbackError('idempotency_conflict');
  if (task.operation?.stage === 'complete') return;
  if (type === 'document') {
    const admission = await prepare();
    guard();
    await mounted.settleDocument(id, undefined, admission);
    guard();
  }
  let current = readRemoteArtifact(project, task.artifact).revision;
  let prepared;
  if (!task.operation || current === task.operation.baseRevision) {
    if (upload.baseRevision !== task.inputRevision || current !== upload.baseRevision)
      feedbackError('revision_conflict');
    const decoded = type === 'document' ? decodeDocumentUpload(upload) : undefined;
    if (decoded) {
      const admission = await prepare();
      guard();
      prepared = await mounted.prepareDocumentUpload(id, decoded.source, decoded.files, admission);
      guard();
    }
    const expectedRevision = remoteUploadRevision(task.artifact, upload, prepared?.xml);
    if (task.operation && task.operation.expectedRevision !== expectedRevision)
      feedbackError('result_reconciliation_required');
    if (!task.operation) {
      task.operation = {
        id: operationId,
        payloadHash,
        expectedRevision,
        baseRevision: upload.baseRevision!,
        stage: 'prepared',
        replies: replies.map((r) => ({ ...r, messageId: crypto.randomUUID() })),
      };
      await save();
      guard();
    }
  }
  const operation = task.operation!;
  if (current !== operation.expectedRevision) {
    if (operation.stage !== 'prepared' || current !== operation.baseRevision)
      feedbackError('result_reconciliation_required');
    const admission = await prepare();
    guard();
    writeRemoteArtifact(
      project,
      task.artifact,
      upload,
      admission,
      prepared,
      type === 'artboard'
        ? (directory) => mounted.prepareArtifactUpload(type, id, directory)
        : undefined,
    );
    current = readRemoteArtifact(project, task.artifact).revision;
    if (current !== operation.expectedRevision) feedbackError('result_reconciliation_required');
  }
  operation.stage = 'uploaded';
  task.outputRevision = current!;
  await save();
  guard();
  for (const reply of operation.replies) {
    const admission = await prepare();
    guard();
    const threads = mounted.feedbackComments!(type, id);
    const thread = threads.find((t) => t.id === reply.threadId);
    if (!thread) feedbackError('reply_thread_missing');
    const prior = thread!.messages.find((m) => m.id === reply.messageId);
    if (prior) {
      if (prior.author !== 'agent' || prior.text !== reply.text || prior.deleted)
        feedbackError('reply_reconciliation_required');
    } else mounted.feedbackReply!(type, id, reply.threadId, reply.text, reply.messageId, admission);
    const saved = mounted.feedbackComments!(type, id)
      .find((t) => t.id === reply.threadId)
      ?.messages.find((m) => m.id === reply.messageId);
    if (!saved || saved.text !== reply.text || saved.deleted)
      feedbackError('reply_reconciliation_required');
  }
  operation.stage = 'replied';
  await save();
  guard();
  if (readRemoteArtifact(project, task.artifact).revision !== operation.expectedRevision)
    feedbackError('result_reconciliation_required');
  operation.stage = 'complete';
  task.state = 'awaiting_review';
  task.updatedAt = Date.now();
  await save();
}
