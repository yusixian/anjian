import path from 'node:path';

import type { BoardThread } from '../../shared/board-comments';
import { isChoiceRecord } from '../../shared/choices';
import type {
  FeedbackConnection,
  FeedbackRoundContext,
  FeedbackRoundInput,
} from '../../shared/feedback';
import { choiceContext, choiceGroups, groupsTouching, roundViews } from '../board-choices';
import { type FeedbackData, feedbackError, hash } from './store';
import { enqueueTask } from './tasks';

export function feedbackRounds(
  project: string,
  id: string,
  threads: BoardThread[],
  revision: string,
) {
  const context = choiceContext(path.join(project, '.anjian', 'artifacts', 'artboard', id));
  if (!context.canvas) feedbackError('invalid_round_canvas');
  const groups = choiceGroups(context, threads);
  return roundViews(context, threads).map((round) => {
    const ordinary = threads.filter(
      (t) =>
        !isChoiceRecord(t) &&
        t.messages.some((m) => !m.deleted) &&
        groupsTouching(context, t.anchor).some((group) => round.groups.includes(group)),
    );
    const choices = threads.filter(
      (t) =>
        isChoiceRecord(t) &&
        (t.anchor.round === round.id ||
          (t.anchor.group !== undefined && round.groups.includes(t.anchor.group))),
    );
    const snapshot: FeedbackRoundContext = {
      id: round.id,
      page: round.page,
      state: round.state,
      ...(round.title ? { title: round.title } : {}),
      groups: groups
        .filter((g) => round.groups.includes(g.id))
        .map(({ round: _round, page: _page, kind: _kind, threads: _count, ...group }) => ({
          ...group,
          threadIds: ordinary
            .filter((t) => groupsTouching(context, t.anchor).includes(group.id))
            .map((t) => t.id),
        })),
      canvas: context.canvas!,
      threads: ordinary,
      choiceRecords: choices,
    };
    const inputs = ordinary.filter((t) => t.status === 'open');
    const preview: FeedbackRoundInput = {
      id: snapshot.id,
      page: snapshot.page,
      state: snapshot.state,
      groups: snapshot.groups,
      ...(snapshot.title ? { title: snapshot.title } : {}),
      version: hash({ snapshot, revision }),
      threadCount: inputs.length,
    };
    return { snapshot, preview, inputs };
  });
}
export function roundSubmissionHash(
  connectionId: string,
  artifact: string,
  round: { id: string; version: string },
) {
  return hash({ connectionId, artifact, round });
}
export function submitRound(
  data: FeedbackData,
  connection: FeedbackConnection,
  artifact: string,
  key: string,
  requested: { id: string; version: string },
  rounds: ReturnType<typeof feedbackRounds>,
  revision: string,
  now: number,
) {
  if (!connection.artifacts.includes(artifact)) feedbackError('connection_unavailable');
  if (
    data.tasks.some(
      (t) => t.artifact === artifact && t.roundId === requested.id && t.state !== 'cancelled',
    )
  )
    feedbackError('round_already_submitted');
  const current = rounds.find((r) => r.preview.id === requested.id);
  if (!current || current.preview.version !== requested.version) feedbackError('feedback_changed');
  if (current!.preview.state !== 'open') feedbackError('round_not_open');
  if (current!.snapshot.groups.some((g) => g.choice !== null && !g.boards.includes(g.choice)))
    feedbackError('round_choice_invalid');
  const task = enqueueTask(
    data,
    connection,
    artifact,
    key,
    roundSubmissionHash(connection.id, artifact, requested),
    current!.inputs,
    revision,
    now,
  );
  task.roundId = requested.id;
  task.roundContext = structuredClone(current!.snapshot);
  return task;
}
