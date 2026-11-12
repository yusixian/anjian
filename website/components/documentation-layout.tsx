import { DocsLayout } from 'fumadocs-ui/layouts/docs';
import type { ReactNode } from 'react';

import { BrandLogo } from '@/components/brand';
import { DocsSidebarSeparator } from '@/components/docs-sidebar-separator';
import { LanguageSwitch } from '@/components/language-switch';
import { type Locale, localePath } from '@/lib/i18n';
import { source } from '@/lib/source';

export function DocumentationLayout({ children, locale }: { children: ReactNode; locale: Locale }) {
  return (
    <DocsLayout
      githubUrl="https://github.com/yusixian/anjian"
      sidebar={{ components: { Separator: DocsSidebarSeparator } }}
      tree={source.getPageTree(locale)}
      links={[
        { text: locale === 'zh' ? '使用案例' : 'Use cases', url: localePath('/use-cases', locale) },
        { type: 'custom', children: <LanguageSwitch locale={locale} /> },
        {
          type: 'custom',
          children: (
            <a className="text-fd-primary font-medium p-2" href="/library">
              {locale === 'zh' ? '进入工作台 ↗' : 'Open workspace ↗'}
            </a>
          ),
        },
      ]}
      nav={{
        title: (
          <>
            <BrandLogo />
            {locale === 'zh' ? '案间' : 'Anjian'}
          </>
        ),
        url: localePath('/', locale),
      }}
    >
      <div className="docs-content-anchor" id="main-content" />
      {children}
    </DocsLayout>
  );
}
