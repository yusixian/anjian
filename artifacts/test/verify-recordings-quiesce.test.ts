import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { expect, test, vi } from 'vitest';

import type { CanvasPayload } from '../src/shared/types';
import { createVerifyRecordings } from '../src/server/verify-recordings';

const payload = (file: string): CanvasPayload => ({
  pending: [], versions: { 'pages/capture.webm': fs.statSync(file).mtimeMs },
  canvas: {
    pages: [{ id: 'page', name: 'Page' }],
    boards: { clip: { type: 'video', file: 'pages/capture.webm', src: 'pages/capture.webm', page: 'page', x: 0, y: 0, w: 100, h: 100 } },
    groups: { group: { boards: ['clip'], verify: true } },
  },
} as unknown as CanvasPayload);

test('recording quiesce waits for running work, holds queued work, then resumes it', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'anjian-recording-quiesce-'));
  const dir = path.join(root, 'artboard', 'one');
  const file = path.join(dir, 'pages', 'capture.webm');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, 'first');
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const calls: string[] = [];
  const registry = createVerifyRecordings({
    stateDir: path.join(root, '.state'), stableMs: 0, onChange: () => {},
    prepare: async (input) => {
      const value = fs.readFileSync(input, 'utf8');
      calls.push(value);
      if (value === 'first') await gate;
      return { status: 'unchanged', duration: 1, start: 0, end: 1, removed: 0 };
    },
  });
  try {
    registry.project('one', dir, payload(file));
    await vi.waitFor(() => expect(calls).toEqual(['first']));
    const pausing = registry.quiesce();
    await expect(registry.quiesce()).rejects.toThrow('already closed or paused');
    fs.writeFileSync(file, 'second');
    registry.project('one', dir, payload(file));
    let settled = false;
    void pausing.then(() => { settled = true; });
    expect(settled).toBe(false);
    release();
    const resume = await pausing;
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(calls).toEqual(['first']);
    const cacheDir = path.join(root, '.state', 'recordings');
    expect(fs.readdirSync(cacheDir).some((name) => name.startsWith('.prepare-'))).toBe(false);
    resume();
    await vi.waitFor(() => expect(calls).toEqual(['first', 'second']));
    await vi.waitFor(() => expect(registry.project('one', dir, payload(file)).pending).toEqual([]));
    const secondResume = await registry.quiesce();
    resume();
    await expect(registry.quiesce()).rejects.toThrow('already closed or paused');
    secondResume();
  } finally {
    release();
    await registry.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a failed temporary cleanup aborts quiesce and permits retry', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'anjian-recording-quiesce-failure-'));
  const dir = path.join(root, 'artboard', 'one');
  const file = path.join(dir, 'pages', 'capture.webm');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, 'capture');
  const registry = createVerifyRecordings({
    stateDir: path.join(root, '.state'), stableMs: 0, onChange: () => {},
    prepare: async () => ({ status: 'unchanged', duration: 1, start: 0, end: 1, removed: 0 }),
  });
  const remove = fs.rmSync.bind(fs);
  let failures = 2;
  const spy = vi.spyOn(fs, 'rmSync').mockImplementation((target, options) => {
    if (String(target).includes('.prepare-') && failures-- > 0) throw new Error('cleanup failed');
    remove(target, options);
  });
  try {
    registry.project('one', dir, payload(file));
    await vi.waitFor(() => expect(registry.project('one', dir, payload(file)).pending).toEqual([]));
    await expect(registry.quiesce()).rejects.toThrow('Recording preparation did not quiesce completely');
    const resume = await registry.quiesce();
    resume();
    expect(fs.readdirSync(path.join(root, '.state', 'recordings')).some((name) => name.startsWith('.prepare-'))).toBe(false);
  } finally {
    spy.mockRestore();
    await registry.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
