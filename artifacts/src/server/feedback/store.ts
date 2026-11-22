import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { type DocumentQuestion, validateDocumentQuestion } from '../../shared/document-questions';
import {
  type DesignDecision,
  type FeedbackConnection,
  type FeedbackQuestionContext,
  type FeedbackTask,
  MAX_QUESTION_ANSWER_LENGTH,
} from '../../shared/feedback';
import { isArtifactAddress } from '../../shared/ids';
import { RemoteTransferError } from '../remote-transfer';

export interface FeedbackData {
  connections: FeedbackConnection[];
  decisions?: DesignDecision[];
  localQuestions?: LocalQuestionSubmission[];
  questionDrafts?: QuestionDraft[];
  tasks: FeedbackTask[];
  version: 1;
}
export interface QuestionDraft {
  answer?: string;
  artifact: string;
  artifactAddress?: string;
  definition: DocumentQuestion;
  version: string;
}
export interface LocalQuestionSubmission {
  artifact: string;
  artifactAddress: string;
  id: string;
  input: FeedbackQuestionContext;
  offer?: { until: number; proof: string };
  recipient: string;
  revision: string;
  state: 'queued' | 'delivered' | 'cancelled';
  submissionHash: string;
  submissionKey: string;
}

export const feedbackError = (code: string, message = code, status = 409): never => {
  throw new RemoteTransferError(status, code, message);
};
const canonical = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, canonical(item)]),
    );
  return value;
};
export const hash = (value: unknown) =>
  crypto
    .createHash('sha256')
    .update(JSON.stringify(canonical(value)))
    .digest('hex');
const MAX_STORE = 16 * 1024 * 1024;
const states = new Set([
  'queued',
  'running',
  'needs_attention',
  'awaiting_review',
  'accepted',
  'cancelled',
]);
const isDocument = (artifact: unknown): artifact is string =>
  typeof artifact === 'string' && artifact.startsWith('document/') && artifact.length > 9;

function validDefinition(value: DocumentQuestion): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  try {
    validateDocumentQuestion(value);
    return true;
  } catch {
    return false;
  }
}

function validDecisions(decisions: DesignDecision[] | undefined): boolean {
  return (
    decisions === undefined ||
    (Array.isArray(decisions) &&
      decisions.every(
        (decision) =>
          decision &&
          typeof decision.documentId === 'string' &&
          isArtifactAddress(decision.documentId) &&
          typeof decision.revision === 'string' &&
          /^sha256:[a-f0-9]{64}$/.test(decision.revision) &&
          validDefinition(decision.question) &&
          decision.question.approve !== undefined &&
          decision.question.options?.some(({ id }) => id === decision.choice) &&
          decision.by &&
          typeof decision.by.id === 'string' &&
          decision.by.id.length > 0 &&
          (decision.by.login === undefined || typeof decision.by.login === 'string') &&
          Number.isSafeInteger(decision.at) &&
          decision.at >= 0,
      ))
  );
}

function validAnswer(answer: unknown, definition: DocumentQuestion): boolean {
  return (
    typeof answer === 'string' &&
    answer.length > 0 &&
    answer.length <= MAX_QUESTION_ANSWER_LENGTH &&
    answer.trim() === answer &&
    (!definition.options || definition.options.some(({ id }) => id === answer))
  );
}

function validQuestionDrafts(drafts: QuestionDraft[] | undefined): boolean {
  if (drafts === undefined) return true;
  if (!Array.isArray(drafts)) return false;
  const seen = new Set<string>();
  for (const draft of drafts) {
    if (
      !draft ||
      !isDocument(draft.artifact) ||
      (draft.artifactAddress !== undefined &&
        (typeof draft.artifactAddress !== 'string' || !isArtifactAddress(draft.artifactAddress))) ||
      !validDefinition(draft.definition) ||
      (draft.answer !== undefined && !validAnswer(draft.answer, draft.definition)) ||
      typeof draft.version !== 'string' ||
      !draft.version
    )
      return false;
    const key = JSON.stringify([draft.artifact, draft.artifactAddress, draft.definition.id]);
    if (seen.has(key)) return false;
    seen.add(key);
  }
  return true;
}

function validLocalQuestions(rows: LocalQuestionSubmission[] | undefined): boolean {
  if (rows === undefined) return true;
  if (!Array.isArray(rows)) return false;
  const ids = new Set<string>();
  const keys = new Set<string>();
  const active = new Set<string>();
  for (const row of rows) {
    if (
      !row ||
      !isDocument(row.artifact) ||
      typeof row.artifactAddress !== 'string' ||
      !isArtifactAddress(row.artifactAddress) ||
      (row.offer !== undefined &&
        (!row.offer ||
          !Number.isSafeInteger(row.offer.until) ||
          !/^[a-f0-9]{64}$/.test(row.offer.proof))) ||
      typeof row.id !== 'string' ||
      !row.id ||
      ids.has(row.id) ||
      !row.input ||
      !validDefinition(row.input.definition) ||
      row.input.definition.approve !== undefined ||
      !validAnswer(row.input.answer, row.input.definition) ||
      typeof row.recipient !== 'string' ||
      !/^[\w-]{43}$/.test(row.recipient) ||
      typeof row.revision !== 'string' ||
      !/^sha256:[a-f0-9]{64}$/.test(row.revision) ||
      (row.state !== 'queued' && row.state !== 'delivered' && row.state !== 'cancelled') ||
      typeof row.submissionHash !== 'string' ||
      !/^[a-f0-9]{64}$/.test(row.submissionHash) ||
      typeof row.submissionKey !== 'string' ||
      !row.submissionKey ||
      keys.has(row.submissionKey)
    )
      return false;
    ids.add(row.id);
    keys.add(row.submissionKey);
    if (row.state === 'cancelled') continue;
    const question = JSON.stringify([row.artifactAddress, row.input.definition.id]);
    if (active.has(question)) return false;
    active.add(question);
  }
  return true;
}

