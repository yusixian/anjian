// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { ServerDisk } from '../src/viewer/layouts/storage/ServerDisk';
vi.mock('@stylexjs/stylex', async (original) => ({ ...(await original<object>()),
  create: (value: unknown) => value, defineConsts: (value: unknown) => value, defineVars: (value: unknown) => value, props: () => ({}) }));
vi.mock('@lobehub/ui/stylex/cssVar.stylex', () => ({ cssVar: new Proxy({}, { get: (_, key) => `var(--${String(key)})` }) }));
vi.mock('@lobehub/ui', () => ({ Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props}>{children}</button> }));

let host: HTMLElement;
let root: Root;
let fail = false;
const report = { volumes: [{ total: 80 * 1024 ** 3, used: 76 * 1024 ** 3, available: 3 * 1024 ** 3, reserved: 1024 ** 3 }], checkedAt: 10000 };
beforeEach(() => {
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); fail = false;
 host = document.createElement('div'); document.body.append(host); root = createRoot(host);
 vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(report), { status: fail ? 503 : 200 })));
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });
const render = () => act(async () => root.render(<ServerDisk />));
test('shows reserved space and warning; a failed refresh retains stale data then recovers', async () => {
 await render();
 expect(host.textContent).toContain('3.0 GiB');
 expect(host.textContent).toContain('Disk space critically low');
 expect(host.textContent).toContain('1.0 GiB is reserved');
 fail = true;
 await act(async () => host.querySelector('button')!.click());
 expect(host.querySelector('[role="alert"]')).not.toBeNull();
 expect(host.textContent).toContain('(stale)');
 expect(host.textContent).toContain('3.0 GiB');
 expect(host.textContent).not.toContain('Disk space critically low');
 fail = false;
 await act(async () => host.querySelector('button')!.click());
 expect(host.querySelector('[role="alert"]')).toBeNull();
});
test('initial failure displays unknown capacity and no zero reading', async () => {
 fail = true; await render();
 expect(host.textContent).toContain('—');
 expect(host.textContent).not.toContain('0.0 GiB');
});
test('polling pauses while hidden and resumes on becoming visible', async () => {
 vi.useFakeTimers();
 const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
 await render(); expect(fetch).toHaveBeenCalledTimes(1);
 hidden.mockReturnValue(true);
 await act(async () => vi.advanceTimersByTimeAsync(60000));
 expect(fetch).toHaveBeenCalledTimes(1);
 hidden.mockReturnValue(false);
 await act(async () => document.dispatchEvent(new Event('visibilitychange')));
 expect(fetch).toHaveBeenCalledTimes(2);
 await act(async () => vi.advanceTimersByTimeAsync(60000));
 expect(fetch).toHaveBeenCalledTimes(3);
});
