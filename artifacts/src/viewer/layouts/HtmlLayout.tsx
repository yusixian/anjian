import { LibraryNavigation } from '../components/LibraryNavigation';
import { ShareButton } from '../components/ShareButton';
import { useLocalFeed } from '../hooks/useArtifactFeed';
import { HtmlView } from './HtmlView';

export function HtmlLayout({ id }: { id: string }) {
  return (
    <LibraryNavigation>
      <HtmlView
        actions={<ShareButton id={id} type="html" />}
        feed={useLocalFeed('html', id)}
        id={id}
        selectionSendEndpoint={`/api/html/${encodeURIComponent(id)}/selection-send`}
      />
    </LibraryNavigation>
  );
}
