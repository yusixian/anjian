// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import { ShareButton } from '../src/viewer/components/ShareButton';

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

let host: HTMLElement;
let root: Root;
let current: { url: string; publishedAt: number; expiresAt: number | null } | null;
let failNext = false;
let failRead = false;
let quotaNext = false;
const posts: Record<string, unknown>[] = [];

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  history.replaceState(null, '', '/artboard/example');
  current = null;
  failNext = false;
  failRead = false;
  quotaNext = false;
  posts.length = 0;
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    if (String(url).startsWith('/api/hub/share?')) {
      if (failRead) return new Response('', { status: 503 });
      return new Response(JSON.stringify({ title: '案间设计', share: current }));
    }
    if (url === '/api/hub/share' && init?.method === 'POST') {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      posts.push(body);
      if (quotaNext) { quotaNext = false; return new Response(JSON.stringify({ code: 'storage_quota_exceeded' }), { status: 413 }); }
      if (failNext) { failNext = false; failRead = true; throw new Error('lost connection'); }
      if (body.action === 'revoke') current = null;
      else current = { url: '/s/published-share', publishedAt: Date.now(), expiresAt: Date.now() + 7 * 86400_000 };
      return new Response(JSON.stringify({ title: '案间设计', share: current }));
    }
    return new Response('', { status: 404 });
  });
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

async function render() {
  await act(async () => root.render(<ShareButton type="artboard" id="example" />));
}
async function click(button: HTMLButtonElement) {
  await act(async () => button.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  await act(async () => {});
}
function button(label: string) {
  const found = [...document.querySelectorAll<HTMLButtonElement>('button')].find((item) => item.textContent?.trim() === label);
  if (!found) throw new Error(`Missing button ${label}`);
  return found;
}

test('publishes only after explicit action; updates without resetting expiry; cancel preserves share', async () => {
  await render();
  await click(document.querySelector<HTMLButtonElement>('button[aria-label="Share"]')!);
  expect(posts).toHaveLength(0);
  const expiry = document.querySelector<HTMLSelectElement>('#share-expiry')!;
  await act(async () => { expiry.value = '30'; expiry.dispatchEvent(new Event('change', { bubbles: true })); });
  await click(button('Create public link'));
  expect(posts[0]).toMatchObject({ type: 'artboard', id: 'example', action: 'publish', expiresInDays: 30 });
  expect(document.body.textContent).toContain('/s/published-share');
  await click(button('Update shared version'));
  expect(posts[1]).toMatchObject({ action: 'publish' });
  expect(posts[1]).not.toHaveProperty('expiresInDays');
  await click(button('Turn off sharing'));
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain('The old link will stop working');
  await click(button('Cancel'));
  expect(posts).toHaveLength(2);
});

test('ambiguous failed revoke blocks repeat until status can be read again', async () => {
  current = { url: '/s/published-share', publishedAt: Date.now(), expiresAt: null };
  await render();
  await click(document.querySelector<HTMLButtonElement>('button[aria-label="Share"]')!);
  await click(button('Turn off sharing'));
  failNext = true;
  await click(button('Turn off sharing'));
  expect(posts).toHaveLength(1);
  expect(button('Turn off sharing').disabled).toBe(true);
  expect(document.querySelector('[role="alert"]')?.textContent).toContain('not confirmed');
});


test('quota rejection explains temporary snapshot space and preserves the existing share', async () => {
  current = { url: '/s/published-share', publishedAt: Date.now(), expiresAt: null };
  await render();
  await click(document.querySelector<HTMLButtonElement>('button[aria-label="Share"]')!);
  quotaNext = true;
  await click(button('Update shared version'));
  expect(document.querySelector('[role="alert"]')?.textContent).toContain('Not enough storage');
  expect(document.querySelector('[role="alert"]')?.textContent).toContain('complete new snapshot');
  expect(document.body.textContent).toContain('/s/published-share');
  expect(button('Turn off sharing').disabled).toBe(false);
});
