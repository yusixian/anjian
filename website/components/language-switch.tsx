'use client';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';

import { type AnchorRoutes,languageHref } from '@/lib/doc-anchor-routing.mjs';
import { languageKey, type Locale, localePath } from '@/lib/i18n';

const emptyRoutes: AnchorRoutes = {};

export function LanguageSwitch({
  locale,
  routes = emptyRoutes,
}: {
  locale: Locale;
  routes?: AnchorRoutes;
}) {
  const path = usePathname();
  const target = locale === 'zh' ? 'en' : 'zh';
  const fallback = localePath(path, target);
  const [href, setHref] = useState(fallback);
  const link = useRef<HTMLAnchorElement>(null);

  const refreshHref = useCallback(() => {
    const next = languageHref(
      window.location,
      localePath(window.location.pathname, target),
      routes,
    );
    // Update the native link synchronously before the browser handles this activation.
    if (link.current) link.current.href = next;
    setHref(next);
  }, [target, routes]);

  useEffect(() => {
    refreshHref();
    window.addEventListener('hashchange', refreshHref);
    window.addEventListener('popstate', refreshHref);
    window.addEventListener('pageshow', refreshHref);
    return () => {
      window.removeEventListener('hashchange', refreshHref);
      window.removeEventListener('popstate', refreshHref);
      window.removeEventListener('pageshow', refreshHref);
    };
  }, [path, refreshHref]);

  return (
    <a
      aria-label={locale === 'zh' ? 'Switch to English' : '切换到中文'}
      className="language-switch"
      href={href}
      hrefLang={target === 'zh' ? 'zh-CN' : 'en'}
      ref={link}
      onContextMenu={refreshHref}
      onFocus={refreshHref}
      onPointerDown={refreshHref}
      onClick={(event) => {
        refreshHref();
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
          return;
        try {
          localStorage.setItem(languageKey, target);
        } catch {
          /* Optional persistence. */
        }
      }}
    >
      {locale === 'zh' ? 'English' : '中文'}
    </a>
  );
}
