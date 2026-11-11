import { DocsLayout } from 'fumadocs-ui/layouts/docs';
import type { ReactNode } from 'react';

import { DocsMobileNav } from '@/components/docs-mobile-nav';
import { source } from '@/lib/source';

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <DocsLayout
      nav={{ title: null }}
      searchToggle={{ enabled: false }}
      sidebar={{ collapsible: false }}
      slots={{ header: DocsMobileNav }}
      themeSwitch={{ enabled: false }}
      tree={source.pageTree}
    >
      <div className="docs-content-anchor" id="main-content" />
      {children}
    </DocsLayout>
  );
}
