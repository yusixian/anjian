import { expect, test, vi } from 'vitest';
import { testS3Connection, type ProbeStore } from '../src/server/storage/s3';
const settings = { endpoint: 'https://objects.example', bucket: 'bucket', region: 'auto', prefix: 'private', forcePathStyle: true };
const credentials = { accessKeyId: 'secret-id', secretAccessKey: 'secret' };
function probe() {
  let stored = Buffer.alloc(0);
  const store: ProbeStore = {
    put: vi.fn(async (_key, content) => { stored = content; }),
    get: vi.fn(async () => stored), remove: vi.fn(async () => {}), close: vi.fn(),
  };
  return store;
}
test('connection test verifies a random payload and cleans up only its own random key', async () => {
  const store = probe();
  const result = await testS3Connection(settings, credentials, () => store);
  expect(result.ok).toBe(true);
  expect(result.steps).toEqual({ write: true, read: true, delete: true });
  const key = vi.mocked(store.put).mock.calls[0]![0];
  expect(key).toMatch(/^private\/_anjian-check\/[a-f0-9-]{36}$/);
  expect(store.get).toHaveBeenCalledWith(key);
  expect(store.remove).toHaveBeenCalledWith(key);
  expect(store.close).toHaveBeenCalledOnce();
  expect(JSON.stringify(result)).not.toContain('secret');
});
test('read-back corruption fails verification but still cleans up', async () => {
  const store = probe(); vi.mocked(store.get).mockResolvedValue(Buffer.from('corrupt'));
  const result = await testS3Connection(settings, credentials, () => store);
  expect(result.ok).toBe(false); expect(result.steps.read).toBe(false);
  expect(result.steps.delete).toBe(true); expect(store.close).toHaveBeenCalledOnce();
});
test('a lost write response still attempts cleanup, and cleanup failures expose an actionable key', async () => {
  const store = probe();
  vi.mocked(store.put).mockRejectedValue(new Error('secret endpoint failure'));
  vi.mocked(store.remove).mockRejectedValue(new Error('secret deletion error'));
  const result = await testS3Connection(settings, credentials, () => store);
  expect(result.ok).toBe(false); expect(store.remove).toHaveBeenCalledOnce();
  expect(result.cleanupKey).toMatch(/^private\/_anjian-check\//);
  expect(result.error).not.toContain('secret'); expect(store.close).toHaveBeenCalledOnce();
});
test('unsafe endpoints fail before creating a connection', async () => {
  const result = await testS3Connection({ ...settings, endpoint: 'https://127.0.0.1' }, credentials);
  expect(result.ok).toBe(false); expect(result.steps).toEqual({ write: false, read: false, delete: false });
});

test('compatibility errors are not reported as missing permissions and cleanup keeps the original failure', async () => {
  const store = probe();
  vi.mocked(store.get).mockRejectedValue(Object.assign(new Error('secret provider detail'), { name: 'NotImplemented', $metadata: { httpStatusCode: 501 } }));
  vi.mocked(store.remove).mockRejectedValue(Object.assign(new Error('secret provider detail'), { name: 'AccessDenied', $metadata: { httpStatusCode: 403 } }));
  const result = await testS3Connection(settings, credentials, () => store);
  expect(result.error).toContain('S3 读回校验失败');
  expect(result.error).toContain('S3 兼容性');
  expect(result.error).toContain('测试对象清理失败');
  expect(result.error).toContain('对应操作权限');
  expect(result.error).not.toContain('secret');
});
test.each([
  ['SignatureDoesNotMatch', 403, '身份验证失败'],
  ['AccessDenied', 403, '对应操作权限'],
  ['TimeoutError', undefined, '请求超时'],
  ['NotImplemented', 501, 'S3 兼容性'],
  ['NoSuchBucket', 404, '不存在'],
] as const)('classifies %s without exposing provider messages', async (name, status, expected) => {
  const store = probe();
  vi.mocked(store.get).mockRejectedValue(Object.assign(new Error('secret response'), { name, $metadata: { httpStatusCode: status } }));
  const result = await testS3Connection(settings, credentials, () => store);
  expect(result.error).toContain(expected);
  expect(result.error).not.toContain('secret');
});
