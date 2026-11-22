import fs from 'node:fs';

import type { BoardThread } from '../shared/board-comments';
import { groupChoice, isChoiceRecord } from '../shared/choices';
import { type ChoiceContext, groupsTouching, type RoundView, roundViews } from './board-choices';

interface RoundSummary {
  choices: Array<{ answer: string; byRecommendation?: boolean; group: string; label?: string }>;
  threads: Array<{ id: string; anchor: string; text?: string }>;
  truncated?: boolean;
}

type RoundRecord = RoundView & { summary?: RoundSummary };

const MAX_ITEMS = 16;
const MAX_BYTES = 3072;

function summarize(context: ChoiceContext, round: RoundView, threads: BoardThread[]): RoundSummary {
  const summary: RoundSummary = { choices: [], threads: [] };
  const clip = (value: string, max: number) => {
    if (value.length <= max) return value;
    const chars = Array.from(value);
    if (chars.length <= max) return value;
    summary.truncated = true;
    return chars.slice(0, max - 1).join('') + '…';
  };
  const append = <T>(list: T[], item: T) => {
    if (list.length === MAX_ITEMS) {
      summary.truncated = true;
      return;
    }
    list.push(item);
    // Reserve room for the flag even when the current item was not shortened.
    if (Buffer.byteLength(JSON.stringify({ ...summary, truncated: true })) > MAX_BYTES) {
      list.pop();
      summary.truncated = true;
    }
  };

  const canvas = context.canvas!;
  for (const group of round.groups) {
    const spec = canvas.groups![group]!;
    const recommendation = typeof spec.recommend === 'string' ? spec.recommend : undefined;
    const { choice, byRecommendation } = groupChoice(threads, group, recommendation);
    if (choice === null) continue;
    const title = canvas.boards[choice]?.title;
    const answer = typeof title === 'string' && title ? title : choice;
    append(summary.choices, {
      group: clip(group, 120),
      ...(typeof spec.title === 'string' && spec.title ? { label: clip(spec.title, 120) } : {}),
      answer: clip(answer, 120),
      ...(byRecommendation ? { byRecommendation } : {}),
    });
  }

  for (const thread of threads) {
    if (
      isChoiceRecord(thread) ||
      !groupsTouching(context, thread.anchor).some((group) => round.groups.includes(group))
    )
      continue;
    const message = [...thread.messages]
      .reverse()
      .find((item) => item.author === 'human' && !item.deleted);
    if (!message) continue;
    const { anchor } = thread;
    const node = anchor.nodes?.find(({ board }) => round.boards.includes(board));
    const label = node
      ? `${node.board} · ${node.path}`
      : (anchor.group ?? anchor.board ?? anchor.page);
    append(summary.threads, {
      id: thread.id,
      anchor: clip(label, 160),
      ...(message.text ? { text: clip(message.text, 240) } : {}),
    });
  }
  return summary;
}

function previousRounds(file: string): RoundRecord[] {
  try {
    const stored = JSON.parse(fs.readFileSync(file, 'utf8')) as { rounds?: RoundRecord[] } | null;
    if (Array.isArray(stored?.rounds)) return stored.rounds;
  } catch {
    // This state file can be regenerated from the current comments and canvas.
  }
  return [];
}

export function roundRecords(file: string, context: ChoiceContext, threads: BoardThread[]) {
  const previous = previousRounds(file);
  return roundViews(context, threads).map((round): RoundRecord => {
    if (!round.submitted) return round;
    const prior = previous.find((record) => record?.id === round.id);
    if (prior?.submitted === round.submitted)
      return prior.summary ? { ...round, summary: prior.summary } : round;
    return { ...round, summary: summarize(context, round, threads) };
  });
}
