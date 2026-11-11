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
  const { client, objectVersion, close } = createStorageClient(settings, credentials);
  const versions = new Map<string, string>();
  const acknowledged = new Set<string>();
  return {
    async put(key, content) {
      const result = await client.send(new PutObjectCommand({ Bucket: settings.bucket, Key: key, Body: content, ContentType: 'application/octet-stream', IfNoneMatch: '*' }), { abortSignal: AbortSignal.timeout(15000) });
      acknowledged.add(key);
      const version = objectVersion(result.VersionId);
      if (version) versions.set(key, version);
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
        const version = objectVersion(result.VersionId);
        if (version) versions.set(key, version);
      }
      await client.send(new DeleteObjectCommand({ Bucket: settings.bucket, Key: key, VersionId: versions.get(key) }), { abortSignal: AbortSignal.timeout(15000) });
    },
    close,
  };
}

function failureReason(error: unknown): string {
  const failure = error as { name?: string; $metadata?: { httpStatusCode?: number } } | null;
  const status = failure?.$metadata?.httpStatusCode;
  if (status === 501 || failure?.name === 'NotImplemented') return '存储服务不支持此操作或请求参数，请检查 S3 兼容性。';
  if (status === 401 || ['InvalidAccessKeyId', 'SignatureDoesNotMatch'].includes(failure?.name ?? '')) return '身份验证失败，请检查凭据、Region 和签名配置。';
  if (status === 403 || failure?.name === 'AccessDenied') return '存储服务拒绝访问，请检查凭据及对应操作权限。';
  if (status === 404) return '存储桶或对象不存在，请检查 Bucket 和对象路径。';
  if (['TimeoutError', 'AbortError', 'RequestTimeout'].includes(failure?.name ?? '')) return '请求超时，请检查服务器到存储服务的网络后重试。';
  return '请求失败，请检查网络、服务状态及 S3 配置。';
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
  } catch (error) {
    result.error = `${result.steps.write ? 'S3 读回校验失败。' : 'S3 写入失败。'}${failureReason(error)}`;
  } finally {
    if (client) {
      try { await client.remove(key); result.steps.delete = true; }
      catch (error) {
        result.cleanupKey = key;
        result.error = `${result.error ?? ''}测试对象清理失败。${failureReason(error)}请清理所列测试对象后重试。`;
      }
      finally { client.close(); }
    }
  }
  result.ok = result.steps.write && result.steps.read && result.steps.delete;
  return result;
}
