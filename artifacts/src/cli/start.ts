import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

import { AGENT_MARKERS, detectAgent } from '../server/agent';
import { artifactPath } from '../server/artifact-address';
import { artifactKeyOf } from '../server/artifacts';
import { openBrowser } from '../server/browser-focus';
import { artifactAgentFile } from '../server/comment-names';
import { recordHubEvent } from '../server/hub-events';
import { ensureHome, type MachinePaths, machinePaths, readProjects } from '../server/machine';
import { readEntries, registryDir, removeEntry } from '../server/registry';
import { writeJsonAtomic } from '../server/state';
import type { CommandSpec } from './command';
import {
  ARTIFACT_ERROR,
  ARTIFACT_PATTERN,
  CliError,
  invocation,
  type ProjectPaths,
  projectPaths,
} from './paths';
import { alive, hasServerId, readText, sleep, waitForExit } from './process';
import { artifactSkillBody } from './skills';
import { replaceDecision } from './upgrade-rule';

declare const CLI_VERSION: string | undefined;

export interface StartOptions {
  artifact?: string;
  background: boolean;
  exclusive?: boolean;
  foreground: boolean;
  host: string;
  mockup?: boolean;
  open: boolean;
  openExisting?: boolean;
  port?: string;
  projectDir: string;
  urlHost?: string;
}

export type Emit = (value: Record<string, unknown>) => void;

interface ServerInfo {
  boardOrigin?: string;
  host?: string;
  localUrl?: string;
  port: number;
  publicOrigin?: string;
  url: string;
  urlHost?: string;
  version?: string;
}

const REGISTER_TIMEOUT_MS = 15000;
const STATUS_TIMEOUT_MS = 1000;
const START_TIMEOUT_MS = 10000;
const SETTLE_MS = 6000;

const loopbackUrl = (url: string) => {
  const parsed = new URL(url);
  if (parsed.hostname === 'localhost') parsed.hostname = '127.0.0.1';
  return parsed;
};

const apiUrl = (info: ServerInfo, pathname: string) => {
  const base = loopbackUrl(info.localUrl ?? info.url);
  const target = new URL(pathname, base.origin);
  const key = base.searchParams.get('key');
  if (key) target.searchParams.set('key', key);
  return target.toString();
};

function withLink(info: ServerInfo, paths: ProjectPaths, artifact: string | undefined) {
  const out: Record<string, unknown> = {
    type: 'server-started',
    url: info.url,
    port: info.port,
    root: paths.root,
  };
  if (artifact) {
    const url = new URL(info.url);
    const ref = artifactKeyOf(artifact)!;
    const key = url.searchParams.get('key');
    out.link = `${url.origin}${artifactPath(paths.root, ref.type, ref.id)}${key ? `?key=${key}` : ''}`;
  }
  return out;
}

async function acquireLock(lock: string) {
  for (let attempt = 0; attempt < 150; attempt++) {
    try {
      fs.mkdirSync(lock);
      return true;
    } catch {}
    try {
      if (Date.now() - fs.statSync(lock).mtimeMs > 60_000) {
        fs.rmdirSync(lock);
        continue;
      }
    } catch {}
    await sleep(100);
  }
  return false;
}

function runningPid(machine: MachinePaths) {
  const pid = Number(readText(machine.pid));
  const id = readText(machine.serverId);
  if (!Number.isInteger(pid) || pid <= 0 || !id) return null;
  return hasServerId(pid, id) ? pid : null;
}

function readInfo(machine: MachinePaths): ServerInfo | null {
  try {
    const info = JSON.parse(readText(machine.info) ?? '') as ServerInfo;
    return typeof info.url === 'string' && Number.isInteger(info.port) ? info : null;
  } catch {
    return null;
  }
}

async function answers(info: ServerInfo, pid: number) {
  try {
    const res = await fetch(apiUrl(info, '/api/status'), {
      signal: AbortSignal.timeout(STATUS_TIMEOUT_MS),
    });
    return res.ok && (await res.json()).pid === pid;
  } catch {
    return false;
  }
}

