// @vitest-environment happy-dom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  type FeedbackInput,
  readIntent,
  selectableInput,
  storeIntent,
} from '../src/viewer/feedback/api';
import { FeedbackProvider } from '../src/viewer/feedback/FeedbackProvider';
import { feedbackApi } from '../src/viewer/feedback/localApi';
import { useFeedback } from '../src/viewer/feedback/useFeedback';

const input: FeedbackInput = {
  artifact: 'document/demo',
  revision: 'rev-1',
  threads: [{ id: 'thread-1', messages: [{ id: 'm1', text: 'Make the heading clearer' }] }],
  selection: [{ threadId: 'thread-1', messageIds: ['m1'], version: 'version-1' }],
};
const connection = {
  id: 'connection-1',
  displayName: 'Writing Agent',
  artifacts: ['document/demo'],
  enabled: true,
  authorized: true,
};
const task = {
  id: 'task-1',
  connectionId: connection.id,
  submissionKey: 'key-1',
  state: 'queued',
  attempt: 0,
  createdAt: 1,
  inputRevision: 'rev-1',
  needsRecovery: false,
};
let controller: ReturnType<typeof useFeedback>;
let root: Root;
let container: HTMLDivElement;
let fetchMock: ReturnType<typeof vi.fn>;
function Harness(): ReactNode {
  controller = useFeedback('document/demo');
  return null;
}
function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
async function mount() {
  await act(async () => {
    root.render(
      <FeedbackProvider createApi={feedbackApi}>
        <Harness />
      </FeedbackProvider>,
    );
  });
}
async function select() {
  await act(async () => {
    controller.setTarget(connection.id);
    controller.setSelected(['thread-1']);
  });
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  sessionStorage.clear();
  fetchMock = vi.fn(async (url: string) => {
    if (url.endsWith('/connections')) return json({ connections: [connection] });
    if (url.endsWith('/input')) return json(input);
    if (url.endsWith('/tasks')) return json({ tasks: [] });
    return json({ task });
  });
  vi.stubGlobal('fetch', fetchMock);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe('feedback submission boundary', () => {
  it('does not dispatch on load or selection and preserves the exact intent across unknown responses and remounts', async () => {
    await mount();
    await select();
    expect(fetchMock.mock.calls.every(([, init]) => !init || init.method !== 'POST')).toBe(true);
    const sent: string[] = [];
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/submit')) {
        sent.push(init?.body as string);
        throw new TypeError('response lost');
      }
      if (url.endsWith('/connections')) return json({ connections: [connection] });
      if (url.endsWith('/input')) return json(input);
      return json({ tasks: [] });
    });
    await act(async () => {
      await controller.submit();
    });
    expect(controller.error).toBe('network');
    expect(controller.selected).toEqual(['thread-1']);
    const saved = readIntent('document/demo');
    expect(saved?.selection).toEqual(input.selection);
    await act(async () => root.unmount());
    root = createRoot(container);
    await mount();
    await act(async () => {
      await controller.submit();
    });
    expect(sent).toHaveLength(2);
    expect(sent[0]).toBe(sent[1]);
    expect(JSON.parse(sent[1]!).submissionKey).toBe(saved?.submissionKey);
  });

  it('reconciles a lost response from the task list without submitting again', async () => {
    storeIntent('document/demo', {
      connectionId: connection.id,
      submissionKey: task.submissionKey,
      selection: input.selection,
    });
    fetchMock.mockImplementation(async (url: string) =>
      url.endsWith('/tasks')
        ? json({ tasks: [task] })
        : url.endsWith('/input')
          ? json(input)
          : json({ connections: [connection] }),
    );
    await mount();
    expect(controller.intent).toBeNull();
    expect(controller.selected).toEqual([]);
    expect(controller.tasks[0]?.id).toBe(task.id);
    expect(fetchMock.mock.calls).toHaveLength(3);
  });

  it('requires another user submit after feedback_changed, retaining the thread selection', async () => {
    await mount();
    await select();
    let posts = 0;
    const changed = {
      ...input,
      selection: [{ ...input.selection[0]!, version: 'version-2' }],
    };
    fetchMock.mockImplementation(async (url: string) => {
      if (url.endsWith('/submit')) {
        posts++;
        return json({ code: 'feedback_changed' }, 409);
      }
      if (url.endsWith('/input')) return json(changed);
      if (url.endsWith('/tasks')) return json({ tasks: [] });
      return json({ connections: [connection] });
    });
    await act(async () => {
      await controller.submit();
    });
    expect(posts).toBe(1);
    expect(controller.error).toBe('changed');
    expect(controller.selected).toEqual(['thread-1']);
    expect(controller.input?.selection[0]?.version).toBe('version-2');
    expect(controller.intent).toBeNull();
  });

  it('keeps last known tasks and selection after a network failure', async () => {
    fetchMock.mockImplementation(async (url: string) =>
      url.endsWith('/tasks')
        ? json({ tasks: [task] })
        : url.endsWith('/input')
          ? json(input)
          : json({ connections: [connection] }),
    );
    await mount();
    await select();
    fetchMock.mockRejectedValue(new TypeError('offline'));
    await act(async () => {
      await controller.refresh();
    });
    expect(controller.tasks[0]?.id).toBe(task.id);
    expect(controller.selected).toEqual(['thread-1']);
    expect(controller.input?.revision).toBe('rev-1');
    expect(controller.error).toBe('network');
  });

  it('rejects malformed feedback responses without replacing last known data', async () => {
    await mount();
    await select();
    fetchMock.mockResolvedValue(json({ signedIn: false, artifacts: {} }));
    await act(async () => {
      await controller.refresh();
    });
    expect(controller.connections).toEqual([connection]);
    expect(controller.input).toEqual(input);
    expect(controller.selected).toEqual(['thread-1']);
    expect(controller.error).toBe('network');
  });

  it('excludes choice and round control records from new comment submissions', () => {
    const mixed = {
      ...input,
      threads: [
        ...input.threads,
        { id: 'choice', anchor: { choice: 'board' }, messages: [{ id: 'c', text: 'board' }] },
        { id: 'round', anchor: { round: 'r1' }, messages: [{ id: 'r', text: 'Submit r1' }] },
      ],
      selection: [
        ...input.selection,
        { threadId: 'choice', messageIds: ['c'], version: 'c' },
        { threadId: 'round', messageIds: ['r'], version: 'r' },
      ],
    };
    expect(selectableInput(mixed)).toEqual(input.selection);
  });

  it('uses same-origin no-store reads and explicit JSON POST writes', async () => {
    const api = feedbackApi('document/demo');
    await api.tasks();
    await api.pause(connection.id, true);
    expect(fetchMock).toHaveBeenCalledWith('/api/document/demo/feedback/tasks', {
      cache: 'no-store',
      credentials: 'same-origin',
    });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/document/demo/feedback/connections/connection-1/pause',
      expect.objectContaining({ method: 'POST', body: '{}' }),
    );
    expect(() => feedbackApi('../other')).toThrow('Invalid artifact');
  });
});

