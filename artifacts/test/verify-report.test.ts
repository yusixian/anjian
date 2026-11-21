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
