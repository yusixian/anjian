import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { CanvasPayload, RecordingState } from '../shared/types';
import { resolveBoardFile } from './paths';
import { RemoteTransferError } from './remote-transfer';
import { trimRecording, type TrimResult } from './recording-trim';
import type { CommentAdmission } from './document-comments';
import { createPreparedStateFiles } from './storage/prepared-files';

// Bump when the preparation policy changes; source bytes + policy identify a
// durable cache entry. Quota failures retry; media failures wait for a restart or edit.
const POLICY = 'idle-ends-v1';
const STABLE_MS = 750;
const digest = (data: Buffer | string) => crypto.createHash('sha256').update(data).digest('hex');
const stamp = (file: string) => {
  const stat = fs.statSync(file);
  return `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`;
};
interface Cached {
  hash?: string;
  result: TrimResult;
}
interface Job {
  artifact: string;
  admissionBytes?: number;
  controller: AbortController;
  file: string;
  hash?: string;
  key: string;
  output?: string;
  stamp: string;
  state: RecordingState;
  timer?: NodeJS.Timeout;
  virtual?: string;
}
interface Options {
  onChange: (id: string) => void;
  withWriteQuota?: (work: (admit: CommentAdmission) => Promise<void>) => Promise<void>;
  // The processor is also a boundary for alternative local media backends.
  prepare?: typeof trimRecording;
  stableMs?: number;
  retryMs?: number;
  stateDir: string;
}

