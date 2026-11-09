// @vitest-environment happy-dom
import { ConfigProvider, ContextMenuHost } from '@lobehub/ui';
import { motion } from 'motion/react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import type { HubArtifactList } from '../src/shared/hub';
import type { TrashEntry } from '../src/shared/trash';
import { THUMBNAIL_PATH } from '../src/shared/thumbnail';
import { ArtifactList } from '../src/viewer/layouts/ArtifactList';

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

const project = (dir: string, dormant = false) => ({
  dir,
  name: dir.split('/').pop()!,
  lastUsedAt: 0,
  dormant,
  artifacts: 0,
});

const hubList = (): HubArtifactList => ({
  warnings: [],
  projects: [project('/p/two'), project('/p/one'), project('/p/old', true)],
  artifacts: [
    {
      project: '/p/two',
      type: 'artboard',
      id: 'pricing',
      title: 'Pricing page',
      updatedAt: 300,
      url: '/artboard/AAAAAAAAAAAAAAAAAAAAA',
    },
    {
      project: '/p/one',
      type: 'document',
      id: 'signup',
      title: 'Signup flow',
      updatedAt: 200,
      url: '/document/BBBBBBBBBBBBBBBBBBBBB',
    },
    {
      project: '/p/old',
      type: 'html',
      id: 'legacy',
      title: 'Legacy tuner',
      updatedAt: 100,
      url: '/html/CCCCCCCCCCCCCCCCCCCCC',
    },
  ],
});

let root: Root | null = null;
let host: HTMLElement;
const deleted: unknown[] = [];

class FakeSocket {
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: (() => void) | null = null;
  close() {}
  send() {}
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('WebSocket', FakeSocket);
  history.replaceState(null, '', '/');
  deleted.length = 0;
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    if (url === '/api/hub/artifacts') return new Response(JSON.stringify(hubList()));
    if (url === '/api/hub/trash' && !init?.method) return new Response(JSON.stringify({ entries: [], deployment: 'local' }));
    if (url === '/api/hub/projects' && init?.method === 'DELETE') {
      deleted.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify({ removed: true }));
    }
    return new Response('{}', { status: 404 });
  });
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  host.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function render() {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () =>
    root!.render(
      <ConfigProvider enableCustomFonts={false} motion={motion}>
        <ArtifactList />
        <ContextMenuHost />
      </ConfigProvider>,
    ),
  );
  await act(async () => {});
}

const cards = () =>
  [...host.querySelectorAll('ul[aria-label] a[aria-label]')].map((a) =>
    a.getAttribute('aria-label'),
  );
const button = (name: string) =>
  [...document.body.querySelectorAll('button')].find((b) => b.textContent?.includes(name))!;
const click = async (element: Element) => {
  await act(async () => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
};
const type = async (input: HTMLInputElement, value: string) => {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
};

test('recent lists every project newest first, with each card naming its project', async () => {
  await render();
  expect(cards()).toEqual(['Open Pricing page', 'Open Signup flow', 'Open Legacy tuner']);
  expect(host.querySelector('ul[aria-label]')!.textContent).toContain('two');
});

test('a card thumbnail URL changes when the drawing version changes, not only the artifact', async () => {
  await render();
  const src = host.querySelector('a[aria-label="Open Signup flow"] img')!.getAttribute('src');
  expect(src).toBe(`/api/thumbnail/document/BBBBBBBBBBBBBBBBBBBBB.svg?v=200&d=${THUMBNAIL_PATH}`);
});

test('picking a project shows only its artifacts', async () => {
  await render();
  await click(button('one'));
  expect(cards()).toEqual(['Open Signup flow']);
});

test('dormant projects stay folded until opened', async () => {
  await render();
  expect(button('old')).toBeUndefined();
  await click(button('Dormant'));
  expect(button('old')).toBeDefined();
});

test('searching all projects reaches past the picked project', async () => {
  await render();
  await click(button('one'));
  const search = host.querySelector<HTMLInputElement>('input[type="search"]')!;
  await type(search, 'pric');
  expect(cards()).toEqual([]);
  await click(button('All projects'));
  expect(cards()).toEqual(['Open Pricing page']);
});

test('right-clicking a project offers to remove it', async () => {
  await render();
  await act(async () => {
    button('one').dispatchEvent(
      new MouseEvent('contextmenu', { bubbles: true, clientX: 10, clientY: 10 }),
    );
  });
  const item = [...document.body.querySelectorAll('[role="menuitem"]')].find((el) =>
    el.textContent?.includes('Remove from list'),
  )!;
  await click(item);
  await act(async () => {});
  expect(deleted).toEqual([{ dir: '/p/one' }]);
});

test('⌘K opens a palette grouped by project, ⌘↵ opens a new tab', async () => {
  await render();
  await act(async () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true }));
  });
  const dialog = document.body.querySelector('[role="dialog"]')!;
  expect(dialog).not.toBeNull();
  const headings = [...dialog.querySelectorAll('[role="group"]')].map((g) =>
    g.getAttribute('aria-label'),
  );
  expect(headings).toEqual(['two', 'one', 'old']);
  const input = dialog.querySelector<HTMLInputElement>('input')!;
  await type(input, 'signup');
  const opened = vi.spyOn(window, 'open').mockReturnValue(null);
  await act(async () => {
    input.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', metaKey: true, bubbles: true }),
    );
  });
  expect(opened).toHaveBeenCalledWith('/document/BBBBBBBBBBBBBBBBBBBBB', '_blank');
});

