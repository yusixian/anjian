import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { releasePage, releasesFromChangelog } from './release-pages.mjs';

test('formal releases reuse the bilingual changelog and exclude prereleases', () => {
  const releases = releasesFromChangelog(
    readFileSync(new URL('../../CHANGELOG.md', import.meta.url), 'utf8'),
  );
  for (const version of ['0.2.1', '0.2.0'])
    assert(releases.some((release) => release.version === version));
  for (const language of ['zh', 'en']) {
    const page = releasePage(releases, language);
    for (const release of releases) assert(page.includes(release[language]));
    assert(!page.includes('<nav'), 'Language selection belongs to the shared layout');
  }
  assert.equal(releasesFromChangelog('## 1.0.0-beta.1\n\nPreview').length, 0);
});

test('missing translations retain original content and identify fallback language', () => {
  const releases = releasesFromChangelog(
    '## 1.0.0\n<!-- anjian:zh -->\n#### 中文\n中文内容\n<!-- anjian:en -->\n<!-- anjian:end -->',
  );
  const english = releasePage(releases, 'en');
  assert(english.includes('English translation is unavailable'));
  assert(english.includes('<div lang="zh-CN">\n\n中文内容'));
  const zh = releasePage(
    [{ version: '1.0.0', zh: '', en: 'Original English', original: '' }],
    'zh',
  );
  assert(zh.includes('暂无中文翻译'));
  assert(zh.includes('<div lang="en">\n\nOriginal English'));
  const legacy = releasePage(releasesFromChangelog('## 0.1.0\n\nLegacy notes'), 'zh');
  assert(legacy.includes('Legacy notes'));
});
