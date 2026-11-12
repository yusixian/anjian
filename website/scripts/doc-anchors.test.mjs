import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

import { docAnchorMap } from '../lib/doc-anchor-map.mjs';
import { languageHref, legacyDocHref, translateHash } from '../lib/doc-anchor-routing.mjs';
import { buildAnchorRoutes, releaseAnchorPairs } from '../lib/doc-anchor-validation.mjs';

const mapping = {
  local: {
    install: { zh: '安装与启动', en: 'install-and-start' },
    update: { zh: '更新案间', en: 'update-anjian' },
  },
  other: {
    first: { zh: '重复', en: 'same' },
    second: { zh: '重复-1', en: 'same-1' },
    special: { zh: 'a & b/%#?', en: 'special & %' },
  },
};
const page = (slug, locale, ids) => ({
  slugs: [slug],
  url: `/${locale}/docs/${slug}`,
  data: { toc: ids.map((id) => ({ url: `#${id}` })) },
});
const pages = () =>
  Object.fromEntries(
    ['zh', 'en'].map((locale) => [
      locale,
      Object.entries(mapping).map(([slug, sections]) =>
        page(
          slug,
          locale,
          Object.values(sections).map((section) => section[locale]),
        ),
      ),
    ]),
  );

test('semantic sections survive reordering, repeated titles and multiple pages in both directions', () => {
  const input = pages();
  input.en[0].data.toc.reverse();
  const routes = buildAnchorRoutes(input, mapping);
  for (const locale of ['zh', 'en']) {
    const target = locale === 'zh' ? 'en' : 'zh';
    for (const [slug, sections] of Object.entries(mapping)) {
      for (const section of Object.values(sections)) {
        const location = {
          pathname: `/${locale}/docs/${slug}/`,
          search: '?a=1&a=2&q=%26+%20',
          hash: `#${encodeURIComponent(section[locale])}`,
        };
        assert.equal(
          languageHref(location, '/unused', routes[locale]),
          `/${target}/docs/${slug}?a=1&a=2&q=%26+%20#${encodeURIComponent(section[target])}`,
        );
      }
    }
  }
});

test('hash decoding is single-pass and preserves unknown, malformed and absent fragments', () => {
  const hashes = { '更新案间': 'update-anjian', 'a & b/%#?': 'special & %' };
  assert.equal(translateHash('#更新案间', hashes), '#update-anjian');
  assert.equal(translateHash('#%e6%9b%b4%e6%96%b0%e6%a1%88%e9%97%b4', hashes), '#update-anjian');
  assert.equal(
    translateHash(`#${encodeURIComponent('a & b/%#?')}`, hashes),
    '#special%20%26%20%25',
  );
  for (const hash of [
    '',
    '#',
    '#unknown',
    '#%E6',
    '#%',
    '#%25E6%259B%25B4',
    '#constructor',
    '#__proto__',
    '#:~:text=hello',
  ]) {
    assert.equal(translateHash(hash, hashes), hash);
  }
  assert.equal(
    languageHref({ pathname: '/zh', search: '?q=1', hash: '#unknown' }, '/en'),
    '/en?q=1#unknown',
  );
  assert.equal(
    languageHref(
      { pathname: '/zh/docs/local', search: '?q=1', hash: '' },
      '/en/docs/local',
      buildAnchorRoutes(pages(), mapping).zh,
    ),
    '/en/docs/local?q=1',
  );
});

test('legacy preference redirects reuse semantic pairs and retain unmatched fragments', () => {
  const location = { pathname: '/docs/local/', search: '?audit=anchor', hash: '#更新案间' };
  assert.equal(
    legacyDocHref(location, '/en/docs/local', docAnchorMap),
    '/en/docs/local?audit=anchor#update-anjian',
  );
  assert.equal(
    legacyDocHref({ ...location, pathname: '/docs/', hash: '#全部功能' }, '/en/docs', docAnchorMap),
    '/en/docs?audit=anchor#features',
  );
  assert.equal(
    legacyDocHref(
      { ...location, pathname: '/docs/updates/', hash: '#030' },
      '/en/docs/updates',
      docAnchorMap,
    ),
    '/en/docs/updates?audit=anchor#030',
  );
});

