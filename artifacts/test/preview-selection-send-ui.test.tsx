// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import type { SelectionRecipient } from '../src/shared/selection-send';
import { PreviewSelectionSend } from '../src/viewer/components/PreviewSelectionSend';
import { usePreviewSelection } from '../src/viewer/hooks/usePreviewSelection';

vi.mock('@stylexjs/stylex', () => ({ create: (value: unknown) => value, props: () => ({}) }));
vi.mock('@lobehub/ui/stylex/cssVar.stylex', () => ({ cssVar: {} }));

let root: Root;
let hook: ReturnType<typeof usePreviewSelection>;
const source = 'http://127.0.0.1:33111/content/sample/index.html?v=1';

function Capture() {
  hook = usePreviewSelection();
  return null;
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  root = createRoot(document.body.appendChild(document.createElement('div')));
});
afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = '';
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

test('selection reports from a navigated iframe or a hidden tab are ignored', async () => {
  const postMessage = vi.fn();
  await act(async () => root.render(<Capture />));
  await act(async () => hook.open({ postMessage } as unknown as Window, source));
  const { channel } = postMessage.mock.calls[0]![0];
  const report = {
    channel,
    selector: '#selected',
    text: 'Preview text',
    type: 'anjian:selection-text',
  };
  await act(async () => hook.receive({ ...report, url: source.replace('sample', 'another') }));
  expect(hook.capture).toBeNull();
  await act(async () => hook.receive({ ...report, url: source }));
  expect(hook.capture?.selection).toMatchObject({ revision: 1, text: 'Preview text' });
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
  await act(async () => {
    document.dispatchEvent(new Event('visibilitychange'));
    hook.receive({ ...report, url: source, text: 'Background update' });
  });
  expect(hook.capture).toBeNull();
});

test('losing a chosen Agent does not silently send the selection to the remaining Agent', async () => {
  vi.useFakeTimers();
  const now = Date.now();
  const first: SelectionRecipient = { id: 'first', host: 'codex', label: '123456' };
  const other: SelectionRecipient = { id: 'other', host: 'claude', label: 'abcdef' };
  let recipients = [first, other];
  const fetched = vi.fn(async () => Response.json({ recipients }));
  vi.stubGlobal('fetch', fetched);
  await act(async () =>
    root.render(
      <PreviewSelectionSend
        endpoint="/test/selection-send"
        capture={{
          id: 'capture',
          selection: { capturedAt: now, revision: 1, selector: '#selected', text: 'Preview text' },
        }}
      />,
    ),
  );
  const choose = (id: string) =>
    act(async () => {
      const select = document.querySelector('select')!;
      select.value = id;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
  await choose(first.id);
  expect(document.querySelector('button')!.disabled).toBe(false);
  recipients = [other];
  await act(async () => vi.advanceTimersByTimeAsync(2000));
  const button = document.querySelector('button')!;
  expect(button.disabled).toBe(true);
  await act(async () => button.click());
  expect(fetched).toHaveBeenCalledTimes(2);
  await choose(other.id);
  expect(document.querySelector('button')!.disabled).toBe(false);
});
