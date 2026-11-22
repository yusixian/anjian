import type { WhiteboardScene } from '../../shared/whiteboard';

export function whiteboardFrames(scene: WhiteboardScene) {
  return scene.elements.filter(({ isDeleted, type }) => !isDeleted && type === 'frame');
}

export function requestedFrame(url: URL): string | null {
  const value = url.searchParams.get('frame');
  return value && value.length <= 100 ? value : null;
}

export function frameLink(source: URL, frame: string): string {
  const url = new URL(source.href);
  url.username = '';
  url.password = '';
  url.search = '';
  url.hash = '';
  url.searchParams.set('frame', frame);
  return url.href;
}
