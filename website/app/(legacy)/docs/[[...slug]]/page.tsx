import { notFound } from 'next/navigation';

import { DocumentationPage } from '@/components/documentation-page';
import type { Locale } from '@/lib/i18n';
import { source } from '@/lib/source';

type Props = { params: Promise<{ slug?: string[]; lang: Locale }> };
export default async function Page({ params }: Props) {
  const p = await params;
  return <DocumentationPage locale={'zh'} slug={p.slug} />;
}
export function generateStaticParams() {
  return source
    .generateParams()
    .filter((p) => p.lang === 'zh')
    .map(({ slug }) => ({ slug }));
}
export async function generateMetadata({ params }: Props) {
  const p = await params;
  const page = source.getPage(p.slug, 'zh');
  if (!page) notFound();
  return { title: page.data.title, description: page.data.description };
}
