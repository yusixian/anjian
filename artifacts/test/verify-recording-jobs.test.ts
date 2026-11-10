import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, expect, test, vi } from 'vitest';

import { checkText } from '../src/cli/check';
import { RemoteTransferError } from '../src/server/remote-transfer';
import { readCanvas } from '../src/server/state';
import { createVerifyRecordings } from '../src/server/verify-recordings';
import { writeArtboard } from './helpers';

const roots: string[] = [];
const managers: ReturnType<typeof createVerifyRecordings>[] = [];
afterEach(async () => {
  await Promise.all(managers.splice(0).map((manager) => manager.close()));
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});
const canvas = {
  version: 1,
  pages: [{ id: 'p', name: 'P' }],
  boards: { clip: { type: 'video', src: 'pages/clip.webm', page: 'p', x: 0, y: 0, w: 160, h: 96 } },
  groups: { g: { boards: ['clip'], verify: true } },
};
const result = { status: 'trimmed' as const, duration: 10, start: 3, end: 7, removed: 6 };
function fixture(prepare: NonNullable<Parameters<typeof createVerifyRecordings>[0]['prepare']>, withWriteQuota?: Parameters<typeof createVerifyRecordings>[0]['withWriteQuota'], retryMs?: number) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'recording-jobs-'));
  roots.push(root);
  const dir = writeArtboard(root, 'one', canvas, { 'pages/clip.webm': 'first capture' });
  const stateDir = path.join(root, '.state');
  const manager = createVerifyRecordings({ stateDir, stableMs: 10, onChange: () => {}, prepare, withWriteQuota, retryMs });
  managers.push(manager);
  const read = () => manager.project('one', dir, readCanvas(dir));
  return { root, dir, stateDir, manager, read };
}

test('an edit during encoding discards the obsolete result and processes an immutable new capture', async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const inputs: string[] = [];
  const f = fixture(async (input, output) => {
    const captured = fs.readFileSync(input, 'utf8');
    inputs.push(captured);
    if (captured === 'first capture') await gate;
    fs.writeFileSync(output, `prepared: ${fs.readFileSync(input, 'utf8')}`);
    return result;
  });
  expect(f.read().pending).toEqual(['clip']);
  try {
    await vi.waitFor(() => expect(inputs).toEqual(['first capture']));
    fs.writeFileSync(path.join(f.dir, 'pages/clip.webm'), 'second capture');
    expect(f.read().pending).toEqual(['clip']);
  } finally {
    release();
  }
  let ready = f.read();
  await vi.waitFor(() => {
    ready = f.read();
    expect(ready.pending).toEqual([]);
  });
  expect(inputs).toEqual(['first capture', 'second capture']);
  const output = f.manager.resolve('one', ready.canvas!.boards.clip!.file)!;
  expect(fs.readFileSync(output, 'utf8')).toBe('prepared: second capture');
  expect(fs.readFileSync(path.join(f.dir, 'pages/clip.webm'), 'utf8')).toBe('second capture');
});

test('a durable content cache survives a restart and avoids re-encoding the same source', async () => {
  const f = fixture(async (_input, output) => {
    fs.writeFileSync(output, 'prepared bytes');
    return result;
  });
  await vi.waitFor(() => expect(f.read().pending).toEqual([]));
  const first = f.read().canvas!.boards.clip!.file;
  await f.manager.close();
  const resumed = createVerifyRecordings({
    stateDir: f.stateDir,
    stableMs: 10,
    onChange: () => {},
    prepare: async () => {
      throw new Error('cache miss');
    },
  });
  managers.push(resumed);
  let ready = resumed.project('one', f.dir, readCanvas(f.dir));
  await vi.waitFor(() => {
    ready = resumed.project('one', f.dir, readCanvas(f.dir));
    expect(ready.recordings!.clip!.status).toBe('ready');
  });
  expect(ready.canvas!.boards.clip!.file).toBe(first);
  expect(fs.readFileSync(resumed.resolve('one', first)!, 'utf8')).toBe('prepared bytes');
});

test('failed preparation falls back once and exposes a non-blocking check warning', async () => {
  const prepare = vi.fn(async () => {
    throw new Error('ffmpeg unavailable');
  });
  const f = fixture(prepare, undefined, 30);
  let ready = f.read();
  await vi.waitFor(() => {
    ready = f.read();
    expect(ready.pending).toEqual([]);
  });
  expect(ready.canvas!.boards.clip!.src).toBe('pages/clip.webm');
  expect(ready.recordings!.clip).toMatchObject({
    status: 'original',
    warning: expect.stringContaining('ffmpeg unavailable'),
  });
  expect(ready.warnings).toEqual([]);
  expect(checkText({ type: 'checked', artifact: 'artboard/one', ...ready })).toContain(
    'warning: recording clip:',
  );
  await new Promise(resolve => setTimeout(resolve, 80));
  expect(prepare).toHaveBeenCalledTimes(1);
  expect(f.read().recordings).toEqual(ready.recordings);
});

