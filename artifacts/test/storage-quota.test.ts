import { expect, test } from 'vitest';
import { createUploadQuota } from '../src/server/storage/quota';

test('serializes uploads across projects and releases admission after a failure', async () => {
  let used = 0;
  const quota = createUploadQuota({ owner: () => 'github:2', measure: async () => ({ shared: used, personal: used }), limits: () => ({ shared: 10, personal: 10 }) });
  const put = (project: string, bytes: number) => quota(project, async (prepare) => { const admit = await prepare(); admit(bytes); used += bytes; });
  const results = await Promise.allSettled([put('a', 6), put('b', 6)]);
  expect(results.map((result) => result.status)).toEqual(['fulfilled', 'rejected']);
  expect(used).toBe(6);
  await put('b', 4);
  expect(used).toBe(10);
});

test('honors zero limits, allows shrinking, and rechecks changed limits after scanning', async () => {
  let limit = 0;
  const quota = createUploadQuota({ owner: () => 'owner', measure: async () => ({ shared: 10, personal: 10 }), limits: () => ({ shared: limit, personal: null }) });
  await expect(quota('a', async (prepare) => (await prepare())(1))).rejects.toMatchObject({ code: 'storage_quota_exceeded' });
  await quota('a', async (prepare) => (await prepare())(-1));
  limit = 100;
  await expect(quota('a', async (prepare) => { const admit = await prepare(); limit = 0; admit(1); })).rejects.toMatchObject({ status: 413 });
});

test('fails closed on unknown usage or changed ownership', async () => {
  let owner = 'owner';
  const quota = createUploadQuota({ owner: () => owner, measure: async () => ({ shared: 0, personal: 0 }), limits: () => ({ shared: null, personal: 0 }) });
  await expect(quota('a', async (prepare) => { const admit = await prepare(); owner = 'github:2'; admit(1); })).rejects.toMatchObject({ code: 'ownership_changed' });
  const broken = createUploadQuota({ owner: () => owner, measure: async () => { throw new Error('unavailable'); }, limits: () => ({ shared: null, personal: null }) });
  await expect(broken('a', async (prepare) => (await prepare())(1))).rejects.toThrow('unavailable');
});

test('personal limits apply even when shared capacity is unlimited', async () => {
  const quota = createUploadQuota({ owner: () => 'github:2', measure: async () => ({ shared: 100, personal: 4 }), limits: () => ({ shared: null, personal: 5 }) });
  await quota('a', async (prepare) => (await prepare())(1));
  await expect(quota('a', async (prepare) => (await prepare())(2))).rejects.toMatchObject({ code: 'storage_quota_exceeded' });
});
