import {
  isWhiteboardPageId,
  WHITEBOARD_DEFAULT_PAGE,
  type WhiteboardScene,
} from '../../shared/whiteboard';

export function whiteboardFrames(scene: WhiteboardScene) {
  return scene.elements.filter(({ isDeleted, type }) => !isDeleted && type === 'frame');
}

export function requestedFrame(url: URL): string | null {
  const value = url.searchParams.get('frame');
  return value && value.length <= 100 ? value : null;
}

export function requestedPage(url: URL): string {
  const value = url.searchParams.get('page');
  return isWhiteboardPageId(value) ? value : WHITEBOARD_DEFAULT_PAGE;
}

export function frameLink(source: URL, frame: string): string {
  const url = new URL(source.href);
  const page = url.searchParams.get('page');
  url.username = '';
  url.password = '';
  url.search = '';
  url.hash = '';
  if (isWhiteboardPageId(page) && page !== WHITEBOARD_DEFAULT_PAGE)
    url.searchParams.set('page', page);
  url.searchParams.set('frame', frame);
  return url.href;
}
