import { expect, test } from 'vitest';
import { createStorageQuota } from '../src/server/storage/quota';

test('serializes uploads across projects and releases admission after a failure', async () => {
  let used = 0;
  const quota = createStorageQuota({ owner: () => 'github:2', measure: async () => ({ shared: used, personal: used }), limits: () => ({ shared: 10, personal: 10 }) });
  const put = (project: string, bytes: number) => quota(project, async (prepare) => { const admit = await prepare(); admit(bytes); used += bytes; });
  const results = await Promise.allSettled([put('a', 6), put('b', 6)]);
  expect(results.map((result) => result.status)).toEqual(['fulfilled', 'rejected']);
  expect(used).toBe(6);
  await put('b', 4);
  expect(used).toBe(10);
});

test('honors zero limits, allows shrinking, and rechecks changed limits after scanning', async () => {
  let limit = 0;
  const quota = createStorageQuota({ owner: () => 'owner', measure: async () => ({ shared: 10, personal: 10 }), limits: () => ({ shared: limit, personal: null }) });
  await expect(quota('a', async (prepare) => (await prepare())(1))).rejects.toMatchObject({ code: 'storage_quota_exceeded' });
  await quota('a', async (prepare) => (await prepare())(-1));
  limit = 100;
  await expect(quota('a', async (prepare) => { const admit = await prepare(); limit = 0; admit(1); })).rejects.toMatchObject({ status: 413 });
});

test('fails closed on unknown usage or changed ownership', async () => {
  let owner = 'owner';
  const quota = createStorageQuota({ owner: () => owner, measure: async () => ({ shared: 0, personal: 0 }), limits: () => ({ shared: null, personal: 0 }) });
  await expect(quota('a', async (prepare) => { const admit = await prepare(); owner = 'github:2'; admit(1); })).rejects.toMatchObject({ code: 'ownership_changed' });
  const broken = createStorageQuota({ owner: () => owner, measure: async () => { throw new Error('unavailable'); }, limits: () => ({ shared: null, personal: null }) });
  await expect(broken('a', async (prepare) => (await prepare())(1))).rejects.toThrow('unavailable');
});

test('personal limits apply even when shared capacity is unlimited', async () => {
  const quota = createStorageQuota({ owner: () => 'github:2', measure: async () => ({ shared: 100, personal: 4 }), limits: () => ({ shared: null, personal: 5 }) });
  await quota('a', async (prepare) => (await prepare())(1));
  await expect(quota('a', async (prepare) => (await prepare())(2))).rejects.toMatchObject({ code: 'storage_quota_exceeded' });
});

test('private S3 writes do not consume shared allocations and binding changes invalidate admission', async () => {
  let shared = false;
  const quota = createStorageQuota({ owner: () => 'github:2', sharedOwner: () => shared,
    measure: async () => ({ shared: 50, personal: 20 }), limits: () => ({ shared: 0, personal: 0 }) });
  await quota('private', async (prepare) => (await prepare())(100));
  await expect(quota('private', async (prepare) => { const admit = await prepare(); shared = true; admit(1); })).rejects.toMatchObject({ code: 'storage_changed' });
  await expect(quota('shared', async (prepare) => (await prepare())(1))).rejects.toMatchObject({ code: 'storage_quota_exceeded' });
});

test('private S3 admission does not scan unrelated shared resources', async () => {
  const quota = createStorageQuota({ owner: () => 'github:2', sharedOwner: () => false,
    measure: async () => { throw new Error('unrelated missing cache'); }, limits: () => ({ shared: 0, personal: 0 }) });
  await quota('private', async (prepare) => (await prepare())(12));
});
