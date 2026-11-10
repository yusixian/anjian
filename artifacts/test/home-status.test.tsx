// @vitest-environment happy-dom
import { ConfigProvider } from '@lobehub/ui';
import { motion } from 'motion/react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import type { HubStatus } from '../src/shared/hub';
import { formatUptime, hubAction } from '../src/viewer/layouts/home/status-format';
import { StatusPill } from '../src/viewer/layouts/home/StatusPill';

vi.mock('@stylexjs/stylex', async (original) => ({
  ...(await original<object>()),
  create: (value: unknown) => value,
  defineConsts: (value: unknown) => value,
  defineVars: (value: unknown) => value,
  props: () => ({}),
}));
vi.mock('@lobehub/ui/stylex/cssVar.stylex', () => ({
  cssVar: new Proxy({}, { get: (_, key) => `var(--${String(key)})` }),
}));

const status = (): HubStatus => ({
  pid: 1,
  version: '1.0.0',
  startedAt: Date.now() - 3 * 3600_000,
  lastActivity: Date.now(),
  clients: 2,
  port: 27319,
  boardPort: 27329,
  url: 'http://localhost:27319/',
  live: { local: 6 },
  projects: [
    { dir: '/p/anjian', name: 'anjian', lastUsedAt: 0, dormant: false, artifacts: 31 },
    { dir: '/p/old-blog', name: 'old-blog', lastUsedAt: 0, dormant: true, artifacts: 4 },
  ],
});

let root: Root | null = null;
let host: HTMLElement;
const requests: { url: string; method: string; body?: string }[] = [];

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  requests.length = 0;
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    requests.push({ url, method: init?.method ?? 'GET', body: init?.body as string | undefined });
    if (url === '/api/account') return new Response(JSON.stringify({ role: 'owner', login: 'Owner' }));
    if (url === '/api/status') return new Response(JSON.stringify(status()));
    if (url.startsWith('/api/hub/log'))
      return new Response(JSON.stringify({ lines: ['{"project":"/p/anjian"}'] }));
    return new Response(JSON.stringify({ ok: true }), { status: 202 });
  });
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  host.remove();
  vi.unstubAllGlobals();
});

async function render() {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () =>
    root!.render(
      <ConfigProvider enableCustomFonts={false} motion={motion}>
        <StatusPill />
      </ConfigProvider>,
    ),
  );
  await act(async () => {});
}

const button = (name: string) =>
  [...host.querySelectorAll('button')].find((b) => b.textContent?.includes(name));
const click = async (element: Element) => {
  await act(async () => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await act(async () => {});
};

test('the status pill shows a local server without Cloud relay or upstream upgrades', async () => {
  await render();
  const pill = host.querySelector('button[aria-expanded]')!;
  expect(pill.textContent).toContain('v1.0.0');
  expect(pill.textContent).toContain('Local');
  expect(pill.textContent).not.toContain('relay');
  expect(pill.textContent).not.toContain('Update');
  await click(pill);
  const panel = host.querySelector('[role="dialog"]')!;
  expect(panel.textContent).toContain('localhost:27319');
  expect(panel.textContent).toContain('old-blog');
  expect(button('Upgrade and restart')).toBeUndefined();
  await click(button('Restart')!);
  await click(button('Stop')!);
  expect(requests.some((r) => r.url === '/api/hub/stop')).toBe(false);
  await click(button('Cancel')!);
  expect(requests.some((r) => r.url === '/api/hub/stop')).toBe(false);
  await click(button('Stop')!);
  await click(button('Confirm stop')!);
  expect(requests.filter((r) => r.method === 'POST').map((r) => r.url)).toEqual([
    '/api/hub/restart',
    '/api/hub/stop',
  ]);
});

test('removing a project from the panel forgets it', async () => {
  await render();
  await click(host.querySelector('button[aria-expanded]')!);
  await click(host.querySelector('button[aria-label="Remove old-blog"]')!);
  expect(requests.find((r) => r.method === 'DELETE')).toEqual({
    url: '/api/hub/projects',
    method: 'DELETE',
    body: JSON.stringify({ dir: '/p/old-blog' }),
  });
});

test('the log opens from the panel', async () => {
  await render();
  await click(host.querySelector('button[aria-expanded]')!);
  await click(button('View log')!);
  expect(requests.some((r) => r.url === '/api/hub/log')).toBe(true);
  expect(host.querySelector('pre')!.textContent).toContain('/p/anjian');
});

test('uptime reads in days and hours, or hours and minutes', () => {
  expect(formatUptime(3 * 86400_000 + 4 * 3600_000, 'en')).toBe('3d 4h');
  expect(formatUptime(2 * 3600_000 + 5 * 60_000, 'en')).toBe('2h 5m');
  expect(formatUptime(30_000, 'en')).toBe('0m');
});

test('self-hosted status identifies the remote server', async () => {
  vi.stubGlobal('fetch', async (url: string) => new Response(JSON.stringify(url === '/api/account'
    ? { role: 'owner', login: 'Owner' }
    : { ...status(), deployment: 'self-hosted', url: 'https://anjian.cosine.ren' })));
  await render();
  expect(host.querySelector('button[aria-expanded]')!.textContent).toContain('Self-hosted');
});


test('blocked shutdown reports the actionable server message rather than a success notice', async () => {
  const error = '文档尚未保存，服务仍在运行。请在存储设置中检查可用容量与连接后重试。';
  vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ code: 'document_save_blocked', error }), { status: 409 }));
  await expect(hubAction('/api/hub/stop')).rejects.toThrow(error);
  vi.stubGlobal('fetch', async () => new Response('private server detail', { status: 500 }));
  await expect(hubAction('/api/hub/stop')).rejects.toThrow('500');
});
