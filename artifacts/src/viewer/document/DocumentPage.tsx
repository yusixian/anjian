import { DocumentView } from './DocumentView';
import { useLocalTransport } from './useDocumentTransport';

export default function DocumentPage({ id }: { id: string }) {
  const { transport, live } = useLocalTransport(id);
  return (
    <DocumentView
      id={id}
      live={live}
      transport={transport}
    />
  );
}
