import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, expect, test } from 'vitest';

import { verifyReportCommand } from '../src/cli/verify-report';
import { parseDocument, serializeDocument } from '../src/server/document-codec';

let dir: string;
const captured = '\uFEFFInput: <tag id="one"> & text\nLiteral ]]>, final line\n';
const capturedAt = '2026-11-22T03:40:00Z';

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'anjian-verify-report-'));
});

afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

async function run(values: Record<string, string>) {
  let output: Record<string, unknown> | undefined;
  const code = await verifyReportCommand.run(
    { positionals: [], projectDir: dir, values },
    (value) => {
      output = value;
    },
  );
  expect(code).toBe(0);
  return output!;
}

async function createReport() {
  fs.writeFileSync(path.join(dir, 'output.txt'), captured);
  const { sha256 } = await run({ digest: 'output.txt' });
  const report = {
    title: '验收 & <回归>',
    build: '1e1a860',
    environment: 'macOS Chrome 390',
    checks: [
      {
        title: '实测 CLI',
        command: 'pnpm test',
        capturedAt,
        output: 'output.txt',
        sha256,
        result: 'pass',
      },
    ],
    reviews: [
      {
        title: '核对提案',
        target: 'ABCDEFGHIJKLMNOPQRSTU',
        group: 'proposal',
        ask: '主操作是否可用？',
        capturedAt,
      },
    ],
    gaps: [{ title: 'Windows', reason: '没有可用设备' }],
  };
  fs.writeFileSync(path.join(dir, 'report.json'), JSON.stringify(report));
  return report;
}

test('generates a native document with full literal output, provenance, a live review link and a gap', async () => {
  await createReport();
  const { output, checks } = await run({ input: 'report.json', output: 'doc.xml' });
  expect(output).toBe(path.join(dir, 'doc.xml'));
  expect(checks).toEqual([{ title: '实测 CLI', status: 'pass' }]);
  const xml = fs.readFileSync(path.join(dir, 'doc.xml'), 'utf8');
  const parsed = parseDocument(xml);
  const block = parsed.root.children.find(({ type }) => type === 'details')!;
  expect(JSON.stringify(block)).toContain(JSON.stringify(captured).slice(1, -1));
  const roundTrip = serializeDocument(parsed);
  expect(roundTrip).toContain('target="ABCDEFGHIJKLMNOPQRSTU"');
  expect(roundTrip).toContain('group="proposal"');
  expect(roundTrip).toContain('1e1a860');
  expect(roundTrip).toContain(capturedAt);
  expect(roundTrip).toContain('没有可用设备');
});

test('overwritten or removed bytes no longer support the recorded result', async () => {
  await createReport();
  const base = await run({ input: 'report.json', lang: 'en' });
  fs.writeFileSync(path.join(dir, 'output.txt'), 'new unreviewed evidence');
  const changed = await run({ input: 'report.json', lang: 'en' });
  expect(changed.checks).toEqual([{ title: '实测 CLI', status: 'stale' }]);
  expect(changed.xml).toContain('Evidence changed. Review required.');
  expect(changed.xml).not.toContain('Passed');
  expect(changed.xml).not.toContain('new unreviewed evidence');
  expect(base.xml).toContain('Passed');
  fs.unlinkSync(path.join(dir, 'output.txt'));
  const missing = await run({ input: 'report.json', lang: 'en' });
  expect(missing.checks).toEqual([{ title: '实测 CLI', status: 'missing' }]);
  expect(missing.xml).toContain('Evidence missing. Review required.');
});

test('a rejected manifest leaves an existing output document untouched', async () => {
  const report = await createReport();
  report.checks[0]!.output = '../previous.txt';
  fs.writeFileSync(path.join(dir, 'report.json'), JSON.stringify(report));
  fs.writeFileSync(path.join(dir, 'doc.xml'), '<doc><p>Original</p></doc>');
  await expect(run({ input: 'report.json', output: 'doc.xml' })).rejects.toThrow(
    'relative to the report input directory',
  );
  expect(fs.readFileSync(path.join(dir, 'doc.xml'), 'utf8')).toBe('<doc><p>Original</p></doc>');
});

test('report output cannot replace the manifest or the referenced log', async () => {
  await createReport();
  const before = fs.readFileSync(path.join(dir, 'report.json'), 'utf8');
  for (const output of ['./report.json', './output.txt']) {
    await expect(run({ input: 'report.json', output })).rejects.toThrow('--output must differ');
  }
  expect(fs.readFileSync(path.join(dir, 'report.json'), 'utf8')).toBe(before);
  expect(fs.readFileSync(path.join(dir, 'output.txt'), 'utf8')).toBe(captured);
  fs.unlinkSync(path.join(dir, 'output.txt'));
  await expect(run({ input: 'report.json', output: 'output.txt' })).rejects.toThrow(
    '--output must differ',
  );
  expect(fs.existsSync(path.join(dir, 'output.txt'))).toBe(false);
});

test.skipIf(process.platform === 'win32')(
  'handles path aliases and keeps private reports private',
  async () => {
    await createReport();
    fs.symlinkSync(path.join(dir, 'output.txt'), path.join(dir, 'alias.txt'));
    await expect(run({ input: 'report.json', output: 'alias.txt' })).rejects.toThrow(
      '--output must differ',
    );
    await run({ input: 'report.json', output: 'doc.xml' });
    await run({ input: 'report.json', output: 'doc.xml' });
    expect(fs.statSync(path.join(dir, 'doc.xml')).mode & 0o777).toBe(0o600);
  },
);

