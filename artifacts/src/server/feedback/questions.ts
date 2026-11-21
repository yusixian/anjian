import crypto from 'node:crypto';

import type { DocumentQuestion } from '../../shared/document-questions';
import {
  type FeedbackConnection,
  type FeedbackQuestionInput,
  type FeedbackTask,
  MAX_QUESTION_ANSWER_LENGTH,
} from '../../shared/feedback';
import { type FeedbackData, feedbackError, hash, type QuestionDraft } from './store';
import { enqueueTask } from './tasks';

interface QuestionWrite {
  answer: string;
  id: string;
  version: string;
}

function canWithdraw(task: FeedbackTask): boolean {
  return (
    !task.operation &&
    !task.questionResult &&
    (task.state === 'queued' || task.state === 'running' || task.state === 'needs_attention')
  );
}

function draftOf(data: FeedbackData, artifact: string, id: string) {
  return data.questionDrafts?.find(
    (draft) => draft.artifact === artifact && draft.definition.id === id,
  );
}

function taskOf(data: FeedbackData, artifact: string, id: string) {
  return data.tasks.find(
    (task) => task.artifact === artifact && task.questionId === id && task.state !== 'cancelled',
  );
}

function questionItem(
  data: FeedbackData,
  artifact: string,
  definition: DocumentQuestion,
): FeedbackQuestionInput {
  const draft = draftOf(data, artifact, definition.id);
  const task = taskOf(data, artifact, definition.id);
  const saved = task?.questionContext ?? draft;
  const answer = saved?.answer;
  const previousDefinition =
    answer !== undefined && saved && hash(saved.definition) !== hash(definition)
      ? saved.definition
      : undefined;
  return {
    id: definition.id,
    definition,
    version: hash({ definition, draftVersion: draft?.version ?? null }),
    ...(answer !== undefined ? { answer } : {}),
    ...(previousDefinition ? { previousDefinition } : {}),
    ...(task
      ? {
          task: {
            id: task.id,
            state: task.state,
            withdrawable: canWithdraw(task),
            ...(task.questionResult ? { reply: task.questionResult.reply } : {}),
          },
        }
      : {}),
  };
}

export function questionItems(
  data: FeedbackData,
  artifact: string,
  definitions: readonly DocumentQuestion[],
): FeedbackQuestionInput[] {
  return definitions.map((definition) => questionItem(data, artifact, definition));
}

function writableQuestion(
  data: FeedbackData,
  artifact: string,
  definitions: readonly DocumentQuestion[],
  input: QuestionWrite,
): DocumentQuestion {
  if (taskOf(data, artifact, input.id)) feedbackError('question_already_submitted');
  const definition = definitions.find(({ id }) => id === input.id);
  if (!definition || questionItem(data, artifact, definition).version !== input.version)
    return feedbackError('feedback_changed');
  return definition;
}

function answerText(value: unknown): string {
  if (typeof value !== 'string') return feedbackError('invalid_question_answer', undefined, 400);
  const answer = value.trim();
  if (answer.length > MAX_QUESTION_ANSWER_LENGTH)
    return feedbackError('invalid_question_answer', undefined, 400);
  return answer;
}

function checkOption(definition: DocumentQuestion, answer: string) {
  if (answer && definition.options && !definition.options.some(({ id }) => id === answer))
    feedbackError('invalid_question_answer', undefined, 400);
}

function writeDraft(
  data: FeedbackData,
  artifact: string,
  definition: DocumentQuestion,
  answer: string,
) {
  const draft: QuestionDraft = {
    artifact,
    definition: structuredClone(definition),
    ...(answer ? { answer } : {}),
    version: crypto.randomUUID(),
  };
  const drafts = (data.questionDrafts ??= []);
  const index = drafts.findIndex(
    (draft) => draft.artifact === artifact && draft.definition.id === definition.id,
  );
  if (index === -1) drafts.push(draft);
  else drafts[index] = draft;
}

export function saveQuestionDraft(
  data: FeedbackData,
  artifact: string,
  definitions: readonly DocumentQuestion[],
  input: QuestionWrite,
): FeedbackQuestionInput {
  const definition = writableQuestion(data, artifact, definitions, input);
  const answer = answerText(input.answer);
  checkOption(definition, answer);
  writeDraft(data, artifact, definition, answer);
  return questionItem(data, artifact, definition);
}

function submissionHash(connection: FeedbackConnection, artifact: string, input: QuestionWrite) {
  return hash({
    connectionId: connection.id,
    artifact,
    question: { id: input.id, version: input.version, answer: answerText(input.answer) },
  });
}

export function replayQuestionSubmission(
  data: FeedbackData,
  connection: FeedbackConnection,
  artifact: string,
  key: string,
  input: QuestionWrite,
): FeedbackTask | undefined {
  const previous = data.tasks.find((task) => task.submissionKey === key);
  if (!previous) return;
  if (previous.submissionHash !== submissionHash(connection, artifact, input))
    feedbackError('idempotency_conflict');
  return previous;
}

export function submitQuestion(
  data: FeedbackData,
  connection: FeedbackConnection,
  artifact: string,
  key: string,
  input: QuestionWrite,
  definitions: readonly DocumentQuestion[],
  revision: string,
  now: number,
): FeedbackTask {
  if (!connection.artifacts.includes(artifact)) feedbackError('connection_unavailable');
  const replay = replayQuestionSubmission(data, connection, artifact, key, input);
  if (replay) return replay;
  const definition = writableQuestion(data, artifact, definitions, input);
  const answer = answerText(input.answer);
  if (!answer) feedbackError('invalid_question_answer', undefined, 400);
  checkOption(definition, answer);
  writeDraft(data, artifact, definition, answer);
  const task = enqueueTask(
    data,
    connection,
    artifact,
    key,
    submissionHash(connection, artifact, input),
    [],
    revision,
    now,
  );
  task.questionId = definition.id;
  task.questionContext = { definition: structuredClone(definition), answer };
  return task;
}

export function withdrawQuestion(task: FeedbackTask, now: number): void {
  if (task.questionId === undefined) feedbackError('invalid_task_transition');
  if (task.state === 'cancelled') return;
  if (!canWithdraw(task)) feedbackError('invalid_task_transition');
  task.state = 'cancelled';
  task.attempt++;
  task.updatedAt = now;
}
