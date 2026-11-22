import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { MountSettings } from '../src/server/context';
import type { CommentAdmission } from '../src/server/document-comments';
import { RemoteTransferError } from '../src/server/remote-transfer';
import { createStoryboardJobs } from '../src/server/storyboard-jobs';
import { defaultStoryboard, writeStoryboard } from '../src/server/storyboard-source';

const media = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const video = Buffer.from('storyboard render fixture');
const asset = 'assets/still.png';
let root: string;
let stateDir: string;
let jobs: ReturnType<typeof createStoryboardJobs> | undefined;

function createStoryboard(id: string, identity: string) {
  const dir = path.join(root, 'storyboard', id);
  fs.mkdirSync(path.join(dir, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.artifact-id'), identity);
  const file = path.join(dir, asset);
  fs.writeFileSync(file, media);
  const timeline = defaultStoryboard('Review');
  timeline.tracks[0]!.clips.push({ asset, durationMs: 1000, id: 'still', startMs: 0, trimMs: 0 });
  const { revision } = writeStoryboard(dir, timeline, 'empty');
  return { entry: { dir, id }, file, revision };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

function mountWith(backgroundWrite: NonNullable<MountSettings['backgroundWrite']>): MountSettings {
  return { backgroundWrite, boardPort: 0, port: 0, token: '', version: '' };
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'anjian-test-storyboard-jobs-'));
  stateDir = path.join(root, '.state');
  fs.mkdirSync(stateDir);
});

afterEach(async () => {
  await jobs?.close();
  jobs = undefined;
  fs.rmSync(root, { recursive: true, force: true });
});

