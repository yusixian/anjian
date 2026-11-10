import crypto from 'node:crypto';
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createS3Objects, digestFile, StorageObjectError } from './objects';
import { isRuntimeLocalArtifactStateFile } from './sources';
import type { FileDigest, S3Objects, StoredObject } from './objects';
import type { S3Credentials, S3Settings } from './settings';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const SCOPE = /^(shared|owner|github:[1-9]\d*)$/;
const ROOT_ID = /^[a-z][a-z0-9_-]{0,63}$/;
const HASH = /^[a-f0-9]{64}$/;
const MAX_MANIFEST_BYTES = 32 * 1024 * 1024;
const activeScopes = new Set<string>();

export type MigrationState = 'prepared' | 'copying' | 'verified' | 'failed';
export class StorageMigrationError extends Error {
  constructor(readonly code: 'invalid_request' | 'busy' | 'not_found' | 'corrupt_manifest' | 'profile_changed' | 'source_changed' | 'verification_failed', message: string) {
    super(message);
  }
}
export interface MigrationRoot { id: string; directory: string; kind?: 'artifacts' | 'trash' | 'snapshot'; owner?: string; exclude?: string[] }
export interface MigrationProfile extends S3Settings { id: string; scope: string; credentials: S3Credentials }
export interface MigrationFileEntry { rootId: string; relative: string; digest: FileDigest; object?: StoredObject }
type Entry = MigrationFileEntry;
interface RootSnapshot extends MigrationRoot { exclude: string[]; directories: string[] }
interface ManifestBody {
  version: 1; id: string; scope: string; profileId: string; profileFingerprint: string;
  createdAt: number; updatedAt: number; state: MigrationState; error: string | null;
  roots: RootSnapshot[]; files: Entry[];
}
interface Manifest extends ManifestBody { checksum: string }
export interface MigrationSummary {
  id: string; scope: string; profileId: string; state: MigrationState; createdAt: number; updatedAt: number;
  files: number; bytes: number; verifiedFiles: number; verifiedBytes: number; error: string | null;
}
interface Dependencies {
  resolveProfile(scope: string, profileId: string): MigrationProfile | Promise<MigrationProfile>;
  createObjects?: (settings: S3Settings, credentials: S3Credentials, namespace: string) => Pick<S3Objects, 'reference' | 'upload' | 'verify' | 'close'>;
}
const invalid = (message: string): never => { throw new StorageMigrationError('invalid_request', message); };
const corrupt = (): never => { throw new StorageMigrationError('corrupt_manifest', '迁移记录损坏或格式无效。'); };
const sourceChanged = (): never => { throw new StorageMigrationError('source_changed', '源文件或目录已变化，请重新准备迁移。'); };
const validRelative = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 4096 &&
  !path.isAbsolute(value) && !value.includes('\\') && !value.includes('\0') && value.split('/').every((part) => part && part !== '.' && part !== '..');
const validDigest = (value: unknown): value is FileDigest => !!value && typeof value === 'object' &&
  Number.isSafeInteger((value as FileDigest).bytes) && (value as FileDigest).bytes >= 0 && (value as FileDigest).bytes <= 5 * 1024 ** 3 && HASH.test((value as FileDigest).sha256);
