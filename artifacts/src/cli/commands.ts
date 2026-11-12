import { checkCommand } from './check';
import type { CommandSpec } from './command';
import { commentCommand } from './comment';
import { remoteCommands } from './remote-commands';
import { skillsCommand } from './skills';
import { startCommand } from './start';
import { stopCommand } from './stop';

export const COMMANDS: CommandSpec[] = [
  skillsCommand,
  startCommand,
  stopCommand,
  checkCommand,
  commentCommand,
  ...remoteCommands,
];
