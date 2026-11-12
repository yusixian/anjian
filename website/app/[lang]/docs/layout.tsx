import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';

import { DocumentationLayout } from '@/components/documentation-layout';
import { isLocale } from '@/lib/i18n';

export default async function Layout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  return <DocumentationLayout locale={lang}>{children}</DocumentationLayout>;
}
