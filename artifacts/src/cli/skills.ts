import path from 'node:path';

import type { CommandSpec } from './command';
import { CliError } from './paths';

declare const CLI_SKILL_DOCUMENTS: Record<string, string>;

export function cliCommand() {
  const quote = (value: string) =>
    process.platform === 'win32'
      ? `"${value.replaceAll('"', '\\"')}"`
      : `'${value.replaceAll("'", "'\\''")}'`;
  return (
    process.env.ANJIAN_ARTIFACTS_COMMAND ||
    `${quote(process.execPath)} ${quote(path.resolve(process.argv[1]!))}`
  );
}

export function remoteGuide() {
  return `${cliCommand()} skills get artifacts --reference remote.md`;
}

export const skillsCommand: CommandSpec = {
  name: 'skills',
  summary: 'Read built-in Agent skills without starting services',
  usage: ['list', 'get artifacts [--reference <name>] [--json]'],
  details:
    'Agent entry: skills get artifacts, then skills get artifacts --reference remote.md.\nReads only bundled documents. Default output is complete Markdown, including in pipes.',
  explicitJson: true,
  positionals: 2,
  options: {
    reference: {
      type: 'string',
      value: '<name>',
      help: 'An exact reference name from skills list',
    },
    json: { type: 'boolean', help: 'Print explicit JSON instead of Markdown' },
  },
  run: ({ positionals: [action, name], values }, emit) => {
    const references = Object.keys(CLI_SKILL_DOCUMENTS).filter((key) => key !== 'SKILL.md');
    if (action === 'list' && !name && values.reference === undefined) {
      emit({ type: 'skills-list', skills: [{ name: 'artifacts', references }] });
      return 0;
    }
    if (action !== 'get' || !name)
      throw new CliError('Use skills list or skills get artifacts [--reference <name>]');
    if (name !== 'artifacts') throw new CliError(`Unknown skill: ${name}`);
    const reference = values.reference === undefined ? 'SKILL.md' : String(values.reference);
    if (
      (values.reference !== undefined && !references.includes(reference)) ||
      !Object.hasOwn(CLI_SKILL_DOCUMENTS, reference)
    )
      throw new CliError(`Unknown reference: ${reference}. Use skills list for allowed names.`);
    const command = cliCommand();
    const body = CLI_SKILL_DOCUMENTS[reference]!.replaceAll('node app/anjian.cjs', command);
    const header = `<!-- Anjian built-in artifacts / ${reference} -->\n\nCurrent CLI: ${command}\n\nUse this entry point wherever the guide says anjian or app/anjian.cjs. Preserve any configured wrapper and ANJIAN_CLIENT_HOME.\nRead references with: ${command} skills get artifacts --reference <name>\nAllowed references: ${references.join(', ')}\nRelative document links refer to these bundled references, not files in your project.\n\n`;
    emit({ type: 'skill', name, reference, command, content: header + body });
    return 0;
  },
  text: (value) => {
    if (value.type === 'skill') return value.content as string;
    if (value.type === 'skills-list') {
      const skills = value.skills as { name: string; references: string[] }[];
      return skills
        .map(({ name, references }) => `${name}\n  ${references.join('\n  ')}`)
        .join('\n');
    }
    return null;
  },
};
