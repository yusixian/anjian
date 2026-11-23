import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { isObject } from '../shared/comments';
import {
  VERIFICATION_RUN_ID,
  type VerificationRun,
  type VerificationSnapshot,
} from '../shared/verification-runs';
import { writeJsonAtomic } from './state';

interface Check {
  command: string[];
  id: string;
  title: string;
}

const digest = (text: string) => createHash('sha256').update(text).digest('hex');
const environmentKeys = [
  'PATH',
  'Path',
  'HOME',
  'USERPROFILE',
  'SystemRoot',
  'TMPDIR',
  'TEMP',
  'LANG',
  'LC_ALL',
];

function executeCheck(command: string[], project: string, signal: AbortSignal) {
  const [executable, ...args] = command;
  const env = Object.fromEntries(environmentKeys.map((name) => [name, process.env[name]]));
  const ownGroup = process.platform !== 'win32';
  const child = spawn(executable!, args, {
    cwd: project,
    env,
    detached: ownGroup,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const maxOutput = 512 * 1024;
  const chunks: Buffer[] = [];
  let size = 0;
  let failure: string | undefined;
  const stop = (reason: string) => {
    if (failure) return;
    failure = reason;
    if (child.pid === undefined) return;
    try {
      if (ownGroup) process.kill(-child.pid, 'SIGKILL');
      else child.kill('SIGKILL');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH')
        console.error('Could not stop verification check', error);
    }
  };
  const collect = (chunk: Buffer) => {
    const part = chunk.subarray(0, maxOutput - size);
    if (part.length) chunks.push(part);
    size += part.length;
    if (part.length < chunk.length) stop('Check exceeded the output limit.');
  };
  const abort = () => stop('Check stopped when the Hub closed.');
  child.stdout.on('data', collect);
  child.stderr.on('data', collect);
  const timer = setTimeout(() => stop('Check timed out after 5 minutes.'), 300_000);
  signal.addEventListener('abort', abort, { once: true });
  return new Promise<{ exitCode: number | null; output: string }>((resolve) => {
    child.once('error', () => {
      failure ??= 'Check could not start.';
    });
    child.once('close', (code) => {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      const text = Buffer.concat(chunks).toString('utf8');
      resolve({
        exitCode: failure ? null : code,
        output: [text, failure ?? (code === null ? 'Check was terminated.' : '')]
          .filter(Boolean)
          .join('\n'),
      });
    });
  });
}

export function createVerificationRuns(home: string) {
  const configFile = path.join(home, 'verification-checks.json');
  const active = new Map<string, { check: string; abort: AbortController; done: Promise<void> }>();
  const failedWrites = new Set<string>();
  let closed = false;

  function checksFor(project: string, document: string): Check[] {
    let config: unknown;
    try {
      config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw new Error('Could not read verification-checks.json', { cause: error });
    }
    if (!isObject(config) || !Array.isArray(config.reports))
      throw new Error('verification-checks.json requires a reports array');
    const reports = config.reports.filter(
      (row) => isObject(row) && row.project === project && row.document === document,
    );
    if (!reports.length) return [];
    const checks: unknown = reports[0]?.checks;
    if (reports.length !== 1 || !Array.isArray(checks))
      throw new Error('A report must have one verification configuration with a checks array');
    const ids = new Set<string>();
    return checks.map((check) => {
      if (
        !isObject(check) ||
        typeof check.id !== 'string' ||
        !/^[a-z0-9][a-z0-9-]{0,63}$/.test(check.id) ||
        ids.has(check.id) ||
        typeof check.title !== 'string' ||
        !check.title.trim() ||
        !Array.isArray(check.command) ||
        typeof check.command[0] !== 'string' ||
        !path.isAbsolute(check.command[0]) ||
        !check.command.every(
          (argument: unknown) => typeof argument === 'string' && !argument.includes('\0'),
        )
      )
        throw new Error(
          'Each verification check needs a unique ID, a title and an absolute executable with arguments',
        );
      ids.add(check.id);
      return { id: check.id, title: check.title, command: check.command as string[] };
    });
  }

  const keyOf = (project: string, document: string) => digest(project + '\0' + document);
  const directoryFor = (key: string) => path.join(home, 'verification-runs', key);

  function snapshot(project: string, document: string): VerificationSnapshot | null {
    const checks = checksFor(project, document);
    if (!checks.length) return null;
    const key = keyOf(project, document);
    const directory = directoryFor(key);
    let runs: string[];
    try {
      runs = fs.readdirSync(directory);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      runs = [];
    }
    return {
      checks: checks.map(({ id, title }) => ({ id, title })),
      running: active.get(key)?.check ?? null,
      ...(failedWrites.has(key) ? { writeFailed: true } : {}),
      runs: runs
        .filter((file) => file.endsWith('.json') && VERIFICATION_RUN_ID.test(file.slice(0, -5)))
        .sort()
        .reverse()
        .slice(0, 20)
        .map((file) => {
          const { output: _output, ...run } = JSON.parse(
            fs.readFileSync(path.join(directory, file), 'utf8'),
          ) as VerificationRun;
          return run;
        }),
    };
  }

  function start(
    project: string,
    document: string,
    id: string,
  ): 'accepted' | 'running' | 'missing' {
    const check = checksFor(project, document).find((item) => item.id === id);
    if (closed || !check) return 'missing';
    const key = keyOf(project, document);
    if (active.has(key)) return 'running';
    const directory = directoryFor(key);
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    failedWrites.delete(key);
    const runId = Date.now() + '-' + randomUUID();
    const startedAt = new Date().toISOString();
    const abort = new AbortController();
    const done = executeCheck(check.command, project, abort.signal)
      .then(({ exitCode, output }) => {
        const run: VerificationRun = {
          id: runId,
          check: id,
          title: check.title,
          status: exitCode === 0 ? 'passed' : exitCode === null ? 'error' : 'failed',
          startedAt,
          finishedAt: new Date().toISOString(),
          exitCode,
          output,
          sha256: digest(output),
        };
        writeJsonAtomic(path.join(directory, runId + '.json'), run);
      })
      .catch((error) => {
        failedWrites.add(key);
        console.error('Could not save verification run', error);
      })
      .finally(() => active.delete(key));
    active.set(key, { check: id, abort, done });
    return 'accepted';
  }

  return {
    enabled: () => fs.existsSync(configFile),
    snapshot,
    start,
    run(project: string, document: string, id: string) {
      if (!VERIFICATION_RUN_ID.test(id) || !checksFor(project, document).length) return null;
      const file = path.join(directoryFor(keyOf(project, document)), id + '.json');
      return JSON.parse(fs.readFileSync(file, 'utf8')) as VerificationRun;
    },
    async close() {
      closed = true;
      const jobs = [...active.values()];
      jobs.forEach(({ abort }) => abort.abort());
      await Promise.all(jobs.map(({ done }) => done));
    },
  };
}
