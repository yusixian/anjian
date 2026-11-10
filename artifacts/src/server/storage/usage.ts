import fs from 'node:fs/promises';
import path from 'node:path';

export interface UsageBytes {
  artifacts: number;
  history: number;
  trash: number;
  shares: number;
  retained: number;
  total: number;
}
export interface UsageReport extends UsageBytes { checkedAt: number }
interface Inventory { total: UsageReport; owners: Map<string, UsageBytes> }
const empty = (): UsageBytes => ({ artifacts: 0, history: 0, trash: 0, shares: 0, retained: 0, total: 0 });

/** Logical file bytes, including hidden state and retained snapshots; never follows symlinks. */
export function createStorageUsage(options: {
  projects: () => Array<{ dir: string; owner: string }>;
  snapshotsRoot: string;
  snapshots: () => Array<{ directory: string; owner: string }>;
  now?: () => number;
}) {
  const now = options.now ?? Date.now;
  let pending: Promise<Inventory> | undefined;
  let cached: Inventory | undefined;
  const scan = async (): Promise<Inventory> => {
    const total = empty();
    const owners = new Map<string, UsageBytes>();
    let entries = 0;
    const started = Date.now();
    const inspect = async (file: string, optional = false) => {
      if (++entries > 200_000 || Date.now() - started > 30_000) throw new Error('Storage scan limit exceeded');
      try {
        const stat = await fs.lstat(file);
        if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile())) throw new Error('Unsafe storage entry');
        return stat;
      } catch (error) {
        if (optional && (error as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw error;
      }
    };
    const directory = async (file: string, optional = false) => {
      const stat = await inspect(file, optional);
      if (stat && !stat.isDirectory()) throw new Error('Invalid storage directory');
      return stat !== null;
    };
    const add = (category: Exclude<keyof UsageBytes, 'total'>, bytes: number, owner?: string) => {
      if (!Number.isSafeInteger(bytes) || bytes < 0 || !Number.isSafeInteger(total.total + bytes)) throw new Error('Invalid storage size');
      total[category] += bytes;
      total.total += bytes;
      if (owner) {
        const usage = owners.get(owner) ?? empty();
        usage[category] += bytes;
        usage.total += bytes;
        owners.set(owner, usage);
      }
    };
    const walk = async (file: string, category: Exclude<keyof UsageBytes, 'total'>, owner?: string): Promise<void> => {
      const stat = await inspect(file);
      if (stat!.isFile()) { add(category, stat!.size, owner); return; }
      for (const name of await fs.readdir(file)) await walk(path.join(file, name), category, owner);
    };
    const projects = new Map<string, string>();
    for (const { dir, owner } of options.projects()) {
      const normalized = path.resolve(dir);
      if (projects.has(normalized) && projects.get(normalized) !== owner) throw new Error('Conflicting project ownership');
      projects.set(normalized, owner);
    }
    for (const [project, owner] of projects) {
      await directory(project);
      const root = path.join(project, '.anjian');
      if (!await directory(root, true)) continue;
      const artifacts = path.join(root, 'artifacts');
      if (await directory(artifacts, true)) {
        for (const name of await fs.readdir(artifacts))
          await walk(path.join(artifacts, name), name === '.state' ? 'history' : 'artifacts', owner);
      }
      const trash = path.join(root, '.trash');
      if (await directory(trash, true)) await walk(trash, 'trash', owner);
    }
    // Keep expired/unavailable indexed shares charged until their files are removed.
    const snapshots = new Map(options.snapshots().map(({ directory, owner }) => [path.resolve(directory), owner]));
    if (await directory(options.snapshotsRoot, true)) {
      for (const name of await fs.readdir(options.snapshotsRoot)) {
        const file = path.resolve(options.snapshotsRoot, name);
        const owner = snapshots.get(file);
        await walk(file, owner ? 'shares' : 'retained', owner);
      }
    }
    return { total: { ...total, checkedAt: now() }, owners };
  };
  return {
    async read(scope: string): Promise<UsageReport> {
      if (!cached || now() - cached.total.checkedAt >= 5_000) {
        if (!pending) pending = scan();
        const task = pending;
        try { cached = await task; }
        finally { if (pending === task) pending = undefined; }
      }
      return scope === 'shared' ? { ...cached.total } : { ...(cached.owners.get(scope) ?? empty()), checkedAt: cached.total.checkedAt };
    },
  };
}
