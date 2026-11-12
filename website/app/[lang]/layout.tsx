import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';

import { SiteLayout, siteMetadata } from '@/components/site-layout';
import { i18n, isLocale } from '@/lib/i18n';

export const dynamicParams = false;
export function generateStaticParams() {
  return i18n.languages.map((lang) => ({ lang }));
}
export async function generateMetadata({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  return siteMetadata(lang);
}
export default async function Layout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  return <SiteLayout locale={lang}>{children}</SiteLayout>;
}
