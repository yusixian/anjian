import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { createStorageSettings, validateS3Settings } from '../src/server/storage/settings';
const homes: string[] = [];
afterEach(() => { for (const home of homes.splice(0)) fs.rmSync(home, { recursive: true, force: true }); });
function fixture() { const home = fs.mkdtempSync(path.join(os.tmpdir(), 'anjian-storage-')); homes.push(home); return { home, store: createStorageSettings(home) }; }
const settings = { endpoint: 'https://objects.example', bucket: 'my-bucket', region: 'auto', prefix: 'anjian/', forcePathStyle: true };
const credentials = { accessKeyId: 'example-access-key', secretAccessKey: 'never-print-this-secret', sessionToken: 'temporary-session-token' };

test('stores encrypted credentials and returns only safe metadata', () => {
  const { home, store } = fixture();
  expect(store.summary('shared')).toEqual({ configured: false, profile: null, sharedLimitBytes: null });
  const profile = store.save('shared', settings, credentials);
  expect(profile.prefix).toBe('anjian');
  const serialized = fs.readFileSync(path.join(home, 'storage/settings.json'), 'utf8');
  for (const secret of Object.values(credentials)) {
    expect(serialized).not.toContain(secret);
    expect(JSON.stringify(profile)).not.toContain(secret);
    expect(JSON.stringify(store.summary('shared'))).not.toContain(secret);
  }
  expect(fs.statSync(path.join(home, 'storage/credentials.key')).mode & 0o777).toBe(0o600);
  expect(createStorageSettings(home).resolve('shared', profile.id).credentials).toEqual(credentials);
});

test('credential reuse stays within the same scope and old revisions remain readable', () => {
  const { store } = fixture();
  const original = store.save('github:2', settings, credentials);
  const next = store.save('github:2', { ...settings, bucket: 'next-bucket' });
  expect(next.id).not.toBe(original.id);
  expect(store.resolve('github:2', next.id).credentials).toEqual(credentials);
  expect(store.resolve('github:2', original.id).bucket).toBe('my-bucket');
  expect(() => store.save('github:3', settings)).toThrow('凭据');
  expect(() => store.resolve('github:3', original.id)).toThrow('不存在');
  expect(store.summary('github:2').profile!.id).toBe(next.id);
  expect(store.summary('github:2')).not.toHaveProperty('active');
});

test('ciphertext cannot be transplanted across scopes or revised identities', () => {
  const { home, store } = fixture();
  const a = store.save('github:2', settings, credentials);
  const b = store.save('github:3', settings, credentials);
  const file = path.join(home, 'storage/settings.json');
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  data.profiles[1].credentials = data.profiles[0].credentials;
  fs.writeFileSync(file, JSON.stringify(data));
  expect(() => store.resolve('github:3', b.id)).toThrow('加密密钥不可用');
  expect(store.resolve('github:2', a.id).credentials).toEqual(credentials);
});

test('missing keys and corrupt indexes fail closed without generating replacement credentials', () => {
  const { home, store } = fixture();
  const profile = store.save('shared', settings, credentials);
  const key = path.join(home, 'storage/credentials.key');
  fs.unlinkSync(key);
  expect(() => store.resolve('shared', profile.id)).toThrow('加密密钥不可用');
  expect(() => store.save('shared', settings, credentials)).toThrow('加密密钥不可用');
  expect(fs.existsSync(key)).toBe(false);
  fs.writeFileSync(path.join(home, 'storage/settings.json'), '{}');
  expect(() => store.summary('shared')).toThrow('配置或加密密钥不可用');
});

test('unsafe URLs, paths and quota values are rejected; zero remains a real limit', () => {
  const { store } = fixture();
  for (const endpoint of ['http://objects.example', 'https://user:secret@objects.example', 'https://objects.example/a', 'https://objects.example?secret=x', 'https://objects.example#secret'])
    expect(() => validateS3Settings({ ...settings, endpoint })).toThrow();
  expect(validateS3Settings({ ...settings, endpoint: 'https://objects.example:9443' }).endpoint).toBe('https://objects.example:9443');
  for (const prefix of ['../escape', '/absolute', 'double//slash']) expect(() => validateS3Settings({ ...settings, prefix })).toThrow();
  for (const limit of [-1, NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1]) expect(() => store.setSharedLimit(limit)).toThrow();
  store.setSharedLimit(0); expect(store.summary('shared').sharedLimitBytes).toBe(0);
});

test('symlinked metadata and key paths are rejected', () => {
  const { home, store } = fixture();
  const outside = path.join(home, 'outside'); fs.writeFileSync(outside, Buffer.alloc(32));
  fs.symlinkSync(outside, path.join(home, 'storage/credentials.key'));
  expect(() => store.save('shared', settings, credentials)).toThrow('加密密钥不可用');
  fs.symlinkSync(outside, path.join(home, 'storage/settings.json'));
  expect(() => store.summary('shared')).toThrow('配置或加密密钥不可用');
});
