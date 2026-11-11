import fs from 'node:fs/promises';

export interface DiskVolume {
  total: number;
  used: number;
  available: number;
  reserved: number;
}
export interface DiskReport { volumes: DiskVolume[]; checkedAt: number }

/** Report only filesystems containing managed data; never expose host paths. */
export function createDiskUsage(directories: () => string[]) {
  let pending: Promise<DiskReport> | undefined;
  let cached: DiskReport | undefined;
  async function measure(): Promise<DiskReport> {
    const devices = new Set<bigint>();
    const volumes: DiskVolume[] = [];
    for (const directory of new Set(directories())) {
      const real = await fs.realpath(directory);
      const stat = await fs.stat(real, { bigint: true });
      if (devices.has(stat.dev)) continue;
      const info = await fs.statfs(real, { bigint: true });
      if (info.bsize <= 0n || info.blocks <= 0n || info.bfree < 0n || info.bfree > info.blocks || info.bavail < 0n || info.bavail > info.bfree) throw new Error('Invalid filesystem capacity');
      const bytes = (blocks: bigint) => {
        const value = blocks * info.bsize;
        if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Filesystem capacity out of range');
        return Number(value);
      };
      volumes.push({ total: bytes(info.blocks), used: bytes(info.blocks - info.bfree), available: bytes(info.bavail), reserved: bytes(info.bfree - info.bavail) });
      devices.add(stat.dev);
    }
    if (!volumes.length) throw new Error('No managed filesystem');
    return { volumes, checkedAt: Date.now() };
  }
  return () => {
    if (cached && Date.now() - cached.checkedAt < 5_000) return Promise.resolve(cached);
    if (!pending) pending = measure().then(report => (cached = report)).finally(() => { pending = undefined; });
    return pending;
  };
}
