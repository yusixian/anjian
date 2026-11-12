import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import type { CommandInput, Options } from './command';
import { CliError } from './paths';
import { authenticatedRequest, bindingFor } from './remote-core';
import type { Emit } from './start';

export const feedbackOptions: Options = {
  'input': {
    type: 'string',
    value: '<json-file>',
    help: 'Feedback connection, claim or result JSON manifest',
  },
  'task': { type: 'string', value: '<task-id>', help: 'Feedback task ID' },
  'connection': { type: 'string', value: '<connection-id>', help: 'Feedback connection ID' },
  'claim-file': {
    type: 'string',
    value: '<private-json-file>',
    help: 'Private execution credential file; required for claim and task writes',
  },
};
function jsonFile(file: string, privateFile = false): Record<string, unknown> {
  const stat = fs.lstatSync(file);
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    stat.size > 46 * 1024 * 1024 ||
    (privateFile && stat.mode & 0o077)
  )
    throw new CliError('Expected a regular JSON file; claim credentials must have mode 0600');
  const value: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new CliError('Expected a JSON object');
  return value as Record<string, unknown>;
}
const id = (value: unknown, name: string) => {
  if (typeof value !== 'string' || !/^[a-z0-9-]{1,200}$/i.test(value))
    throw new CliError(`Specify --${name}`);
  return value;
};
function safeClaimPath(file: string) {
  for (
    let current = path.resolve(file);
    current !== path.dirname(current);
    current = path.dirname(current)
  ) {
    try {
      if (fs.lstatSync(current).isSymbolicLink())
        throw new CliError('Unsafe claim credential path');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
}
function saveClaim(file: string, value: Record<string, unknown>) {
  safeClaimPath(file);
  const temporary = `${file}.${crypto.randomUUID()}.tmp`;
  try {
    const fd = fs.openSync(temporary, 'wx', 0o600);
    try {
      fs.writeFileSync(fd, JSON.stringify(value));
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(temporary, file);
    const directory = fs.openSync(path.dirname(file), 'r');
    try {
      fs.fsyncSync(directory);
    } finally {
      fs.closeSync(directory);
    }
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}
export async function feedbackCommand(input: CommandInput, emit: Emit) {
  const { projectDir, values, positionals } = input;
  const action = positionals[1];
  const read = ['status', 'pending', 'show'].includes(action ?? '');
  if (
    !read &&
    !['connect', 'pause', 'resume', 'claim', 'recover', 'renew', 'result', 'fail'].includes(
      action ?? '',
    )
  )
    throw new CliError(
      'Use remote feedback connect|status|pending|show|claim|renew|recover|result|fail|pause|resume',
    );
  const { binding } = bindingFor(projectDir);
  const root = `/api/remote/projects/${binding.projectId}/feedback`;
  const call = async (suffix: string, body?: Record<string, unknown>) => {
    const result = await authenticatedRequest(
      projectDir,
      `${root}/${suffix}`,
      body ? { method: 'POST', body } : {},
    );
    if (result.status !== 200)
      throw new CliError(
        `${result.json.code ?? 'feedback_failed'}: ${result.json.error ?? `HTTP ${result.status}`}`,
      );
    return result.json;
  };
  if (read) {
    if (action === 'show')
      emit({ type: 'remote-feedback', ...(await call(`tasks/${id(values.task, 'task')}`)) });
    else if (action === 'status') emit({ type: 'remote-feedback', ...(await call('connections')) });
    else {
      const suffix = values.connection
        ? `tasks?connectionId=${encodeURIComponent(id(values.connection, 'connection'))}`
        : 'tasks';
      const result = await call(suffix);
      emit({
        type: 'remote-feedback',
        tasks: (result.tasks ?? []).filter((task: { state: string }) =>
          ['queued', 'running', 'needs_attention'].includes(task.state),
        ),
      });
    }
    return 0;
  }
  const body = typeof values.input === 'string' ? jsonFile(values.input) : {};
  let suffix: string;
  if (action === 'connect')
    suffix = values.connection
      ? `connections/${id(values.connection, 'connection')}/rebind`
      : 'connections';
  else if (action === 'pause' || action === 'resume')
    suffix = `connections/${id(values.connection, 'connection')}/${action}`;
  else suffix = `tasks/${id(values.task, 'task')}/${action}`;
  const claims = action === 'claim' || action === 'recover';
  const writesTask = ['renew', 'result', 'fail'].includes(action!);
  if ((claims || writesTask) && typeof values['claim-file'] !== 'string')
    throw new CliError('Specify --claim-file for private execution credentials');
  if (writesTask) {
    safeClaimPath(values['claim-file'] as string);
    const credential = jsonFile(values['claim-file'] as string, true);
    if (
      credential.taskId !== values.task ||
      credential.projectId !== binding.projectId ||
      credential.origin !== binding.origin
    )
      throw new CliError('Claim credential belongs to a different task or project');
    for (const field of ['connectionId', 'generation', 'attempt', 'token'])
      body[field] = credential[field];
  }
  if (!claims) {
    emit({ type: 'remote-feedback', ...(await call(suffix, body)) });
    return 0;
  }
  const file = path.resolve(values['claim-file'] as string);
  safeClaimPath(file);
  const lock = `${file}.lock`;
  const acquire = () => {
    const fd = fs.openSync(lock, 'wx', 0o600);
    fs.writeFileSync(fd, JSON.stringify({ pid: process.pid }));
    return fd;
  };
  let lockFd: number;
  try {
    lockFd = acquire();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    const prior = jsonFile(lock, true);
    if (!Number.isSafeInteger(prior.pid) || Number(prior.pid) <= 0)
      throw new CliError('Invalid claim lock');
    try {
      process.kill(Number(prior.pid), 0);
      throw new CliError('Claim file is in use');
    } catch (alive) {
      if ((alive as NodeJS.ErrnoException).code !== 'ESRCH') throw alive;
    }
    fs.unlinkSync(lock);
    lockFd = acquire();
  }
  try {
    let credential: Record<string, unknown> | undefined;
    try {
      credential = jsonFile(file, true);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    if (
      credential &&
      (credential.taskId !== values.task ||
        credential.projectId !== binding.projectId ||
        credential.origin !== binding.origin)
    )
      throw new CliError('Claim file belongs to a different task or project');
    if (credential?.action === action) {
      for (const field of ['connectionId', 'generation', 'claimant', 'recoveryRequestSeq']) {
        if (body[field] !== undefined && body[field] !== credential[field])
          throw new CliError(
            'Claim request differs from the saved request; use a new private file for explicit recovery',
          );
      }
    } else {
      if (credential && action !== 'recover')
        throw new CliError('Use a new claim file for this request');
      credential = {
        taskId: values.task,
        projectId: binding.projectId,
        origin: binding.origin,
        action,
        connectionId: body.connectionId,
        generation: body.generation,
        claimant: body.claimant,
        recoveryRequestSeq: body.recoveryRequestSeq,
        requestId: crypto.randomUUID(),
        token: crypto.randomBytes(32).toString('hex'),
      };
      saveClaim(file, credential);
    }
    for (const field of [
      'connectionId',
      'generation',
      'claimant',
      'recoveryRequestSeq',
      'requestId',
      'token',
    ])
      body[field] = credential[field];
    const result = await call(suffix, body);
    const task = result.task;
    if (!task || task.id !== values.task || !Number.isSafeInteger(task.attempt))
      throw new CliError('Server returned invalid claim state');
    saveClaim(file, { ...credential, attempt: task.attempt });
    const { token: _token, ...safe } = task;
    emit({ type: 'remote-feedback', task: safe, claimFile: file });
  } finally {
    fs.closeSync(lockFd);
    fs.unlinkSync(lock);
  }
  return 0;
}
