// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import { SharePage } from '../src/viewer/share/SharePage';

const authorView = vi.hoisted(() => ({ props: {} as Record<string, unknown> }));
vi.mock('../src/viewer/layouts/ArtboardView', () => ({ ArtboardView: (props: Record<string, unknown>) => { authorView.props = props; return <div>Shared author workbench</div>; } }));

const token = 'a'.repeat(43);
let host: HTMLElement;
let root: Root | null;
const calls: Array<{ url: string; credentials?: RequestCredentials }> = [];

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  history.replaceState(null, '', `/s/${token}`);
  calls.length = 0;
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root?.unmount());
  host.remove();
  root = null;
  vi.unstubAllGlobals();
});

async function render() {
  await act(async () => { root!.render(<SharePage />); });
  await act(async () => undefined);
}

const fixture = {
  type: 'html', title: 'Published example', publishedAt: Date.now(), expiresAt: null,
  // data: keeps happy-dom's iframe loader local; the browser integration
  // checks the actual preview-origin URL on a running server.
  contentBase: 'data:text/html,',
};

test('anonymous reader fetches only scoped data and embeds published HTML without write capabilities', async () => {
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    calls.push({ url, credentials: init?.credentials });
    return new Response(JSON.stringify(fixture), { status: 200 });
  });
  await render();
  expect(calls).toEqual([{ url: `${location.origin}/s/${token}/data`, credentials: 'omit' }]);
  expect(host.textContent).toContain('Published example');
  const frame = host.querySelector('iframe')!;
  expect(frame.getAttribute('src')).toBe(`${fixture.contentBase}index.html`);
  expect(frame.getAttribute('sandbox')).toBe('allow-scripts');
  expect(frame.getAttribute('referrerpolicy')).toBe('no-referrer');
  expect(host.querySelector('[contenteditable]')).toBeNull();
});

test('expired or closed share removes its content after retry', async () => {
  let live = true;
  vi.stubGlobal('fetch', async () => live
    ? new Response(JSON.stringify(fixture), { status: 200 })
    : new Response('Gone', { status: 404 }));
  await render();
  expect(host.querySelector('iframe')).not.toBeNull();
  live = false;
  await act(async () => window.dispatchEvent(new Event('focus')));
  expect(host.querySelector('iframe')).toBeNull();
  expect(host.textContent).toMatch(/unavailable|无法访问/);
});

test('a transient failure keeps the last snapshot and offers retry', async () => {
  let live = true;
  vi.stubGlobal('fetch', async () => {
    if (!live) throw new Error('network unavailable');
    return new Response(JSON.stringify(fixture), { status: 200 });
  });
  await render();
  live = false;
  await act(async () => window.dispatchEvent(new Event('focus')));
  expect(host.querySelector('iframe')).not.toBeNull();
  expect(host.querySelector('[role="alert"]')).not.toBeNull();
});

test('document resource base does not redirect refresh requests to the preview origin', async () => {
  const base = document.createElement('base');
  base.href = 'https://preview.example/s/token/r/revision/files/';
  document.head.prepend(base);
  try {
    vi.stubGlobal('fetch', async (url: string) => {
      expect(new URL(url, document.baseURI).origin).toBe(location.origin);
      return new Response(JSON.stringify(fixture));
    });
    await render();
    await act(async () => window.dispatchEvent(new Event('focus')));
    expect(host.textContent).toContain('Published example');
  } finally { base.remove(); }
});

test('public artboards use the author workbench with inspection and no write callbacks', async () => {
  vi.stubGlobal('fetch', async () => new Response(JSON.stringify({
    ...fixture, type: 'artboard',
    canvas: { version: 1, pages: [{ id: 'p', name: 'Page' }], boards: {}, activePage: 'p' },
    layout: { pages: { p: { bounds: { minX: 0, minY: 0, maxX: 500, maxY: 500 }, groups: {}, notes: {} } } },
  })));
  await render();
  expect(host.textContent).toContain('Shared author workbench');
  expect(authorView.props.readOnly).toBe(true);
  expect(authorView.props.artifact).toBeNull();
  expect(authorView.props.live).toBe(false);
  expect(authorView.props.send).toBeUndefined();
  expect(authorView.props.comment).toBeUndefined();
  expect(authorView.props.contentBase).toBe(fixture.contentBase);
});
