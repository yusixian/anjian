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
  const scratch: string[] = [];
  const registry = createVerifyRecordings({
    stateDir: path.join(root, '.state'), stableMs: 0, onChange: () => {},
    prepare: async (input) => {
      scratch.push(path.dirname(input));
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
    expect(fs.existsSync(scratch[0]!)).toBe(false);
    expect(fs.existsSync(path.join(root, '.state', 'recordings'))).toBe(false);
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
  let scratch = '';
  const registry = createVerifyRecordings({
    stateDir: path.join(root, '.state'), stableMs: 0, onChange: () => {},
    prepare: async input => { scratch = path.dirname(input); return { status: 'unchanged', duration: 1, start: 0, end: 1, removed: 0 }; },
  });
  const remove = fs.rmSync.bind(fs);
  let failures = 2;
  const spy = vi.spyOn(fs, 'rmSync').mockImplementation((target, options) => {
    if (String(target) === scratch && failures-- > 0) throw new Error('cleanup failed');
    remove(target, options);
  });
  try {
    registry.project('one', dir, payload(file));
    await vi.waitFor(() => expect(registry.project('one', dir, payload(file)).pending).toEqual([]));
    await expect(registry.quiesce()).rejects.toThrow('Recording preparation did not quiesce completely');
    const resume = await registry.quiesce();
    resume();
    expect(fs.existsSync(scratch)).toBe(false);
  } finally {
    spy.mockRestore();
    await registry.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('maintenance does not wait on a recording queued behind its own quota lock', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'anjian-recording-quota-wait-'));
  const dir = path.join(root, 'artboard/one'); const file = path.join(dir, 'pages/capture.webm');
  fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, 'capture');
  let release!: () => void; let entered = false;
  const lock = new Promise<void>(resolve => { release = resolve; });
  const prepare = vi.fn(async () => ({ status: 'unchanged' as const, duration: 1, start: 0, end: 1, removed: 0 }));
  const registry = createVerifyRecordings({
    stateDir: path.join(root, '.state'), stableMs: 0, onChange: () => {}, prepare,
    withWriteQuota: async work => { entered = true; await lock; await work(() => undefined); },
  });
  try {
    registry.project('one', dir, payload(file));
    await vi.waitFor(() => expect(entered).toBe(true));
    const resume = await registry.quiesce();
    release(); await lock; await Promise.resolve(); await Promise.resolve();
    expect(prepare).not.toHaveBeenCalled();
    resume();
    await vi.waitFor(() => expect(prepare).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(registry.project('one', dir, payload(file)).pending).toEqual([]));
  } finally { release(); await registry.close(); fs.rmSync(root, { recursive: true, force: true }); }
});

test.each(['resume', 'close'] as const)('encoding releases quota and queued publication permits maintenance to %s', async action => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'anjian-recording-phases-'));
  const dir = path.join(root, 'artboard/one');
  const file = path.join(dir, 'pages/capture.webm');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, 'capture');
  let releaseEncode!: () => void;
  const encoding = new Promise<void>(resolve => { releaseEncode = resolve; });
  let releaseMaintenance!: () => void;
  const maintenance = new Promise<void>(resolve => { releaseMaintenance = resolve; });
  let serial = Promise.resolve();
  const exclusive = (work: () => Promise<void>) => {
    const result = serial.then(work);
    serial = result.catch(() => {});
    return result;
  };
  let scratch = '';
  let admissions = 0;
  let requests = 0;
  const registry = createVerifyRecordings({
    stateDir: path.join(root, '.state'), stableMs: 0, onChange: () => {},
    withWriteQuota: work => {
      requests++;
      return exclusive(() => work(() => { admissions++; }));
    },
    prepare: async input => {
      scratch = path.dirname(input);
      await encoding;
      return { status: 'unchanged', duration: 1, start: 0, end: 1, removed: 0 };
    },
  });
  try {
    registry.project('one', dir, payload(file));
    await vi.waitFor(() => expect(scratch).not.toBe(''));
    expect(path.relative(root, scratch).startsWith('..')).toBe(true);
    let wrote = false;
    await exclusive(async () => { wrote = true; });
    expect(wrote).toBe(true);
    const holding = exclusive(() => maintenance);
    const pausing = registry.quiesce();
    releaseEncode();
    const resume = await pausing;
    expect(admissions).toBe(1);
    expect(fs.existsSync(path.join(root, '.state', 'recordings'))).toBe(false);
    // Resume while maintenance still owns the quota lock: publication queues.
    resume();
    await vi.waitFor(() => expect(requests).toBe(2));
    if (action === 'close') {
      await registry.close();
      expect(fs.existsSync(scratch)).toBe(false);
    } else {
      const resumeAgain = await registry.quiesce();
      releaseMaintenance();
      await holding;
      expect(admissions).toBe(1);
      resumeAgain();
      await vi.waitFor(() => expect(registry.project('one', dir, payload(file)).pending).toEqual([]));
      expect(admissions).toBe(2);
      expect(fs.existsSync(scratch)).toBe(false);
    }
    releaseMaintenance();
    await serial;
    if (action === 'close') {
      expect(admissions).toBe(1);
      expect(fs.existsSync(path.join(root, '.state', 'recordings'))).toBe(false);
    }
  } finally {
    releaseEncode();
    releaseMaintenance();
    await registry.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
