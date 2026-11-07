import { expect, test } from 'vitest';

import { commandHelp, rootHelp } from '../src/cli/command';
import { COMMANDS } from '../src/cli/commands';

test('root help lists every command with its summary and points at per-command help', () => {
  const help = rootHelp(COMMANDS);
  for (const command of COMMANDS)
    expect(help).toMatch(
      new RegExp(
        `^  ${command.name} +${command.summary.slice(0, 20).replaceAll(/[()]/g, '\\$&')}`,
        'm',
      ),
    );
  expect(help).toContain('anjian <command> --help');
});

test('monitor is gone: the machine runs one server, managed from its home page', () => {
  expect(COMMANDS.map((command) => command.name)).not.toContain('monitor');
  expect(rootHelp(COMMANDS)).not.toMatch(/monitor/);
});

test.each(COMMANDS.map((command) => [command.name, command] as const))(
  '%s help documents every visible option it parses',
  (_name, command) => {
    const help = commandHelp(command);
    expect(help).toMatch(new RegExp(`^Usage: anjian ${command.name}\\b`, 'm'));
    for (const [name, option] of Object.entries(command.options)) {
      if (option.help === undefined) continue;
      expect(help).toMatch(new RegExp(`^  --${name}\\b`, 'm'));
    }
    expect(help).toContain('--project-dir <path>');
    expect(help).toContain('-h, --help');
  },
);

test('comment help shows one usage line per action', () => {
  const comment = COMMANDS.find((command) => command.name === 'comment')!;
  const help = commandHelp(comment);
  for (const action of ['list', 'add', 'reply', 'resolve'])
    expect(help).toMatch(new RegExp(`anjian comment ${action} +--artifact`));
});

test('local-only CLI has no cloud or upstream update commands', () => {
  expect(COMMANDS.map((command) => command.name)).toEqual(['start', 'stop', 'check', 'comment']);
  expect(rootHelp(COMMANDS)).not.toMatch(/publish|login|cloud|update/i);
});
