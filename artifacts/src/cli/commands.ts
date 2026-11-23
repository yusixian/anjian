import { approvalCommand } from './approval';
import { changesCommand } from './changes';
import { checkCommand } from './check';
import type { CommandSpec } from './command';
import { commentCommand } from './comment';
import { designSpecCommand } from './design-spec';
import { doctorCommand } from './doctor';
import { feedbackHostCommand } from './feedback-host';
import { questionAnswerCommand } from './question-answer';
import { remoteCommands } from './remote-commands';
import { reviewCommand } from './review';
import { serviceCommand } from './service';
import { skillsCommand } from './skills';
import { startCommand } from './start';
import { stopCommand } from './stop';
import { verifyReportCommand } from './verify-report';
import { versionCommand } from './version';

export const COMMANDS: CommandSpec[] = [
  versionCommand,
  skillsCommand,
  startCommand,
  stopCommand,
  serviceCommand,
  checkCommand,
  designSpecCommand,
  verifyReportCommand,
  commentCommand,
  doctorCommand,
  feedbackHostCommand,
  approvalCommand,
  questionAnswerCommand,
  changesCommand,
  reviewCommand,
  ...remoteCommands,
];
