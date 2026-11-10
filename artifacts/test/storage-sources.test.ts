import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { assertMigrationSourcesUnchanged, isRuntimeLocalArtifactStateFile, planMigrationSources } from '../src/server/storage/sources';

const homes: string[] = [];
afterEach(() => { for (const home of homes.splice(0)) fs.rmSync(home, { recursive: true, force: true }); });

function fixture() {
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'anjian-sources-'))); homes.push(home);
  const snapshotsRoot = path.join(home, 'shares', 'snapshots');
  fs.mkdirSync(snapshotsRoot, { recursive: true });
  const projects: Array<{ dir: string; owner: string }> = [];
  const snapshots: Array<{ directory: string; project: string }> = [];
  const project = (name: string, owner: string) => {
    const dir = path.join(home, name); fs.mkdirSync(dir); projects.push({ dir, owner }); return dir;
  };
  const snapshot = (projectDir?: string) => {
    const directory = path.join(snapshotsRoot, crypto.randomUUID()); fs.mkdirSync(directory);
    if (projectDir) snapshots.push({ directory, project: projectDir });
    return directory;
  };
  const options = { projects: () => projects, snapshotsRoot, snapshots: () => snapshots };
  return { home, project, snapshot, projects, snapshots, options };
}

test('plans owner, member, and shared resources from trusted ownership; retains orphan snapshots only in shared', async () => {
  const f = fixture();
  const owner = f.project('owner-project', 'owner');
  const member = f.project('member-project', 'github:123');
  const ownerShare = f.snapshot(owner);
  const memberShare = f.snapshot(member);
  const retainedShare = f.snapshot();
  const ownerPlan = await planMigrationSources('owner', f.options);
  const memberPlan = await planMigrationSources('github:123', f.options);
  const sharedPlan = await planMigrationSources('shared', f.options);
  const paths = (plan: typeof ownerPlan) => plan.roots.map((root) => root.directory);
  expect(paths(ownerPlan)).toEqual(expect.arrayContaining([path.join(owner, '.anjian/artifacts'), path.join(owner, '.anjian/.trash'), ownerShare]));
  expect(paths(ownerPlan)).not.toContain(memberShare);
  expect(paths(ownerPlan)).not.toContain(retainedShare);
  expect(paths(memberPlan)).toEqual(expect.arrayContaining([path.join(member, '.anjian/artifacts'), path.join(member, '.anjian/.trash'), memberShare]));
  expect(paths(memberPlan)).not.toContain(ownerShare);
  expect(paths(sharedPlan)).toEqual(expect.arrayContaining([...paths(ownerPlan), ...paths(memberPlan), retainedShare]));
  expect(ownerPlan.roots.find((root) => root.directory.endsWith('/artifacts'))?.kind).toBe('artifacts');
  expect(ownerPlan.roots.find((root) => root.directory.endsWith('/.trash'))?.kind).toBe('trash');
  expect(ownerPlan.roots.every((root) => root.owner === 'owner')).toBe(true);
  expect(memberPlan.roots.every((root) => root.owner === 'github:123')).toBe(true);
  expect(sharedPlan.roots.find((root) => root.directory === retainedShare)?.owner).toBe('shared');
  expect(JSON.stringify({ scope: sharedPlan.scope, roots: sharedPlan.roots.length })).not.toContain(f.home);
});

test('shared excludes personal-storage owners and their indexed snapshots while retaining other and unassigned snapshots', async () => {
  const f = fixture();
  const owner = f.project('owner-project', 'owner');
  const personal = f.project('personal-project', 'github:123');
  const ownerShare = f.snapshot(owner);
  const personalShare = f.snapshot(personal);
  const orphan = f.snapshot();
  const unregistered = f.snapshot(path.join(f.home, 'unregistered-project'));
  const options = { ...f.options, sharedOwner: (id: string) => id !== 'github:123' };
  const shared = await planMigrationSources('shared', options);
  const personalPlan = await planMigrationSources('github:123', options);
  const paths = shared.roots.map((root) => root.directory);
  expect(paths).toEqual(expect.arrayContaining([path.join(owner, '.anjian/artifacts'), path.join(owner, '.anjian/.trash'), ownerShare, orphan, unregistered]));
  expect(paths).not.toContain(path.join(personal, '.anjian/artifacts'));
  expect(paths).not.toContain(path.join(personal, '.anjian/.trash'));
  expect(paths).not.toContain(personalShare);
  expect(personalPlan.roots.map((root) => root.directory)).toContain(personalShare);
  expect(personalPlan.roots.map((root) => root.directory)).not.toContain(unregistered);
  const allShared = await planMigrationSources('shared', f.options);
  expect(() => assertMigrationSourcesUnchanged(shared, allShared)).toThrow();
});

