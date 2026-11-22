import { useEffect, useState } from 'react';

import { WHITEBOARD_DEFAULT_PAGE } from '../../shared/whiteboard';
import { requestedFrame, requestedPage } from './frames';

function currentTarget() {
  const url = new URL(location.href);
  return { page: requestedPage(url), frame: requestedFrame(url) };
}

export function useWhiteboardLocation() {
  const [target, update] = useState(currentTarget);
  useEffect(() => {
    const follow = () => update(currentTarget());
    window.addEventListener('popstate', follow);
    return () => window.removeEventListener('popstate', follow);
  }, []);
  function navigate(page: string, frame: string | null) {
    const url = new URL(location.href);
    if (page === WHITEBOARD_DEFAULT_PAGE) url.searchParams.delete('page');
    else url.searchParams.set('page', page);
    if (frame) url.searchParams.set('frame', frame);
    else url.searchParams.delete('frame');
    if (url.href !== location.href) history.pushState(history.state, '', url);
    update({ page, frame });
  }
  return { ...target, navigate };
}
