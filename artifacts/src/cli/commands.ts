import { checkCommand } from './check';
import type { CommandSpec } from './command';
import { commentCommand } from './comment';
import { startCommand } from './start';
import { stopCommand } from './stop';

export const COMMANDS: CommandSpec[] = [
  startCommand,
  stopCommand,
  checkCommand,
  commentCommand,
];
