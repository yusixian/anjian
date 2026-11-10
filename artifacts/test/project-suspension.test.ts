import { expect, test, vi } from 'vitest';
import { createProjectSuspension } from '../src/server/project-suspension';

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

test('keeps mounts paused until asynchronous maintenance and rescan finish', async () => {
  const suspension = createProjectSuspension();
  const work = deferred<string>();
  const rescan = deferred();
  const before = vi.fn(async () => {});
  const after = vi.fn(() => rescan.promise);
  const operation = suspension.suspend('project-a', before, () => work.promise, after);
  const waiting = suspension.wait('project-a');
  expect(waiting).toBeDefined();
  const mount = vi.fn();
  void waiting!.then(mount);

  await vi.waitFor(() => expect(before).toHaveBeenCalledOnce());
  work.resolve('done');
  await vi.waitFor(() => expect(after).toHaveBeenCalledOnce());
  expect(mount).not.toHaveBeenCalled();
  expect(suspension.wait('project-a')).toBe(waiting);

  rescan.resolve();
  await expect(operation).resolves.toBe('done');
  await waiting;
  expect(mount).toHaveBeenCalledOnce();
  expect(suspension.wait('project-a')).toBeUndefined();
});

test('serializes overlapping pauses per project while other projects proceed', async () => {
  const suspension = createProjectSuspension();
  const firstWork = deferred();
  const secondWork = deferred();
  const firstStarted = vi.fn();
  const secondStarted = vi.fn();
  const first = suspension.suspend('a', async () => {}, () => { firstStarted(); return firstWork.promise; }, () => {});
  const second = suspension.suspend('a', async () => {}, () => { secondStarted(); return secondWork.promise; }, () => {});
  const latestGate = suspension.wait('a');
  const mounted = vi.fn();
  void latestGate!.then(mounted);
  const other = suspension.suspend('b', async () => {}, () => 'independent', () => {});

  await expect(other).resolves.toBe('independent');
  await vi.waitFor(() => expect(firstStarted).toHaveBeenCalledOnce());
  expect(secondStarted).not.toHaveBeenCalled();
  firstWork.resolve();
  await first;
  await vi.waitFor(() => expect(secondStarted).toHaveBeenCalledOnce());
  expect(mounted).not.toHaveBeenCalled();
  expect(suspension.wait('a')).toBe(latestGate);

  secondWork.resolve();
  await second;
  await latestGate;
  expect(mounted).toHaveBeenCalledOnce();
  expect(suspension.wait('a')).toBeUndefined();
});

test.each(['close', 'work', 'rescan'] as const)('releases queued mounts and later work after %s fails', async (phase) => {
  const suspension = createProjectSuspension();
  const error = new Error(`${phase} failed`);
  const after = vi.fn(() => { if (phase === 'rescan') throw error; });
  const failed = suspension.suspend('a', async () => { if (phase === 'close') throw error; }, () => {
    if (phase === 'work') throw error;
  }, after);
  const next = suspension.suspend('a', async () => {}, () => 'recovered', () => {});
  const waiting = suspension.wait('a');
  await expect(failed).rejects.toBe(error);
  expect(after).toHaveBeenCalledOnce();
  await expect(next).resolves.toBe('recovered');
  await waiting;
  expect(suspension.wait('a')).toBeUndefined();
});
