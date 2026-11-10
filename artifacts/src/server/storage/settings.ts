import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { S3TestResult } from './s3';

export interface S3Settings {
  endpoint: string;
  bucket: string;
  region: string;
  prefix: string;
  forcePathStyle: boolean;
}
export interface S3Credentials { accessKeyId: string; secretAccessKey: string; sessionToken?: string }
interface Profile extends S3Settings {
  id: string;
  scope: string;
  createdAt: number;
  credentials: { iv: string; tag: string; body: string };
}
interface State {
  version: 1;
  sharedLimitBytes: number | null;
  profiles: Profile[];
  drafts: Record<string, string>;
  tests?: Record<string, S3TestResult>;
}
export class StorageSettingsError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}
const fail = (message: string): never => { throw new StorageSettingsError(400, message); };
const validScope = (scope: string) => scope === 'shared' || scope === 'owner' || /^github:[1-9]\d*$/.test(scope);
const bytes = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;

export function validateS3Settings(input: unknown): S3Settings {
  if (!input || typeof input !== 'object') return fail('S3 配置格式无效。');
  const value = input as Record<string, unknown>;
  let endpoint: URL;
  try { endpoint = new URL(String(value.endpoint)); } catch { return fail('请输入有效的 HTTPS S3 地址。'); }
  if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.search || endpoint.hash ||
      (endpoint.pathname !== '/' && endpoint.pathname !== '') || endpoint.hostname.endsWith('.'))
    return fail('S3 地址必须是 HTTPS 服务根地址，不包含账号、路径或查询参数。');
  if (typeof value.bucket !== 'string' || !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(value.bucket) ||
      value.bucket.includes('..') || /^\d+\.\d+\.\d+\.\d+$/.test(value.bucket)) return fail('Bucket 名称无效。');
  if (typeof value.region !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(value.region)) return fail('Region 无效。');
  const prefix = typeof value.prefix === 'string' ? value.prefix.replace(/\/$/, '') : '';
  if (prefix.length > 256 || (prefix && (!/^[a-zA-Z0-9/_-]+$/.test(prefix) || prefix.split('/').some((part) => !part))))
    return fail('对象前缀只能包含字母、数字、连字符、下划线和分隔斜杠。');
  if (typeof value.forcePathStyle !== 'boolean') return fail('请选择有效的 S3 寻址方式。');
  return { endpoint: endpoint.origin, bucket: value.bucket, region: value.region, prefix, forcePathStyle: value.forcePathStyle };
}
function validateCredentials(input: unknown): S3Credentials {
  if (!input || typeof input !== 'object') return fail('请输入 S3 访问凭据。');
  const c = input as Record<string, unknown>;
  const valid = (value: unknown, max: number) => typeof value === 'string' && value.length > 0 && value.length <= max && !/[\x00-\x20\x7f]/.test(value);
  if (!valid(c.accessKeyId, 256) || !valid(c.secretAccessKey, 1024) ||
      (c.sessionToken !== undefined && !valid(c.sessionToken, 8192))) return fail('S3 访问凭据格式无效。');
  return { accessKeyId: c.accessKeyId as string, secretAccessKey: c.secretAccessKey as string,
    ...(c.sessionToken !== undefined ? { sessionToken: c.sessionToken as string } : {}) };
}