test.each(['ordinary', 'preserve'])('%s video bypasses automatic trimming', async (mode) => {
  const f = fixture(async () => {
    throw new Error('must not process this video');
  });
  const spec =
    mode === 'ordinary'
      ? { ...canvas, groups: { g: { boards: ['clip'], verify: false } } }
      : { ...canvas, boards: { clip: { ...canvas.boards.clip, trim: false } } };
  fs.writeFileSync(path.join(f.dir, 'canvas.json'), JSON.stringify(spec));
  const payload = f.read();
  expect(payload.pending).toEqual([]);
  expect(payload.recordings).toBeUndefined();
  expect(payload.canvas!.boards.clip!.src).toBe('pages/clip.webm');
  expect(fs.existsSync(path.join(f.stateDir, 'recordings'))).toBe(false);
});


test('quota refusal before capture copying leaves no cache and keeps the original recording', async () => {
  const prepare = vi.fn(async () => result);
  const f = fixture(prepare, async work => work(() => { throw new Error('quota'); }));
  await vi.waitFor(() => expect(f.read().recordings!.clip!.status).toBe('original'));
  expect(prepare).not.toHaveBeenCalled();
  expect(fs.existsSync(path.join(f.stateDir, 'recordings'))).toBe(false);
  expect(fs.readFileSync(path.join(f.dir, 'pages/clip.webm'), 'utf8')).toBe('first capture');
});

test('an oversized prepared result is discarded before publishing durable cache files', async () => {
  const admissions: number[] = [];
  const f = fixture(async (_input, output) => { fs.writeFileSync(output, 'x'.repeat(4096)); return result; }, async work => work(delta => {
    admissions.push(delta);
    if (delta > 1024) throw new Error('quota');
  }));
  await vi.waitFor(() => expect(f.read().recordings!.clip!.status).toBe('original'));
  expect(admissions[0]).toBe(Buffer.byteLength('first capture'));
  expect(admissions[1]).toBeGreaterThan(4096);
  expect(fs.existsSync(path.join(f.stateDir, 'recordings'))).toBe(false);
  expect(fs.readFileSync(path.join(f.dir, 'pages/clip.webm'), 'utf8')).toBe('first capture');
});

test('recording metadata installation failure rolls back the prepared clip', async () => {
  const rename = fs.renameSync.bind(fs);
  const spy = vi.spyOn(fs, 'renameSync').mockImplementation((source, target) => {
    if (String(target).endsWith('/result.json') && String(source).endsWith('.tmp')) throw new Error('metadata install failed');
    rename(source, target);
  });
  try {
    const f = fixture(async (_input, output) => { fs.writeFileSync(output, 'prepared'); return result; });
    await vi.waitFor(() => expect(f.read().recordings!.clip!.status).toBe('original'));
    const cache = path.join(f.stateDir, 'recordings');
    for (const dir of fs.readdirSync(cache)) expect(fs.readdirSync(path.join(cache, dir))).toEqual([]);
    expect(fs.readFileSync(path.join(f.dir, 'pages/clip.webm'), 'utf8')).toBe('first capture');
  } finally { spy.mockRestore(); }
});

test('quota recovery retries without a file edit and avoids encoding while the known result cannot fit', async () => {
  let capacity = 32;
  let checks = 0;
  const prepare = vi.fn(async (_input: string, output: string) => {
    fs.writeFileSync(output, 'x'.repeat(4096));
    return result;
  });
  const f = fixture(prepare, async work => work(delta => {
    checks++;
    if (delta > capacity) throw new RemoteTransferError(413, 'storage_quota_exceeded', 'quota');
  }), 30);
  await vi.waitFor(() => expect(f.read().recordings!.clip!.status).toBe('original'));
  await vi.waitFor(() => expect(checks).toBeGreaterThanOrEqual(4));
  expect(prepare).toHaveBeenCalledTimes(1);
  expect(f.read().pending).toEqual([]);
  capacity = 8192;
  await vi.waitFor(() => expect(f.read().recordings!.clip!.status).toBe('ready'));
  expect(prepare).toHaveBeenCalledTimes(2);
  expect(fs.readFileSync(path.join(f.dir, 'pages/clip.webm'), 'utf8')).toBe('first capture');
});

test.each(['resume', 'close'] as const)('quota retries respect maintenance and %s', async action => {
  let capacity = 0;
  let checks = 0;
  const prepare = vi.fn(async (_input: string, output: string) => {
    fs.writeFileSync(output, 'prepared');
    return result;
  });
  const f = fixture(prepare, async work => work(delta => {
    checks++;
    if (delta > capacity) throw new RemoteTransferError(413, 'storage_quota_exceeded', 'quota');
  }), 30);
  await vi.waitFor(() => expect(f.read().recordings!.clip!.status).toBe('original'));
  const resume = await f.manager.quiesce();
  const before = checks;
  capacity = 8192;
  await new Promise(resolve => setTimeout(resolve, 80));
  expect(checks).toBe(before);
  expect(prepare).not.toHaveBeenCalled();
  if (action === 'close') {
    await f.manager.close();
    resume();
    await new Promise(resolve => setTimeout(resolve, 80));
    expect(checks).toBe(before);
    expect(prepare).not.toHaveBeenCalled();
  } else {
    resume();
    await vi.waitFor(() => expect(f.read().recordings!.clip!.status).toBe('ready'));
    expect(prepare).toHaveBeenCalledTimes(1);
  }
});
