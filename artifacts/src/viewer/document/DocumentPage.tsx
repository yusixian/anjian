import { DocumentView } from './DocumentView';
import { ShareButton } from '../components/ShareButton';
import { useLocalTransport } from './useDocumentTransport';

export default function DocumentPage({ id }: { id: string }) {
  const { transport, live } = useLocalTransport(id);
  return (
    <DocumentView
      id={id}
      actions={<ShareButton type="document" id={id} />}
      live={live}
      transport={transport}
    />
  );
}
