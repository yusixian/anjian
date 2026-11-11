import fs from 'node:fs/promises';
import { afterEach, expect, test, vi } from 'vitest';
import { createDiskUsage } from '../src/server/storage/disk';

afterEach(() => vi.restoreAllMocks());
function fixture() {
  vi.spyOn(fs, 'realpath').mockImplementation(async value => String(value));
  vi.spyOn(fs, 'stat').mockImplementation(async value => ({ dev: String(value).startsWith('/second') ? 2n : 1n }) as never);
  return vi.spyOn(fs, 'statfs').mockResolvedValue({ bsize: 1024n, blocks: 100n, bfree: 40n, bavail: 30n } as never);
}
test('deduplicates filesystems, separates reserved space and exposes no paths', async () => {
  const statfs = fixture();
  const report = await createDiskUsage(() => ['/data', '/data/project', '/second'])();
  expect(report.volumes).toEqual(Array(2).fill({ total: 102400, used: 61440, available: 30720, reserved: 10240 }));
  expect(statfs).toHaveBeenCalledTimes(2);
  expect(JSON.stringify(report)).not.toContain('/data');
});
test('shares concurrent reads and expires cached readings', async () => {
  const statfs = fixture();
  const now = vi.spyOn(Date, 'now').mockReturnValue(10000);
  const read = createDiskUsage(() => ['/data']);
  const [a, b] = await Promise.all([read(), read()]);
  expect(a).toBe(b);
  await read(); expect(statfs).toHaveBeenCalledTimes(1);
  now.mockReturnValue(16000);
  await read(); expect(statfs).toHaveBeenCalledTimes(2);
});
test('failed refresh rejects instead of returning a stale or zero reading and can retry', async () => {
  const statfs = fixture();
  const now = vi.spyOn(Date, 'now').mockReturnValue(10000);
  const read = createDiskUsage(() => ['/data']);
  await read(); now.mockReturnValue(16000);
  statfs.mockRejectedValueOnce(new Error('offline'));
  await expect(read()).rejects.toThrow('offline');
  expect((await read()).volumes[0]!.available).toBe(30720);
});
test('rejects invalid capacity and unsafe integer conversion', async () => {
  const statfs = fixture();
  statfs.mockResolvedValueOnce({ bsize: 4096n, blocks: 0n, bfree: 0n, bavail: 0n } as never);
  await expect(createDiskUsage(() => ['/data'])()).rejects.toThrow('Invalid');
  statfs.mockResolvedValueOnce({ bsize: 4096n, blocks: 2n ** 60n, bfree: 0n, bavail: 0n } as never);
  await expect(createDiskUsage(() => ['/data'])()).rejects.toThrow('range');
});
