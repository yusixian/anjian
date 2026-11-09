import { LibraryNavigation } from '../components/LibraryNavigation';
import { useLocalFeed } from '../hooks/useArtifactFeed';
import { useCanvasData } from '../hooks/useCanvasData';
import { ArtboardView } from './ArtboardView';

export function ArtboardLayout({ id }: { id: string }) {
  const data = useCanvasData(useLocalFeed('artboard', id));
  return (
    <LibraryNavigation>
      <ArtboardView artifact={`artboard/${id}`} id={id} {...data} />
    </LibraryNavigation>
  );
}