const equalDigest = (a: FileDigest, b: FileDigest) => a.bytes === b.bytes && a.sha256 === b.sha256;
const inside = (file: string, parent: string) => file === parent || file.startsWith(parent.endsWith(path.sep) ? parent : `${parent}${path.sep}`);
const profileFingerprint = (profile: MigrationProfile) => crypto.createHash('sha256').update(JSON.stringify({
  endpoint: profile.endpoint, bucket: profile.bucket, region: profile.region,
  prefix: profile.prefix, forcePathStyle: profile.forcePathStyle,
})).digest('hex');
const checksum = (body: ManifestBody) => crypto.createHash('sha256').update(JSON.stringify(body)).digest('hex');
const summary = (m: ManifestBody): MigrationSummary => ({
  id: m.id, scope: m.scope, profileId: m.profileId, state: m.state, createdAt: m.createdAt, updatedAt: m.updatedAt,
  files: m.files.length, bytes: m.files.reduce((n, file) => n + file.digest.bytes, 0),
  verifiedFiles: m.files.filter((file) => !!file.object).length,
  verifiedBytes: m.files.reduce((n, file) => n + (file.object ? file.digest.bytes : 0), 0), error: m.error,
});
const directoryFor = (root: string, scope: string) => path.join(root, Buffer.from(scope).toString('base64url'));
const manifestFile = (root: string, scope: string, id: string) => path.join(directoryFor(root, scope), `${id}.json`);
async function ensureDirectory(directory: string) {
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const stat = await fs.lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) invalid('迁移目录无效。');
}
async function syncDirectory(directory: string) {
  const handle = await fs.open(directory, 'r');
  try { await handle.sync(); } finally { await handle.close(); }
}
async function save(file: string, body: ManifestBody, createOnly = false) {
  const data = JSON.stringify({ ...body, checksum: checksum(body) });
  if (Buffer.byteLength(data) > MAX_MANIFEST_BYTES) invalid('迁移记录过大。');
  const temporary = path.join(path.dirname(file), `.${crypto.randomUUID()}.tmp`);
  const handle = await fs.open(temporary, 'wx', 0o600);
  try {
    await handle.writeFile(data); await handle.sync(); await handle.close();
    if (createOnly) { await fs.link(temporary, file); await fs.rm(temporary); }
    else await fs.rename(temporary, file);
    await syncDirectory(path.dirname(file));
  } catch (error) { await handle.close().catch(() => undefined); await fs.rm(temporary, { force: true }); throw error; }
}
function validateManifest(value: unknown, scope: string, id: string): ManifestBody {
  if (!value || typeof value !== 'object') return corrupt();
  const { checksum: recorded, ...body } = value as Manifest;
  const m = body as ManifestBody;
  if (m.version !== 1 || m.scope !== scope || m.id !== id || !UUID.test(m.id) || !UUID.test(m.profileId) ||
      !HASH.test(m.profileFingerprint) || !Number.isSafeInteger(m.createdAt) || !Number.isSafeInteger(m.updatedAt) ||
      !['prepared', 'copying', 'verified', 'failed'].includes(m.state) ||
      (m.error !== null && !['source_changed', 'verification_failed', 'profile_changed'].includes(m.error)) ||
      !Array.isArray(m.roots) || !Array.isArray(m.files) || m.roots.length === 0 ||
      (m.state === 'verified' && m.files.some((file) => !file.object)) ||
      typeof recorded !== 'string' || recorded !== checksum(m)) return corrupt();
  const rootIds = new Map<string, RootSnapshot>();
  for (const root of m.roots) {
    if (!root || !ROOT_ID.test(root.id) || rootIds.has(root.id) || typeof root.directory !== 'string' ||
        !path.isAbsolute(root.directory) || path.normalize(root.directory) !== root.directory ||
        (root.kind !== undefined && !['artifacts', 'trash', 'snapshot'].includes(root.kind)) ||
        (root.owner !== undefined && (!SCOPE.test(root.owner) || scope !== 'shared' && root.owner !== scope)) ||
        !Array.isArray(root.exclude) || root.exclude.some((item) => !validRelative(item)) ||
        new Set(root.exclude).size !== root.exclude.length ||
        !Array.isArray(root.directories) || root.directories[0] !== '') return corrupt();
    rootIds.set(root.id, root);
    const seen = new Set<string>();
    for (const directory of root.directories) {
      if (directory !== '' && !validRelative(directory) || seen.has(directory)) return corrupt();
      seen.add(directory);
    }
  }
  const entries = new Set<string>();
  for (const file of m.files) {
    if (!file || !rootIds.has(file.rootId) || !validRelative(file.relative) || !validDigest(file.digest)) return corrupt();
    const key = `${file.rootId}\0${file.relative}`;
    if (entries.has(key)) return corrupt();
    entries.add(key);
    const root = rootIds.get(file.rootId)!;
    if (root.exclude.includes(file.relative) || root.kind === 'artifacts' && isRuntimeLocalArtifactStateFile(file.relative)) return corrupt();
    if (file.object && (!validDigest(file.object) || !equalDigest(file.digest, file.object) ||
        typeof file.object.key !== 'string' || !file.object.key ||
        (file.object.versionId !== undefined && (typeof file.object.versionId !== 'string' || !file.object.versionId)))) return corrupt();
  }
  return m;
}
async function load(file: string, scope: string, id: string): Promise<ManifestBody> {
  let raw: string;
  try {
    for (const directory of [path.dirname(path.dirname(path.dirname(file))), path.dirname(path.dirname(file)), path.dirname(file)]) {
      const parent = await fs.lstat(directory);
      if (!parent.isDirectory() || parent.isSymbolicLink()) return corrupt();
    }
    const stat = await fs.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_MANIFEST_BYTES) return corrupt();
    raw = await fs.readFile(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new StorageMigrationError('not_found', '迁移记录不存在。');
    throw error;
  }
  try { return validateManifest(JSON.parse(raw), scope, id); } catch (error) {
    if (error instanceof StorageMigrationError) throw error;
    return corrupt();
  }
}
export async function scanStorageRoot(root: MigrationRoot): Promise<{ directories: string[]; files: MigrationFileEntry[] }> {
  const stat = await fs.lstat(root.directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) invalid('源目录必须是真实目录。');
  if (await fs.realpath(root.directory) !== root.directory) invalid('源目录真实路径已变化。');
  const exclude = new Set(root.exclude ?? []);
  const directories = ['']; const files: Entry[] = [];
  async function visit(relative: string) {
    const directory = relative ? path.join(root.directory, relative) : root.directory;
    const names = (await fs.readdir(directory)).sort();
    for (const name of names) {
      if (!validRelative(name)) invalid('源目录含无效名称。');
      const child = relative ? `${relative}/${name}` : name;
      const target = path.join(root.directory, child);
      const stat = await fs.lstat(target);
      if (stat.isSymbolicLink()) invalid('源目录含符号链接。');
      if (root.kind === 'artifacts' && isRuntimeLocalArtifactStateFile(child)) {
        if (!stat.isFile()) invalid('运行态排除路径必须是普通文件。');
        continue;
      }
      if (exclude.has(child)) {
        if (!stat.isFile()) invalid('精确排除路径必须是普通文件。');
        continue;
      }
      if (stat.isDirectory()) { directories.push(child); await visit(child); }
      else if (stat.isFile()) files.push({ rootId: root.id, relative: child, digest: await digestFile(target) });
      else invalid('源目录含不支持的特殊文件。');
    }
  }
  await visit('');
  return { directories, files };
}
async function checkTree(m: ManifestBody) {
  const expectedDirectories = new Map(m.roots.map((root) => [root.id, root.directories]));
  const expectedFiles = new Map(m.files.map((file) => [`${file.rootId}\0${file.relative}`, file.digest]));
  try {
    for (const root of m.roots) {
      const current = await scanStorageRoot(root);
      const expected = expectedDirectories.get(root.id)!;
      if (current.directories.length !== expected.length || current.directories.some((item, index) => item !== expected[index])) return sourceChanged();
      for (const file of current.files) {
        const digest = expectedFiles.get(`${file.rootId}\0${file.relative}`);
        if (!digest || !equalDigest(file.digest, digest)) return sourceChanged();
      }
      if (current.files.length !== m.files.filter((file) => file.rootId === root.id).length) return sourceChanged();
    }
  } catch (error) {
    if (error instanceof StorageMigrationError && error.code === 'source_changed') throw error;
    return sourceChanged();
  }
}
async function exclusive<T>(scope: string, action: () => Promise<T>): Promise<T> {
  if (activeScopes.has(scope)) throw new StorageMigrationError('busy', '此归属的迁移正在进行。');
  activeScopes.add(scope);
  try { return await action(); } finally { activeScopes.delete(scope); }
}