async function stopPid(pid: number, what: string) {
  try {
    process.kill(pid, 'SIGTERM');
  } catch {}
  if (await waitForExit(pid, 7000)) return;
  try {
    process.kill(pid, 'SIGKILL');
  } catch {}
  if (await waitForExit(pid, 2000)) return;
  throw new CliError(
    `The ${what} (pid ${pid}) did not stop; stop it with \`${invocation()} stop\` and retry`,
  );
}

async function stopOldProjectServers() {
  const dir = registryDir();
  for (const entry of readEntries(dir)) {
    if (hasServerId(entry.pid, entry.serverId)) {
      try {
        process.kill(entry.pid, 'SIGTERM');
      } catch {}
      await waitForExit(entry.pid, 5000);
    }
    try {
      removeEntry(dir, entry);
    } catch {}
  }
}

function recordAgent(paths: ProjectPaths, artifact?: string) {
  const markers = Object.fromEntries(
    AGENT_MARKERS.flatMap((key) => (process.env[key] ? [[key, process.env[key]]] : [])),
  );
  if (!Object.keys(markers).length) return;
  const ref = artifact && artifactKeyOf(artifact);
  if (ref && !detectAgent(markers)) return;
  writeJsonAtomic(ref ? artifactAgentFile(paths.agent, ref) : paths.agent, markers);
}

function serverEnv(options: StartOptions) {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ARTIFACTS_HOST: options.host,
    ARTIFACTS_URL_HOST: options.urlHost!,
  };
  if (process.env.ANJIAN_ARTIFACTS_COMMAND)
    env.ANJIAN_ARTIFACTS_LAUNCHER = process.env.ANJIAN_ARTIFACTS_COMMAND;
  for (const key of [
    'ANJIAN_ARTIFACTS_OWNER',
    'ANJIAN_ARTIFACTS_VERSION',
    'ANJIAN_ARTIFACTS_COMMAND',
    'ARTIFACTS_OPEN_CMD',
    'ARTIFACTS_ROOT',
  ])
    delete env[key];
  return env;
}

const startedLine = (text: string) =>
  text.split('\n').find((line) => line.includes('"server-started"'));
const errorLine = (text: string) =>
  text.split('\n').find((line) => line.includes('"server-error"'));

async function register(
  info: ServerInfo,
  paths: ProjectPaths,
  open: string | true | undefined,
): Promise<void> {
  const res = await fetch(apiUrl(info, '/api/hub/projects'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      dir: paths.project,
      ...(open ? { open } : {}),
      ...(open && process.env.ARTIFACTS_OPEN_CMD
        ? { openCmd: process.env.ARTIFACTS_OPEN_CMD }
        : {}),
    }),
    signal: AbortSignal.timeout(REGISTER_TIMEOUT_MS),
  });
  if (!res.ok) throw new CliError(`The artifacts server refused this project: ${await res.text()}`);
}

