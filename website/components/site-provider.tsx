'use client';
import { RootProvider } from 'fumadocs-ui/provider/next';
import { usePathname } from 'next/navigation';
import { type ReactNode, useEffect } from 'react';

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
    window.location.replace(
      localePath(path, preferred) + window.location.search + window.location.hash,
    );
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
