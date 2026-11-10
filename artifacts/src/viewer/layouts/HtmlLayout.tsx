import { LibraryNavigation } from '../components/LibraryNavigation';
import { ShareButton } from '../components/ShareButton';
import { useLocalFeed } from '../hooks/useArtifactFeed';
import { HtmlView } from './HtmlView';

export function HtmlLayout({ id }: { id: string }) {
  return (
    <LibraryNavigation>
      <HtmlView feed={useLocalFeed('html', id)} id={id} actions={<ShareButton type="html" id={id} />} />
    </LibraryNavigation>
  );
}
