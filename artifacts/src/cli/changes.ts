import type { documentChanges } from '../server/document-changes';
import type { CommandSpec } from './command';
import { CliError, invocation } from './paths';
import { serverClient } from './server';

type Changes = Awaited<ReturnType<typeof documentChanges>>;

function changesText(value: Record<string, unknown>): string | null {
  if (value.type !== 'document-changes') return null;
  const result = value as unknown as Changes;
  const lines = [`Change history of ${value.artifact}`];
  if (result.shallow) lines.push('The server retains only part of this history.');
  if ('versions' in result) {
    lines.push(`Latest version ${result.latest}`, `Earliest version ${result.earliest}`);
    for (const { version, source, timestamp } of result.versions)
      lines.push(
        `${version}  ${source}${timestamp ? `  ${new Date(timestamp * 1000).toISOString()}` : ''}`,
      );
  } else {
    lines.push(`From ${result.from}`, `To ${result.to}`);
    if (result.empty) lines.push('No recorded human changes in this range.');
    if (result.unknownChanges)
      lines.push(`${result.unknownChanges} history entries have an unknown author.`);
    for (const change of result.changes) {
      const time = change.timestamp ? `  ${new Date(change.timestamp * 1000).toISOString()}` : '';
      lines.push(`Human peer ${change.author.peer}  change ${change.id}${time}`);
      for (const { blockId, treeId, operations } of change.blocks) {
        const block = blockId ? `Block ${blockId}, tree ${treeId}` : `Tree ${treeId}`;
        lines.push(`  ${block}  ${operations.map(({ id, type }) => `${id} ${type}`).join(', ')}`);
      }
      for (const { id, container, type } of change.unlocated)
        lines.push(`  Unlocated operation ${id} ${type} in ${container}`);
    }
  }
  return lines.join('\n');
}

export const changesCommand: CommandSpec = {
  name: 'changes',
  summary: 'List retained document versions or inspect recorded human changes',
  usage: [
    '--artifact document/<id> --versions [--json]',
    '--artifact document/<id> --from <version> [--to <version>] [--json]',
  ],
  options: {
    artifact: { type: 'string', value: 'document/<id>', help: 'The document to inspect' },
    versions: { type: 'boolean', help: 'List recorded document versions' },
    from: { type: 'string', value: '<version>', help: 'Starting version from --versions' },
    to: {
      type: 'string',
      value: '<version>',
      help: 'Ending version, defaults to the latest version',
    },
  },
  async run({ values, projectDir }, emit) {
    const { artifact, versions, from, to } = values;
    if (typeof artifact !== 'string' || !/^document\/[a-z0-9][a-z0-9-]*$/.test(artifact))
      throw new CliError('--artifact must be document/<id>');
    if (versions ? from !== undefined || to !== undefined : !from)
      throw new CliError('Use --versions or specify --from with optional --to.');
    const server = serverClient(projectDir);
    const { status, json } = await server.call('POST', `/api/agent/${artifact}/changes`, {
      versions,
      from,
      to,
    });
    if (status === 404 && typeof json.error !== 'string')
      throw new CliError(
        `The running artifacts server does not support changes. Start an updated server with \`${invocation()} start --project-dir ${server.project}\`.`,
      );
    if (status < 200 || status >= 300)
      throw new CliError(typeof json.error === 'string' ? json.error : `HTTP ${status}`);
    emit(json);
    return 0;
  },
  text: changesText,
};
