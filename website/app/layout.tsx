import './global.css';

import { RootProvider } from 'fumadocs-ui/provider/next';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { Header } from '@/components/header';

export const metadata: Metadata = {
  title: { default: '案间 · 使用文档', template: '%s · 案间文档' },
  description: '从本机运行到邀请朋友，一起了解案间的画板、文档、HTML 预览、批注与 Agent 工作流。',
  icons: { icon: '/anjian.svg' },
};
export default function Layout({ children }: { children: ReactNode }) {
  return (
    <html suppressHydrationWarning lang="zh-CN">
      <body>
        <RootProvider
          search={{ options: { type: 'static' } }}
          i18n={{
            locale: 'zh-CN',
            translations: {
              'Search(search dialog)': '搜索文档',
              'Search(search trigger)': '搜索文档',
              'Open Search(search trigger)(aria-label)': '搜索文档',
              'Close Search(search dialog)(aria-label)': '关闭搜索',
              'No results found(search dialog)': '没有找到相关内容',
              'Search failed(search dialog)': '搜索失败，请重试',
              'On this page(table of contents)': '本页目录',
              'No Headings(table of contents)': '暂无目录',
              'Next Page(pagination)': '下一篇',
              'Previous Page(pagination)': '上一篇',
              'Copy Text(code block)(aria-label)': '复制代码',
              'Copied Text(code block)(aria-label)': '已复制',
              'Copy Anchor Link(heading anchor)(aria-label)': '复制章节链接',
              'Copied Anchor Link(heading anchor)(aria-label)': '已复制章节链接',
              'Open Sidebar(sidebar)(aria-label)': '打开文档导航',
              'Close Sidebar(sidebar)(aria-label)': '关闭文档导航',
              'Close Sidebar(aria-label)': '关闭文档导航',
              'Skip to Content(skip link)': '跳到正文',
              'Table of Contents(inline table of contents)': '本页目录',
            },
          }}
        >
          <a className="skip-link" href="#main-content">
            跳到正文
          </a>
          <Header />
          {children}
        </RootProvider>
      </body>
    </html>
  );
}
