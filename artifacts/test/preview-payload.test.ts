import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { expect, test } from 'vitest';

import { previewPayload } from '../src/server/preview-payload';

function documentDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'anjian-preview-doc-'));
  fs.writeFileSync(
    path.join(dir, 'doc.xml'),
    '<doc><h1 id="b0">Title</h1><p id="b1">按事件粒度推送</p></doc>',
  );
  return dir;
}

test('a local document preview carries its parsed state without comment publication data', () => {
  const payload = previewPayload({ type: 'document', id: 'plan' }, documentDir(), 'Title', null);
  expect(payload.title).toBe('Title');
  expect(JSON.stringify(payload.state)).toContain('按事件粒度推送');
  expect(payload).not.toHaveProperty('comments');
});

test('a local artboard preview carries its canvas, layout and versions only', () => {
  const payload = {
    canvas: { title: 'Board' },
    layout: null,
    versions: { 'pages/a.html': 1 },
    pending: [],
    warnings: [],
  };
  expect(previewPayload({ type: 'artboard', id: 'ideas' }, '/nowhere', 'Board', payload)).toEqual({
    canvas: { title: 'Board' },
    layout: null,
    versions: { 'pages/a.html': 1 },
  });
});