const typographyRule = {
  id: 'body-type',
  title: '正文 & 标签',
  category: 'typography',
  requirement: '正文统一使用系统字体。',
  source: '页面正文',
};
const colorRule = {
  ...typographyRule,
  id: 'text-color',
  title: '正文色彩',
  category: 'color',
};
const layoutRule = {
  ...typographyRule,
  id: 'mobile-layout',
  title: '移动端布局',
  category: 'layout',
};

async function createDesignReport() {
  const base = await createReport();
  const file = 'design.json';
  fs.writeFileSync(
    path.join(dir, file),
    JSON.stringify({
      schema: 1,
      title: '案间 & 规范',
      rules: [typographyRule, colorRule, layoutRule],
    }),
  );
  const { sha256 } = await run({ digest: file });
  return {
    ...base,
    designSpec: { file, revision: String(sha256), target: '123456789012345678901' },
    checks: base.checks.map((check) => ({ ...check, rules: [typographyRule.id] })),
    reviews: base.reviews.map((review) => ({ ...review, rules: [colorRule.id] })),
  };
}

function writeReport(report: unknown) {
  fs.writeFileSync(path.join(dir, 'report.json'), JSON.stringify(report));
}

test('links pinned design rules to automated and manual evidence and identifies unchecked rules', async () => {
  const report = await createDesignReport();
  writeReport(report);
  const { xml, designSpec, checks } = await run({ input: 'report.json', lang: 'en' });
  expect(checks).toEqual([{ title: '实测 CLI', status: 'pass' }]);
  expect(designSpec).toEqual({
    ...report.designSpec,
    title: '案间 & 规范',
    rules: [
      {
        ...typographyRule,
        checks,
        reviews: [],
      },
      {
        ...colorRule,
        checks: [],
        reviews: [{ title: '核对提案', target: 'ABCDEFGHIJKLMNOPQRSTU', group: 'proposal' }],
      },
      {
        ...layoutRule,
        checks: [],
        reviews: [],
      },
    ],
  });
  const nativeXml = serializeDocument(parseDocument(String(xml)));
  expect(nativeXml).toContain('Design specification');
  expect(nativeXml).toContain(report.designSpec.revision);
  expect(nativeXml).toContain('type="document" target="123456789012345678901"');
  expect(nativeXml).toContain('body-type · 正文 &amp; 标签 · Typography');
  expect(nativeXml).toContain('Human review · 核对提案');
  expect(nativeXml).toContain('正文统一使用系统字体。');
  expect(nativeXml).toContain('Source 页面正文');
  expect(nativeXml).toMatch(/mobile-layout · 移动端布局 · Layout[\s\S]*<p>Unchecked<\/p>/);

  fs.writeFileSync(path.join(dir, 'output.txt'), 'unreviewed output');
  const written = await run({ input: 'report.json', output: 'doc.xml' });
  expect(written.designSpec).toMatchObject({ rules: [{ checks: [{ status: 'stale' }] }, {}, {}] });
  const updated = fs.readFileSync(path.join(dir, 'doc.xml'), 'utf8');
  expect(updated).toContain('未检查');
  expect(updated).toContain('证据已变更，待复核');
  expect(updated).not.toContain('通过');
});

test('requires matching design bytes within the manifest directory and protects the spec from output', async () => {
  const report = await createDesignReport();
  writeReport(report);
  await expect(run({ input: 'report.json', output: 'design.json' })).rejects.toThrow(
    '--output must differ',
  );
  const file = path.join(dir, 'design.json');
  fs.appendFileSync(file, '\n');
  await expect(run({ input: 'report.json' })).rejects.toThrow('revision does not match');
  fs.unlinkSync(file);
  await expect(run({ input: 'report.json' })).rejects.toThrow('designSpec.file is missing');
  report.designSpec.file = '../escaped.json';
  writeReport(report);
  await expect(run({ input: 'report.json' })).rejects.toThrow(
    'relative to the report input directory',
  );
});

test('validates the document reference and rule associations in both evidence sections', async () => {
  const report = await createDesignReport();
  for (const [manifest, reason] of [
    [
      { ...report, designSpec: { ...report.designSpec, target: '/document/new' } },
      'stable artifact ID',
    ],
    [{ ...report, designSpec: undefined }, 'rules require a designSpec'],
    [
      { ...report, checks: [{ ...report.checks[0], rules: ['unknown-rule'] }] },
      'Unknown design rule',
    ],
    [
      { ...report, reviews: [{ ...report.reviews[0], rules: [colorRule.id, colorRule.id] }] },
      'duplicate rule IDs',
    ],
  ] as const) {
    writeReport(manifest);
    await expect(run({ input: 'report.json' })).rejects.toThrow(reason);
  }
});

test('protects a pinned manifest addressed with different case on case-insensitive disks', async () => {
  const report = await createDesignReport();
  writeReport(report);
  const original = path.join(dir, report.designSpec.file);
  const alias = path.join(dir, report.designSpec.file.toUpperCase());
  if (!fs.existsSync(alias)) return;
  const bytes = fs.readFileSync(original);
  await expect(run({ input: 'report.json', output: alias })).rejects.toThrow(
    '--output must differ',
  );
  expect(fs.readFileSync(original)).toEqual(bytes);
});
