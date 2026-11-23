import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { machinePaths } from '../server/machine';
import type { CommandSpec } from './command';
import { CliError, projectPaths } from './paths';

const UNIT = 'anjian-hub.service';
const MANAGED = '# Managed by Anjian CLI\n';
const systemctl = promisify(execFile);

function unitArgument(value: string, command = false) {
  if (Array.from(value).some((character) => character.charCodeAt(0) < 32))
    throw new CliError('The systemd unit cannot use paths containing control characters');
  const escaped = value.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('%', '%%');
  return `"${command ? escaped.replaceAll('$', () => '$$') : escaped}"`;
}

function unitContents(project: string) {
  const command = [
    process.execPath,
    path.resolve(process.argv[1]!),
    'start',
    '--project-dir',
    project,
    '--foreground',
    '--exclusive',
    '--no-open',
  ];
  const home = path.resolve(machinePaths().home);
  const runtime = process.env.ANJIAN_RUNTIME_DIR;
  return [
    MANAGED.trimEnd(),
    '[Unit]',
    'Description=Anjian local Hub',
    '',
    '[Service]',
    'Type=exec',
    `Environment=${unitArgument('ANJIAN_SERVER_HOME=' + home)}`,
    ...(runtime
      ? [`Environment=${unitArgument('ANJIAN_RUNTIME_DIR=' + path.resolve(runtime))}`]
      : []),
    'UnsetEnvironment=ANJIAN_PUBLIC_ORIGIN ANJIAN_BOARD_ORIGIN ARTIFACTS_URL_HOST',
    `ExecStart=${command.map((value) => unitArgument(value, true)).join(' ')}`,
    'Restart=on-failure',
    'RestartPreventExitStatus=78',
    'RestartSec=2s',
    '',
    '[Install]',
    'WantedBy=default.target',
    '',
  ].join('\n');
}

async function runSystemctl(...args: string[]) {
  try {
    const { stdout } = await systemctl(
      'systemctl',
      ['--user', '--no-pager', '--no-ask-password', ...args],
      {
        timeout: 20_000,
      },
    );
    return stdout;
  } catch (error) {
    const failure = error as NodeJS.ErrnoException & { stderr?: string };
    const detail =
      failure.code === 'ENOENT'
        ? 'systemctl is unavailable'
        : failure.stderr?.trim() || failure.message;
    throw new CliError(`systemctl --user: ${detail}`);
  }
}

async function ownedUnit(file: string) {
  const info = await fs.lstat(file).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (!info) return null;
  if (!info.isFile()) throw new CliError(`Anjian does not own ${file}`);
  const content = await fs.readFile(file, 'utf8');
  if (!content.startsWith(MANAGED)) throw new CliError(`Anjian does not own ${file}`);
  return content;
}

export const serviceCommand: CommandSpec = {
  name: 'service',
  summary: 'Manage the local Hub as a Linux systemd user service',
  usage: ['install [--project-dir <path>]', 'start | stop | status | uninstall'],
  options: {},
  positionals: 1,
  run: async ({ positionals: [action], projectDir }, emit) => {
    if (!action || !['install', 'start', 'stop', 'status', 'uninstall'].includes(action))
      throw new CliError('Use service install, start, stop, status or uninstall');
    if (process.platform !== 'linux')
      throw new CliError(
        'The Anjian user service requires Linux with a running systemd user manager',
      );

    const userConfig = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
    if (!path.isAbsolute(userConfig))
      throw new CliError('XDG_CONFIG_HOME must be an absolute path');
    const file = path.join(userConfig, 'systemd', 'user', UNIT);
    const installed = await ownedUnit(file);
    if (action === 'install') {
      const next = unitContents(projectPaths(projectDir).project);
      if (installed && installed !== next)
        throw new CliError(
          'Uninstall the existing Anjian service before changing its installation path or project',
        );
      await runSystemctl('show-environment');
      if (!installed) {
        await fs.mkdir(path.dirname(file), { recursive: true });
        await fs.writeFile(file, next, { flag: 'wx' });
      }
      await runSystemctl('enable', UNIT);
      emit({ type: 'service-installed', unit: UNIT, file });
      return 0;
    }
    if (!installed) {
      if (action === 'status' || action === 'uninstall') {
        emit({ type: 'service-not-installed', unit: UNIT });
        return 0;
      }
      throw new CliError('Install the Anjian user service first');
    }
    if (action === 'uninstall') {
      await runSystemctl('disable', '--now', UNIT);
      await fs.unlink(file);
      await runSystemctl('daemon-reload');
      emit({ type: 'service-uninstalled', unit: UNIT });
      return 0;
    }
    if (action === 'start' || action === 'stop') await runSystemctl(action, UNIT);
    const fields = await runSystemctl(
      'show',
      UNIT,
      '--property=ActiveState,SubState,UnitFileState,MainPID',
    );
    emit({
      type: 'service-status',
      unit: UNIT,
      ...Object.fromEntries(
        fields
          .trim()
          .split('\n')
          .filter(Boolean)
          .map((line) => line.split('=')),
      ),
    });
    return 0;
  },
};
