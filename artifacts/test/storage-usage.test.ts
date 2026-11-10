import fs from 'node:fs';
import promises from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';
import { createStorageUsage } from '../src/server/storage/usage';

const homes: string[] = [];
afterEach(() => { vi.restoreAllMocks(); for (const home of homes.splice(0)) fs.rmSync(home, { recursive: true, force: true }); });
function fixture() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'anjian-usage-')); homes.push(home);
  const projects = [{ dir: path.join(home, 'alice'), owner: 'github:2' }, { dir: path.join(home, 'bob'), owner: 'github:3' }];
  for (const { dir } of projects) fs.mkdirSync(dir);
  const snapshotsRoot = path.join(home, 'snapshots'); fs.mkdirSync(snapshotsRoot);
  let time = 10_000;
  const snapshots = [{ directory: path.join(snapshotsRoot, 'published'), owner: 'github:2' }];
  const personal = new Set<string>();
  const usage = createStorageUsage({ projects: () => [...projects, projects[0]!], snapshotsRoot, snapshots: () => snapshots, now: () => time, sharedOwner: (owner) => !personal.has(owner) });
  const put = (relative: string, bytes: number) => {
    const file = path.join(home, relative); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, Buffer.alloc(bytes));
  };
  return { home, projects, usage, put, personal, advance: () => { time += 5_001; } };
}

test('restarts the complete inventory if an atomic writer renames a listed file', async () => {
  const f = fixture();
  f.put('alice/.anjian/artifacts/.state/value.json.tmp', 42);
  const temporary = path.join(f.home, 'alice/.anjian/artifacts/.state/value.json.tmp');
  const final = path.join(f.home, 'alice/.anjian/artifacts/.state/value.json');
  const lstat = promises.lstat.bind(promises);
  const spy = vi.spyOn(promises, 'lstat').mockImplementation(async (...args) => {
    if (args[0] === temporary && fs.existsSync(temporary)) fs.renameSync(temporary, final);
    return lstat(...args);
  });
  expect(await f.usage.measure('github:2')).toEqual({ shared: 42, personal: 42 });
  expect(spy.mock.calls.filter(([file]) => file === f.projects[0]!.dir)).toHaveLength(2);
});

test('counts source, hidden state, trash, shares and orphaned snapshots without leaking other owners', async () => {
  const f = fixture();
  f.put('alice/.anjian/artifacts/html/a/index.html', 10);
  f.put('alice/.anjian/artifacts/.state/html/a/history/one', 20);
  f.put('alice/.anjian/.trash/retained/artifact/index.html', 30);
  f.put('bob/.anjian/artifacts/html/b/index.html', 40);
  f.put('snapshots/published/index.html', 50);
  f.put('snapshots/orphan/index.html', 60);
  const [shared, alice, bob] = await Promise.all(['shared', 'github:2', 'github:3'].map((scope) => f.usage.read(scope)));
  expect(shared).toEqual({ artifacts: 50, history: 20, trash: 30, shares: 50, retained: 60, total: 210, checkedAt: 10_000 });
  expect(alice).toEqual({ artifacts: 10, history: 20, trash: 30, shares: 50, retained: 0, total: 110, checkedAt: 10_000 });
  expect(bob!.total).toBe(40);
  expect((await f.usage.read('owner')).total).toBe(0);
  expect(JSON.stringify(shared)).not.toContain(f.home);
});

test('rescans after cache expires and returned summaries cannot mutate cached accounting', async () => {
  const f = fixture(); f.put('alice/.anjian/artifacts/file', 8);
  const report = await f.usage.read('shared'); report.total = 999;
  f.put('alice/.anjian/artifacts/file', 9);
  expect((await f.usage.read('shared')).total).toBe(8);
  f.advance(); expect((await f.usage.read('shared')).total).toBe(9);
});

test('rejects symlinks and missing projects rather than underreporting', async () => {
  const f = fixture(); f.put('alice/.anjian/artifacts/file', 8);
  fs.symlinkSync(f.projects[1]!.dir, path.join(f.home, 'alice/.anjian/artifacts/link'));
  await expect(f.usage.read('shared')).rejects.toThrow('Unsafe');
  fs.unlinkSync(path.join(f.home, 'alice/.anjian/artifacts/link'));
  expect((await f.usage.read('shared')).total).toBe(8);
  fs.rmSync(f.projects[1]!.dir, { recursive: true }); f.advance();
  await expect(f.usage.read('shared')).rejects.toThrow();
});

test('does not follow a linked metadata directory or accept conflicting owners', async () => {
  const f = fixture(); fs.symlinkSync(f.projects[1]!.dir, path.join(f.home, 'alice/.anjian'));
  await expect(f.usage.read('shared')).rejects.toThrow('Unsafe');
  fs.unlinkSync(path.join(f.home, 'alice/.anjian'));
  f.projects.push({ dir: f.projects[0]!.dir, owner: 'github:4' });
  await expect(f.usage.read('shared')).rejects.toThrow('Conflicting');
});

test('upload accounting bypasses the display cache and returns one inventory for both limits', async () => {
  const f = fixture();
  f.put('alice/.anjian/artifacts/html/a/index.html', 5);
  expect((await f.usage.read('shared')).total).toBe(5);
  f.put('alice/.anjian/artifacts/html/a/index.html', 11);
  f.put('bob/.anjian/.trash/retained/source', 7);
  expect(await f.usage.measure('github:2')).toEqual({ shared: 18, personal: 11 });
});

test('personal S3 allocation immediately leaves shared accounting without hiding its own usage or orphan snapshots', async () => {
  const f = fixture();
  f.put('alice/.anjian/artifacts/html/a/index.html', 10);
  f.put('alice/.anjian/artifacts/.state/history', 20);
  f.put('alice/.anjian/.trash/kept', 30);
  f.put('snapshots/published/index.html', 40);
  f.put('snapshots/orphan/index.html', 50);
  f.put('bob/.anjian/artifacts/html/b/index.html', 60);
  expect((await f.usage.read('shared')).total).toBe(210);
  f.personal.add('github:2');
  // The display cache is still warm, but binding allocation must take effect now.
  expect(await f.usage.read('shared')).toEqual({ artifacts: 60, history: 0, trash: 0, shares: 0, retained: 50, total: 110, checkedAt: 10_000 });
  expect((await f.usage.read('github:2')).total).toBe(100);
  expect(await f.usage.measure('github:2')).toEqual({ shared: 110, personal: 100 });
  f.personal.delete('github:2');
  expect((await f.usage.read('shared')).total).toBe(210);
});

test('shared admission does not depend on another personal S3 cache being available', async () => {
  const f = fixture(); f.put('alice/.anjian/artifacts/file', 9);
  f.personal.add('github:3'); fs.rmSync(f.projects[1]!.dir, { recursive: true });
  expect(await f.usage.measure('github:2')).toEqual({ shared: 9, personal: 9 });
});
