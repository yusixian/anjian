import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { CommandSpec } from './command';
import { feedbackCommand, feedbackOptions } from './feedback';
import { CliError } from './paths';
import {
  applyLocalFiles,
  artifactRoute,
  authenticatedRequest,
  backupHome,
  bindingFor,
  filesHash,
  localFiles,
  normalizeOrigin,
  openBrowser,
  projectKey,
  readConfig,
  type RemoteArtifact,
  request,
  saveRevision,
  sleep,
  updateConfig,
  validateFiles,
  withArtifactLock,
} from './remote-core';
import { remoteGuide } from './skills';
import type { Emit } from './start';

const artifactOption = {
  artifact: {
    type: 'string' as const,
    value: '<type>/<id>',
    help: 'Document, artboard or HTML artifact',
  },
};
const permissionError = (status: number, json: Record<string, any>) =>
  new CliError(typeof json.error === 'string' ? json.error : `Remote API returned HTTP ${status}`);
const validSnapshot = (artifact: string, value: Record<string, any>): value is RemoteArtifact => {
  if (
    !(value.revision === null || typeof value.revision === 'string') ||
    !value.files ||
    typeof value.files !== 'object'
  )
    return false;
  try {
    validateFiles(artifact, value.files as Record<string, string>);
    return true;
  } catch {
    return false;
  }
};

async function remoteSnapshot(dir: string, artifact: string) {
  const { binding } = bindingFor(dir);
  const result = await authenticatedRequest(dir, artifactRoute(binding, artifact));
  if (result.status !== 200 || !validSnapshot(artifact, result.json))
    throw permissionError(result.status, result.json);
  return result.json;
}

async function login(
  originRaw: string | undefined,
  name: string | undefined,
  noOpen: boolean,
  emit: Emit,
) {
  if (!originRaw)
    throw new CliError('login needs a server origin: anjian login https://anjian.example.com');
  const origin = normalizeOrigin(originRaw);
  const label = (name || os.hostname()).trim();
  if (!label || label.length > 100) throw new CliError('Device name must be 1–100 characters');
  const begun = await request(origin, '/api/remote/auth/device', {
    method: 'POST',
    body: { name: label },
  });
  const { deviceCode, userCode, verificationUri, expiresIn, interval } = begun.json;
  if (
    begun.status !== 200 ||
    typeof deviceCode !== 'string' ||
    typeof userCode !== 'string' ||
    typeof verificationUri !== 'string' ||
    !Number.isFinite(expiresIn) ||
    !Number.isFinite(interval)
  )
    throw permissionError(begun.status, begun.json);
  const url = new URL(verificationUri, origin);
  if (url.origin !== origin || url.protocol !== new URL(origin).protocol)
    throw new CliError('Server returned an unsafe approval URL');
  url.searchParams.set('code', userCode);
  emit({ type: 'remote-login-pending', origin, verificationUri: url.href, userCode, expiresIn });
  if (!noOpen) openBrowser(url.href);
  const deadline = Date.now() + Math.min(Math.max(expiresIn, 1), 900) * 1000;
  let pollMs = Math.min(Math.max(interval, 1), 30) * 1000;
  while (Date.now() < deadline) {
    await sleep(Math.min(pollMs, Math.max(deadline - Date.now(), 0)));
    if (Date.now() >= deadline) break;
    const result = await request(origin, '/api/remote/auth/token', {
      method: 'POST',
      body: { deviceCode },
    });
    if (result.status === 202 && result.json.status === 'pending') continue;
    if (result.status === 429) {
      pollMs = Math.max(pollMs, (result.retryAfter || 5) * 1000);
      continue;
    }
    if (result.status === 200 && typeof result.json.token === 'string') {
      const { token, device, expiresAt } = result.json;
      if (
        !device ||
        typeof device.id !== 'string' ||
        typeof device.name !== 'string' ||
        !Array.isArray(device.projects) ||
        !device.projects.every((id: unknown) => typeof id === 'string') ||
        !Number.isFinite(expiresAt) ||
        expiresAt <= Date.now()
      )
        throw new CliError('Server returned an invalid device credential');
      updateConfig((config) => {
        config.servers[origin] = { token, deviceId: device.id, deviceName: device.name, expiresAt };
      });
      emit({
        type: 'remote-login',
        origin,
        device: device.name,
        projects: device.projects.length,
        expiresAt,
      });
      return 0;
    }
    throw permissionError(result.status, result.json);
  }
  throw new CliError('Device approval expired; run anjian login again');
}

