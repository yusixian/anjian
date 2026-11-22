import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import {
  MAX_STORYBOARD_SOURCE_BYTES,
  type Storyboard,
  storyboardDuration,
  type StoryboardJob,
} from '../shared/storyboard';
import type { ServerContext } from './context';
import { RemoteTransferError } from './remote-transfer';
import { renderStoryboard, StoryboardRenderError } from './storyboard-render';
import {
  openStoryboardAsset,
  readStoryboard,
  StoryboardError,
  storyboardIdentity,
} from './storyboard-source';

const RENDER_POLICY = 'storyboard-mp4-v1';
const MAX_PENDING = 3;
const MAX_FAILED = 32;
const MAX_COMPLETED = 4;
const MAX_OUTPUT_BYTES = 128 * 1024 * 1024;
const isJobId = (id: string) => /^[a-f0-9]{64}$/.test(id);
const read = promisify(fs.read);

type JobProject = Pick<ServerContext, 'mount' | 'stateDir'>;
type StoryboardEntry = { dir: string; id: string };
type StagedStoryboard = {
  directory: string;
  entry: StoryboardEntry;
  id: string;
  identity: string;
  inputs: Map<string, string>;
  original: fs.Stats;
  storyboard: Storyboard;
};

function checkArtifact(dir: string, original: fs.Stats, identity: string) {
  const current = fs.lstatSync(dir, { throwIfNoEntry: false });
  if (
    !current?.isDirectory() ||
    current.dev !== original.dev ||
    current.ino !== original.ino ||
    storyboardIdentity(dir) !== identity
  )
    throw new StoryboardError(409, 'Storyboard was replaced while rendering');
}

function cacheDirectory(stateDir: string, artifact: string, identity: string, create = false) {
  if (!fs.lstatSync(stateDir, { throwIfNoEntry: false })?.isDirectory()) return null;
  let directory = fs.realpathSync(stateDir);
  for (const segment of ['storyboard', artifact, 'renders', identity]) {
    directory = path.join(directory, segment);
    if (create) {
      try {
        fs.mkdirSync(directory, { mode: 0o700 });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      }
    }
    const stat = fs.lstatSync(directory, { throwIfNoEntry: false });
    if (!stat) return null;
    if (!stat.isDirectory() || fs.realpathSync(directory) !== directory)
      throw new StoryboardError(422, 'Unsafe storyboard render directory');
  }
  return directory;
}