it('does not send a submission when its key cannot be persisted', async () => {
  await mount();
  await select();
  const storage = vi.spyOn(sessionStorage, 'setItem').mockImplementation(() => {
    throw new Error('storage denied');
  });
  await act(async () => {
    await controller.submit();
  });
  expect(controller.error).toBe('storage');
  expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
  expect(controller.selected).toEqual(['thread-1']);
  storage.mockRestore();
});

it('creates a new key only for a new explicitly submitted batch', async () => {
  await mount();
  await select();
  const keys: string[] = [];
  fetchMock.mockImplementation(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(init.body as string);
    keys.push(body.submissionKey);
    return json({ task: { ...task, submissionKey: body.submissionKey } });
  });
  await act(async () => {
    await controller.submit();
  });
  expect(controller.intent).toBeNull();
  expect(controller.selected).toEqual([]);
  await select();
  await act(async () => {
    await controller.submit();
  });
  expect(keys).toHaveLength(2);
  expect(keys[0]).not.toBe(keys[1]);
});

it('preserves public artifact locators, including uppercase and legacy underscores', async () => {
  await feedbackApi('document/Public_37').tasks();
  expect(fetchMock).toHaveBeenCalledWith(
    '/api/document/Public_37/feedback/tasks',
    expect.objectContaining({ cache: 'no-store' }),
  );
  expect(() => feedbackApi('document/../other')).toThrow();
});

it('clears the queued submission notice once the same task progresses', async () => {
  vi.useFakeTimers();
  await mount();
  await select();
  await act(async () => {
    await controller.submit();
  });
  expect(controller.notice).toBe('submitted');
  fetchMock.mockImplementation(async (url: string) =>
    url.endsWith('/tasks')
      ? json({ tasks: [{ ...task, state: 'awaiting_review' }] })
      : url.endsWith('/input')
        ? json(input)
        : json({ connections: [connection] }),
  );
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5000);
  });
  expect(controller.notice).toBeNull();
  vi.useRealTimers();
});
