import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

import {
  createProjectPoll,
  type FeedbackEvent,
  unreadCount,
} from '../../../skills/artifacts/app/comment-watch.cjs';
import { createLocalCommentEvents } from '../../../skills/artifacts/app/local-comment-events.cjs';
import { labelProcess } from '../../../skills/artifacts/app/process-label.cjs';
import { feedbackDisplayName } from '../server/agent';
import type { CommandInput, CommandSpec } from './command';
import { CliError, projectPaths } from './paths';
import type { Emit } from './start';

const ARTIFACT = /^(?:document|artboard)\/[a-z0-9][a-z0-9-]*$/;
const HOST = /^[a-z][a-z0-9-]{0,31}$/;
const SESSION = /^[A-Z0-9][\w.:-]{0,94}$/i;
const RESERVED = new Set(['agy', 'claude', 'codex', 'pi', 'lody']);

function config(file: string) {
  const data: Record<string, unknown> = JSON.parse(fs.readFileSync(file, 'utf8'));
  const { host, name, session, command, artifacts } = data ?? {};
  if (typeof host !== 'string' || !HOST.test(host) || RESERVED.has(host))
    throw new CliError('Use a custom host ID of up to 32 lowercase letters, digits and hyphens');
  const displayName = feedbackDisplayName(typeof name === 'string' ? name : undefined);
  if (!displayName) throw new CliError('Use a display name of up to 100 characters');
  if (typeof session !== 'string' || !SESSION.test(session))
    throw new CliError(
      'Use a session ID of up to 95 letters, digits, dots, underscores, colons or hyphens',
    );
  if (
    !Array.isArray(command) ||
    typeof command[0] !== 'string' ||
    !path.isAbsolute(command[0]) ||
    !command.every((arg) => typeof arg === 'string' && !arg.includes('\0'))
  )
    throw new CliError('Set command to an array starting with an absolute executable path');
  if (
    !Array.isArray(artifacts) ||
    !artifacts.length ||
    !artifacts.every((id) => typeof id === 'string' && ARTIFACT.test(id))
  )
    throw new CliError('Set artifacts to a list of document/<id> or artboard/<id> entries');

  return {
    host,
    name: displayName,
    receipt: `${host}:${session}`,
    command: command as string[],
    artifacts: new Set<string>(artifacts),
  };
}

type Delivery = FeedbackEvent & {
  host: string;
  name: string;
  session: string;
  projectDir: string;
};

function deliver(
  command: string[],
  event: Delivery,
  signal: AbortSignal,
  env: NodeJS.ProcessEnv,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command[0]!, command.slice(1), {
      cwd: event.projectDir,
      env,
      signal,
      killSignal: 'SIGKILL',
      stdio: ['pipe', 'ignore', 'inherit'],
      windowsHide: true,
    });
    const timeout = setTimeout(() => child.kill('SIGKILL'), 15_000);
    let inputError: Error | undefined;
    child.stdin.on('error', (error) => {
      inputError = error;
    });
    child.once('error', reject);
    child.once('close', (code, killed) => {
      clearTimeout(timeout);
      if (code !== 0) reject(new Error(`Adapter exited with ${code ?? killed}`));
      else if (inputError) reject(inputError);
      else resolve();
    });
    child.stdin.end(`${JSON.stringify(event)}\n`);
  });
}

async function watch({ projectDir, values }: CommandInput, emit: Emit) {
  if (typeof values.config !== 'string')
    throw new CliError('Pass the path to your local --config JSON file');
  const { host, name, receipt, command, artifacts } = config(values.config);
  const { project, root } = projectPaths(projectDir);
  const exists = (artifact: string) =>
    fs.statSync(path.join(root, artifact), { throwIfNoEntry: false })?.isDirectory();
  for (const artifact of artifacts) {
    if (!exists(artifact))
      throw new CliError(`Anjian artifact ${artifact} was not found in ${project}`);
  }
  const env = {
    ...process.env,
    ANJIAN_FEEDBACK_SESSION: receipt,
    ANJIAN_FEEDBACK_NAME: name,
  };
  labelProcess('Custom feedback host');
  let stopped = false;
  const sources = new Map([[project, artifacts]]);
  const poll = createProjectPoll(name, receipt);
  const pending = new Map<string, { event: FeedbackEvent; retryAt: number }>();
  const events = createLocalCommentEvents(collect, env, process.argv[1]);
  let active: { artifact: string; controller: AbortController } | undefined;

  function collect() {
    if (stopped) return;
    for (const { event } of poll(sources, events.scope(sources))) {
      pending.set(JSON.stringify([event.artifact, event.round]), { event, retryAt: 0 });
    }
    if (!active) void send();
  }

  async function send() {
    for (const [key, item] of pending) {
      const { event, retryAt } = item;
      if (stopped) return;
      if (!artifacts.has(event.artifact) || Date.now() < retryAt) continue;
      if (
        event.type === 'anjian-comments' &&
        unreadCount(project, event.artifact, name, receipt) === 0
      ) {
        pending.delete(key);
        continue;
      }
      // The adapter reads review data separately through the CLI.
      const { type, artifact, round, withdrawn } = event;
      const controller = new AbortController();
      active = { artifact, controller };
      try {
        await deliver(
          command,
          {
            type,
            artifact,
            round,
            withdrawn,
            host,
            name,
            session: receipt,
            projectDir: project,
          },
          controller.signal,
          env,
        );
        if (pending.get(key) === item) pending.delete(key);
      } catch (error) {
        if (!controller.signal.aborted) {
          item.retryAt = Date.now() + 5_000;
          emit({ type: 'feedback-delivery-error', artifact, message: (error as Error).message });
        }
      } finally {
        active = undefined;
      }
    }
  }

  const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  input.on('line', (line) => {
    try {
      const { action, artifact } = JSON.parse(line);
      if (
        (action !== 'subscribe' && action !== 'unsubscribe') ||
        typeof artifact !== 'string' ||
        !ARTIFACT.test(artifact)
      )
        throw new Error('Expected subscribe or unsubscribe and a document or artboard ID');
      if (action === 'subscribe') {
        if (!exists(artifact)) throw new Error(`Anjian artifact ${artifact} was not found`);
        artifacts.add(artifact);
      } else {
        artifacts.delete(artifact);
        if (active?.artifact === artifact) active.controller.abort();
        for (const [key, { event }] of pending) {
          if (event.artifact === artifact) pending.delete(key);
        }
      }
      collect();
      emit({ type: 'feedback-subscription', action, artifact, session: receipt });
    } catch (error) {
      emit({ type: 'feedback-control-error', message: (error as Error).message });
    }
  });
  const interrupt = () => input.close();
  process.on('SIGINT', interrupt);
  process.on('SIGTERM', interrupt);
  const timer = setInterval(collect, 1000);
  try {
    collect();
    emit({ type: 'feedback-host-ready', host, name, session: receipt, artifacts: [...artifacts] });
    await new Promise<void>((resolve) => input.once('close', resolve));
    return 0;
  } finally {
    clearInterval(timer);
    stopped = true;
    active?.controller.abort();
    events.close();
    process.off('SIGINT', interrupt);
    process.off('SIGTERM', interrupt);
  }
}

export const feedbackHostCommand: CommandSpec = {
  name: 'feedback-host',
  summary: 'Deliver local artifact feedback to a configured Agent host',
  usage: ['--config <file> [--project-dir <path>]'],
  options: {
    config: {
      type: 'string',
      value: '<file>',
      help: 'Explicit path to your local host configuration',
    },
  },
  run: watch,
};
