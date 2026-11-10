import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { beforeEach, expect, test, vi } from 'vitest';

import { createDocumentRegistry } from '../src/server/documents';

const control = vi.hoisted(() => ({
  failures: 0,
  gate: null as Promise<void> | null,
  calls: { first: 0, second: 0 },
  setupMode: null as 'warning' | 'subscribe' | null,
  setupCreates: 0,
  setupCloseCalls: 0,
  setupCloseFailures: 0,
  quiesceFailures: 0,
  quiesceFailureOn: 'first' as 'first' | 'second',
  resumeFailures: 0,
  quiesceCalls: { first: 0, second: 0 },
  resumeCalls: { first: 0, second: 0 },
  openGate: null as Promise<void> | null,
  openEntered: false,
}));

beforeEach(() => {
  control.failures = 0;
  control.gate = null;
  control.calls = { first: 0, second: 0 };
  control.setupMode = null;
  control.setupCreates = 0;
  control.setupCloseCalls = 0;
  control.setupCloseFailures = 0;
  control.quiesceFailures = 0;
  control.quiesceFailureOn = 'first';
  control.resumeFailures = 0;
  control.quiesceCalls = { first: 0, second: 0 };
  control.resumeCalls = { first: 0, second: 0 };
  control.openGate = null;
  control.openEntered = false;
});

vi.mock('../src/server/document-session', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/server/document-session')>();
  return {
    ...actual,
    createDocumentSession: async (options: { file: string }) => {
      const id = path.basename(path.dirname(options.file));
      if (id === 'first' && control.openGate) {
        control.openEntered = true;
        await control.openGate;
      }
      if (id === 'setup') {
        control.setupCreates++;
        return {
          streaming: () => control.setupMode !== 'warning',
          outcome: () => ({ kind: 'rejected', message: 'test warning' }),
          subscribe: () => {
            if (control.setupMode === 'subscribe') throw new Error('injected subscription failure');
            return () => {};
          },
          async close() {
            control.setupCloseCalls++;
            if (control.setupCloseFailures-- > 0) throw new Error('injected setup cleanup failure');
          },
        };
      }
      return {
        streaming: () => true,
        subscribe: () => () => {},
        async quiesce() {
          control.quiesceCalls[id as 'first' | 'second']++;
          if (id === control.quiesceFailureOn && control.quiesceFailures-- > 0) throw new Error('injected quiesce failure');
          if (id === 'second') await control.gate;
          return () => {
            control.resumeCalls[id as 'first' | 'second']++;
            if (id === 'first' && control.resumeFailures-- > 0) throw new Error('injected resume failure');
          };
        },
        async close() {
          control.calls[id as 'first' | 'second']++;
          if (id === 'first' && control.failures-- > 0) throw new Error('injected document save failure');
          if (id === 'second') await control.gate;
        },
      };
    },
  };
});