/** Copies a fixed local snapshot to a fixed immutable profile. Never changes active storage or local files. */
export function createStorageMigration(home: string, deps: Dependencies) {
  const storage = path.join(fsSync.realpathSync(home), 'storage');
  const store = path.join(storage, 'migrations');
  const createObjects = deps.createObjects ?? createS3Objects;
  const validScope = (scope: string) => { if (!SCOPE.test(scope)) invalid('迁移归属无效。'); };
  const validId = (id: string) => { if (!UUID.test(id)) invalid('迁移标识无效。'); };
  const resolve = async (scope: string, id: string) => {
    const profile = await deps.resolveProfile(scope, id);
    if (!profile || profile.id !== id || profile.scope !== scope) throw new StorageMigrationError('profile_changed', '存储配置版本与迁移记录不一致。');
    return profile;
  };
  return {
    async prepare(scope: string, profileId: string, roots: MigrationRoot[]): Promise<MigrationSummary> {
      validScope(scope); validId(profileId);
      return exclusive(scope, async () => {
        if (!Array.isArray(roots) || roots.length === 0) invalid('必须指定源目录。');
        const profile = await resolve(scope, profileId);
        const ids = new Set<string>(); const directories: string[] = []; const canonicalRoots: MigrationRoot[] = [];
        for (const root of roots) {
          if (!root || !ROOT_ID.test(root.id) || ids.has(root.id) || typeof root.directory !== 'string' || !path.isAbsolute(root.directory) ||
              (root.kind !== undefined && !['artifacts', 'trash', 'snapshot'].includes(root.kind)) ||
              (root.owner !== undefined && (!SCOPE.test(root.owner) || scope !== 'shared' && root.owner !== scope))) invalid('源目录标识、归属或路径无效。');
          if (root.exclude !== undefined && (!Array.isArray(root.exclude) || root.exclude.some((item) => !validRelative(item)) ||
              new Set(root.exclude).size !== root.exclude.length)) invalid('源目录排除路径无效。');
          const directory = path.normalize(root.directory);
          if (directory !== root.directory) invalid('源目录路径无效。');
          const stat = await fs.lstat(directory);
          if (!stat.isDirectory() || stat.isSymbolicLink()) invalid('源目录必须是真实目录。');
          const canonical = await fs.realpath(directory);
          if (inside(canonical, store) || inside(store, canonical)) invalid('源目录不能包含迁移记录。');
          if (directories.some((other) => inside(canonical, other) || inside(other, canonical))) invalid('源目录不能重叠。');
          ids.add(root.id); directories.push(canonical); canonicalRoots.push({ ...root, directory: canonical });
        }
        const snapshots: RootSnapshot[] = []; const files: Entry[] = [];
        for (const root of canonicalRoots) {
          const fixed = { ...root, exclude: [...(root.exclude ?? [])].sort() };
          const result = await scanStorageRoot(fixed);
          snapshots.push({ ...fixed, directories: result.directories }); files.push(...result.files);
        }
        await ensureDirectory(storage); await ensureDirectory(store); await ensureDirectory(directoryFor(store, scope));
        const id = crypto.randomUUID();
        const now = Date.now();
        const manifest: ManifestBody = { version: 1, id, scope, profileId, profileFingerprint: profileFingerprint(profile),
          createdAt: now, updatedAt: now, state: 'prepared', error: null, roots: snapshots, files };
        await save(manifestFile(store, scope, id), manifest, true);
        return summary(manifest);
      });
    },
    async resume(scope: string, id: string): Promise<MigrationSummary> {
      validScope(scope); validId(id);
      return exclusive(scope, async () => {
        const file = manifestFile(store, scope, id);
        const m = await load(file, scope, id);
        const profile = await resolve(scope, m.profileId);
        if (profileFingerprint(profile) !== m.profileFingerprint) throw new StorageMigrationError('profile_changed', '存储配置版本内容已变化。');
        const objects = createObjects(profile, profile.credentials, m.id);
        const persist = async () => { m.updatedAt = Date.now(); await save(file, m); };
        try {
          await checkTree(m);
          m.state = 'copying'; m.error = null; await persist();
          for (const entry of m.files) {
            const expected = objects.reference(entry.digest);
            if (entry.object) {
              if (entry.object.key !== expected.key) return corrupt();
              try { entry.object = await objects.verify(entry.object); await persist(); continue; }
              catch { entry.object = undefined; await persist(); }
            }
            const root = m.roots.find((item) => item.id === entry.rootId)!;
            const source = path.join(root.directory, entry.relative);
            let digest: FileDigest;
            try { digest = await digestFile(source); } catch { return sourceChanged(); }
            if (!equalDigest(digest, entry.digest)) return sourceChanged();
            const object = await objects.upload(source, entry.digest);
            if (object.key !== expected.key || !equalDigest(object, entry.digest)) throw new StorageMigrationError('verification_failed', '上传校验结果与迁移记录不一致。');
            // A second local hash detects replacements between pre-upload inspection and upload.
            try { digest = await digestFile(source); } catch { return sourceChanged(); }
            if (!equalDigest(digest, entry.digest)) return sourceChanged();
            entry.object = object; await persist();
          }
          await checkTree(m);
          m.state = 'verified'; m.error = null; await persist();
          return summary(m);
        } catch (error) {
          if (error instanceof StorageMigrationError && error.code === 'corrupt_manifest') throw error;
          if (error instanceof StorageObjectError && error.code === 'source_changed') error = new StorageMigrationError('source_changed', '源文件已变化，请重新准备迁移。');
          m.state = 'failed';
          m.error = error instanceof StorageMigrationError && error.code === 'source_changed' ? 'source_changed' : 'verification_failed';
          await persist();
          if (error instanceof StorageMigrationError) throw error;
          throw new StorageMigrationError('verification_failed', '迁移复制或校验失败，请检查存储连接后重试。');
        } finally { objects.close(); }
      });
    },
    async status(scope: string, id: string): Promise<MigrationSummary> {
      validScope(scope); validId(id);
      return summary(await load(manifestFile(store, scope, id), scope, id));
    },
    /** Server-only activation input. Call only after checking state and draining writers. */
    async verifiedReferences(scope: string, id: string) {
      validScope(scope); validId(id);
      return exclusive(scope, async () => {
        const m = await load(manifestFile(store, scope, id), scope, id);
        if (m.state !== 'verified' || m.files.some((file) => !file.object)) throw new StorageMigrationError('verification_failed', '迁移尚未完成校验。');
        const profile = await resolve(scope, m.profileId);
        if (profileFingerprint(profile) !== m.profileFingerprint) throw new StorageMigrationError('profile_changed', '存储配置版本内容已变化。');
        await checkTree(m);
        const objects = createObjects(profile, profile.credentials, m.id);
        try {
          for (const file of m.files) {
            if (file.object!.key !== objects.reference(file.digest).key) return corrupt();
            await objects.verify(file.object!);
          }
        } catch (error) {
          if (error instanceof StorageMigrationError && error.code === 'corrupt_manifest') throw error;
          throw new StorageMigrationError('verification_failed', '远端对象复核失败，请重新运行迁移校验。');
        } finally { objects.close(); }
        await checkTree(m);
        return {
          id: m.id, scope: m.scope, profileId: m.profileId,
          roots: m.roots.map((root) => ({ ...root, directories: [...root.directories], exclude: [...root.exclude] })),
          files: m.files.map((file) => ({ rootId: file.rootId, relative: file.relative, digest: file.digest, object: file.object! })),
        };
      });
    },
  };
}
