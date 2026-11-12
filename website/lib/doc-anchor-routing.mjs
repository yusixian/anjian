/** @typedef {{url: string, hashes: Record<string, string>}} AnchorRoute */
/** @typedef {Record<string, AnchorRoute>} AnchorRoutes */

/** @param {string} pathname */
export function anchorPath(pathname) {
  return pathname.replace(/\/$/, '') || '/';
}

/** Decode exactly once; malformed and unknown fragments are preserved verbatim.
 * @param {string} hash
 * @param {Record<string, string>} hashes
 */
export function translateHash(hash, hashes) {
  if (!hash.startsWith('#')) return hash;
  let id;
  try {
    id = decodeURIComponent(hash.slice(1));
  } catch {
    return hash;
  }
  return Object.hasOwn(hashes, id) ? `#${encodeURIComponent(hashes[id])}` : hash;
}

/** @param {{pathname: string, search: string, hash: string}} location
 * @param {string} fallbackPath
 * @param {AnchorRoutes} routes
 */
export function languageHref(location, fallbackPath, routes = {}) {
  const route = routes[anchorPath(location.pathname)];
  return (
    (route?.url ?? fallbackPath) +
    location.search +
    (route ? translateHash(location.hash, route.hashes) : location.hash)
  );
}

/** @param {string} url
 * @param {{zh: string, en: string}[]} sections
 * @param {'zh' | 'en'} locale
 * @returns {AnchorRoute}
 */
export function sectionRoute(url, sections, locale) {
  const target = locale === 'zh' ? 'en' : 'zh';
  return {
    url,
    hashes: Object.fromEntries(sections.map((section) => [section[locale], section[target]])),
  };
}

/** Old unprefixed documentation is Chinese; use the same pairs for preference redirects.
 * @param {{pathname: string, search: string, hash: string}} location
 * @param {string} targetPath
 * @param {Record<string, Record<string, {zh: string, en: string}>>} mapping
 */
export function legacyDocHref(location, targetPath, mapping) {
  const path = anchorPath(location.pathname);
  const slug = path === '/docs' ? '' : path.slice('/docs/'.length);
  return languageHref(location, targetPath, {
    [path]: sectionRoute(targetPath, Object.values(mapping[slug] ?? {}), 'zh'),
  });
}
