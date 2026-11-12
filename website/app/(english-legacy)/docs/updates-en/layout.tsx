import type { ReactNode } from 'react';

import { SiteLayout, siteMetadata } from '@/components/site-layout';

export const metadata = siteMetadata('en');
export default function Layout({ children }: { children: ReactNode }) {
  return <SiteLayout locale="en">{children}</SiteLayout>;
}
