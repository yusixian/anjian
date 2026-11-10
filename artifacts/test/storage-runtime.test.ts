import { afterEach, expect, test, vi } from 'vitest';
import { createStorageRuntime } from '../src/server/storage/runtime';

type Options = Parameters<typeof createStorageRuntime>[0];
afterEach(() => vi.useRealTimers());
function fixture() {
  let pending = false;
  let namespace = 'first';
  const checkpoint = vi.fn<Options['backend']['checkpoint']>(async (_scope, _roots, guard) => { await guard(); return { backend: 's3', bytes: 0, pending }; });
  const markDirty = vi.fn<Options['backend']['markDirty']>(async (_owner, guard) => {
    await guard(); pending = true; return { scope: 'shared', namespace };
  });
  const backend: Options['backend'] = {
    bindingFor: () => ({ scope: 'shared', namespace }),
    ownersFor: () => ['owner'],
    summary: vi.fn(() => ({ backend: 's3' as const, bytes: 0, pending })),
    markDirty, checkpoint,
  };
  const plan = vi.fn<Options['plan']>(async () => ({ scope: 'shared', roots: [], fingerprint: 'stable' }));
  const runtime = createStorageRuntime({ backend, owners: () => ['owner'], maintain: async (_owner, work) => work(), plan, now: () => 123, intervalMs: 100 });
  return { runtime, backend, checkpoint, markDirty, plan, dirty: () => { pending = true; }, rebind: () => { namespace = 'second'; } };
}

test('restart dirty state cannot be adopted as a live write lease', async () => {
  const f = fixture(); f.dirty();
  expect(f.runtime.ownerPending('owner')).toBe(true);
  await expect(f.runtime.arm('owner')).rejects.toThrow('recovery');
  await expect(f.runtime.sync('owner')).rejects.toThrow('recovery');
  expect(f.markDirty).not.toHaveBeenCalled();
  expect(f.checkpoint).not.toHaveBeenCalled();
  await f.runtime.close();
});

test('live writes retain a durable dirty marker after synchronization and permit retry', async () => {
  const f = fixture();
  await Promise.all([f.runtime.arm('owner'), f.runtime.arm('owner')]);
  expect(f.markDirty).toHaveBeenCalledTimes(1);
  expect(f.runtime.ownerPending('owner')).toBe(false);
  f.checkpoint.mockRejectedValueOnce(new Error('provider unavailable'));
  await expect(f.runtime.sync('owner')).rejects.toThrow('provider');
  expect(f.runtime.status('owner').state).toBe('error');
  await f.runtime.sync('owner');
  expect(f.runtime.status('owner')).toEqual({ state: 'ready', lastSyncedAt: 123 });
  expect(f.backend.summary('shared', 'owner').pending).toBe(true);
  expect(f.checkpoint).toHaveBeenLastCalledWith('shared', [], expect.any(Function), 'owner', { keepDirty: true });
  f.runtime.changed('owner');
  expect(f.runtime.status('owner').state).toBe('pending');
  await f.runtime.close();
});

test('changed binding invalidates the lease and cannot checkpoint the old namespace', async () => {
  const f = fixture(); await f.runtime.arm('owner'); f.rebind();
  expect(f.runtime.ownerPending('owner')).toBe(true);
  await expect(f.runtime.sync('owner')).rejects.toThrow('recovery');
  expect(f.checkpoint).not.toHaveBeenCalled();
  await f.runtime.close();
});

test('periodic synchronization coalesces work and close waits for the in-flight checkpoint', async () => {
  vi.useFakeTimers();
  const f = fixture(); await f.runtime.arm('owner');
  let release!: () => void;
  f.checkpoint.mockImplementationOnce(async () => { await new Promise<void>((resolve) => { release = resolve; }); return { backend: 's3', bytes: 0, pending: true }; });
  f.runtime.start();
  await vi.advanceTimersByTimeAsync(300);
  expect(f.checkpoint).toHaveBeenCalledTimes(1);
  let closed = false;
  const closing = f.runtime.close().then(() => { closed = true; });
  await Promise.resolve(); expect(closed).toBe(false);
  release(); await closing;
  await vi.advanceTimersByTimeAsync(500);
  expect(f.checkpoint).toHaveBeenCalledTimes(1);
  await expect(f.runtime.arm('owner')).rejects.toThrow('stopping');
});
