import { expect, test } from 'vitest';
import { withProjectMaintenance } from '../src/server/project-maintenance';
import { withProjectMutation } from '../src/server/project-mutations';
import { createStorageQuota } from '../src/server/storage/quota';

const deferred = () => { let resolve!: () => void; const promise = new Promise<void>((done) => { resolve = done; }); return { promise, resolve }; };
test('maintenance follows the global upload queue, drains all projects and excludes queued writes', async () => {
  const queue = createStorageQuota({ owner: () => 'owner', measure: async () => ({ shared: 0, personal: 0 }), limits: () => ({ shared: null, personal: null }) });
  const events: string[] = [];
  const active = deferred(); const started = deferred(); const drained = deferred(); const finish = deferred();
  const upload = queue('a', async () => withProjectMutation('a', async () => { events.push('upload'); started.resolve(); await active.promise; }));
  await started.promise;
  const maintenance = queue.exclusive(() => withProjectMaintenance(['b', 'a', 'a'], async (project, work) => {
    events.push(`close:${project}`);
    try { return await work(); } finally { events.push(`resume:${project}`); }
  }, async () => { events.push('prepare'); drained.resolve(); await finish.promise; }));
  const nextUpload = queue('a', async () => { events.push('next-upload'); });
  expect(events).toEqual(['upload']);
  active.resolve(); await upload; await drained.promise;
  const directWrite = withProjectMutation('b', async () => { events.push('direct-write'); });
  expect(events).toEqual(['upload', 'close:a', 'close:b', 'prepare']);
  finish.resolve(); await Promise.all([maintenance, nextUpload, directWrite]);
  expect(events.indexOf('direct-write')).toBeGreaterThan(events.indexOf('resume:a'));
  expect(events.indexOf('next-upload')).toBeGreaterThan(events.indexOf('resume:a'));
});

test('failed draining releases project locks without entering the storage operation', async () => {
  let entered = false;
  await expect(withProjectMaintenance(['b', 'a'], async (project, work) => {
    if (project === 'b') throw new Error('flush failed');
    return work();
  }, async () => { entered = true; })).rejects.toThrow('flush failed');
  expect(entered).toBe(false);
  await expect(withProjectMutation('a', async () => 'recovered')).resolves.toBe('recovered');
  await expect(withProjectMutation('b', async () => 'recovered')).resolves.toBe('recovered');
});

test('rechecks authority after waiting for an existing project write', async () => {
  const held = deferred(); const entered = deferred();
  const writing = withProjectMutation('waiting-project', async () => { entered.resolve(); await held.promise; });
  await entered.promise;
  let authorized = true; let closed = false;
  const maintenance = withProjectMaintenance(['waiting-project'], async (_project, work) => { closed = true; return work(); }, async () => {}, () => {
    if (!authorized) throw new Error('revoked');
  });
  authorized = false; held.resolve();
  await writing;
  await expect(maintenance).rejects.toThrow('revoked');
  expect(closed).toBe(false);
});
