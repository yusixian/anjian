import { ShareButton } from '../components/ShareButton';
import { FeedbackProvider } from '../feedback/FeedbackProvider';
import { feedbackApi } from '../feedback/localApi';
import { DocumentView } from './DocumentView';
import { useLocalTransport } from './useDocumentTransport';

export default function DocumentPage({ id }: { id: string }) {
  const { transport, live } = useLocalTransport(id);
  return (
    <FeedbackProvider createApi={feedbackApi}>
      <DocumentView
        actions={<ShareButton id={id} type="document" />}
        id={id}
        live={live}
        transport={transport}
      />
    </FeedbackProvider>
  );
}
