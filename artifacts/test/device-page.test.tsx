// @vitest-environment happy-dom
import { ConfigProvider } from '@lobehub/ui';
import { motion } from 'motion/react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import type { RemoteDevicesResponse, RemotePairingResponse } from '../src/shared/devices';
import { DevicePage } from '../src/viewer/layouts/DevicePage';

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

const code = 'ABCD-EFGH-JKLM';
const devices = (): RemoteDevicesResponse => ({
  devices: [{ id: 'device-1', name: 'MacBook', projects: ['project'], createdAt: Date.now(), expiresAt: Date.now() + 30 * 86400_000 }],
  projects: [{ id: 'project', name: 'Design project' }],
  origin: 'https://anjian.example',
});
const pairing = (): RemotePairingResponse => ({
  pairing: { code, name: 'MacBook', expiresAt: Date.now() + 5 * 60_000 },
  projects: [{ id: 'project', name: 'Design project' }],
});

let root: Root | null = null;
let host: HTMLElement;
let revoked = false;
const posts: { url: string; body: unknown }[] = [];

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  history.replaceState(null, '', '/devices');
  posts.length = 0;
  revoked = false;
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    if (url === '/api/remote/auth/devices') return new Response(JSON.stringify({ ...devices(), devices: revoked ? [] : devices().devices }));
    if (url.startsWith('/api/remote/auth/pairing?')) return new Response(JSON.stringify(pairing()));
    if (init?.method === 'POST') {
      posts.push({ url, body: JSON.parse(String(init.body)) });
      if (url.endsWith('/revoke')) { revoked = true; return new Response(JSON.stringify({ revoked: true })); }
      if (url.endsWith('/approve')) return new Response(JSON.stringify({ approved: true }));
      if (url.endsWith('/deny')) return new Response(JSON.stringify({ denied: true }));
    }
    return new Response('{}', { status: 404 });
  });
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  host.remove();
  vi.unstubAllGlobals();
});

async function render(connect: boolean) {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root!.render(
    <ConfigProvider enableCustomFonts={false} motion={motion}><DevicePage connect={connect} /></ConfigProvider>,
  ));
  await act(async () => {});
}

const button = (text: string) => [...host.querySelectorAll('button')].find((item) => item.textContent?.trim() === text)!;
const click = async (element: Element) => {
  await act(async () => element.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  await act(async () => {});
};

test('lists real device and project names and shows the local CLI guide', async () => {
  await render(false);
  expect(host.textContent).toContain('MacBook');
  expect(host.textContent).toContain('Design project');
  await click(button('Connection guide'));
  expect(host.textContent).toContain('anjian login https://anjian.example');
  expect(host.textContent).toContain('anjian link');
  expect(host.textContent).toContain('anjian push --artifact document/plan');
});

test('revoke confirmation names the device and projects, cancels safely, then refreshes', async () => {
  await render(false);
  await click(button('Revoke'));
  expect(host.querySelector('[role="dialog"]')!.textContent).toContain('MacBook');
  expect(host.querySelector('[role="dialog"]')!.textContent).toContain('Design project');
  await click(button('Cancel'));
  expect(posts).toHaveLength(0);
  await click(button('Revoke'));
  await click(button('Revoke access'));
  expect(posts).toEqual([{ url: '/api/remote/auth/revoke', body: { id: 'device-1' } }]);
  expect(host.textContent).toContain('No authorized devices');
});

test('pairing URL previews an actual request but does not preselect projects', async () => {
  history.replaceState(null, '', `/connect?code=${code}`);
  await render(true);
  expect(host.textContent).toContain('MacBook');
  expect(host.textContent).toContain('Design project');
  expect(host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.checked).toBe(false);
  expect(button('Approve connection').disabled).toBe(true);
  await act(async () => host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
  await click(button('Approve connection'));
  expect(posts).toEqual([{ url: '/api/remote/auth/approve', body: { code, projects: ['project'] } }]);
  expect(host.textContent).toContain('Device authorized');
});

test('invalid local code never requests a pairing and expired API code shows recovery', async () => {
  let calls = 0;
  vi.stubGlobal('fetch', async () => { calls++; return new Response(JSON.stringify({ error: 'expired' }), { status: 410 }); });
  history.replaceState(null, '', '/connect?code=bad');
  await render(true);
  expect(host.textContent).toContain('wrong format');
  expect(calls).toBe(0);
  const input = host.querySelector<HTMLInputElement>('#pair-code')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, code);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await click(button('Preview device'));
  expect(calls).toBe(1);
  expect(host.textContent).toContain('invalid or expired');
});

test('a delayed pairing response cannot restore a preview after the code changes', async () => {
  let resolveRequest!: (response: Response) => void;
  vi.stubGlobal('fetch', () => new Promise<Response>((resolve) => { resolveRequest = resolve; }));
  history.replaceState(null, '', `/connect?code=${code}`);
  await render(true);
  const input = host.querySelector<HTMLInputElement>('#pair-code')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'bad');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => resolveRequest(new Response(JSON.stringify(pairing()))));
  expect(host.textContent).not.toContain('Projects this device can access');
  expect(host.querySelector('input[type="checkbox"]')).toBeNull();
  expect(new URLSearchParams(location.search).has('code')).toBe(false);
});