export async function start(options: StartOptions, emit: Emit): Promise<number> {
  if (options.artifact !== undefined && !ARTIFACT_PATTERN.test(options.artifact))
    throw new CliError(ARTIFACT_ERROR);
  if (
    options.port !== undefined &&
    (!/^\d+$/.test(options.port) || Number(options.port) < 1 || Number(options.port) > 65535)
  )
    throw new CliError('--port must be a port number');
  options.urlHost ||=
    options.host === '127.0.0.1' || options.host === 'localhost' ? 'localhost' : options.host;
  process.umask(0o077);
  const paths = projectPaths(options.projectDir);
  const machine = machinePaths();
  ensureHome(machine.home);
  fs.mkdirSync(paths.state, { recursive: true });
  if (!fs.existsSync(path.join(paths.state, '.gitignore')))
    fs.writeFileSync(path.join(paths.state, '.gitignore'), '*\n');
  const cliVersion =
    process.env.ANJIAN_ARTIFACTS_VERSION || (typeof CLI_VERSION === 'string' ? CLI_VERSION : '');
  const known = readProjects(machine.projects).some((entry) => entry.dir === paths.project);

  const finish = async (info: ServerInfo, reused: boolean, hint?: string) => {
    recordAgent(paths, options.artifact);
    const wantsOpen = options.open && (!reused || !known);
    await register(info, paths, wantsOpen ? (options.artifact ?? true) : undefined);
    if (options.artifact && process.connected && process.send) {
      process.send(
        {
          type: 'artifact-opened',
          project: paths.project,
          artifact: options.artifact,
        },
        () => {},
      );
    }
    const base = withLink(info, paths, options.artifact);
    if (reused) base.reused = true;
    if (hint) base.hint = hint;
    if (options.mockup) base.mockupGuide = artifactSkillBody('phone-mockups.md');
    emit(base);
    if (
      reused &&
      known &&
      process.platform === 'darwin' &&
      options.open &&
      options.openExisting &&
      options.artifact &&
      !process.env.ARTIFACTS_OPEN_CMD
    ) {
      const local = base.link as string;
      await openBrowser(local, [local]).catch((error: Error) => console.error(error.message));
    }
  };

  if (!(await acquireLock(machine.lock)))
    throw new CliError('Another start is still starting the artifacts server; retry in a moment');
  let locked = true;
  const unlock = () => {
    if (!locked) return;
    locked = false;
    try {
      fs.rmdirSync(machine.lock);
    } catch {}
  };
  try {
    const running = runningPid(machine);
    if (options.exclusive && running)
      throw new CliError(
        'Anjian Hub is already running; stop it before starting the user service',
        {},
        78,
      );
    let info = readInfo(machine);
    if (running && !info) {
      for (let waited = 0; waited < SETTLE_MS && alive(running) && !info; waited += 100) {
        await sleep(100);
        info = readInfo(machine);
      }
      if (!info && alive(running)) {
        await stopPid(running, 'stopping artifacts server');
        recordHubEvent(machine, { action: 'replace', reason: 'unresponsive', pid: running });
      }
    }
    if (running && info) {
      const runningVersion = readText(machine.version) ?? '';
      const decision = replaceDecision(runningVersion, cliVersion);
      const mismatch =
        (info.host ?? '127.0.0.1') !== options.host ||
        (info.urlHost ?? 'localhost') !== options.urlHost ||
        (info.publicOrigin ?? '') !==
          (process.env.ANJIAN_PUBLIC_ORIGIN ?? '').replace(/\/+$/, '') ||
        (info.boardOrigin ?? '') !== (process.env.ANJIAN_BOARD_ORIGIN ?? '').replace(/\/+$/, '') ||
        (options.port !== undefined && String(info.port) !== options.port);
      const keepLocal = decision === 'keep-local-build';
      if (decision !== 'replace' && (!mismatch || keepLocal) && (await answers(info, running))) {
        if (keepLocal && mismatch) {
          recordHubEvent(machine, { action: 'keep', reason: 'local-build-settings', pid: running });
          throw new CliError(
            `Kept the running local Anjian Hub. Use \`${invocation()} stop\` before starting with different listening settings`,
          );
        }
        recordHubEvent(machine, {
          action: 'keep',
          reason: keepLocal
            ? 'local-build'
            : decision === 'keep-older-cli'
              ? 'older-cli'
              : 'same-version',
          pid: running,
        });
        unlock();
        await finish(
          info,
          true,
          decision === 'keep-older-cli'
            ? `The running server is ${runningVersion}, newer than this CLI (${cliVersion}); kept it`
            : undefined,
        );
        return 0;
      }
      await stopPid(running, 'running artifacts server');
      recordHubEvent(machine, {
        action: 'replace',
        reason:
          decision === 'replace'
            ? 'version-changed'
            : mismatch && !keepLocal
              ? 'settings-changed'
              : 'unresponsive',
        pid: running,
      });
    }
    await stopOldProjectServers();

    fs.rmSync(machine.info, { force: true });
    const id = crypto.randomBytes(24).toString('hex');
    fs.writeFileSync(machine.serverId, `${id}\n`);
    fs.writeFileSync(machine.version, `${cliVersion}\n`);
    const server = path.join(__dirname, 'server.cjs');
    const args = [
      server,
      `--artifacts-server-id=${id}`,
      ...(options.port ? [`--port=${options.port}`] : []),
    ];
    const env = serverEnv(options);
    const foreground = options.foreground || (!options.background && !!process.env.CODEX_CI);

    if (foreground) {
      const child = spawn(process.execPath, args, { env, stdio: ['ignore', 'pipe', 'inherit'] });
      fs.writeFileSync(machine.pid, `${child.pid}\n`);
      for (const signal of ['SIGINT', 'SIGTERM'] as const)
        process.on(signal, () => child.kill('SIGTERM'));
      const exited = new Promise<number>((resolve) =>
        child.on('close', (code) => resolve(code ?? 1)),
      );
      let announced = false;
      readline.createInterface({ input: child.stdout! }).on('line', (line) => {
        let value: Record<string, unknown>;
        try {
          value = JSON.parse(line);
        } catch {
          process.stdout.write(`${line}\n`);
          return;
        }
        if (value.type !== 'server-started' || announced) {
          emit(value);
          return;
        }
        announced = true;
        unlock();
        void finish(value as unknown as ServerInfo, false).catch((error: Error) =>
          emit({ type: 'error', error: error.message }),
        );
      });
      return await exited;
    }

    const log = fs.openSync(machine.log, 'w');
    const child = spawn(process.execPath, args, {
      env,
      detached: true,
      windowsHide: true,
      stdio: ['ignore', log, log],
    });
    fs.closeSync(log);
    child.unref();
    fs.writeFileSync(machine.pid, `${child.pid}\n`);
    for (let waited = 0; waited < START_TIMEOUT_MS; waited += 100) {
      const text = readText(machine.log) ?? '';
      const started = startedLine(text);
      if (started) {
        for (let check = 0; check < 10; check++) {
          if (!alive(child.pid!))
            throw new CliError(
              `Server started but was killed. Retry in a persistent terminal with: ${invocation()} start --project-dir ${paths.project}${options.artifact ? ` --artifact ${options.artifact}` : ''} --host ${options.host} --url-host ${options.urlHost} --foreground`,
            );
          await sleep(100);
        }
        unlock();
        await finish(JSON.parse(started) as ServerInfo, false);
        return 0;
      }
      const failed = errorLine(text);
      if (failed) {
        emit(JSON.parse(failed));
        return 1;
      }
      await sleep(100);
    }
    throw new CliError(`Server failed to start within ${START_TIMEOUT_MS / 1000} seconds`);
  } finally {
    unlock();
  }
}

