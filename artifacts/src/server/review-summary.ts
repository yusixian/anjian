import fs from 'node:fs';
import path from 'node:path';

import { type BoardThread, isChoiceRecord, savedBoardComments } from '../shared/board-comments';
import {
  type Anchor,
  anchorBlockIds,
  type CommentsFile,
  type IncomingComments,
  parseComments,
  savedComments,
  type Thread,
  waitingOn,
} from '../shared/comments';
import { groupVerdict } from '../shared/verdicts';
import { choiceContext, choiceGroups, isDraft, roundViews } from './board-choices';
import { boardHashes, boardSpecs, groupSpecs } from './board-comments';
import { parseDocument } from './document-codec';

type EvidenceHash = (id: string, board: string, source: string) => string;

const openedAt = (thread: BoardThread) => thread.messages[0]?.at ?? thread.statusAt;

function readSaved<A>(
  dir: string,
  decode: (incoming: IncomingComments) => CommentsFile<A>,
  warnings: string[],
): Thread<A>[] {
  let text: string;
  try {
    text = fs.readFileSync(path.join(dir, 'comments.json'), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
      warnings.push('comments.json could not be read.');
    return [];
  }
  try {
    const incoming = parseComments(text);
    const { threads } = decode(incoming);
    const messageCount = (file: IncomingComments) =>
      file.threads.reduce((count, thread) => count + (thread.messages?.length ?? 0), 0);
    if (
      incoming.threads.length !== threads.length ||
      messageCount(incoming) !== messageCount({ threads })
    )
      warnings.push('comments.json contains entries without saved thread or message metadata.');
    return threads;
  } catch {
    warnings.push('comments.json could not be parsed.');
    return [];
  }
}

function visible<A>(thread: Thread<A>) {
  return thread.messages.some((message) => !message.deleted);
}

function describeThread<A>(thread: Thread<A>) {
  return {
    ...thread,
    waitingOn: waitingOn(thread),
    messages: thread.messages.map(({ avatar: _avatar, ...message }) => message),
  };
}

function documentEvidence(dir: string, warnings: string[]) {
  try {
    const state = parseDocument(fs.readFileSync(path.join(dir, 'doc.xml'), 'utf8'));
    const children = state.root.children as { $?: { blockId?: string } }[];
    return new Set(children.flatMap((block) => (block.$?.blockId ? [block.$.blockId] : [])));
  } catch {
    warnings.push('doc.xml could not be read or parsed. Block locations are unverified.');
    return null;
  }
}

function reviewDocument(dir: string, warnings: string[]) {
  const saved = readSaved<Anchor>(dir, savedComments, warnings);
  const blocks = documentEvidence(dir, warnings);
  return {
    threads: saved.filter(visible).map((thread) => ({
      ...describeThread(thread),
      kind: 'document' as const,
      location: {
        file: 'doc.xml',
        blocks: anchorBlockIds(thread.anchor).map((id) => ({
          id,
          status: blocks ? (blocks.has(id) ? 'available' : 'missing') : 'unverified',
        })),
      },
    })),
    groups: [],
    rounds: [],
  };
}

function reviewArtboard(dir: string, id: string, warnings: string[], evidenceHash?: EvidenceHash) {
  const saved = readSaved(dir, savedBoardComments, warnings);
  const context = choiceContext(dir);
  if (!context.canvas)
    warnings.push('canvas.json could not be read or parsed. Canvas locations are unverified.');
  const specs = context.canvas ? boardSpecs(dir) : {};
  const groups = context.canvas ? groupSpecs(dir) : {};
  const hashes = context.canvas ? boardHashes(dir) : {};
  const pages = new Set(context.canvas?.pages.map((page) => page?.id));

  const evidenceStatus = (currentHash?: string, previousHash?: string) => {
    if (!context.canvas) return 'unverified';
    if (!currentHash) return 'missing';
    if (currentHash.endsWith(':preparing')) return 'preparing';
    if (previousHash === undefined) return 'available';
    return currentHash === previousHash ? 'current' : 'changed';
  };

  const evidenceFor = (board: string, previousHash?: string) => {
    const file = Object.hasOwn(specs, board) ? specs[board]?.file : undefined;
    const raw = Object.hasOwn(hashes, board) ? hashes[board] : undefined;
    const currentHash = raw ? (evidenceHash?.(id, board, raw) ?? raw) : undefined;
    return { board, ...(file ? { file } : {}), status: evidenceStatus(currentHash, previousHash) };
  };

  const stale = new Set<string>();
  const threads = saved
    .filter((thread) => visible(thread) && !isChoiceRecord(thread))
    .map((thread) => {
      const { anchor } = thread;
      const group =
        anchor.group && Object.hasOwn(groups, anchor.group) ? groups[anchor.group] : undefined;
      const boards = new Set([
        ...(anchor.board ? [anchor.board] : []),
        ...(anchor.nodes ?? []).map((node) => node.board),
        ...(group?.boards ?? []),
      ]);
      const evidence = [...boards].map((board) => evidenceFor(board, anchor.hashes?.[board]));
      const groupChanged =
        !!anchor.group &&
        !!anchor.hashes &&
        !!context.canvas &&
        (!group ||
          group.boards.length !== Object.keys(anchor.hashes ?? {}).length ||
          group.boards.some((board) => !Object.hasOwn(anchor.hashes ?? {}, board)));
      const changed =
        groupChanged ||
        evidence.some(
          ({ status }) => status === 'changed' || status === 'missing' || status === 'preparing',
        );
      if (
        changed ||
        (anchor.verdict &&
          (!evidence.length || evidence.some(({ status }) => status !== 'current')))
      )
        stale.add(thread.id);
      return {
        ...describeThread(thread),
        kind: 'artboard' as const,
        draft: isDraft(context, thread, saved),
        stale: changed,
        location: {
          canvas: 'canvas.json',
          page: anchor.page,
          pageStatus: context.canvas
            ? pages.has(anchor.page)
              ? 'available'
              : 'missing'
            : 'unverified',
          evidence,
          ...(anchor.nodes?.length ? { nodeStatus: 'unverified' } : {}),
        },
      };
    });

  const latestVerdicts = new Map<string, BoardThread>();
  for (const thread of saved) {
    const group = thread.anchor.group;
    if (!group || !thread.anchor.verdict || !visible(thread) || isChoiceRecord(thread)) continue;
    const prior = latestVerdicts.get(group);
    if (!prior || openedAt(thread) >= openedAt(prior)) latestVerdicts.set(group, thread);
  }

  return {
    threads,
    groups: [
      ...Object.entries(groups)
        .filter(([, group]) => group.verify)
        .map(([groupId, group]) => {
          const { state, ...verdict } = groupVerdict(threads, groupId, stale);
          const latest = latestVerdicts.get(groupId);
          return {
            id: groupId,
            kind: 'verify' as const,
            page:
              group.boards
                .map((board) => (Object.hasOwn(specs, board) ? specs[board]?.page : undefined))
                .find(Boolean) ?? '',
            ...(group.title ? { title: group.title } : {}),
            verdict: state,
            ...verdict,
            boards: group.boards,
            ...(latest ? { verdictThreadId: latest.id } : {}),
            evidence: group.boards.map((board) =>
              evidenceFor(board, latest?.anchor.hashes?.[board]),
            ),
          };
        }),
      ...choiceGroups(context, saved),
    ],
    rounds: roundViews(context, saved),
  };
}

export function reviewSummary(
  dir: string,
  type: 'document' | 'artboard',
  id: string,
  evidenceHash?: EvidenceHash,
) {
  const warnings: string[] = [];
  const content =
    type === 'document'
      ? reviewDocument(dir, warnings)
      : reviewArtboard(dir, id, warnings, evidenceHash);
  const pendingThreads = content.threads.filter(
    (thread) => thread.kind === 'document' || (!thread.draft && thread.anchor.verdict !== 'pass'),
  );
  return {
    type: 'review' as const,
    artifact: `${type}/${id}`,
    empty: !content.threads.length && !content.groups.length && !content.rounds.length,
    ...content,
    pending: {
      agent: pendingThreads.filter((thread) => thread.waitingOn === 'agent').map(({ id }) => id),
      human: pendingThreads.filter((thread) => thread.waitingOn === 'human').map(({ id }) => id),
      verifyGroups: content.groups.flatMap((group) =>
        group.kind === 'verify' && group.verdict !== 'pass' ? [group.id] : [],
      ),
    },
    warnings,
  };
}

export type ReviewSummary = ReturnType<typeof reviewSummary>;
