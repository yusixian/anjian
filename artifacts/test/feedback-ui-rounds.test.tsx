// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import type { BoardHumanOp } from '../src/shared/board-comments';
import { FeedbackProvider } from '../src/viewer/feedback/FeedbackProvider';
import { feedbackApi } from '../src/viewer/feedback/localApi';
import { useChoices } from '../src/viewer/hooks/useChoices';

const canvas = {
  version: 1,
  pages: [{ id: 'p', name: 'Page' }],
  boards: {
    a: { page: 'p', x: 0, y: 0, w: 200, h: 120, file: 'a.html' },
    b: { page: 'p', x: 220, y: 0, w: 200, h: 120, file: 'b.html' },
  },
  groups: { g: { boards: ['a', 'b'], choose: true } },
};
const layout = {
  pages: {
    p: {
      bounds: { minX: 0, minY: 0, maxX: 420, maxY: 120 },
      groups: { g: { x: 0, y: 0, w: 420, h: 120 } },
      notes: {},
    },
  },
};
let root: Root;
let host: HTMLDivElement;
let choices: ReturnType<typeof useChoices>;
let connected: boolean;
let authorized: boolean;
let paused: boolean;
let lost: boolean;
let unavailable: boolean;
let changed: boolean;
let version: string;
let state: string;
let task: Record<string, unknown> | null;
let posts: { path: string; body: Record<string, unknown> }[];
let comment: ReturnType<typeof vi.fn<(op: BoardHumanOp) => Promise<unknown>>>;
let fetchMock: ReturnType<typeof vi.fn>;
function Harness() {
  choices = useChoices({
    artifact: 'artboard/demo',
    canvas,
    layout,
    page: 'p',
    threads: [],
    listening: true,
    comment,
  });
  return null;
}
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
const mount = () =>
  act(async () => {
    root.render(
      <FeedbackProvider createApi={feedbackApi}>
        <Harness />
      </FeedbackProvider>,
    );
  });
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  sessionStorage.clear();
  connected = true;
  authorized = true;
  paused = false;
  lost = false;
  unavailable = false;
  changed = false;
  version = 'v1';
  state = 'open';
  task = null;
  posts = [];
  comment = vi.fn<(op: BoardHumanOp) => Promise<unknown>>().mockResolvedValue({});
  fetchMock = vi.fn(async (path: string, init?: RequestInit) => {
    if (unavailable) throw new TypeError('offline');
    if (init?.method === 'POST') {
      const body = JSON.parse(init.body as string);
      posts.push({ path, body });
      if (path.endsWith('/cancel')) {
        task = { ...task!, state: 'cancelled' };
        state = 'open';
        return json({ task });
      }
      if (changed) {
        version = 'v2';
        return json({ code: 'feedback_changed' }, 409);
      }
      if (lost) throw new TypeError('lost response');
      task = {
        id: 'round-task',
        connectionId: 'c1',
        submissionKey: body.submissionKey,
        roundId: 'page:p',
        state: 'queued',
        createdAt: 1,
        attempt: 0,
        needsRecovery: false,
        inputRevision: 'rev1',
      };
      state = 'submitted';
      return json({ task });
    }
    if (path.endsWith('/connections'))
      return json({
        connections: connected
          ? [
              {
                id: 'c1',
                displayName: 'Round Agent',
                artifacts: ['artboard/demo'],
                enabled: !paused,
                authorized,
              },
            ]
          : [],
      });
    if (path.endsWith('/tasks')) return json({ tasks: task ? [task] : [] });
    return json({
      artifact: 'artboard/demo',
      revision: 'rev1',
      threads: [],
      selection: [],
      rounds: [
        {
          id: 'page:p',
          version,
          page: 'p',
          state,
          threadCount: 0,
          groups: [
            {
              id: 'g',
              boards: ['a', 'b'],
              choice: 'a',
              byRecommendation: false,
              threadIds: [],
            },
          ],
        },
      ],
    });
  });
  vi.stubGlobal('fetch', fetchMock);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

it('submits a choice-only round once without a legacy marker or selection payload', async () => {
  await mount();
  await act(async () => {
    choices.submit();
  });
  expect(posts).toHaveLength(1);
  expect(posts[0]?.body).toMatchObject({
    connectionId: 'c1',
    round: { id: 'page:p', version: 'v1' },
  });
  expect(posts[0]?.body).not.toHaveProperty('selection');
  expect(comment).not.toHaveBeenCalled();
  expect(choices.current?.state).toBe('submitted');
  expect(choices.boardChoice('b')?.disabled).toBe(true);
  await act(async () => {
    choices.submit();
  });
  expect(posts).toHaveLength(1);
});

