import { afterEach, expect, test, vi } from 'vitest';
import { createBackgroundWrites } from '../src/server/storage/background-writes';
afterEach(() => vi.useRealTimers());

test('coalesces to the latest state after acquiring the queue', async () => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const seen: string[] = [];
  const queue = createBackgroundWrites({ execute: async work => { await gate; work(() => undefined); } });
  queue.enqueue('board', () => { seen.push('old'); });
  queue.enqueue('board', () => { seen.push('latest'); });
  release(); await vi.waitFor(() => expect(seen).toEqual(['latest']));
  queue.close();
});

test('failed admission retries the retained update without a new filesystem event', async () => {
  vi.useFakeTimers(); let blocked = true; const saved: string[] = [];
  const onError = vi.fn();
  const queue = createBackgroundWrites({ retryMs: 1000, onError, execute: async work => work(() => { if (blocked) throw new Error('quota'); }) });
  queue.enqueue('board', admit => { admit(20); saved.push('updated'); });
  await vi.advanceTimersByTimeAsync(0);
  expect(saved).toEqual([]); expect(onError).toHaveBeenCalledTimes(1);
  blocked = false;
  await vi.advanceTimersByTimeAsync(1000);
  expect(saved).toEqual(['updated']);
  await vi.advanceTimersByTimeAsync(1000);
  expect(saved).toEqual(['updated']); queue.close();
});

test('closing cancels queued work without waiting on a held maintenance lock', async () => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const save = vi.fn();
  const queue = createBackgroundWrites({ execute: async work => { await gate; work(() => undefined); } });
  queue.enqueue('board', save); queue.close(); release();
  await gate; await Promise.resolve(); await Promise.resolve();
  expect(save).not.toHaveBeenCalled();
  queue.enqueue('board', save); expect(save).not.toHaveBeenCalled();
});

test('maintenance pauses queued callbacks and replays them after resume', async () => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const save = vi.fn();
  const queue = createBackgroundWrites({ execute: async work => { await gate; work(() => undefined); } });
  queue.enqueue('board', save);
  const resume = queue.pause(); release();
  await gate; await Promise.resolve(); await Promise.resolve();
  expect(save).not.toHaveBeenCalled();
  resume(); resume();
  await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  queue.close();
});
