import type { ReviewSummary } from '../server/review-summary';
import { ARTIFACT_LOCATOR_SOURCE } from '../shared/ids';
import type { CommandSpec } from './command';
import { CliError, invocation } from './paths';
import { serverClient } from './server';

const ARTIFACT = new RegExp(`^(?:document|artboard)/${ARTIFACT_LOCATOR_SOURCE}$`);

export function reviewText(value: Record<string, unknown>): string | null {
  if (value.type !== 'review') return null;
  const summary = value as ReviewSummary;
  const lines = [`Review of ${summary.artifact}`];
  if (summary.empty) lines.push('No saved review threads or groups.');
  for (const thread of summary.threads) {
    const pending = thread.waitingOn ? `, waiting on ${thread.waitingOn}` : '';
    lines.push(`Thread ${thread.id} (${thread.status}${pending})`);
    if (thread.kind === 'document') {
      const blocks = thread.location.blocks.map(({ id, status }) => `${id} (${status})`);
      lines.push(`  ${thread.location.file}, blocks ${blocks.join(', ')}`);
      if (thread.anchor.quote) lines.push(`  “${thread.anchor.quote}”`);
    } else {
      const { page, pageStatus, evidence, nodeStatus } = thread.location;
      const { x, y, nodes } = thread.anchor;
      lines.push(`  canvas.json, page ${page} (${pageStatus}), position ${x}, ${y}`);
      for (const { board, file, status } of evidence)
        lines.push(`  Board ${board}${file ? `, ${file}` : ''} (${status})`);
      for (const node of nodes ?? [])
        lines.push(`  Node ${node.board} ${node.path} (${nodeStatus})`);
      if (thread.draft) lines.push('  Draft in an open choice round.');
    }
    for (const message of thread.messages) {
      const author = message.name ? `${message.author} (${message.name})` : message.author;
      lines.push(
        `  ${message.id} ${message.at} ${author}  ${message.deleted ? '[deleted]' : message.text.replaceAll('\n', '\n    ')}`,
      );
    }
  }
  for (const group of summary.groups) {
    const title = group.title ? ` (${group.title})` : '';
    if (group.kind === 'choose') {
      lines.push(`Choice group ${group.id}${title}  ${group.choice ?? 'no choice'}`);
      continue;
    }
    lines.push(
      `Verify group ${group.id}${title}  ${group.verdict}, ${group.rejectThreads} open reject threads`,
    );
    if (group.evidenceUpdated) lines.push('  The previous verdict needs current evidence.');
    for (const { board, file, status } of group.evidence)
      lines.push(`  Board ${board}${file ? `, ${file}` : ''} (${status})`);
  }
  for (const round of summary.rounds) lines.push(`Round ${round.id}  ${round.state}`);
  for (const warning of summary.warnings) lines.push(warning);
  return lines.join('\n');
}

export const reviewCommand: CommandSpec = {
  name: 'review',
  summary: 'Summarize saved comments and evidence on a document or artboard',
  usage: ['--artifact <document|artboard>/<id> [--json]'],
  options: { artifact: { type: 'string', value: '<type>/<id>', help: 'The document or artboard' } },
  async run({ values, projectDir }, emit) {
    const artifact = values.artifact;
    if (typeof artifact !== 'string' || !ARTIFACT.test(artifact))
      throw new CliError('--artifact must be document/<id> or artboard/<id>');
    const server = serverClient(projectDir);
    const { status, json } = await server.call('POST', `/api/agent/${artifact}/review`);
    if (status === 404 && typeof json.error !== 'string')
      throw new CliError(
        `The running artifacts server does not support review. Start an updated server with \`${invocation()} start --project-dir ${server.project}\`.`,
      );
    if (status < 200 || status >= 300)
      throw new CliError(typeof json.error === 'string' ? json.error : `HTTP ${status}`);
    emit(json);
    return 0;
  },
  text: reviewText,
};