test('validation rejects renamed headings, missing translations and incomplete or ambiguous mappings', () => {
  const rejects = (mutate, match) => {
    const input = pages();
    const pairs = structuredClone(mapping);
    mutate(input, pairs);
    assert.throws(() => buildAnchorRoutes(input, pairs), match);
  };
  rejects((p) => {
    p.zh[0].data.toc[0].url = '#新标题';
  }, /Preserve published IDs/);
  rejects((p) => {
    p.en.pop();
  }, /missing translated page/);
  rejects((p) => {
    p.zh[0].data.toc.push({ url: '#new' });
  }, /unmapped heading/);
  rejects((p) => {
    p.zh[0].data.toc.push(p.zh[0].data.toc[0]);
  }, /duplicate heading ID/);
  rejects((p, m) => {
    m.local.update.zh = m.local.install.zh;
  }, /duplicate mapped ID/);
  rejects((p) => {
    p.en[0].data.toc.pop();
  }, /missing published heading/);
  rejects((p) => {
    p.zh.push(p.zh[0]);
  }, /duplicate page/);
  rejects((p, m) => {
    m.removed = {};
  }, /missing translated page/);
  rejects((p) => {
    p.zh[0].data.toc[0].url = '/outside';
  }, /non-fragment TOC/);
});

test('release identities are supplied by compiled version headings, never position', () => {
  const input = {
    zh: [page('updates', 'zh', ['030', '022'])],
    en: [page('updates', 'en', ['022', '030'])],
  };
  assert.deepEqual(
    buildAnchorRoutes(input, {}, [
      { zh: '030', en: '030' },
      { zh: '022', en: '022' },
    ]).zh['/zh/docs/updates'].hashes,
    {
      '030': '030',
      '022': '022',
    },
  );
  assert.throws(() => buildAnchorRoutes(input, {}, [{ zh: '030', en: '030' }]), /unmapped heading/);
  assert.throws(
    () =>
      buildAnchorRoutes(input, {}, [
        { zh: '030', en: '030' },
        { zh: '030', en: '030' },
        { zh: '022', en: '022' },
      ]),
    /duplicate mapped ID/,
  );
});

test('exported documentation retains every published mapped heading exactly once', async () => {
  for (const [slug, sections] of Object.entries(docAnchorMap)) {
    for (const locale of ['zh', 'en']) {
      const route = slug ? `${slug}/` : '';
      const html = await readFile(
        new URL(`../out/${locale}/docs/${route}index.html`, import.meta.url),
        'utf8',
      );
      const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
      for (const section of Object.values(sections)) {
        assert.equal(
          ids.filter((id) => id === section[locale]).length,
          1,
          `${locale}/${slug}#${section[locale]}`,
        );
      }
    }
  }
});

test('generated release versions pair by identity even when slug collisions change order', () => {
  const heading = (title, id) => ({ title, url: `#${id}`, depth: 2 });
  const tocs = {
    zh: [heading('1.23.4', '1234'), heading('12.3.4', '1234-1')],
    en: [heading('12.3.4', '1234'), heading('1.23.4', '1234-1')],
  };
  assert.deepEqual(releaseAnchorPairs(tocs), [
    { zh: '1234', en: '1234-1' },
    { zh: '1234-1', en: '1234' },
  ]);
  assert.throws(() => releaseAnchorPairs({ ...tocs, en: [] }), /missing translated release/);
  assert.throws(
    () => releaseAnchorPairs({ ...tocs, zh: [tocs.zh[0], tocs.zh[0]] }),
    /duplicate release version/,
  );
});
