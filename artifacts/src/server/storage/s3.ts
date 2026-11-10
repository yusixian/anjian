import crypto from 'node:crypto';
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import type { S3Credentials, S3Settings } from './settings';
import { createStorageClient } from './client';

export interface ProbeStore {
  put(key: string, content: Buffer): Promise<void>;
  get(key: string): Promise<Buffer>;
  remove(key: string): Promise<void>;
  close(): void;
}
export function createS3Probe(settings: S3Settings, credentials: S3Credentials): ProbeStore {
  const { client, close } = createStorageClient(settings, credentials);
  const versions = new Map<string, string>();
  const acknowledged = new Set<string>();
  return {
    async put(key, content) {
      const result = await client.send(new PutObjectCommand({ Bucket: settings.bucket, Key: key, Body: content, ContentType: 'application/octet-stream', IfNoneMatch: '*' }), { abortSignal: AbortSignal.timeout(15000) });
      acknowledged.add(key);
      if (result.VersionId) versions.set(key, result.VersionId);
    },
    async get(key) {
      const result = await client.send(new GetObjectCommand({ Bucket: settings.bucket, Key: key, VersionId: versions.get(key) }), { abortSignal: AbortSignal.timeout(15000) });
      if (!result.Body) throw new Error('Empty S3 response');
      const stream = result.Body as AsyncIterable<Uint8Array> & { destroy?: () => void };
      const chunks: Buffer[] = []; let size = 0;
      try {
        for await (const chunk of stream) {
          size += chunk.length;
          if (size > 16_384) throw new Error('Unexpected S3 response size');
          chunks.push(Buffer.from(chunk));
        }
        return Buffer.concat(chunks);
      } finally { stream.destroy?.(); }
    },
    async remove(key) {
      if (!acknowledged.has(key)) {
        // A lost PUT response may hide a stored version. A bare DELETE would only add a delete marker.
        const result = await client.send(new GetObjectCommand({ Bucket: settings.bucket, Key: key }), { abortSignal: AbortSignal.timeout(15000) });
        (result.Body as { destroy?: () => void } | undefined)?.destroy?.();
        if (result.VersionId) versions.set(key, result.VersionId);
      }
      await client.send(new DeleteObjectCommand({ Bucket: settings.bucket, Key: key, VersionId: versions.get(key) }), { abortSignal: AbortSignal.timeout(15000) });
    },
    close,
  };
}

export interface S3TestResult {
  ok: boolean;
  checkedAt: number;
  steps: { write: boolean; read: boolean; delete: boolean };
  error?: string;
  cleanupKey?: string;
}
/** A lost PUT response can still leave an object behind, so cleanup runs after every attempted write. */
export async function testS3Connection(settings: S3Settings, credentials: S3Credentials, create = createS3Probe): Promise<S3TestResult> {
  const key = `${settings.prefix ? settings.prefix + '/' : ''}_anjian-check/${crypto.randomUUID()}`;
  const content = crypto.randomBytes(64);
  const result: S3TestResult = { ok: false, checkedAt: Date.now(), steps: { write: false, read: false, delete: false } };
  let client: ProbeStore | undefined;
  try {
    client = create(settings, credentials);
    await client.put(key, content); result.steps.write = true;
    const received = await client.get(key);
    if (!received.equals(content)) throw new Error('Read-back mismatch');
    result.steps.read = true;
  } catch {
    result.error = result.steps.write ? 'S3 读回校验失败，请检查读取权限和服务配置。' : 'S3 写入失败，请检查公网地址、凭据、Bucket、Region 和写入权限。';
  } finally {
    if (client) {
      try { await client.remove(key); result.steps.delete = true; }
      catch { result.cleanupKey = key; result.error = '测试对象清理失败，请检查删除权限，并手动清理所列对象后重试。'; }
      finally { client.close(); }
    }
  }
  result.ok = result.steps.write && result.steps.read && result.steps.delete;
  return result;
}
