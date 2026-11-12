import { defineI18n } from 'fumadocs-core/i18n';

export const i18n = defineI18n({
  languages: ['zh', 'en'],
  defaultLanguage: 'zh',
  fallbackLanguage: null,
});
export type Locale = 'zh' | 'en';
export const languageKey = 'anjian.docs.language';
export function localePath(path: string, locale: Locale) {
  const clean = path.replace(/^\/(?:zh|en)(?=\/|$)/, '').replace(/\/$/, '') || '/';
  if (clean === '/docs/updates-en') return `/${locale}/docs/updates`;
  if (clean === '/' || clean === '/use-cases' || clean === '/docs' || clean.startsWith('/docs/'))
    return `/${locale}${clean === '/' ? '' : clean}`;
  return path;
}
export function unprefixedPath(path: string) {
  return path.replace(/^\/(?:zh|en)(?=\/|$)/, '') || '/';
}

export function isLocale(value: string): value is Locale {
  return value === 'zh' || value === 'en';
}
