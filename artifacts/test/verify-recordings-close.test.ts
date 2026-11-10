import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { expect, test, vi } from 'vitest';

import type { CanvasPayload } from '../src/shared/types';
import { createVerifyRecordings } from '../src/server/verify-recordings';

test('a failed temporary cleanup remains pending until recording close retries it', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'anjian-recording-close-'));
  const directory = path.join(root, 'artboard', 'board');
  const source = path.join(directory, 'pages', 'capture.webm');
  fs.mkdirSync(path.dirname(source), { recursive: true });
  fs.writeFileSync(source, 'capture');
  const stateDir = path.join(root, '.state');
  let entered = false;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const registry = createVerifyRecordings({
    stateDir, stableMs: 0, onChange: () => {},
    prepare: async () => {
      entered = true;
      await gate;
      return { status: 'unchanged', duration: 1, start: 0, end: 1, removed: 0 };
    },
  });
  const payload = {
    pending: [], versions: { 'pages/capture.webm': fs.statSync(source).mtimeMs },
    canvas: {
      pages: [{ id: 'page', name: 'Page' }],
      boards: { clip: { type: 'video', file: 'pages/capture.webm', src: 'pages/capture.webm', page: 'page', x: 0, y: 0, w: 100, h: 100 } },
      groups: { group: { boards: ['clip'], verify: true } },
    },
  } as unknown as CanvasPayload;
  registry.project('board', directory, payload);
  try {
    await vi.waitFor(() => expect(entered).toBe(true));
    const remove = fs.rmSync.bind(fs);
    let failures = 2;
    const spy = vi.spyOn(fs, 'rmSync').mockImplementation((file, options) => {
      if (String(file).includes('.prepare-') && failures-- > 0) throw new Error('injected cleanup failure');
      remove(file, options);
    });
    const closing = registry.close();
    release();
    await expect(closing).rejects.toThrow('Recording preparation did not close completely');
    const cacheDir = path.join(stateDir, 'recordings');
    expect(fs.readdirSync(cacheDir).some((name) => name.startsWith('.prepare-'))).toBe(true);
    await registry.close();
    expect(fs.readdirSync(cacheDir).some((name) => name.startsWith('.prepare-'))).toBe(false);
    spy.mockRestore();
  } finally {
    release();
    vi.restoreAllMocks();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
