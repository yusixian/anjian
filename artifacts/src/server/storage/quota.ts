import type { CommentAdmission } from '../document-comments';
import { RemoteTransferError } from '../remote-transfer';

/** Serializes uploads and snapshot publication across projects; other writers must join this boundary. */
export function createStorageQuota(options: {
  owner: (project: string) => string;
  measure: (owner: string) => Promise<{ shared: number; personal: number }>;
  limits: (owner: string) => { shared: number | null; personal: number | null };
  /** Member quotas are allocations of shared storage, not limits on their private S3. */
  sharedOwner?: (owner: string) => boolean;
}) {
  let pending: Promise<unknown> = Promise.resolve();
  const exclusive = <T>(work: (prepareProject: (project: string) => Promise<CommentAdmission>) => Promise<T>): Promise<T> => {
    const current = pending.catch(() => undefined).then(async () => {
      let held = true;
      const assertHeld = () => { if (!held) throw new Error('Storage admission lock has been released'); };
      // Maintenance already owns this queue. Refresh each project's usage here
      // instead of recursively entering upload and waiting on our own lock.
      const prepareProject = async (project: string): Promise<CommentAdmission> => {
        assertHeld();
        const owner = options.owner(project);
        const shared = options.sharedOwner?.(owner) ?? true;
        const usage = shared ? await options.measure(owner) : { shared: 0, personal: 0 };
        assertHeld();
        return (delta: number) => {
          assertHeld();
          if (options.owner(project) !== owner) throw new RemoteTransferError(409, 'ownership_changed', '项目归属已变化，请重试');
          if (!Number.isSafeInteger(delta)) throw new Error('Invalid storage delta');
          if ((options.sharedOwner?.(owner) ?? true) !== shared) throw new RemoteTransferError(409, 'storage_changed', '存储归属已变化，请重试');
          if (!shared) return;
          const limits = options.limits(owner);
          for (const scope of ['shared', 'personal'] as const) {
            if (!Number.isSafeInteger(usage[scope]) || usage[scope] < 0) throw new Error('Invalid storage usage');
            const limit = limits[scope];
            if (limit !== null && (!Number.isSafeInteger(limit) || limit < 0)) throw new Error('Invalid storage limit');
            // An over-limit member can still shrink an existing artifact.
            if (delta > 0 && limit !== null && delta > limit - usage[scope])
              throw new RemoteTransferError(413, 'storage_quota_exceeded', scope === 'shared' ? '共享存储容量不足，请联系管理员或减少资源' : '个人存储额度不足，请减少资源或联系管理员');
          }
        };
      };
      try { return await work(prepareProject); }
      finally { held = false; }
    });
    pending = current;
    return current;
  };
  const upload = <T>(project: string, work: (prepare: () => Promise<CommentAdmission>) => Promise<T>): Promise<T> =>
    exclusive(prepareProject => work(() => prepareProject(project)));
  return Object.assign(upload, { exclusive });
}

/** Convert per-write deltas into the total measured by one admission snapshot. */
export function cumulativeStorageAdmission(admit?: CommentAdmission): CommentAdmission | undefined {
  if (!admit) return;
  let used = 0;
  return delta => {
    const next = used + delta;
    admit(next);
    used = next;
  };
}
