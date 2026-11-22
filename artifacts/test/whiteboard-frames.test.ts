import { expect, test } from 'vitest';

import { emptyWhiteboardScene } from '../src/shared/whiteboard';
import { frameLink, requestedFrame, whiteboardFrames } from '../src/viewer/whiteboard/frames';

test('keeps only live native frames in their scene order', () => {
  const frames = whiteboardFrames({
    ...emptyWhiteboardScene(),
    elements: [
      { id: 'start', type: 'frame', name: 'Start' },
      { id: 'shape', type: 'rectangle' },
      { id: 'deleted', type: 'frame', isDeleted: true },
      { id: 'finish', type: 'frame' },
    ],
  });
  expect(frames.map(({ id }) => id)).toEqual(['start', 'finish']);
});

test('copies an encoded frame target without access keys or unrelated URL state', () => {
  const source = new URL(
    'http://user:password@localhost:27319/whiteboard/work?key=private&from=library#old',
  );
  const link = new URL(frameLink(source, 'F / ? # 中文'));
  expect(link.origin).toBe(source.origin);
  expect(link.pathname).toBe(source.pathname);
  expect(link.hash).toBe('');
  expect(link.username + link.password).toBe('');
  expect([...link.searchParams.keys()]).toEqual(['frame']);
  expect(requestedFrame(link)).toBe('F / ? # 中文');
  expect(requestedFrame(new URL('http://localhost/?frame='))).toBeNull();
  expect(requestedFrame(new URL(`http://localhost/?frame=${'x'.repeat(101)}`))).toBeNull();
});
