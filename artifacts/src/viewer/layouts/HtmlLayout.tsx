import { useLocalFeed } from '../hooks/useArtifactFeed';
import { HtmlView } from './HtmlView';

export function HtmlLayout({ id }: { id: string }) {
  return (
    <HtmlView
      feed={useLocalFeed('html', id)}
      id={id}
    />
  );
}
