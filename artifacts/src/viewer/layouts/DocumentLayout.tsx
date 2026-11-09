import { lazy, Suspense } from 'react';

import { LibraryNavigation } from '../components/LibraryNavigation';

const DocumentPage = lazy(() =>
  import('../document/shims').then(() => import('../document/DocumentPage')),
);

export function DocumentLayout({ id }: { id: string }) {
  return (
    <LibraryNavigation>
      <Suspense fallback={null}>
        <DocumentPage id={id} />
      </Suspense>
    </LibraryNavigation>
  );
}