describe('storyboard render jobs', () => {
  it('deduplicates immutable inputs and preserves an earlier render after media edits', async () => {
    const { entry, file, revision } = createStoryboard('first', 'a'.repeat(21));
    const other = createStoryboard('second', 'b'.repeat(21)).entry;
    const held = deferred();
    const seen: Buffer[] = [];
    const render: NonNullable<Parameters<typeof createStoryboardJobs>[1]> = async (
      _timeline,
      inputs,
      output,
    ) => {
      await held.promise;
      seen.push(fs.readFileSync(inputs.get(asset)!));
      fs.writeFileSync(output, video);
    };
    jobs = createStoryboardJobs({ mount: undefined, stateDir }, render);
    try {
      const first = await jobs.start(entry, revision);
      expect(await jobs.start(entry, revision)).toMatchObject({ id: first.id });
      fs.appendFileSync(file, 'changed');
      const second = await jobs.start(entry, revision);
      expect(second.id).not.toBe(first.id);
      expect(jobs.status(entry, second.id)?.status).toBe('queued');
      expect(jobs.status(other, first.id)).toBeNull();
      held.resolve();

      await vi.waitFor(() => expect(jobs!.status(entry, second.id)?.status).toBe('ready'));
      expect(jobs.status(entry, first.id)?.status).toBe('ready');
      expect(seen).toEqual([media, Buffer.concat([media, Buffer.from('changed')])]);
      expect(await jobs.start(entry, revision)).toEqual({ id: second.id, status: 'ready' });
      const reloaded = createStoryboardJobs({ mount: undefined, stateDir }, render);
      expect(reloaded.status(entry, first.id)?.status).toBe('ready');
      fs.writeFileSync(path.join(entry.dir, '.artifact-id'), 'c'.repeat(21));
      expect(reloaded.status(entry, first.id)).toBeNull();
      await reloaded.close();
    } finally {
      held.resolve();
    }
  });

  it('admits output bytes under mounted storage and retries after a rejected publication', async () => {
    const { entry, revision } = createStoryboard('review', 'a'.repeat(21));
    let denies = true;
    let staging: string | undefined;
    const admit = vi.fn(() => {
      if (denies) throw new RemoteTransferError(413, 'storage_quota_exceeded', 'Storage full');
    });
    const mount = mountWith(async (work) => {
      work(admit);
    });
    jobs = createStoryboardJobs({ mount, stateDir }, async (_timeline, _inputs, output) => {
      staging = path.dirname(output);
      fs.writeFileSync(output, video);
    });
    const first = await jobs.start(entry, revision);
    await vi.waitFor(() =>
      expect(jobs!.status(entry, first.id)).toEqual({
        id: first.id,
        status: 'failed',
        error: 'Storage full',
      }),
    );
    expect(jobs.video(entry, first.id)).toBeNull();
    expect(fs.existsSync(staging!)).toBe(false);
    denies = false;
    const retry = await jobs.start(entry, revision);
    expect(retry.id).toBe(first.id);
    await vi.waitFor(() => expect(jobs!.status(entry, retry.id)?.status).toBe('ready'));
    expect(admit.mock.calls).toEqual([[video.length], [video.length]]);
    expect(fs.existsSync(staging!)).toBe(false);
  });

  it('bounds the pending queue for a project and releases temporary input files on close', async () => {
    const { entry, file, revision } = createStoryboard('review', 'a'.repeat(21));
    const staging = new Set<string>();
    jobs = createStoryboardJobs(
      { mount: undefined, stateDir },
      async (_timeline, _inputs, output, signal) => {
        staging.add(path.dirname(output));
        await new Promise<void>((resolve) =>
          signal!.addEventListener('abort', () => resolve(), { once: true }),
        );
      },
    );
    for (let i = 0; i < 3; i++) {
      fs.appendFileSync(file, String(i));
      await jobs.start(entry, revision);
    }
    await expect(jobs.start(entry, revision)).rejects.toMatchObject({ status: 429 });
    await jobs.close();
    expect(staging.size).toBe(1);
    expect([...staging].some((directory) => fs.existsSync(directory))).toBe(false);
  });

  it('admits the net growth of a fifth complete render and evicts the oldest only after publication', async () => {
    const { entry, file, revision } = createStoryboard('review', 'a'.repeat(21));
    let rejectGrowth = false;
    const admit = vi.fn((_delta: number) => {
      if (rejectGrowth)
        throw new RemoteTransferError(413, 'storage_quota_exceeded', 'Storage full');
    });
    const mount = mountWith(async (work) => {
      work(admit);
    });
    jobs = createStoryboardJobs({ mount, stateDir }, async (_timeline, inputs, output) => {
      fs.copyFileSync(inputs.get(asset)!, output);
    });
    const completed: string[] = [];
    for (let i = 0; i < 4; i++) {
      const { id } = await jobs.start(entry, revision);
      await vi.waitFor(() => expect(jobs!.status(entry, id)?.status).toBe('ready'));
      completed.push(id);
      fs.appendFileSync(file, 'x');
    }
    rejectGrowth = true;
    const fifth = await jobs.start(entry, revision);
    await vi.waitFor(() => expect(jobs!.status(entry, fifth.id)?.status).toBe('failed'));
    for (const id of completed) expect(jobs.status(entry, id)?.status).toBe('ready');
    expect(admit).toHaveBeenLastCalledWith(4);

    rejectGrowth = false;
    await jobs.start(entry, revision);
    await vi.waitFor(() => expect(jobs!.status(entry, fifth.id)?.status).toBe('ready'));
    expect(jobs.status(entry, completed[0]!)).toBeNull();
    for (const id of completed.slice(1)) expect(jobs.status(entry, id)?.status).toBe('ready');
    expect(admit).toHaveBeenLastCalledWith(4);
  });

  it('closes without a held storage quota and skips the deferred publication', async () => {
    const { entry, revision } = createStoryboard('review', 'a'.repeat(21));
    const entered = deferred();
    const release = deferred();
    const admit: CommentAdmission = vi.fn();
    const mount = mountWith(async (work) => {
      entered.resolve();
      await release.promise;
      work(admit);
    });
    jobs = createStoryboardJobs({ mount, stateDir }, async (_timeline, _inputs, output) => {
      fs.writeFileSync(output, video);
    });
    const job = await jobs.start(entry, revision);
    await entered.promise;
    await jobs.close();
    release.resolve();
    await release.promise;
    expect(admit).not.toHaveBeenCalled();
    expect(jobs.video(entry, job.id)).toBeNull();
  });
});
