import { LibraryNavigation } from '../components/LibraryNavigation';
import { useLocalFeed } from '../hooks/useArtifactFeed';
import { HtmlView } from './HtmlView';

export function HtmlLayout({ id }: { id: string }) {
  return (
    <LibraryNavigation>
      <HtmlView feed={useLocalFeed('html', id)} id={id} />
    </LibraryNavigation>
  );
}
