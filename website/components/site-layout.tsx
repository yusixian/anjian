import '@/app/global.css';

import type { ReactNode } from 'react';

import type { Locale } from '@/lib/i18n';

import { SiteProvider } from './site-provider';

export function SiteLayout({
  children,
  locale,
  legacy = false,
}: {
  children: ReactNode;
  locale: Locale;
  legacy?: boolean;
}) {
  return (
    <html suppressHydrationWarning lang={locale === 'zh' ? 'zh-CN' : 'en'}>
      <body>
        <SiteProvider legacy={legacy} locale={locale}>
          {children}
        </SiteProvider>
      </body>
    </html>
  );
}
export function siteMetadata(locale: Locale) {
  return {
    title: {
      default: locale === 'zh' ? '案间 · 使用文档' : 'Anjian · Documentation',
      template: locale === 'zh' ? '%s · 案间文档' : '%s · Anjian Docs',
    },
    description:
      locale === 'zh'
        ? '从本机运行到邀请朋友，一起了解案间的画板、文档、HTML 预览、批注与 Agent 工作流。'
        : 'Explore Anjian artboards, documents, HTML previews, comments, and Agent workflows, from local setup to inviting friends.',
    icons: { icon: '/anjian.svg' },
  };
}