/** Immutable configuration revisions remain available for migration recovery; saving never activates storage. */
export function createStorageSettings(home: string) {
  const root = path.resolve(home, 'storage');
  const file = path.join(root, 'settings.json');
  const keyFile = path.join(root, 'credentials.key');
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  const unavailable = (): never => { throw new StorageSettingsError(503, '存储配置或加密密钥不可用，请检查服务器备份。'); };
  const regular = (target: string, max: number) => {
    const stat = fs.lstatSync(target);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > max) unavailable();
  };
  if (fs.lstatSync(root).isSymbolicLink() || !fs.lstatSync(root).isDirectory()) unavailable();
  const read = (): State => {
    try {
      regular(file, 8 * 1024 * 1024);
      const state = JSON.parse(fs.readFileSync(file, 'utf8')) as State;
      if (state.version !== 1 || !Array.isArray(state.profiles) || !state.drafts || typeof state.drafts !== 'object' || Array.isArray(state.drafts) ||
          (state.sharedLimitBytes !== null && !bytes(state.sharedLimitBytes))) return unavailable();
      const ids = new Set<string>();
      for (const p of state.profiles) {
        if (!p || !validScope(p.scope) || !/^[a-f\d-]{36}$/.test(p.id) || ids.has(p.id) || !Number.isFinite(p.createdAt) ||
            !p.credentials || ![p.credentials.iv, p.credentials.tag, p.credentials.body].every((v) => typeof v === 'string' && /^[A-Za-z0-9_-]+$/.test(v))) return unavailable();
        validateS3Settings(p); ids.add(p.id);
      }
      for (const [scope, id] of Object.entries(state.drafts))
        if (!validScope(scope) || !state.profiles.some((p) => p.scope === scope && p.id === id)) return unavailable();
      if (state.tests && (typeof state.tests !== 'object' || Array.isArray(state.tests) || Object.entries(state.tests).some(([id, result]) =>
          !ids.has(id) || !result || typeof result.ok !== 'boolean' || !Number.isFinite(result.checkedAt) || !result.steps ||
          ![result.steps.write, result.steps.read, result.steps.delete].every((value) => typeof value === 'boolean') ||
          result.ok !== (result.steps.write && result.steps.read && result.steps.delete)))) return unavailable();
      return state;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { version: 1, sharedLimitBytes: null, profiles: [], drafts: {} };
      return unavailable();
    }
  };
  const key = () => {
    try {
      if (!fs.existsSync(keyFile)) {
        // Losing the key must never silently replace it and orphan existing credentials.
        if (read().profiles.length) return unavailable();
        fs.writeFileSync(keyFile, crypto.randomBytes(32), { flag: 'wx', mode: 0o600 });
      }
      regular(keyFile, 32);
      const result = fs.readFileSync(keyFile);
      if (result.length !== 32) return unavailable();
      return result;
    } catch { return unavailable(); }
  };
  const write = (state: State) => {
    const temp = path.join(root, `.${crypto.randomUUID()}.tmp`);
    const serialized = JSON.stringify(state);
    if (Buffer.byteLength(serialized) > 8 * 1024 * 1024) throw new StorageSettingsError(409, '存储配置记录已达容量上限，请联系管理员。');
    try { fs.writeFileSync(temp, serialized, { flag: 'wx', mode: 0o600 }); fs.renameSync(temp, file); }
    finally { fs.rmSync(temp, { force: true }); }
  };
  const aad = (profile: Pick<Profile, 'id' | 'scope'>) => Buffer.from(`${profile.scope}:${profile.id}`);
  const decrypt = (profile: Profile): S3Credentials => {
    try {
      const decipher = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(profile.credentials.iv, 'base64url'));
      decipher.setAAD(aad(profile)); decipher.setAuthTag(Buffer.from(profile.credentials.tag, 'base64url'));
      return validateCredentials(JSON.parse(Buffer.concat([decipher.update(Buffer.from(profile.credentials.body, 'base64url')), decipher.final()]).toString()));
    } catch { return unavailable(); }
  };
  const summary = (p: Profile) => ({ id: p.id, scope: p.scope, endpoint: p.endpoint, bucket: p.bucket,
    region: p.region, prefix: p.prefix, forcePathStyle: p.forcePathStyle, createdAt: p.createdAt, credentialsConfigured: true as const });
  return {
    summary(scope: string) {
      if (!validScope(scope)) return fail('存储归属无效。');
      const state = read();
      const profile = state.profiles.find((p) => p.id === state.drafts[scope]);
      return { configured: Boolean(profile), profile: profile ? { ...summary(profile), test: state.tests?.[profile.id] ?? null } : null,
        ...(scope === 'shared' ? { sharedLimitBytes: state.sharedLimitBytes } : {}) };
    },
    save(scope: string, input: unknown, credentials?: unknown) {
      if (!validScope(scope)) return fail('存储归属无效。');
      const settings = validateS3Settings(input);
      const state = read();
      if (state.profiles.length >= 2000) throw new StorageSettingsError(409, '存储配置版本过多，请联系管理员。');
      const previous = state.profiles.find((p) => p.id === state.drafts[scope]);
      const secret = credentials === undefined && previous ? decrypt(previous) : validateCredentials(credentials);
      const id = crypto.randomUUID();
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
      cipher.setAAD(aad({ id, scope }));
      const body = Buffer.concat([cipher.update(JSON.stringify(secret)), cipher.final()]);
      const profile: Profile = { ...settings, id, scope, createdAt: Date.now(),
        credentials: { iv: iv.toString('base64url'), tag: cipher.getAuthTag().toString('base64url'), body: body.toString('base64url') } };
      state.profiles.push(profile); state.drafts[scope] = id; write(state);
      return summary(profile);
    },
    resolve(scope: string, id: string) {
      if (!validScope(scope)) return fail('存储归属无效。');
      const profile = read().profiles.find((p) => p.scope === scope && p.id === id);
      if (!profile) throw new StorageSettingsError(404, '存储配置不存在。');
      return { ...summary(profile), credentials: decrypt(profile) };
    },
    recordTest(scope: string, id: string, result: S3TestResult) {
      const state = read();
      if (!state.profiles.some((p) => p.id === id && p.scope === scope)) throw new StorageSettingsError(404, '存储配置不存在。');
      state.tests = { ...state.tests, [id]: result }; write(state);
    },
    setSharedLimit(limit: number) {
      if (!bytes(limit)) return fail('共享容量必须是非负整数。');
      const state = read(); state.sharedLimitBytes = limit; write(state);
    },
  };
}
