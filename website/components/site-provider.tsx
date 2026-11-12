'use client';
import { RootProvider } from 'fumadocs-ui/provider/next';
import { usePathname } from 'next/navigation';
import { type ReactNode, useEffect } from 'react';

import { legacyDocHref } from '@/lib/doc-anchor-routing.mjs';
import { languageKey, type Locale, localePath } from '@/lib/i18n';
import { chineseUI } from '@/lib/translations';

import { Header } from './header';

export function SiteProvider({
  children,
  locale,
  legacy,
}: {
  children: ReactNode;
  locale: Locale;
  legacy: boolean;
}) {
  const path = usePathname();
  useEffect(() => {
    if (!legacy) return;
    let preferred: Locale = locale;
    try {
      if (localStorage.getItem(languageKey) === 'en') preferred = 'en';
    } catch {
      /* Storage may be disabled. URL navigation still works. */
    }
    let cancelled = false;
    const destination = localePath(path, preferred);
    async function redirect() {
      let href = destination + window.location.search + window.location.hash;
      if (preferred !== locale && (path === '/docs' || path.startsWith('/docs/'))) {
        try {
          const { docAnchorMap } = await import('@/lib/doc-anchor-map.mjs');
          href = legacyDocHref(window.location, destination, docAnchorMap);
        } catch {
          /* A failed optional chunk must not block legacy URL navigation. */
        }
      }
      if (!cancelled) window.location.replace(href);
    }
    void redirect();
    return () => {
      cancelled = true;
    };
  }, [legacy, locale, path]);
  return (
    <RootProvider
      i18n={{ locale, translations: locale === 'zh' ? chineseUI : {} }}
      search={{ options: { type: 'static' } }}
    >
      <a className="skip-link" href="#main-content">
        {locale === 'zh' ? '跳到正文' : 'Skip to content'}
      </a>
      <Header locale={locale} />
      {children}
    </RootProvider>
  );
}