function validQuestionTask(task: FeedbackTask): boolean {
  const { questionId, questionContext, questionResult } = task;
  if (questionId === undefined)
    return questionContext === undefined && questionResult === undefined;
  if (
    !isDocument(task.artifact) ||
    !questionContext ||
    !validDefinition(questionContext.definition) ||
    questionContext.definition.id !== questionId ||
    !validAnswer(questionContext.answer, questionContext.definition) ||
    task.threads.length !== 0 ||
    task.roundId !== undefined ||
    task.roundContext !== undefined
  )
    return false;
  return (
    questionResult === undefined ||
    (!!questionResult &&
      typeof questionResult.id === 'string' &&
      questionResult.id.length > 0 &&
      typeof questionResult.payloadHash === 'string' &&
      /^[a-f0-9]{64}$/.test(questionResult.payloadHash) &&
      typeof questionResult.reply === 'string' &&
      questionResult.reply.trim().length > 0 &&
      questionResult.reply.length <= 20000)
  );
}

function validate(value: unknown): asserts value is FeedbackData {
  const data = value as FeedbackData;
  if (
    !data ||
    data.version !== 1 ||
    !Array.isArray(data.connections) ||
    !Array.isArray(data.tasks) ||
    !validQuestionDrafts(data.questionDrafts) ||
    !validLocalQuestions(data.localQuestions) ||
    !validDecisions(data.decisions) ||
    !data.connections.every(
      (c) =>
        c &&
        typeof c.id === 'string' &&
        typeof c.deviceId === 'string' &&
        typeof c.session === 'string' &&
        c.host === 'lody' &&
        Number.isSafeInteger(c.generation) &&
        Array.isArray(c.artifacts) &&
        c.artifacts.every((a) => typeof a === 'string') &&
        typeof c.enabled === 'boolean',
    ) ||
    !data.tasks.every(
      (t) =>
        t &&
        typeof t.id === 'string' &&
        typeof t.artifact === 'string' &&
        (t.artifactAddress === undefined ||
          (typeof t.artifactAddress === 'string' && isArtifactAddress(t.artifactAddress))) &&
        states.has(t.state) &&
        Number.isSafeInteger(t.attempt) &&
        [t.recoveryRequestSeq ?? 0, t.recoveryConsumedSeq ?? 0, t.claimRecoverySeq ?? 0].every(
          (n) => Number.isSafeInteger(n) && n >= 0,
        ) &&
        (t.recoveryConsumedSeq ?? 0) <= (t.recoveryRequestSeq ?? 0) &&
        Array.isArray(t.claimRequests) &&
        t.claimRequests.every((r) => typeof r === 'string') &&
        Array.isArray(t.threads) &&
        validQuestionTask(t) &&
        typeof t.submissionHash === 'string' &&
        data.connections.some((c) => c.id === t.connectionId),
    ) ||
    new Set(data.tasks.map((t) => t.id)).size !== data.tasks.length ||
    new Set(data.connections.map((c) => c.id)).size !== data.connections.length
  )
    feedbackError('feedback_store_corrupt');
}

/** Callers hold the project mutation lock for the entire read/modify/save cycle. */
export function feedbackStore(home: string, project: string) {
  if (!/^[a-f0-9]{32}$/.test(project)) feedbackError('invalid_project', undefined, 400);
  const dir = path.join(home, 'feedback');
  const file = path.join(dir, `${project}.json`);
  const check = () => {
    for (const target of [home, dir, file]) {
      try {
        const stat = fs.lstatSync(target);
        if (stat.isSymbolicLink() || (target === file ? !stat.isFile() : !stat.isDirectory()))
          feedbackError('unsafe_feedback_store');
        if (target === file && stat.size > MAX_STORE)
          feedbackError('feedback_store_too_large', undefined, 413);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }
  };
  return {
    load(): FeedbackData {
      check();
      try {
        const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
          feedbackError('feedback_store_corrupt');
        const { checksum, ...data } = parsed;
        if (typeof checksum !== 'string' || checksum !== hash(data))
          feedbackError('feedback_store_corrupt');
        validate(data);
        if (data.connections.some((c) => c.project !== project))
          feedbackError('feedback_store_corrupt');
        return data;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT')
          return { version: 1, connections: [], tasks: [] };
        if (error instanceof SyntaxError) feedbackError('feedback_store_corrupt');
        throw error;
      }
    },
    save(data: FeedbackData, admit: (delta: number) => void) {
      check();
      validate(data);
      if (data.connections.some((c) => c.project !== project))
        feedbackError('feedback_store_corrupt');
      const text = `${JSON.stringify({ ...data, checksum: hash(data) })}\n`;
      if (Buffer.byteLength(text) > MAX_STORE)
        feedbackError('feedback_store_too_large', undefined, 413);
      let before = 0;
      try {
        before = fs.statSync(file).size;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      admit(Buffer.byteLength(text) - before);
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      const temporary = `${file}.${crypto.randomUUID()}.tmp`;
      try {
        const fd = fs.openSync(temporary, 'wx', 0o600);
        try {
          fs.writeFileSync(fd, text);
          fs.fsyncSync(fd);
        } finally {
          fs.closeSync(fd);
        }
        fs.renameSync(temporary, file);
        const directory = fs.openSync(dir, 'r');
        try {
          fs.fsyncSync(directory);
        } finally {
          fs.closeSync(directory);
        }
      } finally {
        fs.rmSync(temporary, { force: true });
      }
    },
  };
}
