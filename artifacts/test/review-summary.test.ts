import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, expect, test } from 'vitest';

import { reviewText } from '../src/cli/review';
import { boardHashes } from '../src/server/board-comments';
import { cursorsFile } from '../src/server/comment-cursors';
import { reviewSummary } from '../src/server/review-summary';

const dirs: string[] = [];
const at = '2026-01-01T00:00:00.000Z';
const thread = (id: string, anchor: object) => ({
  anchor,
  id,
  messages: [{ id: `message-${id}`, author: 'human', name: 'Reviewer', text: 'Evidence', at }],
  status: 'open',
  statusAt: at,
});

function fixture(type: string) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'anjian-review-'));
  dirs.push(root);
  const dir = path.join(root, type, 'example');
  fs.mkdirSync(dir, { recursive: true });
  return { root, dir };
}

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

test('reports persisted document comments without changing source files or a cursor', () => {
  const { root, dir } = fixture('document');
  const xml = path.join(dir, 'doc.xml');
  const source = '<doc><p id="available">Evidence</p></doc>\n';
  fs.writeFileSync(xml, source);
  const comments = path.join(dir, 'comments.json');
  const serialized = JSON.stringify({
    threads: [
      thread('review', {
        blockId: 'available',
        blockIds: ['available', 'removed'],
        quote: 'Evidence',
      }),
      { anchor: { blockId: 'available' }, messages: [{ text: 'Unnormalized' }] },
    ],
  });
  fs.writeFileSync(comments, serialized);
  const cursor = cursorsFile(path.join(root, 'state'), 'example');
  fs.mkdirSync(path.dirname(cursor), { recursive: true });
  fs.writeFileSync(cursor, '{"Agent":"old"}');

  const review = reviewSummary(dir, 'document', 'example');
  expect(review).toEqual(reviewSummary(dir, 'document', 'example'));
  expect(review).toMatchObject({
    empty: false,
    pending: { agent: ['review'], human: [], verifyGroups: [] },
    threads: [
      {
        id: 'review',
        messages: [
          { id: 'message-review', at, name: 'Reviewer', author: 'human', text: 'Evidence' },
        ],
        location: {
          file: 'doc.xml',
          blocks: [
            { id: 'available', status: 'available' },
            { id: 'removed', status: 'missing' },
          ],
        },
      },
    ],
    warnings: ['comments.json contains entries without saved thread or message metadata.'],
  });
  expect(reviewText(review)).toContain('message-review');
  expect(fs.readFileSync(xml, 'utf8')).toBe(source);
  expect(fs.readFileSync(comments, 'utf8')).toBe(serialized);
  expect(fs.readFileSync(cursor, 'utf8')).toBe('{"Agent":"old"}');
});

test('stays empty when a valid document has no saved review threads', () => {
  const { dir } = fixture('document');
  fs.writeFileSync(path.join(dir, 'doc.xml'), '<doc><p id="a">Evidence</p></doc>');
  const review = reviewSummary(dir, 'document', 'example');
  expect(review).toMatchObject({ empty: true, warnings: [], threads: [], groups: [], rounds: [] });
  expect(reviewText(review)).toContain('No saved review threads or groups.');
  expect(fs.readdirSync(dir)).toEqual(['doc.xml']);
});

test('keeps file and canvas locators and downgrades a verdict as evidence changes', () => {
  const { root, dir } = fixture('artboard');
  const board = { page: 'page', x: 0, y: 0, w: 100, h: 100, file: 'pages/test.html' };
  fs.writeFileSync(
    path.join(dir, 'canvas.json'),
    JSON.stringify({
      pages: [{ id: 'page', name: 'Page' }],
      boards: { hero: board },
      groups: { acceptance: { boards: ['hero'], title: 'Acceptance', verify: true } },
    }),
  );
  fs.mkdirSync(path.join(dir, 'pages'));
  const evidence = path.join(dir, board.file);
  fs.writeFileSync(evidence, '<p>First</p>');
  const anchor = {
    page: 'page',
    group: 'acceptance',
    verdict: 'pass',
    x: 12,
    y: 8,
    nodes: [{ board: 'hero', path: 'p' }],
    hashes: boardHashes(dir),
  };
  const comments = path.join(dir, 'comments.json');
  const serialized = JSON.stringify({ version: 1, threads: [thread('pass', anchor)] });
  fs.writeFileSync(comments, serialized);
  const review = () => reviewSummary(dir, 'artboard', 'example');

  expect(review()).toMatchObject({
    groups: [
      {
        id: 'acceptance',
        kind: 'verify',
        verdict: 'pass',
        verdictThreadId: 'pass',
        evidence: [{ board: 'hero', file: board.file, status: 'current' }],
      },
    ],
    threads: [
      {
        anchor: { nodes: [{ board: 'hero', path: 'p' }] },
        location: {
          canvas: 'canvas.json',
          page: 'page',
          pageStatus: 'available',
          nodeStatus: 'unverified',
        },
      },
    ],
  });
  const preparing = reviewSummary(
    dir,
    'artboard',
    'example',
    (_id, _board, source) => `${source}:preparing`,
  );
  expect(preparing.groups).toMatchObject([
    { verdict: 'pending', evidence: [{ status: 'preparing' }] },
  ]);

  fs.writeFileSync(evidence, '<div>Updated evidence</div>');
  expect(review()).toMatchObject({
    groups: [{ verdict: 'pending', evidenceUpdated: true, evidence: [{ status: 'changed' }] }],
    pending: { verifyGroups: ['acceptance'] },
    threads: [{ stale: true }],
  });

  fs.unlinkSync(evidence);
  expect(review().groups).toMatchObject([
    { verdict: 'pending', evidence: [{ file: board.file, status: 'missing' }] },
  ]);
  expect(fs.readFileSync(comments, 'utf8')).toBe(serialized);
  expect(fs.readdirSync(root)).toEqual(['artboard']);
});

test('keeps a saved artboard location when canvas metadata cannot be read', () => {
  const { dir } = fixture('artboard');
  fs.writeFileSync(path.join(dir, 'canvas.json'), 'null');
  fs.writeFileSync(
    path.join(dir, 'comments.json'),
    JSON.stringify({ threads: [thread('review', { page: 'page', board: 'hero', x: 12, y: 8 })] }),
  );
  const review = reviewSummary(dir, 'artboard', 'example');
  expect(review).toMatchObject({
    empty: false,
    groups: [],
    threads: [
      {
        anchor: { page: 'page', board: 'hero', x: 12, y: 8 },
        location: {
          canvas: 'canvas.json',
          pageStatus: 'unverified',
          evidence: [{ board: 'hero', status: 'unverified' }],
        },
      },
    ],
    warnings: ['canvas.json could not be read or parsed. Canvas locations are unverified.'],
  });
  expect(reviewText(review)).toContain('page page (unverified), position 12, 8');
});
