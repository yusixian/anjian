import { notFound } from 'next/navigation';

import { caseMetadata, UseCasesPage } from '@/components/case-page';
import { isLocale } from '@/lib/i18n';

export async function generateMetadata({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  return caseMetadata(lang);
}
export default async function Page({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  return <UseCasesPage locale={lang} />;
}
