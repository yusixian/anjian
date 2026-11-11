import { DocsLayout } from 'fumadocs-ui/layouts/docs';
import type { ReactNode } from 'react';

import { BrandLogo } from '@/components/brand';
import { source } from '@/lib/source';

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <DocsLayout
      githubUrl="https://github.com/yusixian/anjian"
      tree={source.pageTree}
      links={[
        { text: '使用案例', url: '/use-cases' },
        {
          type: 'custom',
          children: (
            <a className="text-fd-primary font-medium p-2" href="/library">
              进入工作台 ↗
            </a>
          ),
        },
      ]}
      nav={{
        title: (
          <>
            <BrandLogo />
            案间
          </>
        ),
        url: '/',
      }}
    >
      <div className="docs-content-anchor" id="main-content" />
      {children}
    </DocsLayout>
  );
}
