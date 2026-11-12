import type { ReactNode } from 'react';

import { SiteLayout, siteMetadata } from '@/components/site-layout';

export const metadata = siteMetadata('zh');
export default function Layout({ children }: { children: ReactNode }) {
  return (
    <SiteLayout legacy locale="zh">
      {children}
    </SiteLayout>
  );
}
