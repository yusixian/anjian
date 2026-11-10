import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { createStorageUsage } from '../src/server/storage/usage';

const homes: string[] = [];
afterEach(() => { for (const home of homes.splice(0)) fs.rmSync(home, { recursive: true, force: true }); });
function fixture() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'anjian-usage-')); homes.push(home);
  const projects = [{ dir: path.join(home, 'alice'), owner: 'github:2' }, { dir: path.join(home, 'bob'), owner: 'github:3' }];
  for (const { dir } of projects) fs.mkdirSync(dir);
  const snapshotsRoot = path.join(home, 'snapshots'); fs.mkdirSync(snapshotsRoot);
  let time = 10_000;
  const snapshots = [{ directory: path.join(snapshotsRoot, 'published'), owner: 'github:2' }];
  const usage = createStorageUsage({ projects: () => [...projects, projects[0]!], snapshotsRoot, snapshots: () => snapshots, now: () => time });
  const put = (relative: string, bytes: number) => {
    const file = path.join(home, relative); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, Buffer.alloc(bytes));
  };
  return { home, projects, usage, put, advance: () => { time += 5_001; } };
}

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
