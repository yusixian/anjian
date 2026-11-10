// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { useContentRefresh } from '../src/viewer/hooks/useContentRefresh';

let root: Root;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  vi.setSystemTime(1000);
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  root = createRoot(document.createElement('div'));
});
afterEach(() => {
  act(() => root.unmount());
  vi.restoreAllMocks();
  vi.useRealTimers();
});
function Probe({ expiresAt, refresh }: { expiresAt?: number; refresh: () => void }) {
  useContentRefresh(expiresAt, refresh);
  return null;
}

test('renews before expiry and cleans up the previous deadline when credentials change', () => {
  const refresh = vi.fn();
  act(() => root.render(createElement(Probe, { expiresAt: Date.now() + 30 * 60_000, refresh })));
  act(() => vi.advanceTimersByTime(25 * 60_000));
  expect(refresh).not.toHaveBeenCalled();
  act(() => vi.advanceTimersByTime(60_000));
  expect(refresh).toHaveBeenCalledTimes(1);
  act(() => root.render(createElement(Probe, { expiresAt: Date.now() + 30 * 60_000, refresh })));
  act(() => vi.advanceTimersByTime(60_000));
  expect(refresh).toHaveBeenCalledTimes(1);
});

test('hidden previews defer renewal until visible and failed refreshes retry at a bounded interval', () => {
  const refresh = vi.fn();
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
  act(() => root.render(createElement(Probe, { expiresAt: Date.now() + 60_000, refresh })));
  act(() => vi.advanceTimersByTime(5 * 60_000));
  expect(refresh).not.toHaveBeenCalled();
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  act(() => document.dispatchEvent(new Event('visibilitychange')));
  expect(refresh).toHaveBeenCalledTimes(1);
  act(() => vi.advanceTimersByTime(60_000));
  expect(refresh).toHaveBeenCalledTimes(2);
  act(() => root.render(createElement(Probe, { refresh })));
  act(() => vi.advanceTimersByTime(5 * 60_000));
  expect(refresh).toHaveBeenCalledTimes(2);
});
