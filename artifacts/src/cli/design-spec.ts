import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import type { CommandSpec } from './command';
import { CliError } from './paths';

const categories = {
  typography: ['排版', 'Typography'],
  color: ['色彩', 'Color'],
  layout: ['布局', 'Layout'],
  component: ['组件', 'Components'],
} as const;
type Category = keyof typeof categories;

interface Rule {
  category: Category;
  id: string;
  requirement: string;
  source: string;
  title: string;
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new CliError(`${label} must be an object`);
  return value as Record<string, unknown>;
}

function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim())
    throw new CliError(`${label} must be nonempty text`);
  for (const character of value) {
    const code = character.codePointAt(0)!;
    const control = code < 32 && code !== 9 && code !== 10 && code !== 13;
    if (control || (code >= 0xd800 && code <= 0xdfff) || code === 0xfffe || code === 0xffff)
      throw new CliError(`${label} must contain valid XML text`);
  }
  return value.trim();
}

export function parseDesignSpec(bytes: Buffer) {
  let input: unknown;
  try {
    input = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    throw new CliError('Design specification must be a UTF-8 JSON document');
  }
  const spec = object(input, 'Design specification');
  if (spec.schema !== 1) throw new CliError('Design specification schema must be 1');
  const title = text(spec.title, 'Design specification title');
  if (
    spec.previous !== undefined &&
    (typeof spec.previous !== 'string' || !/^[a-f0-9]{64}$/.test(spec.previous))
  )
    throw new CliError('previous must be a SHA-256 revision');
  if (!Array.isArray(spec.rules) || !spec.rules.length)
    throw new CliError('Design specification must have at least one rule');

  const ids = new Set<string>();
  const rules = spec.rules.map((value, index): Rule => {
    const label = `rules[${index}]`;
    const row = object(value, label);
    const { id, category } = row;
    if (typeof id !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(id))
      throw new CliError(
        `${label}.id must be lowercase letters, digits or hyphens and start with a letter`,
      );
    if (ids.has(id)) throw new CliError(`Duplicate design rule ID ${id}`);
    ids.add(id);
    if (typeof category !== 'string' || !Object.hasOwn(categories, category))
      throw new CliError(`${label}.category must be typography, color, layout or component`);
    return {
      id,
      category: category as Category,
      title: text(row.title, `${label}.title`),
      requirement: text(row.requirement, `${label}.requirement`),
      source: text(row.source, `${label}.source`),
    };
  });
  const revision = createHash('sha256').update(bytes).digest('hex');
  return { title, revision, previous: spec.previous, rules };
}

function escapeXml(value: string) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function renderDesignSpec(spec: ReturnType<typeof parseDesignSpec>, lang: 'zh' | 'en') {
  const zh = lang === 'zh';
  const paragraph = (text: string) => `<p>${escapeXml(text)}</p>`;
  return [
    '<doc>',
    `<h1>${escapeXml(spec.title)}</h1>`,
    paragraph(`${zh ? '规范版本' : 'Specification revision'} ${spec.revision}`),
    ...(spec.previous
      ? [paragraph(`${zh ? '上一个版本' : 'Previous revision'} ${spec.previous}`)]
      : []),
    ...Object.entries(categories).flatMap(([category, labels]) => {
      const rules = spec.rules.filter((rule) => rule.category === category);
      if (!rules.length) return [];
      return [
        `<h2>${labels[zh ? 0 : 1]}</h2>`,
        ...rules.flatMap(({ id, title, requirement, source }) => [
          `<h3 id="${id}">${escapeXml(title)}</h3>`,
          paragraph(requirement),
          paragraph(`${zh ? '规则' : 'Rule'} ${id} · ${zh ? '来源' : 'Source'} ${source}`),
        ]),
      ];
    }),
    '</doc>',
    '',
  ].join('\n');
}

export const designSpecCommand: CommandSpec = {
  name: 'design-spec',
  summary: 'Build a reusable design specification and identify its exact revision',
  usage: ['--input <path> [--lang zh|en]'],
  options: {
    input: { type: 'string', value: '<path>', help: 'Design specification JSON' },
    lang: { type: 'string', value: '<language>', help: 'Document labels (zh by default, or en)' },
  },
  explicitJson: true,
  run: ({ projectDir, values }, emit) => {
    const { input, lang = 'zh' } = values;
    if (typeof input !== 'string' || (lang !== 'zh' && lang !== 'en'))
      throw new CliError('Use --input <path> and optionally --lang zh|en');
    const spec = parseDesignSpec(fs.readFileSync(path.resolve(projectDir, input)));
    emit({ type: 'design-specification', ...spec, xml: renderDesignSpec(spec, lang) });
    return 0;
  },
  text: (value) => (value.type === 'design-specification' ? String(value.xml).trimEnd() : null),
};
