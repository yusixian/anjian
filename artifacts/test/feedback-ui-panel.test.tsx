// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { FeedbackPanel } from '../src/viewer/feedback/FeedbackPanel';
import { FeedbackProvider } from '../src/viewer/feedback/FeedbackProvider';
import { feedbackApi } from '../src/viewer/feedback/localApi';
import { i18n } from '../src/viewer/i18n';

vi.mock('@stylexjs/stylex', () => ({ create: (value: unknown) => value, props: () => ({}) }));
vi.mock('@lobehub/ui/stylex/cssVar.stylex', () => ({ cssVar: {} }));
vi.mock('../src/viewer/tokens.stylex', () => ({ brand: {}, color: {} }));

let root: Root;
let container: HTMLDivElement;
let state: string;
let calls: string[];
let enabled: boolean;
const button = (label: string) =>
  [...container.querySelectorAll('button')].find((el) => el.textContent === label)!;
const click = async (label: string) => {
  await act(async () => button(label).click());
};

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  void i18n.changeLanguage('zh');
  sessionStorage.clear();
  state = 'running';
  enabled = true;
  calls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const task = () => ({
        id: 'task-1',
        connectionId: 'c1',
        submissionKey: 'key',
        state,
        attempt: 1,
        createdAt: 1,
        inputRevision: 'before',
        outputRevision: state === 'awaiting_review' ? 'after' : undefined,
        needsRecovery: false,
        operation: {
          stage: 'complete',
          replies: [
            {
              threadId: 't1',
              messageId: 'reply1',
              text: 'Updated the title without changing the data.',
            },
          ],
        },
        threads: [{ id: 't1', messages: [{ id: 'm1', text: 'Submitted title feedback' }] }],
      });
      let data;
      if (url.endsWith('/connections'))
        data = {
          connections: [
            {
              id: 'c1',
              displayName: 'My writing Agent',
              artifacts: ['document/demo'],
              enabled,
              authorized: true,
            },
          ],
        };
      else if (url.endsWith('/input'))
        data = {
          artifact: 'document/demo',
          revision: 'before',
          threads: [{ id: 't1', messages: [{ id: 'm1', text: 'Clarify the title' }] }],
          selection: [{ threadId: 't1', messageIds: ['m1'], version: 'v1' }],
        };
      else if (url.endsWith('/tasks')) data = { tasks: [task()] };
      else {
        if (init?.method === 'POST') calls.push(url);
        if (url.endsWith('/pause')) enabled = false;
        if (url.endsWith('/resume')) enabled = true;
        if (url.endsWith('/cancel')) state = 'cancelled';
        if (url.endsWith('/accept')) state = 'accepted';
        data = { task: task() };
      }
      return new Response(JSON.stringify(data), { status: 200 });
    }),
  );
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
const mount = () =>
  act(async () => {
    root.render(
      <FeedbackProvider createApi={feedbackApi}>
        <FeedbackPanel artifact="document/demo" />
      </FeedbackProvider>,
    );
  });

it('shows the friendly connection and requires independent cancellation confirmation', async () => {
  await mount();
  expect(container.textContent).toContain('My writing Agent');
  expect(container.textContent).toContain('处理中');
  await click('取消任务');
  expect(calls).toEqual([]);
  expect(container.textContent).toContain('不会回滚');
  await click('确认取消任务');
  expect(calls).toEqual(['/api/document/demo/feedback/tasks/task-1/cancel']);
  expect(button('已结束任务（1）').getAttribute('aria-expanded')).toBe('false');
  expect(container.textContent).not.toContain('已取消');
  await click('已结束任务（1）');
  expect(container.textContent).toContain('已取消');
});

it('leaves acceptance as an explicit action separate from completion', async () => {
  state = 'awaiting_review';
  await mount();
  expect(container.textContent).toContain('待验收');
  expect(calls).toEqual([]);
  await click('验收通过');
  expect(calls).toEqual(['/api/document/demo/feedback/tasks/task-1/accept']);
  expect(container.textContent).not.toContain('已验收');
  await click('已结束任务（1）');
  expect(container.textContent).toContain('已验收');
});

