import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, expect, test } from 'vitest';

import { designSpecCommand, parseDesignSpec } from '../src/cli/design-spec';
import { parseDocument, serializeDocument } from '../src/server/document-codec';

let directory: string;

beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'anjian-design-spec-'));
});

afterEach(() => fs.rmSync(directory, { recursive: true, force: true }));

const rule = {
  id: 'reference-title',
  category: 'layout',
  title: '标题 <&>',
  requirement: '390px 无横向滚动 & 长标题换行',
  source: 'Landed review <170a86c>',
};
const content = { schema: 1, title: '作品引用卡片', rules: [rule] };
const digest = (buffer: Buffer) => createHash('sha256').update(buffer).digest('hex');

test('renders a native document with stable rule blocks and tracks the exact bytes of a prior revision', async () => {
  const first = Buffer.from(JSON.stringify(content));
  const previous = digest(first);
  const next = Buffer.from(
    JSON.stringify({
      ...content,
      previous,
      rules: [{ ...rule, requirement: '390px 和 1440px 视口保留完整标题' }],
    }),
  );
  fs.writeFileSync(path.join(directory, 'design.json'), next);
  let output: Record<string, unknown> = {};
  const code = await designSpecCommand.run(
    {
      positionals: [],
      projectDir: directory,
      values: { input: 'design.json', lang: 'en' },
    },
    (value) => {
      output = value;
    },
  );
  expect(code).toBe(0);
  expect(output).toMatchObject({ type: 'design-specification', revision: digest(next), previous });
  const xml = serializeDocument(parseDocument(String(output.xml)));
  expect(xml).toContain('id="reference-title"');
  expect(xml).toContain('Layout');
  expect(xml).toContain('390px 和 1440px 视口保留完整标题');
  expect(xml).toContain('Landed review &lt;170a86c&gt;');
  expect(xml).toContain(previous);
  expect(fs.readFileSync(path.join(directory, 'design.json'))).toEqual(next);
});

test('rejects ambiguous or incomplete rules and malformed revision sources', () => {
  expect(() =>
    parseDesignSpec(Buffer.from(JSON.stringify({ ...content, rules: [rule, rule] }))),
  ).toThrow('Duplicate design rule');
  expect(() =>
    parseDesignSpec(Buffer.from(JSON.stringify({ ...content, previous: 'latest' }))),
  ).toThrow('previous');
  expect(() =>
    parseDesignSpec(Buffer.from(JSON.stringify({ ...content, rules: [{ ...rule, source: '' }] }))),
  ).toThrow('source');
  expect(() =>
    parseDesignSpec(
      Buffer.from(JSON.stringify({ ...content, title: 'invalid' + String.fromCodePoint(0) })),
    ),
  ).toThrow('valid XML text');
});
