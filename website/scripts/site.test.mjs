import assert from 'node:assert/strict';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join,resolve } from 'node:path';
import { test } from 'node:test';

const output = resolve('out');
async function files(dir) {
  const result = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) result.push(...(await files(path)));
    else result.push(path);
  }
  return result;
}

test('every exported page has reachable local links and assets', async () => {
  const pages = (await files(output)).filter((path) => path.endsWith('.html'));
  assert(pages.length >= 19, 'Build the full site before testing');
  for (const page of pages) {
    const html = await readFile(page, 'utf8');
    for (const [, raw] of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
      if (!raw.startsWith('/') || raw.startsWith('//')) continue;
      const url = new URL(raw.replaceAll('&amp;', '&'), 'http://docs.local');
      if (url.pathname === '/library') continue; // Served by the authenticated workbench.
      const path = join(output, decodeURIComponent(url.pathname));
      const info = await stat(path).catch(() => null);
      assert(info, `${page}: missing ${url.pathname}`);
      if (info.isDirectory()) await stat(join(path, 'index.html'));
    }
  }
});

test('the static search index contains the core Chinese guides', async () => {
  const data = await readFile(join(output, 'api/search'), 'utf8');
  JSON.parse(data);
  for (const title of ['在本机使用', '邀请朋友', '公开分享', '存储与备份'])
    assert(data.includes(title), `Search index is missing ${title}`);
});
