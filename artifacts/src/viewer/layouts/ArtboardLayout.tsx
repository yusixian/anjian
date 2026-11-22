import { CommentRecovery } from '../comments/CommentRecovery';
import { LibraryNavigation } from '../components/LibraryNavigation';
import { ShareButton } from '../components/ShareButton';
import { FeedbackProvider } from '../feedback/FeedbackProvider';
import { feedbackApi } from '../feedback/localApi';
import { useLocalFeed } from '../hooks/useArtifactFeed';
import { useCanvasData } from '../hooks/useCanvasData';
import { ArtboardView } from './ArtboardView';

export function ArtboardLayout({ id }: { id: string }) {
  const data = useCanvasData(useLocalFeed('artboard', id));
  return (
    <LibraryNavigation>
      <FeedbackProvider createApi={feedbackApi}>
        <ArtboardView
          artifact={`artboard/${id}`}
          id={id}
          actions={
            <>
              <CommentRecovery
                preserveReviewRecords
                url={`/api/artboard/${encodeURIComponent(id)}/comments`}
              />
              <ShareButton id={id} type="artboard" />
            </>
          }
          {...data}
        />
      </FeedbackProvider>
    </LibraryNavigation>
  );
}
