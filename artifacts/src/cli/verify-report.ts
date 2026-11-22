import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { validateArtifactReference } from '../shared/artifact-reference';
import type { CommandSpec } from './command';
import { parseDesignSpec } from './design-spec';
import { CliError } from './paths';

const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const escape = (value: string) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
const paragraph = (value: string) => `<p>${escape(value)}</p>`;

function record(value: unknown, name: string) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new CliError(`${name} must be an object`);
  return value as Record<string, unknown>;
}

function field(row: Record<string, unknown>, key: string) {
  const value = row[key];
  if (typeof value !== 'string' || !value.trim())
    throw new CliError(`${key} must be a nonempty string`);
  return value;
}

function rows(report: Record<string, unknown>, key: string) {
  const value = report[key];
  if (!Array.isArray(value)) throw new CliError(`${key} must be an array`);
  return value.map((row, i) => record(row, `${key}[${i}]`));
}

function capturedAt(row: Record<string, unknown>) {
  const time = field(row, 'capturedAt');
  if (
    !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(time) ||
    !Number.isFinite(Date.parse(time))
  )
    throw new CliError('capturedAt must be an ISO timestamp with a time zone');
  return time;
}

function outside(root: string, file: string) {
  const relative = path.relative(root, file);
  return relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative);
}

