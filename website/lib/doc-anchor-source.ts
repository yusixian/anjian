import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { getTableOfContents } from 'fumadocs-core/content/toc';

import { docAnchorMap } from './doc-anchor-map.mjs';
import { buildAnchorRoutes, releaseAnchorPairs } from './doc-anchor-validation.mjs';
import { source } from './source';

let routes: ReturnType<typeof buildAnchorRoutes> | undefined;

export function getDocAnchorRoutes() {
  if (routes) return routes;
  function releaseToc(locale: 'zh' | 'en') {
    // The existing prebuild generates these files from CHANGELOG; do not import its executable script.
    const markdown = readFileSync(
      resolve(process.cwd(), `content/docs/updates${locale === 'en' ? '.en' : ''}.mdx`),
      'utf8',
    ).replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '');
    return getTableOfContents(markdown).map(({ title, url, depth }) => {
      if (typeof title !== 'string') throw new Error('Expected plain release heading text');
      return { title, url, depth };
    });
  }
  routes = buildAnchorRoutes(
    { zh: source.getPages('zh'), en: source.getPages('en') },
    docAnchorMap,
    releaseAnchorPairs({ zh: releaseToc('zh'), en: releaseToc('en') }),
  );
  return routes;
}
