import type { ReactNode } from 'react';

import { DocumentationLayout } from '@/components/documentation-layout';

export default function Layout({ children }: { children: ReactNode }) {
  return <DocumentationLayout locale="zh">{children}</DocumentationLayout>;
}