async function logout(originArg: string | undefined, emit: Emit) {
  const config = readConfig();
  const origin = originArg
    ? normalizeOrigin(originArg)
    : Object.keys(config.servers).length === 1
      ? Object.keys(config.servers)[0]
      : undefined;
  if (!origin) throw new CliError('Specify the server origin to log out');
  const credential = config.servers[origin];
  if (!credential) throw new CliError(`Not logged in to ${origin}`);
  const result = await request(origin, '/api/remote/auth/session', {
    method: 'DELETE',
    token: credential.token,
  });
  if (![200, 204, 401, 403].includes(result.status))
    throw permissionError(result.status, result.json);
  updateConfig((next) => {
    delete next.servers[origin];
    for (const [project, binding] of Object.entries(next.bindings))
      if (binding.origin === origin) delete next.bindings[project];
  });
  emit({ type: 'remote-logout', origin, revoked: result.status === 200 || result.status === 204 });
  return 0;
}

async function link(
  dir: string,
  projectIdArg: string | undefined,
  originArg: string | undefined,
  emit: Emit,
) {
  const config = readConfig();
  const origin = originArg
    ? normalizeOrigin(originArg)
    : Object.keys(config.servers).length === 1
      ? Object.keys(config.servers)[0]
      : undefined;
  if (!origin || !config.servers[origin])
    throw new CliError('Log in first, or pass --server <origin> if using more than one server', {
      nextStep: remoteGuide(),
    });
  const result = await request(origin, '/api/remote/projects', {
    token: config.servers[origin]!.token,
  });
  if (result.status !== 200 || !Array.isArray(result.json.projects))
    throw permissionError(result.status, result.json);
  const projects = result.json.projects as { id: string; name: string }[];
  const selected = projectIdArg
    ? projects.find((project) => project.id === projectIdArg)
    : projects.length === 1
      ? projects[0]
      : undefined;
  if (!selected) {
    emit({
      type: 'remote-projects',
      origin,
      projects: projects.map(({ id, name }) => ({ id, name })),
    });
    if (projectIdArg) throw new CliError(`This device has no access to project ${projectIdArg}`);
    throw new CliError('Choose a project with --project <id>');
  }
  const project = projectKey(dir);
  updateConfig((next) => {
    const existing = next.bindings[project];
    next.bindings[project] =
      existing?.origin === origin && existing.projectId === selected.id
        ? existing
        : { origin, projectId: selected.id, revisions: {}, cursor: undefined };
  });
  emit({
    type: 'remote-linked',
    origin,
    project: selected.name,
    projectId: selected.id,
    local: project,
  });
  return 0;
}
function unlink(dir: string, emit: Emit) {
  const project = projectKey(dir);
  const config = readConfig();
  if (!config.bindings[project]) throw new CliError('This directory is not linked');
  updateConfig((next) => {
    delete next.bindings[project];
  });
  emit({ type: 'remote-unlinked', local: project });
  return 0;
}
async function status(dir: string, emit: Emit) {
  const config = readConfig();
  const binding = config.bindings[projectKey(dir)];
  if (!binding) {
    emit({
      type: 'remote-status',
      linked: false,
      servers: Object.keys(config.servers),
      nextStep: remoteGuide(),
    });
    return 0;
  }
  const credential = config.servers[binding.origin];
  if (!credential)
    throw new CliError('Linked server is not logged in', { nextStep: remoteGuide() });
  const result = await request(binding.origin, '/api/remote/auth/session', {
    token: credential.token,
  });
  if (result.status !== 200) throw permissionError(result.status, result.json);
  emit({
    type: 'remote-status',
    linked: true,
    origin: binding.origin,
    projectId: binding.projectId,
    device: credential.deviceName,
    expiresAt: credential.expiresAt,
    session: result.json,
  });
  return 0;
}
async function push(dir: string, artifact: string | undefined, emit: Emit) {
  if (!artifact) throw new CliError('push needs --artifact <type>/<id>');
  return withArtifactLock(dir, artifact, async () => {
    const { binding } = bindingFor(dir);
    const local = localFiles(dir, artifact);
    if (!Object.keys(local).length) throw new CliError(`No local source files for ${artifact}`);
    const previous = binding.revisions[artifact];
    if (!previous) {
      const remote = await remoteSnapshot(dir, artifact);
      if (remote.revision !== null)
        throw new CliError(
          `${artifact} already exists remotely; pull it first to establish a revision`,
        );
    }
    const result = await authenticatedRequest(dir, artifactRoute(binding, artifact), {
      method: 'PUT',
      body: { baseRevision: previous?.remote ?? null, files: local },
      timeoutMs: 60_000,
    });
    if (result.status === 409)
      throw new CliError(`${artifact} changed remotely; pull and compare before pushing`);
    if (result.status !== 200 || !validSnapshot(artifact, result.json) || !result.json.revision)
      throw permissionError(result.status, result.json);
    if (
      bindingFor(dir).binding.origin !== binding.origin ||
      bindingFor(dir).binding.projectId !== binding.projectId
    )
      throw new CliError(
        `${artifact} was accepted remotely but the local project binding changed; relink before retrying`,
      );
    const current = localFiles(dir, artifact);
    if (filesHash(current) === filesHash(local)) {
      // The server may stamp block IDs or normalize a document. Keep the local base in sync.
      try {
        applyLocalFiles(dir, artifact, result.json.files, filesHash(current));
        saveRevision(dir, artifact, result.json.revision, filesHash(result.json.files), binding);
        emit({
          type: 'remote-pushed',
          artifact,
          url: result.json.url,
          revision: result.json.revision,
          canonicalized: filesHash(local) !== filesHash(result.json.files),
        });
      } catch (error) {
        // The remote commit already succeeded. Keep its revision so the next push can compare against it.
        saveRevision(dir, artifact, result.json.revision, filesHash(local), binding);
        emit({
          type: 'remote-pushed',
          artifact,
          url: result.json.url,
          revision: result.json.revision,
          localSyncFailed: (error as Error).message,
          recovery: `Review local files, then run anjian pull --artifact ${artifact} --backup-local if needed`,
        });
        return 2;
      }
    } else {
      saveRevision(dir, artifact, result.json.revision, filesHash(local), binding);
      emit({
        type: 'remote-pushed',
        artifact,
        url: result.json.url,
        revision: result.json.revision,
        localChangedDuringUpload: true,
        recovery: `Review local files, then run anjian pull --artifact ${artifact} --backup-local if needed`,
      });
      return 2;
    }
    return 0;
  });
}
async function pull(dir: string, artifact: string | undefined, backupLocal: boolean, emit: Emit) {
  if (!artifact) throw new CliError('pull needs --artifact <type>/<id>');
  return withArtifactLock(dir, artifact, async () => {
    const { binding } = bindingFor(dir);
    const remote = await remoteSnapshot(dir, artifact);
    if (remote.revision === null) throw new CliError(`${artifact} does not exist remotely`);
    const local = localFiles(dir, artifact);
    const previous = binding.revisions[artifact];
    const hasChanges =
      Object.keys(local).length > 0 && (!previous || previous.local !== filesHash(local));
    if (hasChanges && !backupLocal)
      throw new CliError(
        `${artifact} has local changes or is not yet synchronized; refusing to overwrite. Use pull --backup-local to preserve them before replacement`,
      );
    let backup: string | undefined;
    if (hasChanges) {
      const safeName = artifact.replace('/', '-');
      const backupDir = backupHome();
      backup = path.join(backupDir, `${Date.now()}-${process.pid}-${safeName}.json`);
      fs.writeFileSync(backup, JSON.stringify({ artifact, files: local }), {
        flag: 'wx',
        mode: 0o600,
      });
    }
    if (
      bindingFor(dir).binding.origin !== binding.origin ||
      bindingFor(dir).binding.projectId !== binding.projectId
    )
      throw new CliError('Project binding changed during pull; no local files were replaced');
    applyLocalFiles(dir, artifact, remote.files, filesHash(local));
    saveRevision(dir, artifact, remote.revision, filesHash(remote.files), binding);
    emit({
      type: 'remote-pulled',
      artifact,
      revision: remote.revision,
      ...(backup ? { backup } : {}),
    });
    return 0;
  });
}
async function watch(dir: string, once: boolean, reset: boolean, emit: Emit) {
  const project = projectKey(dir);
  const { binding } = bindingFor(dir);
  if (reset)
    updateConfig((next) => {
      delete next.bindings[project]!.cursor;
    });
  let cursor = reset ? undefined : binding.cursor;
  let failures = 0;
  do {
    const route = `/api/remote/projects/${encodeURIComponent(binding.projectId)}/events${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`;
    let result: Awaited<ReturnType<typeof authenticatedRequest>>;
    try {
      result = await authenticatedRequest(dir, route, { timeoutMs: 35_000 });
    } catch (err) {
      if (err instanceof CliError && /authorization|access/i.test(err.message)) throw err;
      if (once) throw err;
      await sleep(Math.min(30_000, 1000 * 2 ** Math.min(++failures, 5)));
      continue;
    }
    if (result.status === 410)
      throw new CliError(
        'Event cursor expired. Review current comments, then run watch --reset to start at the latest event.',
      );
    if (result.status === 429 || result.status >= 500) {
      if (once) throw permissionError(result.status, result.json);
      await sleep(
        Math.max(
          (result.retryAfter || 0) * 1000,
          Math.min(30_000, 1000 * 2 ** Math.min(++failures, 5)),
        ),
      );
      continue;
    }
    if (
      result.status !== 200 ||
      typeof result.json.cursor !== 'string' ||
      !Array.isArray(result.json.events)
    )
      throw permissionError(result.status, result.json);
    failures = 0;
    for (const event of result.json.events)
      emit({ ...event, eventType: event.type, type: 'remote-event' });
    cursor = result.json.cursor;
    updateConfig((next) => {
      if (next.bindings[project]) next.bindings[project]!.cursor = cursor;
    });
    if (!once) await sleep(2000);
  } while (!once);
  return 0;
}