test('selection mode toggles cards and clears choices when the search changes', async () => {
  await render();
  await click(button('Select'));
  expect(cards()).toEqual([]);
  await click(host.querySelector('button[aria-label="Toggle selection: Pricing page"]')!);
  expect(host.querySelector('[role="toolbar"]')!.textContent).toContain('1 selected');
  await type(host.querySelector<HTMLInputElement>('input[type="search"]')!, 'signup');
  expect(host.querySelector('[role="toolbar"]')!.textContent).toContain('0 selected');
  expect(host.querySelector('button[aria-label="Toggle selection: Signup flow"]')).not.toBeNull();
});

test('confirmed move posts only frozen selected targets and offers Undo', async () => {
  const entry: TrashEntry = {
    ...hubList().artifacts[0]!, trashId: 'removed-pricing', deletedAt: Date.now(),
    expiresAt: Date.now() + 30 * 86400_000,
  };
  const posted: unknown[] = [];
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    if (url === '/api/hub/artifacts') return new Response(JSON.stringify(hubList()));
    if (url === '/api/hub/trash' && init?.method === 'POST') {
      posted.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify({ results: [{ key: `${entry.project}\n${entry.url}`, ok: true, entry }] }));
    }
    if (url === '/api/hub/trash') return new Response(JSON.stringify({ entries: [entry], deployment: 'local' }));
    return new Response('{}', { status: 404 });
  });
  await render();
  await click(button('Select'));
  await click(host.querySelector('button[aria-label="Toggle selection: Pricing page"]')!);
  await click(button('Move to Trash'));
  expect(host.querySelector('[role="dialog"]')!.textContent).toContain('Pricing page');
  expect(posted).toHaveLength(0);
  await click(button('Move 1 to Trash'));
  await act(async () => {});
  expect(posted).toEqual([{ items: [{
    project: entry.project, type: entry.type, id: entry.id, url: entry.url,
  }] }]);
  expect(host.textContent).toContain('1 artifacts moved to Trash');
  expect(button('Undo')).toBeDefined();
});

test('a partial Trash listing is reported as an error instead of an empty bin', async () => {
  vi.stubGlobal('fetch', async (url: string) => {
    if (url === '/api/hub/artifacts') return new Response(JSON.stringify(hubList()));
    if (url === '/api/hub/trash') return new Response(JSON.stringify({
      entries: [], warnings: ['One project could not be read'], deployment: 'local',
    }));
    return new Response('{}', { status: 404 });
  });
  await render();
  await click(button('Trash'));
  expect(host.textContent).toContain('Could not load Trash');
  expect(host.textContent).not.toContain('Trash is empty');
});

test('retry failed items never includes a newly selected artifact', async () => {
  const first = hubList().artifacts[0]!;
  const posted: unknown[] = [];
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    if (url === '/api/hub/artifacts') return new Response(JSON.stringify(hubList()));
    if (url === '/api/hub/trash' && init?.method === 'POST') {
      posted.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify({ results: [{ key: `${first.project}\n${first.url}`, ok: false, code: 'CONFLICT' }] }));
    }
    if (url === '/api/hub/trash') return new Response(JSON.stringify({ entries: [], deployment: 'local' }));
    return new Response('{}', { status: 404 });
  });
  await render();
  await click(button('Select'));
  await click(host.querySelector('button[aria-label="Toggle selection: Pricing page"]')!);
  await click(button('Move to Trash'));
  await click(button('Move 1 to Trash'));
  await act(async () => {});
  await click(host.querySelector('button[aria-label="Toggle selection: Signup flow"]')!);
  expect(host.querySelector('[role="toolbar"]')!.textContent).toContain('2 selected');
  await click(button('Retry failed items'));
  const dialog = host.querySelector('[role="dialog"]')!;
  expect(dialog.textContent).toContain('Pricing page');
  expect(dialog.textContent).not.toContain('Signup flow');
  expect(posted).toHaveLength(1);
});
