import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { createS3Objects, digestFile, type S3Objects, type StoredObject, type FileDigest } from './objects';
import { isRuntimeLocalArtifactStateFile } from './sources';
import { scanStorageRoot, type MigrationRoot, type MigrationProfile, type createStorageMigration } from './migration';

type Migration = ReturnType<typeof createStorageMigration>;
type Activation = Awaited<ReturnType<Migration['verifiedReferences']>>;
interface Binding { profileId: string; namespace: string; activatedAt: number; sequence: number; owners?: Record<string, number> }
interface FileEntry { relative: string; digest: FileDigest; object: StoredObject }
interface Root extends MigrationRoot { scope: string; directories: string[]; files: FileEntry[] }
interface State { version: 1; generation: string; bindings: Record<string, Binding>; roots: Root[] }
interface Intent { version: 1; id: string; scope: string; owner?: string; sequence: number; binding: Binding; roots: Root[] }
interface Dependencies {
  migration: Pick<Migration, 'verifiedReferences'>;
  resolveProfile(scope: string, id: string): MigrationProfile | Promise<MigrationProfile>;
  createObjects?: (settings: MigrationProfile, credentials: MigrationProfile['credentials'], namespace: string) => Pick<S3Objects, 'reference' | 'upload' | 'verify' | 'download' | 'close'>;
}
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const SCOPE = /^(shared|owner|github:[1-9]\d*)$/;
const HASH = /^[a-f0-9]{64}$/;
const beneath = (parent: string, child: string) => child === parent || child.startsWith(parent.endsWith(path.sep) ? parent : parent + path.sep);
const MAX_INDEX = 32 * 1024 * 1024;
const queues = new Map<string, Promise<unknown>>();
export class StorageBackendError extends Error {
  constructor(readonly code: 'invalid_binding' | 'unavailable' | 'source_changed' | 'not_active' | 'scope_conflict') {
    super({ invalid_binding: '活动存储记录无效。', unavailable: '存储读取或同步失败，请重试。', source_changed: '本地资源已变化，请重试。',
      not_active: '此存储尚未启用。', scope_conflict: '资源归属与活动存储不一致。' }[code]);
  }
}
const fail = (code: StorageBackendError['code']): never => { throw new StorageBackendError(code); };
const relative = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 4096 &&
  !path.isAbsolute(value) && !value.includes('\\') && !value.includes('\0') && value.split('/').every((part) => part && part !== '.' && part !== '..');
