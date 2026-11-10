import type { createStorageBackend } from './backend';
import type { MigrationSourcePlan } from './sources';

type Backend = ReturnType<typeof createStorageBackend>;
type Binding = NonNullable<ReturnType<Backend['bindingFor']>>;
type SyncState = 'local' | 'recovery' | 'pending' | 'syncing' | 'ready' | 'error';
interface Lease { binding: Binding; state: 'pending' | 'syncing' | 'ready' | 'error'; lastSyncedAt: number | null }
const same = (a: Binding | null, b: Binding | null) => a?.scope === b?.scope && a?.namespace === b?.namespace;

/** Live leases explain our own dirty markers; they never survive a process restart. */
export function createStorageRuntime(options: {
  backend: Pick<Backend, 'bindingFor' | 'ownersFor' | 'summary' | 'markDirty' | 'checkpoint'>;
  owners: () => string[];
  maintain: <T>(owner: string, work: () => Promise<T>, recovering?: boolean) => Promise<T>;
  plan: (owner: string, scope: string, recovering?: boolean) => Promise<MigrationSourcePlan>;
  intervalMs?: number;
  now?: () => number;
}) {
  const leases = new Map<string, Lease>();
  const arming = new Map<string, Promise<void>>();
  const syncing = new Map<string, Promise<void>>();
  const now = options.now ?? Date.now;
  let stopping = false;
  let timer: ReturnType<typeof setInterval> | undefined;
  const binding = (owner: string) => options.backend.bindingFor(owner);
  const live = (owner: string) => {
    const lease = leases.get(owner);
    return lease && same(lease.binding, binding(owner)) ? lease : undefined;
  };
  const ownerPending = (owner: string) => {
    const active = binding(owner);
    return active !== null && !live(owner) && options.backend.summary(active.scope, owner).pending;
  };
  const scopeOwners = (scope: string) => [...new Set([
    ...(scope === 'shared' ? ['shared', ...options.owners()] : [scope]),
    ...options.backend.ownersFor(scope), ...leases.keys(),
  ])].filter((owner) => binding(owner)?.scope === scope);
  const arm = (owner: string): Promise<void> => {
    if (stopping) return Promise.reject(new Error('Storage runtime is stopping'));
    const pending = arming.get(owner);
    if (pending) return pending;
    const task = (async () => {
      const active = binding(owner);
      if (!active || live(owner)) return;
      if (ownerPending(owner)) throw new Error('Storage recovery is incomplete');
      const marked = await options.backend.markDirty(owner, async () => {
        if (stopping || !same(active, binding(owner))) throw new Error('Storage binding changed');
      });
      if (!same(active, marked)) throw new Error('Storage binding changed');
      leases.set(owner, { binding: active, state: 'pending', lastSyncedAt: null });
    })();
    arming.set(owner, task);
    void task.then(() => arming.delete(owner), () => arming.delete(owner));
    return task;
  };
  const sync = (owner: string): Promise<void> => {
    if (stopping) return Promise.reject(new Error('Storage runtime is stopping'));
    const pending = syncing.get(owner);
    if (pending) return pending;
    const task = Promise.resolve().then(() => options.maintain(owner, async () => {
      const lease = live(owner);
      if (!lease) {
        if (binding(owner)) throw new Error('Storage requires recovery before synchronization');
        return;
      }
      lease.state = 'syncing';
      try {
        const plan = await options.plan(owner, lease.binding.scope);
        if (plan.scope !== lease.binding.scope || plan.roots.some((root) => root.owner !== owner)) throw new Error('Storage ownership changed');
        const guard = async () => {
          if (!same(lease.binding, binding(owner))) throw new Error('Storage binding changed');
          const current = await options.plan(owner, lease.binding.scope);
          if (current.scope !== plan.scope || current.fingerprint !== plan.fingerprint) throw new Error('Storage sources changed');
        };
        await guard();
        await options.backend.checkpoint(lease.binding.scope, plan.roots, guard, owner, { keepDirty: true });
        lease.lastSyncedAt = now();
        lease.state = 'ready';
      } catch (error) { lease.state = 'error'; throw error; }
    })).catch((error) => {
      const lease = live(owner);
      if (lease) lease.state = 'error';
      throw error;
    });
    syncing.set(owner, task);
    void task.then(() => syncing.delete(owner), () => syncing.delete(owner));
    return task;
  };
  const status = (owner: string): { state: SyncState; lastSyncedAt: number | null } => {
    if (!binding(owner)) return { state: 'local', lastSyncedAt: null };
    const lease = live(owner);
    return { state: lease?.state ?? (ownerPending(owner) ? 'recovery' : 'pending'), lastSyncedAt: lease?.lastSyncedAt ?? null };
  };
  const recover = (owner: string, authorize: () => void): Promise<void> => {
    if (stopping) return Promise.reject(new Error('Storage runtime is stopping'));
    if (syncing.has(owner) || arming.has(owner)) return Promise.reject(new Error('Storage operation is running'));
    const task = Promise.resolve().then(() => options.maintain(owner, async () => {
      authorize();
      const active = binding(owner);
      if (!active || live(owner)) throw new Error('Storage does not require recovery');
      const plan = await options.plan(owner, active.scope, true);
      if (plan.scope !== active.scope || plan.roots.some((root) => root.owner !== owner)) throw new Error('Storage ownership changed');
      const guard = async () => {
        authorize();
        if (stopping || !same(active, binding(owner))) throw new Error('Storage binding changed');
        const current = await options.plan(owner, active.scope, true);
        if (current.scope !== plan.scope || current.fingerprint !== plan.fingerprint) throw new Error('Storage sources changed');
      };
      await guard();
      // The user explicitly chose the retained local tree. Preserve deletions within
      // existing roots, verify every uploaded object, and arm before reopening writers.
      await options.backend.checkpoint(active.scope, plan.roots, guard, owner, { keepDirty: true, requireExistingRoots: true });
      leases.set(owner, { binding: active, state: 'ready', lastSyncedAt: now() });
    }, true));
    syncing.set(owner, task);
    void task.then(() => syncing.delete(owner), () => syncing.delete(owner));
    return task;
  };
  return {
    arm,
    recover,
    async recoverScope(scope: string, authorize: () => void) {
      for (const owner of scopeOwners(scope)) if (ownerPending(owner)) await recover(owner, authorize);
    },
    ownerPending,
    scopePending: (scope: string) => scopeOwners(scope).some(ownerPending),
    changed(owner: string) { const lease = live(owner); if (lease && lease.state !== 'syncing') lease.state = 'pending'; },
    sync,
    async syncScope(scope: string) {
      const results = await Promise.allSettled(scopeOwners(scope).map(sync));
      const failures = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected');
      if (failures.length) throw new AggregateError(failures.map((result) => result.reason), 'Some storage spaces did not synchronize');
    },
    status,
    scopeStatus(scope: string) {
      const reports = scopeOwners(scope).map(status);
      const priority: SyncState[] = ['recovery', 'error', 'syncing', 'pending', 'ready', 'local'];
      const state = priority.find((value) => reports.some((report) => report.state === value)) ?? 'local';
      const times = reports.map((report) => report.lastSyncedAt);
      return { state, lastSyncedAt: times.length && times.every((value) => value !== null) ? Math.min(...times as number[]) : null };
    },
    start() {
      if (timer || stopping) return;
      timer = setInterval(() => {
        for (const owner of leases.keys()) void sync(owner).catch(() => undefined);
      }, options.intervalMs ?? 30_000);
      timer.unref();
    },
    async close() {
      stopping = true;
      clearInterval(timer);
      await Promise.allSettled([...arming.values(), ...syncing.values()]);
    },
  };
}
