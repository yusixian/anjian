import { useEffect, useState } from 'react';

import { requestedFrame } from './frames';

export function useWhiteboardFrame() {
  const [frame, setFrame] = useState(() => requestedFrame(new URL(location.href)));
  useEffect(() => {
    const follow = () => setFrame(requestedFrame(new URL(location.href)));
    window.addEventListener('popstate', follow);
    return () => window.removeEventListener('popstate', follow);
  }, []);
  return [
    frame,
    (next: string | null) => {
      const url = new URL(location.href);
      if (next) url.searchParams.set('frame', next);
      else url.searchParams.delete('frame');
      if (url.href !== location.href) history.pushState(history.state, '', url);
      setFrame(next);
    },
  ] as const;
}
