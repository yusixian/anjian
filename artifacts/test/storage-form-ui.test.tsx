// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { StoragePage } from '../src/viewer/layouts/storage/StoragePage';
vi.mock('@stylexjs/stylex', async (original) => ({ ...(await original<object>()), create: (value: unknown) => value, defineConsts: (value: unknown) => value, defineVars: (value: unknown) => value, props: () => ({}) }));
vi.mock('@lobehub/ui/stylex/cssVar.stylex', () => ({ cssVar: new Proxy({}, { get: (_, key) => `var(--${String(key)})` }) }));
vi.mock('@lobehub/ui', () => ({ Button: ({ children, htmlType, loading: _loading, type: _type, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { htmlType?: 'submit' | 'button'; loading?: boolean }) => <button {...props} type={htmlType ?? 'button'}>{children}</button> }));
vi.mock('../src/viewer/hooks/useAccount', () => ({ useAccount: () => ({ role: 'member', quotaBytes: 0 }) }));
vi.mock('../src/viewer/layouts/storage/StorageMigration', () => ({ StorageMigration: () => null }));
let host: HTMLElement, root: Root;
const posts: Record<string, unknown>[] = [];
let finish: (() => void) | undefined;
let hold = false;
const profile = { id: 'saved', endpoint: 'https://objects.example', bucket: 'bucket', region: 'auto', prefix: 'anjian', forcePathStyle: true, credentialsConfigured: true };
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); posts.length = 0; hold = false;
  vi.stubGlobal('fetch', async (_url: string, init?: RequestInit) => {
    if (init?.method === 'POST') {
      posts.push(JSON.parse(String(init.body)));
      if (hold) await new Promise<void>(resolve => { finish = resolve; });
    }
    return new Response(JSON.stringify({ profile, backend: 'local', usage: null, configured: true }));
  });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<StoragePage />));
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
const button = (text: string) => [...host.querySelectorAll('button')].find(b => b.textContent === text)!;
async function input(element: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
test('saved blank credentials can save and test without resending secrets', async () => {
  expect([...host.querySelectorAll('input[type=password]')].slice(0, 2).every(i => (i as HTMLInputElement).placeholder.includes('Saved'))).toBe(true);
  await act(async () => host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  expect(posts[0]).toMatchObject({ action: 'save' }); expect(posts[0]).not.toHaveProperty('credentials');
  await act(async () => button('Test connection').click());
  expect(posts[1]).toEqual({ action: 'test', id: 'saved' });
});
test('editing then reverting credentials does not leave connection testing disabled', async () => {
  const field = host.querySelector<HTMLInputElement>('input[type=password]')!;
  await input(field, 'replacement');
  await act(async () => button('Test connection').click());
  expect(posts).toHaveLength(0);
  expect(host.querySelector('form [role=alert]')).not.toBeNull();
  await input(field, '');
  await act(async () => button('Test connection').click());
  expect(posts).toEqual([{ action: 'test', id: 'saved' }]);
});
test('test progress appears beside the action and repeated clicks do not send duplicate requests', async () => {
  hold = true;
  await act(async () => button('Test connection').click());
  expect(host.querySelector('form [role=status]')).not.toBeNull();
  expect(button('Test connection').disabled).toBe(true);
  await act(async () => button('Test connection').click());
  expect(posts).toHaveLength(1);
  await act(async () => finish!());
  expect(button('Test connection').disabled).toBe(false);
});
