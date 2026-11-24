import { ShareButton } from '../components/ShareButton';
import { FeedbackProvider } from '../feedback/FeedbackProvider';
import { feedbackApi } from '../feedback/localApi';
import type { ArtifactReferenceResolver } from './ArtifactReferenceCard';
import { DocumentReferenceNavigation } from './DocumentReferenceNavigation';
import { DocumentView } from './DocumentView';
import { useLocalTransport } from './useDocumentTransport';
import { VerificationRuns } from './VerificationRuns';

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
      <DocumentReferenceNavigation>
        {(blockTarget) => (
          <DocumentView
            blockTarget={blockTarget}
            commentRecoveryUrl={`/api/document/${encodeURIComponent(id)}/comments`}
            id={id}
            live={live}
            resolveReference={resolveReference}
            transport={transport}
            actions={
              <>
                <VerificationRuns
                  documentId={id}
                  key={id}
                  onRefreshReport={() => transport.channel.emit({ type: 'refresh' })}
                />
                <ShareButton id={id} type="document" />
              </>
            }
          />
        )}
      </DocumentReferenceNavigation>
    </FeedbackProvider>
  );
}
