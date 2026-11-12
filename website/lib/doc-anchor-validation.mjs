import { anchorPath, sectionRoute } from './doc-anchor-routing.mjs';

/** @typedef {{slugs: string[], url: string, data: {toc: {url: string}[]}}} AnchorPage */

/** Validate actual compiled TOCs, never match headings by order or translated text.
 * @param {{zh: AnchorPage[], en: AnchorPage[]}} pages
 * @param {Record<string, Record<string, {zh: string, en: string}>>} mapping
 * @param {{zh: string, en: string}[]} releases IDs paired by release version identity.
 * @returns {{zh: import('./doc-anchor-routing.mjs').AnchorRoutes, en: import('./doc-anchor-routing.mjs').AnchorRoutes}}
 */
export function buildAnchorRoutes(pages, mapping, releases = []) {
  const result = { zh: {}, en: {} };
  const byLocale = { zh: new Map(), en: new Map() };
  const fail = (message) => {
    throw new Error(
      `Documentation anchors: ${message}. Preserve published IDs with [#original-id] when changing heading text; add explicit semantic pairs for new sections.`,
    );
  };
  for (const locale of /** @type {const} */ (['zh', 'en'])) {
    for (const page of pages[locale]) {
      const slug = page.slugs.join('/');
      if (byLocale[locale].has(slug)) fail(`${locale}/${slug}: duplicate page`);
      byLocale[locale].set(slug, page);
    }
  }
  const slugs = new Set([...byLocale.zh.keys(), ...byLocale.en.keys(), ...Object.keys(mapping)]);
  for (const slug of slugs) {
    const pair = { zh: byLocale.zh.get(slug), en: byLocale.en.get(slug) };
    if (!pair.zh || !pair.en) fail(`${slug}: missing translated page`);
    const sections = slug === 'updates' ? releases : Object.values(mapping[slug] ?? {});
    for (const locale of /** @type {const} */ (['zh', 'en'])) {
      const target = locale === 'zh' ? 'en' : 'zh';
      const ids = pair[locale].data.toc.map((item) => {
        if (!item.url.startsWith('#')) fail(`${locale}/${slug}: non-fragment TOC URL`);
        // Fumadocs TOC URLs contain raw IDs, not URI-encoded fragments.
        return item.url.slice(1);
      });
      if (new Set(ids).size !== ids.length) fail(`${locale}/${slug}: duplicate heading ID`);
      const mapped = sections.map((section) => section[locale]);
      if (new Set(mapped).size !== mapped.length) fail(`${locale}/${slug}: duplicate mapped ID`);
      for (const id of ids)
        if (!mapped.includes(id)) fail(`${locale}/${slug}: unmapped heading #${id}`);
      for (const id of mapped)
        if (!ids.includes(id)) fail(`${locale}/${slug}: missing published heading #${id}`);
      result[locale][anchorPath(pair[locale].url)] = sectionRoute(
        pair[target].url,
        sections,
        locale,
      );
    }
  }
  return result;
}

/** Pair generated release headings by version, including colliding slugs and reordered releases.
 * @param {{zh: {title: string, url: string, depth: number}[], en: {title: string, url: string, depth: number}[]}} tocs
 */
export function releaseAnchorPairs(tocs) {
  const versions = { zh: new Map(), en: new Map() };
  for (const locale of /** @type {const} */ (['zh', 'en'])) {
    for (const item of tocs[locale]) {
      if (item.depth !== 2 || !/^\d+\.\d+\.\d+$/.test(item.title)) continue;
      if (versions[locale].has(item.title))
        throw new Error(`Documentation anchors: duplicate release version ${item.title}`);
      versions[locale].set(item.title, item.url.slice(1));
    }
  }
  const result = [];
  for (const version of new Set([...versions.zh.keys(), ...versions.en.keys()])) {
    if (!versions.zh.has(version) || !versions.en.has(version)) {
      throw new Error(`Documentation anchors: missing translated release ${version}`);
    }
    result.push({ zh: versions.zh.get(version), en: versions.en.get(version) });
  }
  return result;
}
