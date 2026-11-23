// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, test, vi } from 'vitest';

import { VerificationRuns } from '../src/viewer/document/VerificationRuns';

vi.mock('@stylexjs/stylex', async (original) => ({
  ...(await original<object>()),
  create: (value: unknown) => value,
  props: () => ({}),
}));
vi.mock('@lobehub/ui/stylex/cssVar.stylex', () => ({
  cssVar: new Proxy({}, { get: (_, key) => `var(--${String(key)})` }),
}));

test('an open verification panel explains when its checks become unavailable', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  let available = true;
  vi.stubGlobal('fetch', async (_url: string, init?: RequestInit) => {
    if (init?.method === 'POST') available = false;
    return available
      ? Response.json({ checks: [{ id: 'smoke', title: 'Smoke' }], running: null, runs: [] })
      : new Response(null, { status: 404 });
  });
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () =>
      root.render(<VerificationRuns documentId="plan" onRefreshReport={vi.fn()} />),
    );
    await act(async () => host.querySelector<HTMLButtonElement>('button')!.click());
    const dialog = host.querySelector('dialog')!;
    await act(async () => dialog.querySelector<HTMLButtonElement>('ul button')!.click());
    expect(dialog.open).toBe(true);
    expect(dialog.querySelector('[role="status"]')?.textContent).toBeTruthy();
    expect(dialog.querySelector('ul')).toBeNull();
    expect(document.activeElement).toBe(dialog.querySelector('header button:last-child'));
    await act(async () =>
      dialog.querySelector<HTMLButtonElement>('header button:last-child')!.click(),
    );
    expect(host.querySelector('button')).toBeNull();
  } finally {
    act(() => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});
