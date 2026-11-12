import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { test } from 'node:test';

import { releasesFromChangelog } from './release-pages.mjs';

const docs = new URL('../content/docs/', import.meta.url);
const out = new URL('../out/', import.meta.url);
const visible = (html) =>
  html
    .replaceAll(/<script\b[^>]*>[\s\S]*?<\/script>/g, '')
    .replaceAll(/<style\b[^>]*>[\s\S]*?<\/style>/g, '')
    .replaceAll(/<[^>]+>/g, '');

test('all 17 guides have explicit English content, matching sections and command flags', async () => {
  const names = (await readdir(docs)).filter(
    (name) => name.endsWith('.mdx') && !name.includes('.en.') && name !== 'updates-en.mdx',
  );
  assert.equal(names.length, 17);
  for (const name of names) {
    const zh = await readFile(new URL(name, docs), 'utf8');
    const en = await readFile(new URL(name.replace('.mdx', '.en.mdx'), docs), 'utf8');
    assert(!/[\u3400-\u9FFF]/u.test(en), `${name}: untranslated English source`);
    assert.equal(
      (zh.match(/^## /gm) || []).length,
      (en.match(/^## /gm) || []).length,
      `${name}: missing sections`,
    );
    const flags = (text) => [...new Set(text.match(/--[a-z][a-z-]+/g))].sort();
    assert.deepEqual(flags(en), flags(zh), `${name}: command options changed`);
    const route = name === 'index.mdx' ? '' : name.replace('.mdx', '/');
    for (const locale of ['zh', 'en']) {
      const html = await readFile(new URL(`${locale}/docs/${route}index.html`, out), 'utf8');
      assert(html.includes(`lang="${locale === 'zh' ? 'zh-CN' : 'en'}"`));
      assert(!html.includes('translation is unavailable') && !html.includes('暂无中文翻译'));
      if (locale === 'en')
        assert(
          !/[\u3400-\u9FFF]/u.test(visible(html).replaceAll('中文', '')),
          `${name}: untranslated rendered text`,
        );
      for (const [, href] of html.matchAll(/href="([^"]+)"/g)) {
        assert(
          !/^\/(?:docs(?:\/|$)|use-cases\/?$)/.test(href),
          `${name}: unlocalized navigation ${href}`,
        );
      }
    }
  }
});

test('all published releases have both translations in the single changelog', async () => {
  const releases = releasesFromChangelog(
    await readFile(new URL('../../CHANGELOG.md', import.meta.url), 'utf8'),
  );
  for (const release of releases) {
    assert(release.zh.trim(), `${release.version}: missing Chinese`);
    assert(release.en.trim(), `${release.version}: missing English`);
  }
});

test('home and use cases export translated metadata, illustrations and internal links', async () => {
  for (const route of ['', 'use-cases/']) {
    for (const locale of ['zh', 'en']) {
      const html = await readFile(new URL(`${locale}/${route}index.html`, out), 'utf8');
      assert(html.includes(`lang="${locale === 'zh' ? 'zh-CN' : 'en'}"`));
      assert(html.includes('<meta name="description"'));
      if (locale === 'en') assert(!/[\u3400-\u9FFF]/u.test(visible(html).replaceAll('中文', '')));
    }
  }
});
