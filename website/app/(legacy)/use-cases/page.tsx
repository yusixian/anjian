import { caseMetadata, UseCasesPage } from '@/components/case-page';

export const metadata = caseMetadata('zh');
export default function Page() {
  return <UseCasesPage locale={'zh'} />;
}
