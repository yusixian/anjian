// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { StorageMigration } from '../src/viewer/layouts/storage/StorageMigration';

vi.mock('@stylexjs/stylex', async (original) => ({ ...(await original<object>()),
  create: (value: unknown) => value, defineConsts: (value: unknown) => value, defineVars: (value: unknown) => value, props: () => ({}) }));
vi.mock('@lobehub/ui/stylex/cssVar.stylex', () => ({ cssVar: new Proxy({}, { get: (_, key) => `var(--${String(key)})` }) }));
vi.mock('@lobehub/ui', () => ({ Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props}>{children}</button> }));
let host: HTMLElement;
let root: Root;
let jobs: Array<{ id: string; profileId: string; state: string; createdAt: number; files: number; bytes: number; verifiedFiles: number; running: boolean; error: string | null }>;
const posts: Record<string, unknown>[] = [];
const job = () => ({ id: 'job', profileId: 'profile', state: 'prepared', createdAt: 1, files: 2, bytes: 1024, verifiedFiles: 0, running: false, error: null });
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  jobs = []; posts.length = 0;
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  vi.stubGlobal('fetch', async (_url: string, init?: RequestInit) => {
    if (init?.method === 'POST') {
      const body = JSON.parse(String(init.body)); posts.push(body);
      if (body.action === 'prepare') jobs = [job()];
      if (body.action === 'resume') jobs[0] = { ...jobs[0]!, running: true, state: 'copying' };
      return new Response(JSON.stringify({ job: jobs[0] }));
    }
    return new Response(JSON.stringify({ jobs }));
  });
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); vi.useRealTimers(); });
const button = (label: string) => [...host.querySelectorAll('button')].find((item) => item.textContent === label)!;
const click = async (label: string) => { await act(async () => { button(label).click(); }); };
const render = async (enabled = true) => { await act(async () => root.render(<StorageMigration scope="personal" profileId="profile" enabled={enabled} disabled={false} onBusy={() => {}} />)); };

test('requires tested settings, then prepares and copies without claiming storage activation', async () => {
  await render(false);
  expect(button('Prepare migration').disabled).toBe(true);
  await render();
  await click('Prepare migration');
  expect(posts).toEqual([{ action: 'prepare', profileId: 'profile' }]);
  await click('Copy and verify');
  expect(posts[1]).toEqual({ action: 'resume', id: 'job' });
  expect(host.textContent).toContain('Copying and verifying');
  jobs = [{ ...job(), state: 'verified', verifiedFiles: 2 }];
  await click('Refresh jobs');
  expect(host.textContent).toContain('Storage has not switched');
  expect(button('Copy and verify')).toBeUndefined();
  expect(posts.every(({ action }) => action !== 'activate')).toBe(true);
});

test('interrupted jobs can resume but changed sources require a new preparation', async () => {
  jobs = [{ ...job(), state: 'copying' }];
  await render();
  expect(host.textContent).toContain('Copy interrupted');
  expect(button('Resume copy').disabled).toBe(false);
  jobs = [{ ...job(), state: 'failed', error: 'source_changed' }];
  await click('Refresh jobs');
  expect(button('Resume copy').disabled).toBe(true);
  expect(button('Prepare migration').disabled).toBe(false);
});