test('creates empty project resource roots and detects new projects, shares, or ownership changes on replan', async () => {
  const f = fixture(); const owner = f.project('owner-project', 'owner');
  const first = await planMigrationSources('shared', f.options);
  expect(first.roots).toHaveLength(2);
  for (const root of first.roots) expect(fs.statSync(root.directory).isDirectory()).toBe(true);
  const unchanged = await planMigrationSources('shared', f.options);
  expect(() => assertMigrationSourcesUnchanged(first, unchanged)).not.toThrow();
  f.snapshot(owner);
  const withShare = await planMigrationSources('shared', f.options);
  expect(() => assertMigrationSourcesUnchanged(first, withShare)).toThrowError(/源集合已变化/);
  f.projects[0]!.owner = 'github:123';
  const transferred = await planMigrationSources('shared', f.options);
  expect(transferred.roots.map((root) => root.id)).toEqual(withShare.roots.map((root) => root.id));
  expect(() => assertMigrationSourcesUnchanged(withShare, transferred)).toThrow();
  f.project('new-project', 'owner');
  const withProject = await planMigrationSources('shared', f.options);
  expect(() => assertMigrationSourcesUnchanged(transferred, withProject)).toThrow();
});

test('rejects symlink aliases, unsafe snapshot metadata, overlapping projects, and conflicting ownership', async () => {
  const f = fixture(); const owner = f.project('owner-project', 'owner');
  const alias = path.join(f.home, 'alias'); fs.symlinkSync(owner, alias);
  f.projects.push({ dir: alias, owner: 'owner' });
  await expect(planMigrationSources('owner', f.options)).rejects.toMatchObject({ code: 'invalid_source' });
  f.projects.pop();
  f.projects.push({ dir: path.join(owner, 'nested'), owner: 'github:123' }); fs.mkdirSync(f.projects.at(-1)!.dir);
  await expect(planMigrationSources('shared', f.options)).rejects.toMatchObject({ code: 'invalid_source' });
  f.projects.pop();
  f.projects.push({ dir: owner, owner: 'github:123' });
  await expect(planMigrationSources('shared', f.options)).rejects.toMatchObject({ code: 'invalid_source' });
  f.projects.pop();
  const outside = path.join(f.home, 'outside'); fs.mkdirSync(outside);
  f.snapshots.push({ directory: outside, project: owner });
  await expect(planMigrationSources('shared', f.options)).rejects.toMatchObject({ code: 'invalid_source' });
});

test('treats filesystem root as an overlapping ancestor', async () => {
  const f = fixture();
  f.projects.push({ dir: path.parse(f.home).root, owner: 'owner' });
  await expect(planMigrationSources('shared', f.options)).rejects.toMatchObject({ code: 'invalid_source' });
});

test('runtime exclusions match exact project state files and process temporary variants only', () => {
  for (const file of ['server-info', 'server-info.123.tmp', '.last-token', '.last-token.123.tmp', '.last-port', '.last-board-port.42.tmp'])
    expect(isRuntimeLocalArtifactStateFile(`.state/${file}`)).toBe(true);
  for (const file of ['.state/.artifact-id', '.state/artboard/a/comments.json', '.state/recordings/a.mp4', '.state/server-info.backup', '.state/server-info.abc.tmp', 'document/a/server-info', '.state/nested/server-info'])
    expect(isRuntimeLocalArtifactStateFile(file)).toBe(false);
});
