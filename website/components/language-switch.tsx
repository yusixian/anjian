'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { languageKey, type Locale, localePath } from '@/lib/i18n';

export function LanguageSwitch({ locale }: { locale: Locale }) {
  const path = usePathname();
  const target = locale === 'zh' ? 'en' : 'zh';
  return (
    <Link
      aria-label={locale === 'zh' ? 'Switch to English' : '切换到中文'}
      className="language-switch"
      href={localePath(path, target)}
      hrefLang={target === 'zh' ? 'zh-CN' : 'en'}
      onClick={(event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        try {
          localStorage.setItem(languageKey, target);
        } catch {
          /* Optional persistence. */
        }
        event.preventDefault();
        window.location.assign(
          localePath(path, target) + window.location.search + window.location.hash,
        );
      }}
    >
      {locale === 'zh' ? 'English' : '中文'}
    </Link>
  );
}