function openVideo(stateDir: string, artifact: string, identity: string, id: string) {
  if (!isJobId(id)) return null;
  const directory = cacheDirectory(stateDir, artifact, identity);
  if (!directory) return null;
  const file = path.join(directory, `${id}.mp4`);
  let fd: number;
  try {
    fd = fs.openSync(
      file,
      fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK,
    );
  } catch (error) {
    if (['ENOENT', 'ELOOP'].includes((error as NodeJS.ErrnoException).code ?? '')) return null;
    throw error;
  }
  try {
    const stat = fs.fstatSync(fd);
    if (
      stat.isFile() &&
      stat.size > 0 &&
      stat.size <= MAX_OUTPUT_BYTES &&
      fs.realpathSync(file) === file
    )
      return { fd, file, stat };
  } catch (error) {
    fs.closeSync(fd);
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
  fs.closeSync(fd);
  return null;
}

function hasVideo(stateDir: string, artifact: string, identity: string, id: string) {
  const video = openVideo(stateDir, artifact, identity, id);
  if (!video) return false;
  fs.closeSync(video.fd);
  return true;
}

function retiredRenders(cache: string | null, current: string) {
  if (!cache) return [];
  const entries = fs.readdirSync(cache).flatMap((name) => {
    if (name === current || !name.endsWith('.mp4') || !isJobId(name.slice(0, -4))) return [];
    const file = path.join(cache, name);
    const stat = fs.lstatSync(file, { throwIfNoEntry: false });
    return stat?.isFile() ? [{ file, stat }] : [];
  });
  entries.sort((a, b) => a.stat.mtimeMs - b.stat.mtimeMs || a.file.localeCompare(b.file));
  return entries.slice(0, Math.max(0, entries.length - (MAX_COMPLETED - 1)));
}

async function copyInputs(entry: StoryboardEntry, expected: string, signal: AbortSignal) {
  const original = fs.lstatSync(entry.dir, { throwIfNoEntry: false });
  if (!original?.isDirectory()) throw new StoryboardError(404, 'Storyboard not found');
  const identity = storyboardIdentity(entry.dir);
  const { storyboard, revision, bytes } = readStoryboard(entry.dir);
  if (revision !== expected)
    throw new StoryboardError(409, 'Storyboard changed on disk. Reload before rendering.');
  if (!storyboardDuration(storyboard))
    throw new StoryboardError(422, 'Add a clip before rendering');
  const assets = new Set(storyboard.tracks.flatMap(({ clips }) => clips.map(({ asset }) => asset)));
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'anjian-storyboard-'));
  const inputs = new Map<string, string>();
  const digest = createHash('sha256').update(
    `${RENDER_POLICY}\0${entry.id}\0${identity}\0${revision}`,
  );
  let total = bytes;
  try {
    for (const relative of [...assets].sort()) {
      signal.throwIfAborted();
      const { fd, stat } = openStoryboardAsset(entry.dir, relative);
      try {
        total += stat.size;
        if (total > MAX_STORYBOARD_SOURCE_BYTES)
          throw new StoryboardError(413, 'Storyboard source exceeds 32 MiB');
        const data = Buffer.allocUnsafe(stat.size);
        let copied = 0;
        while (copied < data.length) {
          signal.throwIfAborted();
          const { bytesRead } = await read(fd, data, copied, data.length - copied, copied);
          if (!bytesRead) break;
          copied += bytesRead;
        }
        if (copied !== stat.size || fs.fstatSync(fd).ctimeMs !== stat.ctimeMs)
          throw new StoryboardError(409, 'Storyboard media changed while staging. Retry shortly.');
        const staged = path.join(directory, path.basename(relative));
        await fs.promises.writeFile(staged, data, { flag: 'wx', mode: 0o600, signal });
        const assetDigest = createHash('sha256').update(data).digest('hex');
        digest.update(`\0${relative}\0${assetDigest}`);
        inputs.set(relative, staged);
      } finally {
        fs.closeSync(fd);
      }
    }
    signal.throwIfAborted();
    checkArtifact(entry.dir, original, identity);
    return { directory, entry, id: digest.digest('hex'), identity, inputs, original, storyboard };
  } catch (error) {
    fs.rmSync(directory, { recursive: true, force: true });
    throw error;
  }
}

/** Closing a mounted project can itself hold the quota lock. A pending publication must not wait for it. */
async function untilAborted<T>(signal: AbortSignal, work: Promise<T>) {
  let finish!: () => void;
  const aborted = new Promise<void>((resolve) => {
    finish = resolve;
  });
  signal.addEventListener('abort', finish, { once: true });
  if (signal.aborted) finish();
  try {
    await Promise.race([work, aborted]);
  } finally {
    signal.removeEventListener('abort', finish);
  }
}