it('reuses an unknown round submission across retry and remount', async () => {
  lost = true;
  await mount();
  await act(async () => {
    choices.submit();
  });
  expect(choices.feedback.intent?.round).toEqual({ id: 'page:p', version: 'v1' });
  expect(choices.boardChoice('b')?.disabled).toBe(true);
  await act(async () => root.unmount());
  root = createRoot(host);
  await mount();
  await act(async () => {
    choices.submit();
  });
  expect(posts).toHaveLength(2);
  expect(posts[0]?.body).toEqual(posts[1]?.body);
  expect(comment).not.toHaveBeenCalled();
});

it('reconciles an unknown submission from its task receipt without sending again', async () => {
  lost = true;
  await mount();
  await act(async () => {
    choices.submit();
  });
  const intent = choices.feedback.intent!;
  task = {
    id: 'receipt',
    roundId: 'page:p',
    connectionId: 'c1',
    submissionKey: intent.submissionKey,
    state: 'running',
    createdAt: 1,
  };
  state = 'submitted';
  await act(async () => {
    await choices.feedback.refresh();
  });
  expect(choices.feedback.intent).toBeNull();
  expect(choices.feedback.taskFor('page:p')?.state).toBe('running');
  expect(posts).toHaveLength(1);
});

it('only uses the legacy marker after a successful no-connection query', async () => {
  connected = false;
  await mount();
  expect(choices.feedback.mode).toBe('legacy');
  await act(async () => {
    choices.submit();
  });
  expect(posts).toHaveLength(0);
  expect(comment).toHaveBeenCalledWith(
    expect.objectContaining({
      anchor: expect.objectContaining({ round: 'page:p', submit: true }),
    }),
  );
});

it('does not fall back to a legacy marker when connection discovery fails', async () => {
  unavailable = true;
  await mount();
  expect(choices.feedback.mode).toBe('blocked');
  await act(async () => {
    choices.submit();
  });
  expect(posts).toHaveLength(0);
  expect(comment).not.toHaveBeenCalled();
});

it('queues through a paused connection and never falls back for revoked authorization', async () => {
  paused = true;
  await mount();
  await act(async () => {
    choices.submit();
  });
  expect(posts).toHaveLength(1);
  expect(comment).not.toHaveBeenCalled();
  await act(async () => root.unmount());
  root = createRoot(host);
  task = null;
  state = 'open';
  authorized = false;
  posts = [];
  await mount();
  expect(choices.feedback.mode).toBe('connected');
  await act(async () => {
    choices.submit();
  });
  expect(posts).toHaveLength(0);
  expect(comment).not.toHaveBeenCalled();
});

it('requires fresh confirmation after feedback_changed and uses the new server version', async () => {
  changed = true;
  await mount();
  await act(async () => {
    choices.submit();
  });
  expect(posts).toHaveLength(1);
  expect(choices.feedback.intent).toBeNull();
  expect(choices.feedback.error).toBe('changed');
  changed = false;
  await act(async () => {
    await choices.feedback.refresh();
  });
  await act(async () => {
    choices.submit();
  });
  expect(posts[1]?.body.round).toEqual({ id: 'page:p', version: 'v2' });
  expect(posts[0]?.body.submissionKey).not.toBe(posts[1]?.body.submissionKey);
});

it('cancellation unlocks the round and a new explicit submission gets a new key', async () => {
  await mount();
  await act(async () => {
    choices.submit();
  });
  const oldKey = posts[0]?.body.submissionKey;
  await act(async () => {
    await choices.feedback.cancel('round-task');
  });
  expect(choices.boardChoice('a')?.disabled).toBe(false);
  await act(async () => {
    choices.submit();
  });
  expect(posts.at(-1)?.body.submissionKey).not.toBe(oldKey);
  expect(comment).not.toHaveBeenCalled();
});

it('keeps accepted rounds locked', async () => {
  task = {
    id: 'accepted',
    roundId: 'page:p',
    connectionId: 'c1',
    submissionKey: 'old',
    state: 'accepted',
    createdAt: 1,
  };
  state = 'submitted';
  await mount();
  expect(choices.boardChoice('a')?.disabled).toBe(true);
  await act(async () => {
    choices.submit();
  });
  expect(posts).toHaveLength(0);
  expect(comment).not.toHaveBeenCalled();
});

it('keeps embedded choice controls local without an injected feedback API', async () => {
  const fetchMock = vi.mocked(fetch);
  fetchMock.mockClear();
  await act(async () => {
    root.render(<Harness />);
  });
  expect(choices.feedback.mode).toBe('legacy');
  expect(fetchMock).not.toHaveBeenCalled();
});
