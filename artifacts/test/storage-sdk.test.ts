import { Readable } from 'node:stream';
import { expect, test, vi } from 'vitest';
const calls = vi.hoisted(() => [] as Array<{ method: string; hostname: string; query: Record<string, string>; headers: Record<string, string> }>);
const content = Buffer.from('probe-data');
vi.mock('@smithy/node-http-handler', () => ({ NodeHttpHandler: class {
  async handle(request: typeof calls[number]) {
    calls.push(request);
    return { response: { statusCode: request.method === 'DELETE' ? 204 : 200,
      headers: request.method === 'PUT' ? { 'x-amz-version-id': 'version-one' } : {},
      body: Readable.from(request.method === 'GET' ? [content] : []),
    } };
  }
  destroy() {}
} }));
import { createS3Probe } from '../src/server/storage/s3';

test('official SDK signs requests and targets the exact uploaded version during read and cleanup', async () => {
  const store = createS3Probe({ endpoint: 'https://objects.example', bucket: 'test-bucket', region: 'auto', prefix: '', forcePathStyle: true },
    { accessKeyId: 'test-access', secretAccessKey: 'test-secret' });
  try {
    await store.put('test-key', content);
    expect(await store.get('test-key')).toEqual(content);
    await store.remove('test-key');
    expect(calls.map((call) => call.method)).toEqual(['PUT', 'GET', 'DELETE']);
    expect(calls.every((call) => call.hostname === 'objects.example')).toBe(true);
    expect(calls[0]!.headers.authorization).toContain('AWS4-HMAC-SHA256');
    expect(calls[0]!.headers['if-none-match']).toBe('*');
    expect(calls[1]!.query.versionId).toBe('version-one');
    expect(calls[2]!.query.versionId).toBe('version-one');
  } finally { store.close(); }
});