export function createStoryboardJobs(
  project: JobProject,
  render: typeof renderStoryboard = renderStoryboard,
) {
  const queue: StagedStoryboard[] = [];
  const jobs = new Map<string, StoryboardJob>();
  const stages = new Set<Promise<StoryboardJob>>();
  const controller = new AbortController();
  const { signal } = controller;
  let running: Promise<void> | undefined;

  async function run(staged: StagedStoryboard) {
    const { directory, entry, id, identity, inputs, original, storyboard } = staged;
    const key = `${entry.id}/${identity}/${id}`;
    const output = path.join(directory, 'render.mp4');
    jobs.set(key, { id, status: 'running' });
    try {
      await render(storyboard, inputs, output, signal);
      if (signal.aborted) return;
      const stat = fs.lstatSync(output);
      if (!stat.isFile() || stat.size === 0 || stat.size > MAX_OUTPUT_BYTES)
        throw new StoryboardError(422, 'Rendered video is empty or exceeds 128 MiB');
      const publish = (admit: (bytes: number) => void) => {
        if (signal.aborted) return;
        checkArtifact(entry.dir, original, identity);
        if (hasVideo(project.stateDir, entry.id, identity, id)) return;
        const existing = cacheDirectory(project.stateDir, entry.id, identity);
        const name = `${id}.mp4`;
        const retired = retiredRenders(existing, name);
        const superseded =
          existing && fs.lstatSync(path.join(existing, name), { throwIfNoEntry: false });
        if (superseded && !superseded.isFile())
          throw new StoryboardError(422, 'Unsafe storyboard render file');
        const delta = stat.size - (superseded ? superseded.size : 0);
        admit(retired.reduce((bytes, previous) => bytes - previous.stat.size, delta));
        const cache = existing ?? cacheDirectory(project.stateDir, entry.id, identity, true);
        if (!cache) throw new StoryboardError(409, 'Storyboard render directory is unavailable');
        const temporary = path.join(cache, `.${randomUUID()}.tmp`);
        const target = path.join(cache, name);
        try {
          fs.copyFileSync(output, temporary, fs.constants.COPYFILE_EXCL);
          fs.renameSync(temporary, target);
          try {
            for (const previous of retired) fs.rmSync(previous.file, { force: true });
          } catch (error) {
            fs.rmSync(target, { force: true });
            throw error;
          }
        } finally {
          fs.rmSync(temporary, { force: true });
        }
      };
      if (project.mount?.backgroundWrite) {
        await untilAborted(signal, project.mount.backgroundWrite(publish));
      } else publish(() => undefined);
      jobs.delete(key);
    } catch (error) {
      if (signal.aborted) return;
      const message =
        error instanceof StoryboardRenderError ||
        error instanceof StoryboardError ||
        error instanceof RemoteTransferError
          ? error.message
          : 'Storyboard video could not be rendered';
      jobs.delete(key);
      jobs.set(key, { id, status: 'failed', error: message });
      const failed = [...jobs].filter(([, job]) => job.status === 'failed');
      if (failed.length > MAX_FAILED) jobs.delete(failed[0]![0]);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  }

  function pump() {
    if (running || signal.aborted) return;
    const staged = queue.shift();
    if (!staged) return;
    running = run(staged).finally(() => {
      running = undefined;
      pump();
    });
  }

  async function stage(entry: StoryboardEntry, revision: string): Promise<StoryboardJob> {
    const staged = await copyInputs(entry, revision, signal);
    const { directory, id, identity } = staged;
    const key = `${entry.id}/${identity}/${id}`;
    let queued = false;
    try {
      signal.throwIfAborted();
      if (hasVideo(project.stateDir, entry.id, identity, id)) return { id, status: 'ready' };
      const existing = jobs.get(key);
      if (existing && existing.status !== 'failed') return existing;
      const job = { id, status: 'queued' } as const;
      jobs.set(key, job);
      queue.push(staged);
      queued = true;
      pump();
      return job;
    } finally {
      if (!queued) fs.rmSync(directory, { recursive: true, force: true });
    }
  }

  return {
    async start(entry: StoryboardEntry, revision: string) {
      if (signal.aborted) throw new StoryboardError(503, 'Storyboard rendering is stopping');
      if (stages.size + queue.length + (running ? 1 : 0) >= MAX_PENDING)
        throw new StoryboardError(429, 'Storyboard render queue is full. Retry shortly.');
      const task = stage(entry, revision);
      stages.add(task);
      try {
        return await task;
      } catch (error) {
        if (signal.aborted) throw new StoryboardError(503, 'Storyboard rendering is stopping');
        throw error;
      } finally {
        stages.delete(task);
      }
    },
    status(entry: StoryboardEntry, id: string): StoryboardJob | null {
      if (!isJobId(id)) return null;
      const identity = storyboardIdentity(entry.dir);
      const existing = jobs.get(`${entry.id}/${identity}/${id}`);
      if (existing && existing.status !== 'failed') return existing;
      if (hasVideo(project.stateDir, entry.id, identity, id)) return { id, status: 'ready' };
      return existing ?? null;
    },
    video(entry: StoryboardEntry, id: string) {
      return openVideo(project.stateDir, entry.id, storyboardIdentity(entry.dir), id);
    },
    async close() {
      controller.abort();
      await Promise.allSettled([...stages, ...(running ? [running] : [])]);
      for (const staged of queue.splice(0))
        fs.rmSync(staged.directory, { recursive: true, force: true });
      jobs.clear();
    },
  };
}

const projects = new WeakMap<JobProject, ReturnType<typeof createStoryboardJobs>>();

export function storyboardJobsOf(project: JobProject) {
  let jobs = projects.get(project);
  if (!jobs) {
    jobs = createStoryboardJobs(project);
    projects.set(project, jobs);
  }
  return jobs;
}

export async function closeStoryboardJobs(project: JobProject) {
  await storyboardJobsOf(project).close();
}
