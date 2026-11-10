import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { MigrationRoot } from './migration';

const SCOPE = /^(shared|owner|github:[1-9]\d*)$/;
const SNAPSHOT = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const RUNTIME_STATE = /^(?:server-info|\.last-token|\.last-port|\.last-board-port)(?:\.[0-9]+\.tmp)?$/;

/** Only project-root .state runtime files are excluded; artifact identity and collaboration state remain data. */
export function isRuntimeLocalArtifactStateFile(relative: string): boolean {
  if (!relative.startsWith('.state/')) return false;
  const name = relative.slice('.state/'.length);
  return !name.includes('/') && RUNTIME_STATE.test(name);
}

export class MigrationSourceError extends Error {
  constructor(readonly code: 'invalid_source' | 'source_changed') {
    super(code === 'source_changed' ? '迁移源集合已变化，请重新准备迁移。' : '迁移来源或归属无效。');
  }
}

export interface MigrationSourceOptions {
  projects: () => Array<{ dir: string; owner: string }>;
  snapshotsRoot: string;
  snapshots: () => Array<{ directory: string; project: string }>;
  /** Shared storage may omit resources already bound to an owner's personal storage. */
  sharedOwner?: (owner: string) => boolean;
  /** Internal runtime checkpoint: select one owner's roots without requiring other owners' caches. */
  owner?: string;
}

export interface MigrationSourcePlan {
  scope: string;
  /** Server-only paths. Never serialize this plan in an HTTP response. */
  roots: MigrationRoot[];
  /** Includes the ownership mapping, so a transfer between scopes changes the plan. */
  fingerprint: string;
}

const invalid = (): never => { throw new MigrationSourceError('invalid_source'); };
const canonicalInput = (value: string) => {
  if (typeof value !== 'string' || !path.isAbsolute(value) || path.normalize(value) !== value) invalid();
  return value;
};
const inside = (file: string, parent: string) => file === parent || file.startsWith(parent.endsWith(path.sep) ? parent : `${parent}${path.sep}`);
const overlaps = (a: string, b: string) => inside(a, b) || inside(b, a);

async function directory(value: string, create = false): Promise<string> {
  const file = canonicalInput(value);
  if (create) await fs.mkdir(file, { mode: 0o700 }).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'EEXIST') throw error;
  });
  const stat = await fs.lstat(file);
  if (!stat.isDirectory() || stat.isSymbolicLink() || await fs.realpath(file) !== file) invalid();
  return file;
}

/** Build a complete server-trusted source set before prepare and again before activation. */
export async function planMigrationSources(scope: string, options: MigrationSourceOptions): Promise<MigrationSourcePlan> {
  if (!SCOPE.test(scope)) invalid();
  if (options.owner !== undefined && (!SCOPE.test(options.owner) || scope !== 'shared' && options.owner !== scope)) invalid();
  const projects = new Map<string, string>();
  for (const project of options.projects()) {
    if (!SCOPE.test(project.owner) || project.owner === 'shared') invalid();
    const dir = canonicalInput(project.dir);
    if (options.owner === undefined || project.owner === options.owner) await directory(dir);
    if (projects.has(dir) && projects.get(dir) !== project.owner) invalid();
    projects.set(dir, project.owner);
  }
  const projectDirs = [...projects.keys()].sort();
  for (let i = 0; i < projectDirs.length; i++)
    for (let j = i + 1; j < projectDirs.length; j++)
      if (overlaps(projectDirs[i]!, projectDirs[j]!)) invalid();

  const snapshotsRoot = canonicalInput(options.snapshotsRoot);
  let hasSnapshots = true;
  try { await directory(snapshotsRoot); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; hasSnapshots = false; }
  if (projectDirs.some((project) => overlaps(project, snapshotsRoot))) invalid();
  const indexed = new Map<string, string>();
  for (const snapshot of options.snapshots()) {
    const file = canonicalInput(snapshot.directory);
    if (path.dirname(file) !== snapshotsRoot || !SNAPSHOT.test(path.basename(file))) invalid();
    const project = canonicalInput(snapshot.project);
    const owner = projects.get(project) ?? 'shared';
    if (options.owner === undefined || owner === options.owner) await directory(file);
    if (indexed.has(file) && indexed.get(file) !== owner) invalid();
    indexed.set(file, owner);
  }

  const sharedOwners = new Map<string, boolean>();
  const includeOwner = (owner: string) => {
    if (options.owner !== undefined && owner !== options.owner) return false;
    if (scope !== 'shared') return scope === owner;
    if (owner === 'shared') return true;
    let included = sharedOwners.get(owner);
    if (included === undefined) {
      included = options.sharedOwner?.(owner) ?? true;
      if (typeof included !== 'boolean') invalid();
      sharedOwners.set(owner, included);
    }
    return included;
  };

  const selected: Array<{ directory: string; kind: NonNullable<MigrationRoot['kind']>; owner: string }> = [];
  for (const [project, owner] of projects) {
    if (!includeOwner(owner)) continue;
    const base = path.join(project, '.anjian');
    await directory(base, true);
    for (const [name, kind] of [['artifacts', 'artifacts'], ['.trash', 'trash']] as const) {
      const file = await directory(path.join(base, name), true);
      selected.push({ directory: file, kind, owner });
    }
  }
  for (const name of (hasSnapshots ? await fs.readdir(snapshotsRoot) : []).sort()) {
    const file = path.join(snapshotsRoot, name);
    if (!SNAPSHOT.test(name)) {
      if (options.owner === undefined || options.owner === 'shared') invalid();
      continue;
    }
    const owner = indexed.get(file) ?? 'shared';
    if (options.owner === undefined || owner === options.owner) await directory(file);
    if (includeOwner(owner)) selected.push({ directory: file, kind: 'snapshot', owner });
  }
  selected.sort((a, b) => a.directory < b.directory ? -1 : a.directory > b.directory ? 1 : a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0);
  const roots: MigrationRoot[] = selected.map(({ directory: file, kind, owner }) => ({
    id: `src_${crypto.createHash('sha256').update(`${kind}\0${file}`).digest('hex').slice(0, 40)}`,
    directory: file,
    kind,
    owner,
  }));
  if (new Set(roots.map((root) => root.id)).size !== roots.length) invalid();
  return {
    scope, roots,
    fingerprint: crypto.createHash('sha256').update(JSON.stringify(selected)).digest('hex'),
  };
}

export function assertMigrationSourcesUnchanged(expected: MigrationSourcePlan, current: MigrationSourcePlan): void {
  if (expected.scope !== current.scope || expected.fingerprint !== current.fingerprint)
    throw new MigrationSourceError('source_changed');
}
