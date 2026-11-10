import { RemoteTransferError } from '../remote-transfer';

/** Serializes uploads and snapshot publication across projects; other writers must join this boundary. */
export function createStorageQuota(options: {
  owner: (project: string) => string;
  measure: (owner: string) => Promise<{ shared: number; personal: number }>;
  limits: (owner: string) => { shared: number | null; personal: number | null };
}) {
  let pending: Promise<unknown> = Promise.resolve();
  return async <T>(project: string, work: (prepare: () => Promise<(deltaBytes: number) => void>) => Promise<T>): Promise<T> => {
    const current = pending.catch(() => undefined).then(() => work(async () => {
      const owner = options.owner(project);
      const usage = await options.measure(owner);
      return (delta) => {
        if (options.owner(project) !== owner) throw new RemoteTransferError(409, 'ownership_changed', '项目归属已变化，请重试');
        if (!Number.isSafeInteger(delta)) throw new Error('Invalid storage delta');
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
    }));
    pending = current;
    return current;
  };
}