function fileIdentity(file: string): string {
  try {
    return fs.realpathSync.native(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    const parent = path.dirname(file);
    return parent === file ? file : path.join(fileIdentity(parent), path.basename(file));
  }
}

function evidence(root: string, name: string, label = 'output') {
  const requested = path.resolve(root, name);
  if (path.isAbsolute(name) || outside(root, requested))
    throw new CliError(`${label} must be a file relative to the report input directory`);
  const actual = fileIdentity(requested);
  if (outside(root, actual))
    throw new CliError(`${label} must be a regular file inside the report input directory`);
  try {
    if (!fs.statSync(actual).isFile())
      throw new CliError(`${label} must be a regular file inside the report input directory`);
    return { actual, bytes: fs.readFileSync(actual) };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    return { actual, bytes: null };
  }
}

function readDesignSpec(value: unknown, directory: string, sources: Set<string>) {
  if (value === undefined) return undefined;
  const entry = record(value, 'designSpec');
  const file = field(entry, 'file');
  const revision = field(entry, 'revision');
  const target = field(entry, 'target');
  validateArtifactReference({ type: 'document', target });
  if (!/^[a-f0-9]{64}$/.test(revision))
    throw new CliError('designSpec.revision must be a lowercase SHA-256 digest');
  const { actual, bytes } = evidence(directory, file, 'designSpec.file');
  if (!bytes) throw new CliError(`designSpec.file is missing: ${file}`);
  if (sha256(bytes) !== revision)
    throw new CliError(`designSpec.revision does not match the bytes of ${file}`);
  sources.add(actual);
  const { title, rules } = parseDesignSpec(bytes);
  return { file, revision, target, title, rules };
}

function linkedRules(row: Record<string, unknown>, byId: Map<string, string>) {
  const { rules } = row;
  if (rules === undefined) return [];
  if (!Array.isArray(rules) || rules.some((id) => typeof id !== 'string'))
    throw new CliError('rules must be an array of rule IDs');
  if (rules.length && !byId.size)
    throw new CliError('rules require a designSpec with matching rule IDs');
  if (new Set(rules).size !== rules.length)
    throw new CliError('rules must not contain duplicate rule IDs');
  for (const id of rules) {
    if (!byId.has(id)) throw new CliError(`Unknown design rule: ${id}`);
  }
  return rules as string[];
}

function renderReport(source: string, lang: string) {
  const manifest = fs.realpathSync.native(source);
  const directory = path.dirname(manifest);
  const sources = new Set([manifest]);
  const report = record(JSON.parse(fs.readFileSync(manifest, 'utf8')), 'Report');
  const zh = lang === 'zh';
  const tr = (chinese: string, english: string) => (zh ? chinese : english);
  const title = field(report, 'title');
  const build = field(report, 'build');
  const environment = field(report, 'environment');
  const spec = readDesignSpec(report.designSpec, directory, sources);
  const ruleLabels = new Map(spec?.rules.map(({ id, title }) => [id, `${id} · ${title}`]));
  const ruleParagraph = (rules: string[]) =>
    rules.length
      ? [
          paragraph(
            `${tr('设计规则', 'Design rules')} ${rules.map((id) => ruleLabels.get(id)).join(', ')}`,
          ),
        ]
      : [];
  const statusLabels = {
    pass: tr('通过', 'Passed'),
    fail: tr('失败', 'Failed'),
    missing: tr('证据缺失，待复核', 'Evidence missing. Review required.'),
    stale: tr('证据已变更，待复核', 'Evidence changed. Review required.'),
  };
  const checks = rows(report, 'checks').map((row) => {
    const title = field(row, 'title');
    const rules = linkedRules(row, ruleLabels);
    const command = field(row, 'command');
    const output = field(row, 'output');
    const time = capturedAt(row);
    const expected = field(row, 'sha256');
    const result = field(row, 'result');
    if (!/^[a-f0-9]{64}$/.test(expected))
      throw new CliError('sha256 must be a lowercase SHA-256 digest');
    if (result !== 'pass' && result !== 'fail') throw new CliError('result must be pass or fail');
    const { actual: sourceFile, bytes } = evidence(directory, output);
    sources.add(sourceFile);
    const actual = bytes && sha256(bytes);
    const status: keyof typeof statusLabels = !bytes
      ? 'missing'
      : actual === expected
        ? result
        : 'stale';
    let body = '';
    if (bytes && actual === expected) {
      const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
      body = `<details summary="${tr('原始输出', 'Raw output')}"><codeblock lang="text">${escape(text)}</codeblock></details>`;
    }
    return {
      status,
      title,
      rules,
      xml: [
        `<h3>${escape(title)} · ${statusLabels[status]}</h3>`,
        paragraph(`${tr('命令', 'Command')} ${command}`),
        paragraph(`${tr('采集时间', 'Captured')} ${time}`),
        paragraph(`${output} · SHA-256 ${expected}`),
        ...(status === 'stale' ? [paragraph(`${tr('当前摘要', 'Current digest')} ${actual}`)] : []),
        ...ruleParagraph(rules),
        body,
      ].join('\n'),
    } satisfies { status: keyof typeof statusLabels; title: string; rules: string[]; xml: string };
  });

  const reviews = rows(report, 'reviews').map((row) => {
    const title = field(row, 'title');
    const target = field(row, 'target');
    const group = field(row, 'group');
    const rules = linkedRules(row, ruleLabels);
    const ask = field(row, 'ask');
    const time = capturedAt(row);
    validateArtifactReference({
      type: 'artboard',
      target,
      label: title,
      focus: { kind: 'group', id: group },
    });
    return {
      title,
      target,
      group,
      rules,
      xml: [
        paragraph(ask),
        paragraph(`${tr('采集时间', 'Captured')} ${time}`),
        `<ref type="artboard" target="${escape(target)}" group="${escape(group)}" label="${escape(title)}" />`,
        ...ruleParagraph(rules),
      ],
    };
  });
  const designSpec = spec && {
    ...spec,
    rules: spec.rules.map((rule) => ({
      ...rule,
      checks: checks
        .filter(({ rules }) => rules.includes(rule.id))
        .map(({ title, status }) => ({ title, status })),
      reviews: reviews
        .filter(({ rules }) => rules.includes(rule.id))
        .map(({ title, target, group }) => ({ title, target, group })),
    })),
  };
  const categoryLabels = {
    typography: tr('字体排印', 'Typography'),
    color: tr('色彩', 'Color'),
    layout: tr('布局', 'Layout'),
    component: tr('组件', 'Component'),
  };
  const designXml = designSpec
    ? [
        `<h2>${tr('设计规范', 'Design specification')}</h2>`,
        paragraph(designSpec.title),
        paragraph(`${tr('规范修订', 'Specification revision')} · SHA-256 ${designSpec.revision}`),
        `<ref type="document" target="${escape(designSpec.target)}" label="${tr('设计规范原文', 'Design specification document')}" />`,
        ...designSpec.rules.flatMap(
          ({ id, title, category, requirement, source, checks, reviews }) => [
            `<h3>${escape(`${id} · ${title} · ${categoryLabels[category]}`)}</h3>`,
            paragraph(requirement),
            paragraph(`${tr('来源', 'Source')} ${source}`),
            ...(!checks.length && !reviews.length ? [paragraph(tr('未检查', 'Unchecked'))] : []),
            ...checks.map(({ title, status }) => paragraph(`${title} · ${statusLabels[status]}`)),
            ...reviews.map(({ title }) =>
              paragraph(`${tr('人工验收', 'Human review')} · ${title}`),
            ),
          ],
        ),
      ]
    : [];
  const gaps = rows(report, 'gaps').map((row) =>
    paragraph(`${field(row, 'title')} · ${field(row, 'reason')}`),
  );
  const xml = [
    '<doc>',
    `<h1>${escape(title)}</h1>`,
    paragraph(`${tr('构建', 'Build')} ${build}`),
    paragraph(`${tr('环境', 'Environment')} ${environment}`),
    ...designXml,
    ...(checks.length
      ? [`<h2>${tr('机器检查', 'Automated checks')}</h2>`, ...checks.map(({ xml }) => xml)]
      : []),
    ...(reviews.length
      ? [`<h2>${tr('人工验收', 'Human review')}</h2>`, ...reviews.flatMap(({ xml }) => xml)]
      : []),
    ...(gaps.length ? [`<h2>${tr('未验证', 'Unverified')}</h2>`, ...gaps] : []),
    '</doc>',
    '',
  ].join('\n');
  return {
    xml,
    checks: checks.map(({ status, title }) => ({ status, title })),
    sources,
    designSpec,
  };
}

export const verifyReportCommand: CommandSpec = {
  name: 'verify-report',
  summary: 'Build a verification document from check output, review links and coverage gaps',
  usage: ['--input <path> [--output <path>] [--lang zh|en]', '--digest <path>'],
  options: {
    digest: {
      type: 'string',
      value: '<path>',
      help: 'Print the SHA-256 digest of captured evidence',
    },
    input: { type: 'string', value: '<path>', help: 'Report JSON manifest' },
    lang: { type: 'string', value: '<language>', help: 'Report labels (zh by default, or en)' },
    output: { type: 'string', value: '<path>', help: 'Write the report as a document XML file' },
  },
  explicitJson: true,
  run: ({ projectDir, values }, emit) => {
    const { digest, input, output, lang = 'zh' } = values;
    const resolve = (file: string) => path.resolve(projectDir, file);
    if (typeof digest === 'string') {
      if (input || output || values.lang) throw new CliError('Use --digest by itself');
      emit({ type: 'evidence-digest', sha256: sha256(fs.readFileSync(resolve(digest))) });
      return 0;
    }
    if (typeof input !== 'string' || (lang !== 'zh' && lang !== 'en'))
      throw new CliError('Use --input <path> and optionally --lang zh|en');
    const { xml, checks, sources, designSpec } = renderReport(resolve(input), lang);
    const design = designSpec ? { designSpec } : {};
    if (typeof output !== 'string') {
      emit({ type: 'verification-report', xml, checks, ...design });
      return 0;
    }
    const dest = resolve(output);
    if (sources.has(fileIdentity(dest)))
      throw new CliError('--output must differ from the report manifest and evidence files');
    const mode = fs.statSync(dest, { throwIfNoEntry: false })?.mode ?? 0o600;
    const temp = path.join(path.dirname(dest), `.${randomUUID()}.tmp`);
    try {
      fs.writeFileSync(temp, xml, { flag: 'wx', mode: mode & 0o777 });
      fs.renameSync(temp, dest);
    } finally {
      fs.rmSync(temp, { force: true });
    }
    emit({ type: 'verification-report', output: dest, checks, ...design });
    return 0;
  },
  text: (value) => {
    if (value.type === 'evidence-digest') return value.sha256 as string;
    if (value.type !== 'verification-report') return null;
    return typeof value.xml === 'string' ? value.xml.trimEnd() : String(value.output);
  },
};
