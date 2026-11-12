import { notFound } from 'next/navigation';

import { DocumentationPage } from '@/components/documentation-page';
import { isLocale } from '@/lib/i18n';
import { source } from '@/lib/source';

type Props = { params: Promise<{ slug?: string[]; lang: string }> };
export default async function Page({ params }: Props) {
  const p = await params;
  if (!isLocale(p.lang)) notFound();
  return <DocumentationPage locale={p.lang} slug={p.slug} />;
}
export function generateStaticParams() {
  return source.generateParams();
}
export async function generateMetadata({ params }: Props) {
  const p = await params;
  if (!isLocale(p.lang)) notFound();
  const page = source.getPage(p.slug, p.lang);
  if (!page) notFound();
  return { title: page.data.title, description: page.data.description };
}