export function createVerifyRecordings(options: Options) {
  const jobs = new Map<string, Job>();
  const boardJobs = new Map<string, Job>();
  const queue: Job[] = [];
  const files = new Map<string, string>();
  const pendingCleanup = new Set<string>();
  let running: Promise<unknown> | undefined;
  let task: Promise<void> | undefined;
  let waitingForQuota = false;
  const temporaryDirectories = new Set<string>();
  const resumeWaiters = new Set<() => void>();
  const wake = () => {
    for (const resolve of resumeWaiters) resolve();
    resumeWaiters.clear();
  };
  let closed = false;
  let paused = false;
  const current = (job: Job) =>
    !closed && jobs.get(job.key) === job && !job.controller.signal.aborted;
  const notify = (job: Job) => {
    if (current(job)) options.onChange(job.artifact);
  };
  const cacheDir = path.join(options.stateDir, 'recordings');

  const active = async <T>(work: () => Promise<T>): Promise<T> => {
    const phase = work();
    running = phase;
    try {
      return await phase;
    } finally {
      if (running === phase) running = undefined;
    }
  };
  const admitted = async (job: Job, work: (admit: CommentAdmission) => void) => {
    while (current(job)) {
      if (paused) await new Promise<void>(resolve => resumeWaiters.add(resolve));
      if (!current(job)) return false;
      let executed = false;
      const enter = async (admit: CommentAdmission) => {
        if (!current(job) || paused) return;
        work(admit);
        executed = true;
      };
      waitingForQuota = true;
      try {
        if (options.withWriteQuota) await options.withWriteQuota(enter);
        else await enter(() => undefined);
      } finally {
        waitingForQuota = false;
      }
      if (executed) return true;
    }
    return false;
  };

  async function process(job: Job) {
    let temporary: string | undefined;
    try {
      if (stamp(job.file) !== job.stamp) {
        jobs.delete(job.key);
        options.onChange(job.artifact);
        return;
      }
      const bytes = await fs.promises.readFile(job.file);
      if (!current(job)) return;
      if (stamp(job.file) !== job.stamp) {
        jobs.delete(job.key);
        options.onChange(job.artifact);
        return;
      }
      const key = digest(`${POLICY}:${digest(bytes)}`);
      const dir = path.join(cacheDir, key);
      const output = path.join(dir, 'clip.mp4');
      const metadata = path.join(dir, 'result.json');
      let cached: Cached | undefined;
      try {
        const saved: Cached = JSON.parse(fs.readFileSync(metadata, 'utf8'));
        if (
          saved.result.status !== 'trimmed' ||
          (fs.existsSync(output) && saved.hash === digest(fs.readFileSync(output)))
        )
          cached = saved;
      } catch {
        /* uncached or incomplete entry */
      }
      if (!cached) {
        if (!await admitted(job, admit => {
          admit(Math.max(bytes.byteLength, job.admissionBytes ?? 0));
          temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'anjian-recording-prepare-'));
          temporaryDirectories.add(temporary);
          fs.writeFileSync(path.join(temporary, 'capture'), bytes);
        })) return;
        if (job.state.status !== 'processing') {
          job.state = { status: 'processing' };
          notify(job);
        }
        const input = path.join(temporary!, 'capture');
        const prepared = path.join(temporary!, 'clip.mp4');
        const result = await active(() => (options.prepare ?? trimRecording)(input, prepared, job.controller.signal));
        if (!current(job)) return;
        if (stamp(job.file) !== job.stamp) {
          jobs.delete(job.key);
          options.onChange(job.artifact);
          return;
        }
        if (!await admitted(job, admit => {
          if (stamp(job.file) !== job.stamp) {
            jobs.delete(job.key);
            options.onChange(job.artifact);
            return;
          }
          const clip = result.status === 'trimmed' ? fs.readFileSync(prepared) : undefined;
          const hash = clip ? digest(clip) : undefined;
          cached = { result, ...(hash ? { hash } : {}) };
          const planned = [
            ...(clip ? [{ file: output, data: clip }] : []),
            { file: metadata, data: `${JSON.stringify(cached, null, 2)}\n` },
          ];
          const size = (file: string) => {
            try { return fs.statSync(file).size; }
            catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0; throw error; }
          };
          job.admissionBytes = planned.reduce((sum, entry) => sum + Buffer.byteLength(entry.data) - size(entry.file), 0);
          admit(job.admissionBytes);
          const transaction = createPreparedStateFiles(options.stateDir, planned);
          transaction.stage();
          try { transaction.commit(); }
          catch (error) {
            try { transaction.abort(); }
            catch (rollback) { throw new AggregateError([error, rollback], 'Recording cache rollback failed'); }
            throw error;
          }
          transaction.finalize();
        })) return;
      }
      if (!current(job)) return;
      if (stamp(job.file) !== job.stamp) {
        jobs.delete(job.key);
        options.onChange(job.artifact);
        return;
      }
      if (!cached) return;
      job.state = { ...cached.result, status: 'ready', outcome: cached.result.status };
      if (cached.result.status === 'trimmed') {
        job.output = output;
        job.virtual = `pages/anjian-recordings/${key}.mp4`;
        job.hash = cached.hash;
        files.set(`${job.artifact}/${job.virtual}`, output);
      }
      notify(job);
    } catch (error) {
      if (!current(job)) return;
      job.state = {
        status: 'original',
        warning: `Using the original recording: ${(error as Error).message}`,
      };
      if (error instanceof RemoteTransferError && error.code === 'storage_quota_exceeded') {
        job.timer = setTimeout(() => {
          if (!current(job)) return;
          queue.push(job);
          pump();
        }, options.retryMs ?? 30_000);
        job.timer.unref?.();
      }
      notify(job);
    } finally {
      if (temporary) {
        try {
          fs.rmSync(temporary, { recursive: true, force: true });
          temporaryDirectories.delete(temporary);
          pendingCleanup.delete(temporary);
        } catch {
          pendingCleanup.add(temporary);
        }
      }
    }
  }
  function pump() {
    if (task || closed || paused) return;
    const job = queue.shift();
    if (!job) return;
    if (!current(job)) { pump(); return; }
    task = process(job).catch(error => {
      // Observers may throw after processing or fallback notification. Keep the
      // queue alive and make the failure visible without an unhandled rejection.
      console.error('Recording preparation notification failed', error);
    }).finally(() => {
      task = undefined;
      pump();
    });
  }
  const stop = (job: Job) => {
    clearTimeout(job.timer);
    job.controller.abort();
    jobs.delete(job.key);
  };

  return {
    project(id: string, dir: string, payload: CanvasPayload): CanvasPayload {
      if (!payload.canvas || closed) return payload;
      const canvas = { ...payload.canvas, boards: { ...payload.canvas.boards } };
      const eligible = new Set(
        Object.values(canvas.groups ?? {})
          .filter((group) => group.verify)
          .flatMap((group) => group.boards),
      );
      const active = new Set<string>();
      const recordings: Record<string, RecordingState> = {};
      const pending = new Set(payload.pending);
      const versions = { ...payload.versions };
      for (const key of boardJobs.keys()) if (key.startsWith(`${id}/`)) boardJobs.delete(key);
      for (const [boardId, board] of Object.entries(canvas.boards)) {
        if (board.type !== 'video' || board.trim === false || !eligible.has(boardId)) continue;
        const file = resolveBoardFile(dir, board.file);
        if (!file || !versions[board.file]) continue;
        const key = `${id}/${board.file}`;
        active.add(key);
        let job = jobs.get(key);
        const version = stamp(file);
        if (job && job.stamp !== version) {
          stop(job);
          job = undefined;
        }
        if (!job) {
          job = {
            artifact: id,
            key,
            file,
            stamp: version,
            state: { status: 'processing' },
            controller: new AbortController(),
          };
          jobs.set(key, job);
          const scheduled = job;
          job.timer = setTimeout(() => {
            queue.push(scheduled);
            pump();
          }, options.stableMs ?? STABLE_MS);
        }
        boardJobs.set(`${id}/${boardId}`, job);
        recordings[boardId] = job.state;
        if (job.state.status === 'processing') pending.add(boardId);
        if (job.virtual && job.output) {
          canvas.boards[boardId] = { ...board, file: job.virtual, src: job.virtual };
          versions[job.virtual] = fs.statSync(job.output).mtimeMs;
        }
      }
      for (const job of jobs.values()) if (job.artifact === id && !active.has(job.key)) stop(job);
      canvas.building = pending.size > 0;
      return {
        ...payload,
        canvas,
        versions,
        pending: [...pending].sort(),
        ...(Object.keys(recordings).length ? { recordings } : {}),
      };
    },
    resolve(id: string, relative: string) {
      return files.get(`${id}/${relative}`) ?? null;
    },
    evidenceHash(id: string, board: string, source: string) {
      const job = boardJobs.get(`${id}/${board}`);
      return job?.state.status === 'processing'
        ? `${source}:preparing`
        : job?.hash
          ? digest(`${source}:${job.hash}`)
          : source;
    },
    overrides(id: string, payload: CanvasPayload) {
      const overrides = new Map<string, Buffer | null>();
      if (!payload.canvas) return overrides;
      const referenced = new Set(Object.values(payload.canvas.boards).map((board) => board.file));
      for (const job of jobs.values()) {
        if (job.artifact !== id || !job.virtual || !job.output || !referenced.has(job.virtual))
          continue;
        const original = job.key.slice(id.length + 1);
        if (!referenced.has(original)) overrides.set(original, null);
        overrides.set(job.virtual, fs.readFileSync(job.output));
      }
      if (overrides.size) overrides.set('canvas.json', Buffer.from(JSON.stringify(payload.canvas)));
      return overrides;
    },
    async quiesce(): Promise<() => void> {
      if (closed || paused) throw new Error('Recording preparation is already closed or paused');
      paused = true;
      let released = false;
      const resume = () => {
        if (released) return;
        released = true;
        paused = false;
        wake();
        pump();
      };
      try {
        await running;
        const failures: unknown[] = [];
        for (const directory of pendingCleanup) {
          try {
            fs.rmSync(directory, { recursive: true, force: true });
            pendingCleanup.delete(directory);
            temporaryDirectories.delete(directory);
          } catch (error) { failures.push(error); }
        }
        if (failures.length) throw new AggregateError(failures, 'Recording preparation did not quiesce completely');
        return resume;
      } catch (error) {
        resume();
        throw error;
      }
    },
    async close() {
      closed = true;
      for (const job of jobs.values()) stop(job);
      wake();
      const failures: unknown[] = [];
      try { await running; } catch (error) { failures.push(error); }
      if (!waitingForQuota) {
        try { await task; } catch (error) { failures.push(error); }
      }
      for (const directory of new Set([...pendingCleanup, ...temporaryDirectories])) {
        try {
          fs.rmSync(directory, { recursive: true, force: true });
          pendingCleanup.delete(directory);
          temporaryDirectories.delete(directory);
        } catch (error) { failures.push(error); }
      }
      if (failures.length) throw new AggregateError(failures, 'Recording preparation did not close completely');
    },
  };
}
