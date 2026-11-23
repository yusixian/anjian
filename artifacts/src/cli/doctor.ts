import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline';

import { isObject } from '../shared/comments';
import type { CommandSpec } from './command';
import { CliError } from './paths';

const requiredEvents = ['sessionStart', 'userPromptSubmit', 'sessionEnd'];
const reviewHooks = 'Open Codex Settings → Hooks to enable or review the Anjian hooks.';

function codexBinary() {
  if (process.platform === 'darwin') {
    for (const app of ['ChatGPT', 'Codex']) {
      const binary = `/Applications/${app}.app/Contents/Resources/codex-cli/bin/codex`;
      if (existsSync(binary)) return binary;
    }
  }
  return 'codex';
}

function listHooks(binary: string, cwd: string) {
  return new Promise<unknown>((resolve, reject) => {
    const server = spawn(binary, ['app-server', '--listen', 'stdio://'], {
      cwd,
      stdio: ['pipe', 'pipe', 'ignore'],
    });
    const input = createInterface({ input: server.stdout });
    let finished = false;
    const timeout = setTimeout(
      () => finish(new CliError('Codex App Server did not respond within 10 seconds.')),
      10_000,
    );

    function finish(error: CliError | null, result?: unknown) {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      input.close();
      server.kill();
      if (error) reject(error);
      else resolve(result);
    }

    const send = (message: object) => server.stdin.write(JSON.stringify(message) + '\n');
    server.once('error', () =>
      finish(
        new CliError(
          'Could not start Codex App Server. Check the project directory or pass --codex-bin.',
        ),
      ),
    );
    server.once('close', () =>
      finish(new CliError('Codex App Server exited before reporting hooks.')),
    );
    server.stdin.on('error', () =>
      finish(new CliError('Could not send a request to Codex App Server.')),
    );
    input.on('line', (line) => {
      let message: unknown;
      try {
        message = JSON.parse(line);
      } catch {
        return;
      }
      if (!isObject(message) || (message.id !== 1 && message.id !== 2)) return;
      if (message.error || !isObject(message.result)) {
        finish(new CliError('Codex App Server could not list hooks. Use a current Codex binary.'));
      } else if (message.id === 1) {
        send({ method: 'initialized' });
        send({ id: 2, method: 'hooks/list', params: { cwds: [cwd] } });
      } else {
        finish(null, message.result);
      }
    });
    send({
      id: 1,
      method: 'initialize',
      params: {
        clientInfo: { name: 'anjian-doctor', version: '1' },
        capabilities: { experimentalApi: true },
      },
    });
  });
}

function summarizeHooks(result: unknown) {
  if (!isObject(result) || !Array.isArray(result.data) || result.data.length !== 1)
    throw new CliError('Codex App Server returned an unexpected hook report.');
  const entry: unknown = result.data[0];
  if (!isObject(entry) || !Array.isArray(entry.hooks))
    throw new CliError('Codex App Server returned an unexpected hook report.');

  const hooks = entry.hooks.filter(
    (hook): hook is Record<string, unknown> =>
      isObject(hook) &&
      typeof hook.pluginId === 'string' &&
      (hook.pluginId === 'anjian' || hook.pluginId.startsWith('anjian@')),
  );
  return requiredEvents.map((event) => {
    const matches = hooks.filter((hook) => hook.eventName === event);
    const states = matches.map((hook) =>
      hook.enabled === false
        ? 'disabled'
        : hook.enabled === true && typeof hook.trustStatus === 'string'
          ? hook.trustStatus
          : 'unknown',
    );
    return {
      event,
      status:
        states.find((state) => state !== 'trusted' && state !== 'managed') ??
        states[0] ??
        'missing',
    };
  });
}

export const doctorCommand: CommandSpec = {
  name: 'doctor',
  summary: 'Check the installed Anjian hooks and their Codex trust status',
  usage: ['codex [--project-dir <path>] [--codex-bin <path>]'],
  options: {
    'codex-bin': { type: 'string', value: '<path>', help: 'Codex executable for this diagnostic' },
  },
  positionals: 1,
  async run({ projectDir, values, positionals }, emit) {
    if (positionals[0] !== 'codex') throw new CliError('Run anjian doctor codex.');
    const explicit = values['codex-bin'];
    const binary = typeof explicit === 'string' ? path.resolve(explicit) : codexBinary();
    const hooks = summarizeHooks(await listHooks(binary, path.resolve(projectDir)));
    const ready = hooks.every(({ status }) => status === 'trusted' || status === 'managed');
    const nextStep = hooks.some(({ status }) => status === 'missing')
      ? `Check that the Anjian plugin is installed and enabled in the selected Codex profile. ${reviewHooks}`
      : reviewHooks;
    emit({
      type: 'codex-hook-doctor',
      status: ready ? 'ready' : 'attention',
      hooks,
      ...(ready ? {} : { nextStep }),
    });
    return ready ? 0 : 1;
  },
  text: (value) => {
    if (value.type !== 'codex-hook-doctor') return null;
    const hooks = value.hooks as { event: string; status: string }[];
    return [
      ...hooks.map(({ event, status }) => `${event}: ${status}`),
      ...(typeof value.nextStep === 'string' ? [value.nextStep] : []),
    ].join('\n');
  },
};
