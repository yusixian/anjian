// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, test, vi } from 'vitest';

import { createChannel } from '../src/viewer/document/channel';
import { DynamicBlock, DynamicHostContext } from '../src/viewer/document/DynamicBlock';

vi.mock('../src/viewer/hooks/useSandboxFrame', () => ({
  HTML_SANDBOX: '',
  useSandboxFrame: (src: string | null) => ({ src }),
}));

test('live document blocks reload when their file changes or the connection opens again', () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const container = document.createElement('div');
  const root = createRoot(container);
  const channel = createChannel();
  const host = { artifact: 'document/plan', channel, contentBase: '/content/', send: vi.fn() };
  const url = 'assets/preview.html';
  const src = () => container.querySelector('iframe')?.getAttribute('src');
  try {
    act(() => {
      root.render(
        <DynamicHostContext.Provider value={host}>
          <DynamicBlock componentProps={{}} initialHeight={200} url={url} />
        </DynamicHostContext.Provider>,
      );
    });
    expect(src()).toBe(`/content/${url}?v=0`);
    act(() => channel.emit({ type: 'change', artifact: 'document/other', files: [url] }));
    expect(src()).toBe(`/content/${url}?v=0`);
    act(() => channel.emit({ type: 'change', artifact: host.artifact, files: [url] }));
    expect(src()).toBe(`/content/${url}?v=1`);
    act(() => channel.emit({ type: 'open' }));
    expect(src()).toBe(`/content/${url}?v=2`);
  } finally {
    act(() => root.unmount());
    vi.unstubAllGlobals();
  }
});