const transferOptions = artifactOption;
const commands: CommandSpec[] = [
  {
    name: 'login',
    summary: 'Authorize this device for a self-hosted Anjian server',
    usage: ['<https://server> [--name <device>] [--no-open]'],
    options: {
      'name': { type: 'string', value: '<device>', help: 'Name shown on the server' },
      'no-open': { type: 'boolean', help: 'Print the approval URL without opening it' },
    },
    positionals: 1,
    explicitJson: true,
    run: ({ positionals, values }, emit) =>
      login(positionals[0], values.name as string | undefined, !!values['no-open'], emit),
  },
  {
    name: 'logout',
    summary: 'Revoke this device authorization',
    usage: ['[<https://server>]'],
    options: {},
    positionals: 1,
    run: ({ positionals }, emit) => logout(positionals[0], emit),
  },
  {
    name: 'link',
    summary: 'Bind this directory to an authorized server project',
    usage: ['[--server <origin>] [--project <id>]'],
    options: {
      server: { type: 'string', value: '<origin>', help: 'Server origin' },
      project: { type: 'string', value: '<id>', help: 'Project ID from the server' },
    },
    run: ({ projectDir, values }, emit) =>
      link(
        projectDir,
        values.project as string | undefined,
        values.server as string | undefined,
        emit,
      ),
  },
  {
    name: 'unlink',
    summary: 'Remove the remote binding for this directory',
    options: {},
    run: ({ projectDir }, emit) => unlink(projectDir, emit),
  },
  {
    name: 'remote',
    summary: 'Show remote connection or manage durable feedback tasks',
    usage: [
      'status',
      'feedback <action> [--input <json-file>] [--task <id>] [--claim-file <private-file>]',
    ],
    options: feedbackOptions,
    positionals: 2,
    run: (input, emit) => {
      const { projectDir, positionals } = input;
      if (positionals[0] === 'feedback') return feedbackCommand(input, emit);
      if (positionals.length > 1)
        throw new CliError(
          `Unexpected positional argument: ${positionals[1]}. Expected at most 1 positional argument(s).`,
        );
      if (positionals[0] !== 'status') throw new CliError('Use anjian remote status');
      return status(projectDir, emit);
    },
  },
  {
    name: 'push',
    summary: 'Upload a single artifact with remote conflict protection',
    usage: ['--artifact <type>/<id>'],
    options: transferOptions,
    run: ({ projectDir, values }, emit) =>
      push(projectDir, values.artifact as string | undefined, emit),
  },
  {
    name: 'pull',
    summary: 'Download a single artifact with local change protection',
    usage: ['--artifact <type>/<id> [--backup-local]'],
    options: {
      ...transferOptions,
      'backup-local': { type: 'boolean', help: 'Back up changed local files before replacement' },
    },
    run: ({ projectDir, values }, emit) =>
      pull(projectDir, values.artifact as string | undefined, !!values['backup-local'], emit),
  },
  {
    name: 'watch',
    summary: 'Stream remote project events and resume from saved cursor',
    usage: ['[--once] [--reset]'],
    options: {
      once: { type: 'boolean', help: 'Fetch one batch and exit' },
      reset: { type: 'boolean', help: 'Discard the saved cursor after reviewing current comments' },
    },
    run: ({ projectDir, values }, emit) => watch(projectDir, !!values.once, !!values.reset, emit),
  },
];
export function remoteText(value: Record<string, unknown>): string | null {
  if (typeof value.type !== 'string' || !value.type.startsWith('remote-')) return null;
  if (value.type === 'remote-login-pending')
    return `Approve ${value.userCode} at ${value.verificationUri}`;
  if (value.type === 'remote-login')
    return `Authorized ${value.device} on ${value.origin}. Run anjian link in your project.`;
  if (value.type === 'remote-projects')
    return `Available projects: ${JSON.stringify(value.projects)}`;
  if (value.type === 'remote-linked')
    return `Linked ${value.local} to ${value.project} on ${value.origin}.`;
  if (value.type === 'remote-unlinked') return `Unlinked ${value.local}.`;
  if (value.type === 'remote-logout')
    return value.revoked
      ? `Revoked this device on ${value.origin}.`
      : `Removed local credentials; this device was already unauthorized.`;
  if (value.type === 'remote-pushed')
    return `Remote accepted ${value.artifact}: ${value.url || value.revision}${value.localChangedDuringUpload ? `; local files changed during upload. ${value.recovery}` : value.localSyncFailed ? `; local refresh failed: ${value.localSyncFailed}. ${value.recovery}` : ''}`;
  if (value.type === 'remote-pulled')
    return `Downloaded ${value.artifact}.${value.backup ? ` Local copy: ${value.backup}` : ''}`;
  if (value.type === 'remote-event')
    return `${value.artifact || 'Project'}: ${value.eventType || 'changed'} (${value.id})`;
  return JSON.stringify(value);
}

export const remoteCommands: CommandSpec[] = commands.map((command) => ({
  ...command,
  text: remoteText,
}));