it('requires a target and thread selection before enabling submit', async () => {
  await mount();
  expect(button('提交给 Agent').disabled).toBe(true);
  await act(async () => {
    const select = container.querySelector('select')!;
    select.value = 'c1';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  expect(button('提交给 Agent').disabled).toBe(true);
  await act(async () =>
    (container.querySelector('input[type=checkbox]') as HTMLInputElement).click(),
  );
  expect(button('提交给 Agent').disabled).toBe(false);
  expect(calls).toEqual([]);
  expect(container.textContent).toContain('暂停后，当前任务继续');
});

it('renders English task states without claiming that configuration means execution', async () => {
  await i18n.changeLanguage('en');
  state = 'queued';
  await mount();
  expect(container.textContent).toContain('Configured');
  expect(container.textContent).toContain('Waiting for Agent');
  expect(container.textContent).toContain('Execution has not been confirmed');
  expect(container.textContent).not.toContain('In progress');
});

it('shows task context while keeping protocol identifiers in closed diagnostics', async () => {
  state = 'awaiting_review';
  await mount();
  expect(container.querySelector('article')?.textContent).toContain('Submitted title feedback');
  expect(container.querySelector('article time')?.getAttribute('datetime')).toBe(
    '1970-01-01T00:00:00.001Z',
  );
  const diagnostics = container.querySelector('article details')!;
  expect(diagnostics.hasAttribute('open')).toBe(false);
  expect(diagnostics.textContent).toContain('task-1');
  expect(diagnostics.textContent).toContain('after');
  expect(container.querySelector('article')?.textContent).toContain('My writing Agent');
  const management = [...container.querySelectorAll('details')].find(
    (el) => el.querySelector('summary')?.textContent === '管理连接',
  )!;
  expect(management.open).toBe(false);
});

it('copies an artifact-scoped guide without assuming a globally installed CLI', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async (url: string) =>
        new Response(
          JSON.stringify(
            url.endsWith('/connections')
              ? { connections: [] }
              : url.endsWith('/tasks')
                ? { tasks: [] }
                : { artifact: 'document/demo', revision: 'r1', threads: [], selection: [] },
          ),
          { status: 200 },
        ),
    ),
  );
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal('navigator', { clipboard: { writeText } });
  await mount();
  await click('复制接入说明给 Agent');
  expect(writeText).toHaveBeenCalledWith(expect.stringContaining('document/demo'));
  expect(writeText).toHaveBeenCalledWith(expect.stringContaining('不要假定已全局安装 anjian'));
  expect(writeText).toHaveBeenCalledWith(expect.stringContaining('skills get artifacts'));
  expect(container.textContent).toContain('已复制');
});

it('offers selectable guide text if clipboard access fails', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async (url: string) =>
        new Response(
          JSON.stringify(
            url.endsWith('/connections')
              ? { connections: [] }
              : url.endsWith('/tasks')
                ? { tasks: [] }
                : { artifact: 'document/demo', revision: 'r1', threads: [], selection: [] },
          ),
          { status: 200 },
        ),
    ),
  );
  vi.stubGlobal('navigator', {
    clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
  });
  await mount();
  await click('复制接入说明给 Agent');
  expect(container.textContent).toContain('未能复制');
  expect(container.querySelector('textarea')?.value).toContain('document/demo');
});

it('pauses new tasks from secondary management without cancelling current execution', async () => {
  await mount();
  const management = [...container.querySelectorAll('details')].find(
    (el) => el.querySelector('summary')?.textContent === '管理连接',
  )!;
  expect(management.open).toBe(false);
  await act(async () => {
    management.open = true;
  });
  await click('暂停新任务');
  expect(calls).toEqual(['/api/document/demo/feedback/connections/c1/pause']);
  expect(container.querySelector('article')?.textContent).toContain('处理中');
  expect(button('恢复新任务')).toBeDefined();
});

it('shows the task reply when opening the result, with revision hashes kept in diagnostics', async () => {
  state = 'awaiting_review';
  await mount();
  expect(container.textContent).not.toContain('Updated the title without changing the data.');
  await click('查看结果与回复');
  expect(container.textContent).toContain('Updated the title without changing the data.');
  expect(button('查看原批注 / 继续回复')).toBeDefined();
  expect(container.querySelector('article details')?.hasAttribute('open')).toBe(false);
  expect(calls).toEqual([]);
});
