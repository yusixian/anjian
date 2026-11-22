import { ShareButton } from '../components/ShareButton';
import { FeedbackProvider } from '../feedback/FeedbackProvider';
import { feedbackApi } from '../feedback/localApi';
import type { ArtifactReferenceResolver } from './ArtifactReferenceCard';
import { DocumentView } from './DocumentView';
import { useLocalTransport } from './useDocumentTransport';

const resolveReference: ArtifactReferenceResolver = async (
  { type, target, focus, reviewGroups },
  signal,
) => {
  const query = reviewGroups
    ? '?' + new URLSearchParams({ groups: reviewGroups.join(',') })
    : focus
      ? '?' + new URLSearchParams([[focus.kind, focus.id]])
      : '';
  const url = new URL(
    `/api/artifact-reference/${type}/${encodeURIComponent(target)}${query}`,
    window.location.origin,
  );
  const response = await fetch(url, {
    credentials: 'same-origin',
    redirect: 'error',
    referrerPolicy: 'no-referrer',
    cache: 'no-store',
    signal,
  });
  return response.ok ? response.json() : null;
};

export default function DocumentPage({ id }: { id: string }) {
  const { transport, live } = useLocalTransport(id);
  return (
    <FeedbackProvider createApi={feedbackApi}>
      <DocumentView
        actions={<ShareButton id={id} type="document" />}
        id={id}
        live={live}
        resolveReference={resolveReference}
        transport={transport}
      />
    </FeedbackProvider>
  );
}