test('document release attempts every session and leaves the registry reusable after a release failure', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'anjian-document-release-'));
  try {
    for (const id of ['first', 'second']) {
      const directory = path.join(root, 'document', id);
      fs.mkdirSync(directory, { recursive: true });
      fs.writeFileSync(path.join(directory, 'doc.xml'), '<doc><p>draft</p></doc>');
    }
    const registry = createDocumentRegistry({ root, stateDir: path.join(root, '.state'), broadcast: () => {}, onWarningsChange: () => {} });
    await Promise.all([registry.open('first'), registry.open('second')]);
    control.resumeFailures = 1;
    const resume = await registry.quiesce();
    expect(() => resume()).toThrow('Documents did not resume completely');
    expect(control.resumeCalls).toEqual({ first: 1, second: 1 });
    resume();
    const secondResume = await registry.quiesce();
    secondResume();
    expect(control.resumeCalls).toEqual({ first: 2, second: 2 });

    control.quiesceFailures = 1;
    control.quiesceFailureOn = 'second';
    control.resumeFailures = 1;
    await expect(registry.quiesce()).rejects.toMatchObject({
      errors: [expect.any(AggregateError), expect.objectContaining({ message: 'injected resume failure' })],
    });
    expect(control.resumeCalls).toEqual({ first: 3, second: 2 });
    const finalResume = await registry.quiesce();
    finalResume();
    await registry.close();
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('document quiesce waits for an open already in progress', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'anjian-document-quiesce-open-'));
  try {
    const directory = path.join(root, 'document', 'first');
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, 'doc.xml'), '<doc><p>draft</p></doc>');
    const registry = createDocumentRegistry({ root, stateDir: path.join(root, '.state'), broadcast: () => {}, onWarningsChange: () => {} });
    let release!: () => void;
    control.openGate = new Promise<void>((resolve) => { release = resolve; });
    const opening = registry.open('first');
    await vi.waitFor(() => expect(control.openEntered).toBe(true));
    let settled = false;
    const pausing = registry.quiesce().then((resume) => { settled = true; return resume; });
    expect(settled).toBe(false);
    release();
    expect(await opening).not.toBeNull();
    const resume = await pausing;
    expect(control.quiesceCalls.first).toBe(1);
    resume();
    await registry.close();
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('document quiesce drains all opened sessions and resumes successful pauses after failure', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'anjian-document-quiesce-'));
  try {
    for (const id of ['first', 'second']) {
      const directory = path.join(root, 'document', id);
      fs.mkdirSync(directory, { recursive: true });
      fs.writeFileSync(path.join(directory, 'doc.xml'), '<doc><p>draft</p></doc>');
    }
    const registry = createDocumentRegistry({ root, stateDir: path.join(root, '.state'), broadcast: () => {}, onWarningsChange: () => {} });
    const [first, second] = await Promise.all([registry.open('first'), registry.open('second')]);
    control.quiesceFailures = 1;
    let release!: () => void;
    control.gate = new Promise<void>((resolve) => { release = resolve; });
    const pausing = registry.quiesce();
    await vi.waitFor(() => expect(control.quiesceCalls).toEqual({ first: 1, second: 1 }));
    await expect(registry.quiesce()).rejects.toThrow('already closing or paused');
    expect(await registry.open('first')).toBe(first);
    expect(await registry.open('second')).toBe(second);
    let settled = false;
    void pausing.finally(() => { settled = true; }).catch(() => {});
    expect(settled).toBe(false);
    release();
    await expect(pausing).rejects.toThrow('Documents did not quiesce completely');
    expect(control.resumeCalls).toEqual({ first: 0, second: 1 });
    control.gate = null;
    const resume = await registry.quiesce();
    expect(control.quiesceCalls).toEqual({ first: 2, second: 2 });
    resume(); resume();
    expect(control.resumeCalls).toEqual({ first: 1, second: 2 });
    await registry.close();
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test.each(['warning', 'subscribe'] as const)('setup %s failure retains a session whose cleanup failed', async (mode) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'anjian-document-setup-close-'));
  try {
    const directory = path.join(root, 'document/setup');
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, 'doc.xml'), '<doc><p>draft</p></doc>');
    control.setupMode = mode;
    control.setupCloseFailures = 1;
    const registry = createDocumentRegistry({
      root, stateDir: path.join(root, '.state'), broadcast: () => {},
      onWarningsChange: () => { if (mode === 'warning') throw new Error('injected warning callback failure'); },
    });
    expect(await registry.open('setup')).toBeNull();
    expect(control.setupCreates).toBe(1);
    expect(control.setupCloseCalls).toBe(1);
    expect(await registry.open('setup')).toBeNull();
    expect(control.setupCreates).toBe(1);
    await registry.close();
    expect(control.setupCloseCalls).toBe(2);
    await registry.close();
    expect(control.setupCloseCalls).toBe(2);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('document close waits for all sessions, shares concurrent calls, and retries only failures', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'anjian-document-close-'));
  try {
    for (const id of ['first', 'second']) {
      const directory = path.join(root, 'document', id);
      fs.mkdirSync(directory, { recursive: true });
      fs.writeFileSync(path.join(directory, 'doc.xml'), '<doc><p>draft</p></doc>');
    }
    const registry = createDocumentRegistry({ root, stateDir: path.join(root, '.state'), broadcast: () => {}, onWarningsChange: () => {} });
    await Promise.all([registry.open('first'), registry.open('second')]);
    control.failures = 1;
    let release!: () => void;
    control.gate = new Promise<void>((resolve) => { release = resolve; });
    const first = registry.close();
    const concurrent = registry.close();
    expect(concurrent).toBe(first);
    let settled = false;
    void first.then(() => { settled = true; }, () => { settled = true; });
    try {
      await vi.waitFor(() => expect(control.calls).toEqual({ first: 1, second: 1 }));
      expect(settled).toBe(false);
    } finally { release(); }
    await expect(first).rejects.toThrow('Documents did not close completely');
    expect(await registry.open('first')).toBeNull();
    await registry.close();
    expect(control.calls).toEqual({ first: 2, second: 1 });
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