const same = (a: FileDigest, b: FileDigest) => a.bytes === b.bytes && a.sha256 === b.sha256;
const digestValid = (d: FileDigest) => d && Number.isSafeInteger(d.bytes) && d.bytes >= 0 && d.bytes <= 5 * 1024 ** 3 && HASH.test(d.sha256);
const checksum = (state: State) => crypto.createHash('sha256').update(JSON.stringify(state)).digest('hex');
function directory(target: string) {
  fs.mkdirSync(target, { recursive: true, mode: 0o700 });
  const stat = fs.lstatSync(target);
  if (!stat.isDirectory() || stat.isSymbolicLink()) fail('invalid_binding');
}
function regular(file: string) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_INDEX) fail('invalid_binding');
}
function syncDirectory(target: string) {
  const fd = fs.openSync(target, 'r');
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}
function atomic(file: string, content: string, replace: boolean) {
  const temporary = path.join(path.dirname(file), `.${crypto.randomUUID()}.tmp`);
  try {
    const fd = fs.openSync(temporary, 'wx', 0o600);
    try { fs.writeFileSync(fd, content); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    if (replace) fs.renameSync(temporary, file);
    else { fs.linkSync(temporary, file); fs.unlinkSync(temporary); }
    syncDirectory(path.dirname(file));
  } finally { fs.rmSync(temporary, { force: true }); }
}
function validate(state: State) {
  if (!state || state.version !== 1 || !UUID.test(state.generation) || !state.bindings || typeof state.bindings !== 'object' ||
      Array.isArray(state.bindings) || !Array.isArray(state.roots)) fail('invalid_binding');
  for (const [scope, binding] of Object.entries(state.bindings)) {
    if (!SCOPE.test(scope) || !binding || !UUID.test(binding.profileId) || !UUID.test(binding.namespace) || !Number.isSafeInteger(binding.activatedAt) || !Number.isSafeInteger(binding.sequence) || binding.sequence < 0) fail('invalid_binding');
  }
  for (const binding of Object.values(state.bindings)) {
    if (binding.owners !== undefined && (!binding.owners || typeof binding.owners !== 'object' || Array.isArray(binding.owners) ||
      Object.entries(binding.owners).some(([owner, sequence]) => !SCOPE.test(owner) || !Number.isSafeInteger(sequence) || sequence < 0))) fail('invalid_binding');
  }
  const ids = new Set<string>(); const directories: string[] = [];
  for (const root of state.roots) {
    if (!root || !/^[a-z][a-z0-9_-]{0,63}$/.test(root.id) || ids.has(root.id) || !state.bindings[root.scope] ||
        typeof root.directory !== 'string' || !path.isAbsolute(root.directory) || path.normalize(root.directory) !== root.directory ||
        (root.kind !== undefined && !['artifacts', 'trash', 'snapshot'].includes(root.kind)) ||
        (root.owner !== undefined && (!SCOPE.test(root.owner) || root.scope !== 'shared' && root.owner !== root.scope)) ||
        (root.exclude !== undefined && (!Array.isArray(root.exclude) || root.exclude.some((item) => !relative(item)))) ||
        !Array.isArray(root.directories) || root.directories[0] !== '' || !Array.isArray(root.files)) fail('invalid_binding');
    if (directories.some((other) => beneath(other, root.directory) || beneath(root.directory, other))) fail('scope_conflict');
    ids.add(root.id); directories.push(root.directory);
    const dirs = new Set<string>(); const files = new Set<string>();
    for (const dir of root.directories) {
      if ((dir !== '' && !relative(dir)) || dirs.has(dir)) fail('invalid_binding');
      dirs.add(dir);
    }
    for (const entry of root.files) {
      if (!entry || !relative(entry.relative) || files.has(entry.relative) || dirs.has(entry.relative) || !digestValid(entry.digest) ||
          !entry.object || !digestValid(entry.object) || !same(entry.digest, entry.object) || typeof entry.object.key !== 'string' ||
          (entry.object.versionId !== undefined && (typeof entry.object.versionId !== 'string' || !entry.object.versionId || entry.object.versionId.length > 1024))) fail('invalid_binding');
      if (root.exclude?.includes(entry.relative) || root.kind === 'artifacts' && isRuntimeLocalArtifactStateFile(entry.relative)) fail('invalid_binding');
      if (!dirs.has(path.posix.dirname(entry.relative) === '.' ? '' : path.posix.dirname(entry.relative))) fail('invalid_binding');
      files.add(entry.relative);
    }
  }
}

/** Durable payload pointers. Caller must drain writers and revalidate identity/topology around mutations. */
export function createStorageBackend(home: string, deps: Dependencies) {
  const storage = path.join(fs.realpathSync(home), 'storage'); directory(storage);
  const root = path.join(storage, 'bindings'); directory(root);
  const revisions = path.join(root, 'revisions'); directory(revisions);
  const intents = path.join(root, 'intents'); directory(intents);
  const archive = path.join(intents, 'settled'); directory(archive);
  const pointer = path.join(root, 'active.json');
  const objects = deps.createObjects ?? createS3Objects;
  const pending = new Set<string>();
  const pendingOwners = new Set<string>();
  const checkScope = (scope: string) => { if (!SCOPE.test(scope)) fail('invalid_binding'); };
  const read = (): State => {
    try {
      for (const dir of [storage, root, revisions, intents, archive]) {
        const stat = fs.lstatSync(dir); if (!stat.isDirectory() || stat.isSymbolicLink()) fail('invalid_binding');
      }
      try { fs.lstatSync(pointer); } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || fs.readdirSync(revisions).length > 0) throw error;
        return { version: 1, generation: crypto.randomUUID(), bindings: {}, roots: [] };
      }
      regular(pointer);
      const { generation } = JSON.parse(fs.readFileSync(pointer, 'utf8'));
      if (!UUID.test(generation)) fail('invalid_binding');
      const file = path.join(revisions, `${generation}.json`); regular(file);
      const { checksum: recorded, ...data } = JSON.parse(fs.readFileSync(file, 'utf8'));
      const state = data as State; validate(state);
      if (state.generation !== generation || checksum(state) !== recorded) fail('invalid_binding');
      return state;
    } catch (error) {
      if (error instanceof StorageBackendError) throw error;
      return fail('invalid_binding');
    }
  };
  const save = (state: State) => {
    state.generation = crypto.randomUUID(); validate(state);
    const content = JSON.stringify({ ...state, checksum: checksum(state) });
    if (Buffer.byteLength(content) > MAX_INDEX) fail('invalid_binding');
    atomic(path.join(revisions, `${state.generation}.json`), content, false);
    // Previous metadata revisions remain recoverable; no resource cleanup is performed here.
    atomic(pointer, JSON.stringify({ generation: state.generation }), true);
  };
  const exclusive = async <T,>(work: () => Promise<T>): Promise<T> => {
    const previous = queues.get(root) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(work); queues.set(root, current);
    try { return await current; } finally { if (queues.get(root) === current) queues.delete(root); }
  };
  const client = async (scope: string, binding: Binding) => {
    const profile = await deps.resolveProfile(scope, binding.profileId);
    if (profile.id !== binding.profileId || profile.scope !== scope) fail('invalid_binding');
    return objects(profile, profile.credentials, binding.namespace);
  };
  const readIntents = (): Intent[] => {
    try {
      const result: Intent[] = [];
      for (const name of fs.readdirSync(intents)) {
        if (name.startsWith('.') || name === 'settled') continue;
        if (!name.endsWith('.json') || !UUID.test(name.slice(0, -5))) fail('invalid_binding');
        const file = path.join(intents, name); regular(file);
        const { checksum: recorded, ...data } = JSON.parse(fs.readFileSync(file, 'utf8'));
        const intent = data as Intent;
        if (intent.version !== 1 || intent.id !== name.slice(0, -5) || !SCOPE.test(intent.scope) ||
            !Number.isSafeInteger(intent.sequence) || intent.sequence <= 0 ||
            recorded !== crypto.createHash('sha256').update(JSON.stringify(intent)).digest('hex')) fail('invalid_binding');
        validate({ version: 1, generation: intent.id, bindings: { [intent.scope]: intent.binding }, roots: intent.roots });
        if (intent.roots.some((item) => item.scope !== intent.scope) ||
            intent.owner !== undefined && (!SCOPE.test(intent.owner) || intent.scope !== 'shared' && intent.owner !== intent.scope || intent.roots.some((item) => item.owner !== intent.owner))) fail('invalid_binding');
        result.push(intent);
      }
      return result;
    } catch (error) { if (error instanceof StorageBackendError) throw error; return fail('invalid_binding'); }
  };
  const saveIntent = (intent: Intent) => {
    if (!Number.isSafeInteger(intent.sequence) || intent.sequence <= 0) fail('invalid_binding');
    const content = JSON.stringify({ ...intent, checksum: crypto.createHash('sha256').update(JSON.stringify(intent)).digest('hex') });
    if (Buffer.byteLength(content) > MAX_INDEX) fail('invalid_binding');
    atomic(path.join(intents, `${intent.id}.json`), content, false);
  };
  const outstandingIntent = (intent: Intent, scope: string, binding: Binding | undefined) => intent.scope === scope &&
    intent.binding.namespace === binding?.namespace && (intent.owner === undefined ? intent.sequence > binding.sequence :
      intent.binding.sequence === binding.sequence && intent.sequence > (binding.owners?.[intent.owner] ?? 0));
  const archiveSettled = (state: State) => {
    // Keep object provenance for accounting/cleanup without rescanning settled history on every write.
    try {
      for (const intent of readIntents()) {
        if (!outstandingIntent(intent, intent.scope, state.bindings[intent.scope]))
          fs.renameSync(path.join(intents, `${intent.id}.json`), path.join(archive, `${intent.id}.json`));
      }
      syncDirectory(intents); syncDirectory(archive);
    } catch { /* The active pointer already committed; remaining intents are safe to retry archiving. */ }
  };
  const publicSummary = (state: State, scope: string, owner?: string) => {
    const binding = state.bindings[scope];
    return { backend: binding ? 's3' as const : 'local' as const,
      ...(binding ? { profileId: binding.profileId, activatedAt: binding.activatedAt } : {}),
      bytes: state.roots.filter((item) => item.scope === scope && (owner === undefined || item.owner === owner)).reduce((sum, item) => sum + item.files.reduce((size, file) => size + file.digest.bytes, 0), 0),
      pending: pending.has(scope) || (owner === undefined ? [...pendingOwners].some((key) => key.startsWith(scope + '/')) : pendingOwners.has(`${scope}/${owner}`)) ||
        readIntents().some((intent) => (owner === undefined || intent.owner === undefined || intent.owner === owner) && outstandingIntent(intent, scope, binding)) };
  };
  const replaceRoots = (state: State, scope: string, roots: Root[], transfer: boolean, owner?: string) => {
    const incoming = new Set(roots.map((item) => item.id));
    for (const item of roots) {
      const old = state.roots.find((entry) => entry.id === item.id);
      if (old && (old.directory !== item.directory || (!transfer && (old.scope !== scope || owner !== undefined && old.owner !== owner)))) fail('scope_conflict');
    }
    state.roots = [...state.roots.filter((item) => (item.scope !== scope || owner !== undefined && item.owner !== owner) && !incoming.has(item.id)), ...roots];
    validate(state);
  };
  const checkTree = async (roots: Root[]) => {
    for (const root of roots) {
      const current = await scanStorageRoot(root);
      if (JSON.stringify(current.directories) !== JSON.stringify(root.directories) || current.files.length !== root.files.length) fail('source_changed');
      const files = new Map(root.files.map((entry) => [entry.relative, entry.digest]));
      if (current.files.some((entry) => !files.has(entry.relative) || !same(entry.digest, files.get(entry.relative)!))) fail('source_changed');
    }
  };
  // Establish an empty committed pointer before the first activation, so a failed first switch can retry.
  try { fs.lstatSync(pointer); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    for (const name of fs.readdirSync(revisions)) {
      if (!name.endsWith('.json') || !UUID.test(name.slice(0, -5))) fail('invalid_binding');
      const file = path.join(revisions, name); regular(file);
      const { checksum: recorded, ...state } = JSON.parse(fs.readFileSync(file, 'utf8'));
      validate(state);
      if (checksum(state) !== recorded || Object.keys(state.bindings).length || state.roots.length) fail('invalid_binding');
    }
    save({ version: 1, generation: crypto.randomUUID(), bindings: {}, roots: [] });
  }
  return {
    summary(scope: string, owner?: string) { checkScope(scope); if (owner !== undefined) checkScope(owner); return publicSummary(read(), scope, owner); },
    scopeFor(owner: string): string | null {
      checkScope(owner); const state = read();
      return state.bindings[owner] ? owner : state.bindings.shared ? 'shared' : null;
    },
    bindingFor(owner: string): { scope: string; namespace: string } | null {
      checkScope(owner);
      const state = read();
      const scope = state.bindings[owner] ? owner : state.bindings.shared ? 'shared' : null;
      return scope === null ? null : { scope, namespace: state.bindings[scope]!.namespace };
    },
    ownersFor(scope: string): string[] {
      checkScope(scope);
      const state = read();
      const binding = state.bindings[scope];
      if (!binding) return [];
      return [...new Set([
        ...state.roots.filter((root) => root.scope === scope).map((root) => root.owner).filter((owner): owner is string => owner !== undefined),
        ...readIntents().filter((intent) => intent.owner !== undefined && outstandingIntent(intent, scope, binding)).map((intent) => intent.owner!),
      ])].sort();
    },
    /** Call before local writes, under the same writer barrier as checkpoint/activation. */
    async markDirty(owner: string, guard: () => Promise<void>) {
      checkScope(owner);
      return exclusive(async () => {
        await guard();
        const state = read();
        const scope = state.bindings[owner] ? owner : state.bindings.shared ? 'shared' : null;
        if (scope === null) return null;
        const binding = state.bindings[scope]!;
        if (state.roots.some((item) => item.scope === scope && item.owner === undefined)) fail('scope_conflict');
        // A pre-write marker needs no source scan or network access. Its presence
        // prevents restart from restoring a deletion made before checkpoint starts.
        const outstanding = readIntents();
        if (!outstanding.some((intent) => intent.owner === owner && outstandingIntent(intent, scope, binding))) {
          saveIntent({ version: 1, id: crypto.randomUUID(), scope, owner,
            sequence: (binding.owners?.[owner] ?? 0) + 1, binding: { ...binding }, roots: [] });
        }
        return { scope, namespace: binding.namespace };
      });
    },
    /** guard must verify authority and the complete root set while the caller holds its writer barrier. */
    async activate(scope: string, jobId: string, guard: (plan: Activation) => Promise<void>, protectOwners?: readonly string[]) {
      checkScope(scope);
      return exclusive(async () => {
        const plan = await deps.migration.verifiedReferences(scope, jobId);
        if (plan.scope !== scope || plan.id !== jobId) fail('invalid_binding');
        await guard(plan);
        const state = read();
        state.bindings[scope] = { profileId: plan.profileId, namespace: plan.id, activatedAt: Date.now(), sequence: 0 };
        const roots: Root[] = plan.roots.map((entry) => ({ ...entry, scope,
          files: plan.files.filter((file) => file.rootId === entry.id).map(({ relative, digest, object }) => ({ relative, digest, object })) }));
        if (protectOwners && (protectOwners.some((owner) => !SCOPE.test(owner) || scope !== 'shared' && owner !== scope) ||
          roots.some((root) => root.owner === undefined || !protectOwners.includes(root.owner)))) fail('scope_conflict');
        await checkTree(roots); await guard(plan);
        if (scope !== 'shared' && state.bindings.shared) {
          const shared = state.bindings.shared;
          const oldRoots = state.roots.filter((entry) => entry.scope === 'shared' && entry.owner === scope);
          if (oldRoots.some((entry) => !roots.some((root) => root.id === entry.id))) fail('scope_conflict');
          const outstanding = readIntents().filter((intent) => outstandingIntent(intent, 'shared', shared));
          if (oldRoots.length && outstanding.some((intent) => intent.owner === undefined)) fail('scope_conflict');
          const sequence = Math.max(shared.owners?.[scope] ?? 0, ...outstanding.filter((intent) => intent.owner === scope).map((intent) => intent.sequence));
          shared.owners = { ...shared.owners, [scope]: sequence };
        }
        replaceRoots(state, scope, roots, true);
        // Persist every live owner's next write interval before publishing the binding.
        // Failed pointer publication leaves the old binding authoritative.
        for (const owner of new Set(protectOwners ?? [])) saveIntent({ version: 1, id: crypto.randomUUID(), scope, owner,
          sequence: 1, binding: { ...state.bindings[scope]! }, roots: [] });
        save(state); archiveSettled(state); pending.delete(scope);
        for (const key of pendingOwners) if (key.startsWith(scope + '/') || scope !== 'shared' && key === `shared/${scope}`) pendingOwners.delete(key);
        return publicSummary(state, scope);
      });
    },
    /** Checkpoint a complete scope or all roots of one owner under its writer barrier. */
    async checkpoint(scope: string, sources: MigrationRoot[], guard: () => Promise<void>, owner?: string, options: { keepDirty?: boolean; requireExistingRoots?: boolean } = {}) {
      checkScope(scope);
      if (options.keepDirty && owner === undefined) fail('scope_conflict');
      if (owner !== undefined) {
        checkScope(owner);
        if (scope !== 'shared' && scope !== owner || sources.some((source) => source.owner !== owner)) fail('scope_conflict');
      }
      return exclusive(async () => {
        const state = read(); const binding = state.bindings[scope] ?? fail('not_active');
        if (options.requireExistingRoots) {
          if (owner !== undefined && (pending.has(scope) || readIntents().some((intent) => intent.owner === undefined && outstandingIntent(intent, scope, binding)))) fail('scope_conflict');
          const known = state.roots.filter((root) => root.scope === scope && (owner === undefined || root.owner === owner));
          for (const root of known) {
            const source = sources.find((item) => item.directory === root.directory);
            if (!source || source.owner !== root.owner || source.kind !== root.kind ||
              JSON.stringify([...(source.exclude ?? [])].sort()) !== JSON.stringify([...(root.exclude ?? [])].sort())) fail('source_changed');
            const stat = await fsp.lstat(root.directory);
            if (!stat.isDirectory() || stat.isSymbolicLink()) fail('source_changed');
          }
        }
        const pendingSet = owner === undefined ? pending : pendingOwners;
        const pendingKey = owner === undefined ? scope : `${scope}/${owner}`;
        pendingSet.add(pendingKey);
        const sequence = Math.max(
          (owner === undefined ? binding.sequence : binding.owners?.[owner] ?? 0) + 1,
          ...readIntents().filter((intent) => intent.owner === owner && outstandingIntent(intent, scope, binding)).map((intent) => intent.sequence),
        );
        // Record the dirty range even when profile resolution or scanning fails before uploads.
        saveIntent({ version: 1, id: crypto.randomUUID(), scope, ...(owner !== undefined ? { owner } : {}), sequence, binding: { ...binding }, roots: [] });
        let store: Awaited<ReturnType<typeof client>> | undefined;
        try {
          const resolved = await client(scope, binding);
          store = resolved;
          const roots: Root[] = [];
          for (const source of sources) {
            if (state.roots.some((item) => item.id === source.id && item.scope !== scope)) fail('scope_conflict');
            const snapshot = await scanStorageRoot(source);
            const old = state.roots.find((item) => item.id === source.id && item.scope === scope);
            const files: FileEntry[] = snapshot.files.map((entry) => {
              const before = old?.files.find((item) => item.relative === entry.relative);
              const object = before && same(before.digest, entry.digest) && before.object.key === resolved.reference(entry.digest).key
                ? before.object : resolved.reference(entry.digest);
              return { relative: entry.relative, digest: entry.digest, object };
            });
            roots.push({ ...source, scope, directories: snapshot.directories, files });
          }
          const intent: Intent = { version: 1, id: crypto.randomUUID(), scope, ...(owner !== undefined ? { owner } : {}), sequence, binding: { ...binding }, roots };
          validate({ ...state, roots: [...state.roots.filter((item) => item.scope !== scope || owner !== undefined && item.owner !== owner), ...roots] });
          await guard();
          saveIntent(intent);
          for (const entry of roots) {
            const old = state.roots.find((item) => item.id === entry.id && item.scope === scope);
            for (const file of entry.files) {
              const before = old?.files.find((item) => item.relative === file.relative);
              if (before && same(before.digest, file.digest) && before.object.key === store.reference(file.digest).key) {
                try { file.object = await store.verify(before.object); continue; } catch { /* Retry from the retained local source; immutable corruption still fails. */ }
              }
              file.object = await store.upload(path.join(entry.directory, file.relative), file.digest);
              if (!same(file.digest, file.object) || file.object.key !== store.reference(file.digest).key) fail('invalid_binding');
            }
          }
          await checkTree(roots); await guard();
          replaceRoots(state, scope, roots, false, owner);
          if (owner === undefined) { binding.sequence = sequence; binding.owners = {}; }
          else binding.owners = { ...binding.owners, [owner]: sequence };
          if (options.keepDirty) {
            // Arm the next write interval before publishing this checkpoint.
            // A crash here must never expose a clean pointer to live writers.
            saveIntent({ version: 1, id: crypto.randomUUID(), scope, owner,
              sequence: sequence + 1, binding: { ...binding }, roots: [] });
          }
          save(state); archiveSettled(state); pendingSet.delete(pendingKey);
          if (owner === undefined) for (const key of pendingOwners) if (key.startsWith(scope + '/')) pendingOwners.delete(key);
          return publicSummary(state, scope);
        } catch (error) {
          if (error instanceof StorageBackendError) throw error;
          return fail('unavailable');
        } finally { store?.close(); }
      });
    },
    /** Hydrates missing files only. Changed local files are retained and reported for explicit retry/recovery. */
    async restore() {
      return exclusive(async () => {
        const state = read();
        const conflicts: Array<{ scope: string; rootId: string; relative: string }> = [];
        const pendingScopes: string[] = [];
        const affectedOwners: Array<{ scope: string; owner: string }> = [];
        const failures: Array<{ scope: string; owner?: string; code: StorageBackendError['code'] }> = [];
        const outstanding = readIntents();
        pending.clear(); pendingOwners.clear();
        for (const [scope, binding] of Object.entries(state.bindings)) {
          if (outstanding.some((intent) => intent.owner === undefined && outstandingIntent(intent, scope, binding))) {
            // Missing paths may be intentional deletions in the uncommitted plan, not lost cache.
            pending.add(scope); pendingScopes.push(scope); continue;
          }
          const skippedOwners = new Set(outstanding.filter((intent) => intent.owner !== undefined && outstandingIntent(intent, scope, binding)).map((intent) => intent.owner!));
          for (const owner of skippedOwners) { pendingOwners.add(`${scope}/${owner}`); affectedOwners.push({ scope, owner }); }
          let store: Awaited<ReturnType<typeof client>> | undefined;
          try {
            store = await client(scope, binding);
            for (const entry of state.roots.filter((item) => item.scope === scope && !skippedOwners.has(item.owner!))) {
              try {
                // Refuse replaced ancestors instead of following them into a different workspace.
                const chain: string[] = []; let current = entry.directory;
                while (path.dirname(current) !== current) { chain.unshift(current); current = path.dirname(current); }
                for (const dir of chain) {
                  try { const stat = await fsp.lstat(dir); if (!stat.isDirectory() || stat.isSymbolicLink()) fail('invalid_binding'); }
                  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; await fsp.mkdir(dir, { mode: 0o700 }); }
                }
                for (const relativeDir of entry.directories.slice(1)) {
                  const target = path.join(entry.directory, relativeDir);
                  try { const stat = await fsp.lstat(target); if (!stat.isDirectory() || stat.isSymbolicLink()) fail('invalid_binding'); }
                  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; await fsp.mkdir(target, { mode: 0o700 }); }
                }
                for (const file of entry.files) {
                  if (file.object.key !== store.reference(file.digest).key) fail('invalid_binding');
                  const target = path.join(entry.directory, file.relative);
                  try {
                    const local = await digestFile(target);
                    if (!same(local, file.digest)) conflicts.push({ scope, rootId: entry.id, relative: file.relative });
                    continue;
                  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
                  const temporary = await store.download(file.object, path.dirname(target));
                  try { await fsp.link(temporary, target); syncDirectory(path.dirname(target)); }
                  catch (error) {
                    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
                    if (!same(await digestFile(target), file.digest)) conflicts.push({ scope, rootId: entry.id, relative: file.relative });
                  } finally { await fsp.rm(temporary, { force: true }); }
                }
                const snapshot = await scanStorageRoot(entry);
                const known = new Map(entry.files.map((file) => [file.relative, file.digest]));
                const seen = new Set<string>();
                for (const file of snapshot.files) {
                  seen.add(file.relative);
                  if (!known.has(file.relative) || !same(known.get(file.relative)!, file.digest)) conflicts.push({ scope, rootId: entry.id, relative: file.relative });
                }
                for (const file of entry.files) if (!seen.has(file.relative)) conflicts.push({ scope, rootId: entry.id, relative: file.relative });
                const dirs = new Set(entry.directories);
                for (const dir of snapshot.directories) if (!dirs.has(dir)) conflicts.push({ scope, rootId: entry.id, relative: dir + '/' });
                const presentDirs = new Set(snapshot.directories);
                for (const dir of entry.directories) if (!presentDirs.has(dir)) conflicts.push({ scope, rootId: entry.id, relative: dir + '/' });
              } catch (error) {
                if (entry.owner !== undefined) pendingOwners.add(`${scope}/${entry.owner}`); else pending.add(scope);
                failures.push({ scope, ...(entry.owner !== undefined ? { owner: entry.owner } : {}), code: error instanceof StorageBackendError ? error.code : 'unavailable' });
              }
              if (conflicts.some((item) => item.scope === scope && item.rootId === entry.id)) {
                if (entry.owner !== undefined) pendingOwners.add(`${scope}/${entry.owner}`); else pending.add(scope);
              }
            }
          } catch (error) { pending.add(scope); failures.push({ scope, code: error instanceof StorageBackendError ? error.code : 'unavailable' }); }
          finally { store?.close(); }
        }
        return { conflicts: [...new Map(conflicts.map((item) => [JSON.stringify(item), item])).values()], pendingScopes, failures, ...(affectedOwners.length ? { pendingOwners: affectedOwners } : {}) };
      });
    },
  };
}
