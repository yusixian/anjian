import crypto from 'node:crypto';
import { constants } from 'node:fs';
import fs, { type FileHandle } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { createStorageClient } from './client';
import type { S3Credentials, S3Settings } from './settings';

export interface FileDigest { bytes: number; sha256: string }
export interface StoredObject extends FileDigest { key: string; versionId?: string }
const MAX_OBJECT_BYTES = 5 * 1024 ** 3;
const TIMEOUT_MS = 120_000;
const HASH = /^[a-f0-9]{64}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
export class StorageObjectError extends Error {
  constructor(readonly code: 'invalid_object' | 'source_changed' | 'transfer_failed' | 'integrity_failed') {
    super({ invalid_object: '存储对象无效。', source_changed: '源文件已变化，请重新准备迁移。',
      transfer_failed: 'S3 资源传输失败，请检查连接、权限和服务状态后重试。', integrity_failed: 'S3 资源校验失败，未切换存储。' }[code]);
  }
}
function validateDigest(digest: FileDigest) {
  if (!Number.isSafeInteger(digest.bytes) || digest.bytes < 0 || digest.bytes > MAX_OBJECT_BYTES || !HASH.test(digest.sha256))
    throw new StorageObjectError('invalid_object');
}

async function* fileChunks(handle: FileHandle, bytes: number) {
  let offset = 0;
  while (offset < bytes) {
    const buffer = Buffer.allocUnsafe(Math.min(64 * 1024, bytes - offset));
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, offset);
    if (bytesRead === 0) throw new StorageObjectError('source_changed');
    offset += bytesRead;
    yield buffer.subarray(0, bytesRead);
  }
}
async function digestHandle(handle: FileHandle): Promise<FileDigest> {
  const stat = await handle.stat();
  if (!stat.isFile() || stat.size > MAX_OBJECT_BYTES) throw new StorageObjectError('invalid_object');
  const hash = crypto.createHash('sha256');
  for await (const chunk of fileChunks(handle, stat.size)) hash.update(chunk);
  const after = await handle.stat();
  if (after.size !== stat.size || after.mtimeMs !== stat.mtimeMs || after.ctimeMs !== stat.ctimeMs)
    throw new StorageObjectError('source_changed');
  return { bytes: stat.size, sha256: hash.digest('hex') };
}
/** Reads a stable file descriptor; atomic replacements do not change the opened source. */
export async function digestFile(file: string): Promise<FileDigest> {
  const handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try { return await digestHandle(handle); }
  finally { await handle.close(); }
}

/** Immutable payload storage. The namespace is server-generated and persisted with a configuration revision. */
export function createS3Objects(settings: S3Settings, credentials: S3Credentials, namespace: string) {
  if (!UUID.test(namespace)) throw new StorageObjectError('invalid_object');
  const prefix = `${settings.prefix ? settings.prefix + '/' : ''}_anjian/objects/${namespace}/`;
  const { client, close } = createStorageClient(settings, credentials, TIMEOUT_MS);
  const reference = (digest: FileDigest): StoredObject => {
    validateDigest(digest);
    return { bytes: digest.bytes, sha256: digest.sha256, key: prefix + digest.sha256 };
  };
  const validate = (object: StoredObject) => {
    validateDigest(object);
    if (object.key !== reference(object).key || (object.versionId !== undefined &&
        (typeof object.versionId !== 'string' || !object.versionId || object.versionId.length > 1024)))
      throw new StorageObjectError('invalid_object');
  };
  const read = async (object: StoredObject, receive?: (chunk: Buffer) => Promise<void>): Promise<StoredObject> => {
    validate(object);
    const signal = AbortSignal.timeout(TIMEOUT_MS);
    let stream: Readable | undefined;
    const abort = () => stream?.destroy(new StorageObjectError('transfer_failed'));
    try {
      const result = await client.send(new GetObjectCommand({ Bucket: settings.bucket, Key: object.key, VersionId: object.versionId }), { abortSignal: signal });
      stream = result.Body as Readable | undefined;
      if (!stream || typeof stream.destroy !== 'function') throw new StorageObjectError('transfer_failed');
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) throw new StorageObjectError('transfer_failed');
      if ((result.ContentLength !== undefined && result.ContentLength !== object.bytes) ||
          (object.versionId !== undefined && result.VersionId !== object.versionId)) throw new StorageObjectError('integrity_failed');
      const hash = crypto.createHash('sha256'); let bytes = 0;
      for await (const raw of stream) {
        const chunk = Buffer.from(raw); bytes += chunk.length;
        if (bytes > object.bytes) throw new StorageObjectError('integrity_failed');
        hash.update(chunk);
        if (receive) await receive(chunk);
      }
      if (bytes !== object.bytes || hash.digest('hex') !== object.sha256) throw new StorageObjectError('integrity_failed');
      return { ...object, ...(result.VersionId ? { versionId: result.VersionId } : {}) };
    } catch (error) {
      if (error instanceof StorageObjectError) throw error;
      throw new StorageObjectError('transfer_failed');
    } finally { signal.removeEventListener('abort', abort); stream?.destroy(); }
  };
  return {
    reference,
    verify: (object: StoredObject) => read(object),
    async upload(file: string, expected: FileDigest): Promise<StoredObject> {
      const object = reference(expected);
      const handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const checkSource = async () => {
          const digest = await digestHandle(handle);
          if (digest.bytes !== expected.bytes || digest.sha256 !== expected.sha256) throw new StorageObjectError('source_changed');
        };
        await checkSource();
        const stream = Readable.from(fileChunks(handle, expected.bytes));
        try {
          try {
            const result = await client.send(new PutObjectCommand({ Bucket: settings.bucket, Key: object.key, Body: stream,
              ContentLength: expected.bytes, ContentType: 'application/octet-stream', IfNoneMatch: '*',
              ChecksumSHA256: Buffer.from(expected.sha256, 'hex').toString('base64'),
            }), { abortSignal: AbortSignal.timeout(TIMEOUT_MS) });
            if (result.VersionId) object.versionId = result.VersionId;
          } catch {
            // A timeout may follow a committed PUT. A conditional conflict can be a completed retry.
            // Only a full read-back of the expected content may turn either into success.
          }
        } finally { stream.destroy(); }
        const verified = await read(object);
        await checkSource();
        return verified;
      } finally { await handle.close(); }
    },
    /** Returns a verified private temporary file. Caller promotes it under its own mutation lock. */
    async download(object: StoredObject, directory: string): Promise<string> {
      validate(object);
      const stat = await fs.lstat(directory);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new StorageObjectError('invalid_object');
      const temporary = path.join(await fs.realpath(directory), `.${crypto.randomUUID()}.download`);
      const handle = await fs.open(temporary, 'wx', 0o600);
      try {
        await read(object, async (chunk) => {
          let offset = 0;
          while (offset < chunk.length) {
            const { bytesWritten } = await handle.write(chunk, offset, chunk.length - offset);
            if (bytesWritten === 0) throw new StorageObjectError('transfer_failed');
            offset += bytesWritten;
          }
        });
        await handle.sync();
        await handle.close();
        return temporary;
      } catch (error) {
        await handle.close();
        await fs.rm(temporary, { force: true });
        throw error;
      }
    },
    close,
  };
}
export type S3Objects = ReturnType<typeof createS3Objects>;