export const startCommand: CommandSpec = {
  name: 'start',
  summary: "Start this machine's artifacts server if needed and register the project with it",
  options: {
    'artifact': {
      type: 'string',
      value: '<type>/<id>',
      help: 'Also print a link that opens this artifact',
    },
    'host': {
      type: 'string',
      value: '<host>',
      help: 'Interface to listen on (default: 127.0.0.1)',
    },
    'url-host': {
      type: 'string',
      value: '<host>',
      help: 'Host in printed URLs (default: localhost for a loopback --host)',
    },
    'port': {
      type: 'string',
      value: '<n>',
      help: 'Port to listen on (default: the first free of 27319-27321)',
    },
    'open': {
      type: 'boolean',
      help: 'Open or focus the artifact, including when reusing a server',
    },
    'mockup': {
      type: 'boolean',
      help: 'Include the phone mockup guide with the startup result',
    },
    'no-open': { type: 'boolean', help: 'Do not open a browser' },
    'foreground': { type: 'boolean', help: 'Run the server in this process until Ctrl+C' },
    'no-daemon': { type: 'boolean' },
    'exclusive': { type: 'boolean', help: 'Fail if an existing Hub owns the state directory' },
    'background': {
      type: 'boolean',
      help: 'Detach the server even where it would run in the foreground',
    },
    'daemon': { type: 'boolean' },
  },
  run: ({ values, projectDir }, emit) =>
    start(
      {
        projectDir,
        exclusive: !!values.exclusive,
        artifact: values.artifact as string | undefined,
        host: (values.host as string | undefined) ?? '127.0.0.1',
        urlHost: (values['url-host'] as string | undefined) ?? process.env.ARTIFACTS_URL_HOST,
        port: values.port as string | undefined,
        open: values['no-open'] ? false : values.open ? true : process.env.ARTIFACTS_OPEN !== '0',
        openExisting: !!values.open,
        mockup: !!values.mockup,
        foreground: !!(values.foreground || values['no-daemon']),
        background: !!(values.background || values.daemon),
      },
      emit,
    ),
  text: (value) => {
    if (value.type !== 'server-started') return null;
    const link = `${value.link ?? value.url}${value.reused ? ' (already running)' : ''}`;
    return typeof value.mockupGuide === 'string' ? `${link}\n\n${value.mockupGuide}` : link;
  },
};
