// @vitest-environment happy-dom
import { act, createElement, useLayoutEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, expect, test, vi } from 'vitest';

import type { StoryboardClip, StoryboardSnapshot } from '../src/shared/storyboard';
import { Monitor } from '../src/viewer/storyboard/Monitor';
import { moveClip, referencedMediaRevision } from '../src/viewer/storyboard/timeline-utils';
import { useStoryboardDraft } from '../src/viewer/storyboard/useStoryboardDraft';

vi.mock('../src/viewer/storyboard/copy', () => ({
  useStoryboardCopy: () => ({ invalid: 'invalid', discard: 'discard', saveFailed: 'save failed' }),
}));

const url = '/api/storyboard/demo';
const base: StoryboardSnapshot = {
  revision: 'first',
  storyboard: { version: 1, title: 'Demo', tracks: [] },
  assets: [],
  listening: false,
  comments: { threads: [], version: 1 },
};
let root: Root | undefined;
let editor: ReturnType<typeof useStoryboardDraft>;

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  sessionStorage.clear();
  vi.unstubAllGlobals();
});

test('monitor arrow shortcuts respect the source trim and leave native controls alone', () => {
  const host = document.createElement('div');
  root = createRoot(host);
  act(() =>
    root!.render(
      <Monitor
        asset={{ path: 'assets/demo.mp4', kind: 'video', bytes: 10 }}
        canRender={true}
        clip={{ id: 'demo', asset: 'assets/demo.mp4', startMs: 0, trimMs: 1000, durationMs: 6000 }}
        dirty={false}
        duration={6000}
        mediaRevision="media"
        readOnly={false}
        revision="first"
        save={async () => null}
        sourceVersion={0}
        url={url}
        onDuration={() => {}}
      />,
    ),
  );
  const video = host.querySelector('video')!;
  const group = host.querySelector<HTMLElement>('[aria-keyshortcuts]')!;
  Object.defineProperty(video, 'duration', { value: 8 });
  video.currentTime = 1;
  const arrow = (target: HTMLElement, key: string) =>
    target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  expect(arrow(group, 'ArrowRight')).toBe(false);
  expect(video.currentTime).toBe(6);
  arrow(group, 'ArrowRight');
  expect(video.currentTime).toBe(7);
  expect(arrow(video, 'ArrowLeft')).toBe(true);
  expect(video.currentTime).toBe(7);
  arrow(group, 'ArrowLeft');
  arrow(group, 'ArrowLeft');
  expect(video.currentTime).toBe(1);
});

function Harness({ initial, readOnly }: { initial: StoryboardSnapshot; readOnly: boolean }) {
  const value = useStoryboardDraft(url, initial, readOnly);
  useLayoutEffect(() => {
    editor = value;
  }, [value]);
  return null;
}

async function mount(initial = base, readOnly = false) {
  act(() => root?.unmount());
  root = createRoot(document.createElement('div'));
  await act(async () => root!.render(createElement(Harness, { initial, readOnly })));
}

test('does not lose newer edits when a save finishes, and retries against the acknowledged revision', async () => {
  await mount();
  act(() => editor.setBoard({ ...editor.board, title: 'First edit' }));
  let reply!: (value: Response) => void;
  const send = vi.fn(
    () =>
      new Promise<Response>((resolve) => {
        reply = resolve;
      }),
  );
  vi.stubGlobal('fetch', send);
  let request!: Promise<string | null>;
  act(() => {
    request = editor.save();
  });
  act(() => editor.setBoard({ ...editor.board, title: 'More edits' }));
  const saved = {
    ...base,
    revision: 'second',
    storyboard: { ...base.storyboard, title: 'First edit' },
  };
  await act(async () => {
    reply(Response.json(saved));
    await request;
  });
  expect(editor.board.title).toBe('More edits');
  expect(editor.dirty).toBe(true);
  await mount(saved);
  expect(editor.conflict).toBe(false);
  expect(editor.board.title).toBe('More edits');
  act(() => {
    request = editor.save();
  });
  const options = (send.mock.lastCall as unknown as [string, RequestInit])[1];
  expect(JSON.parse(String(options.body)).revision).toBe('second');
  await act(async () => {
    reply(Response.json({ ...saved, revision: 'third', storyboard: editor.board }));
    await request;
  });
  expect(editor.dirty).toBe(false);
  expect(sessionStorage.getItem('anjian.storyboard.draft:' + url)).toBeNull();
});

test('keeps unfinished drafts across reload and read-only preview, and refuses to overwrite a newer revision', async () => {
  await mount();
  act(() => editor.setBoard({ ...editor.board, title: '' }));
  const remote = { ...base, revision: 'newer' };
  await mount(remote, true);
  expect(editor.board).toEqual(base.storyboard);
  await mount(remote);
  expect(editor.board.title).toBe('');
  expect(editor.conflict).toBe(true);
  const send = vi.fn();
  vi.stubGlobal('fetch', send);
  await act(async () => {
    expect(await editor.save()).toBeNull();
  });
  expect(send).not.toHaveBeenCalled();
});

test('reordering unequal clips preserves the leading offset, gap and total running time', () => {
  const first: StoryboardClip = {
    id: 'a',
    asset: 'assets/one.png',
    startMs: 1000,
    trimMs: 0,
    durationMs: 500,
  };
  const second: StoryboardClip = {
    id: 'b',
    asset: 'assets/two.png',
    startMs: 2500,
    trimMs: 0,
    durationMs: 2000,
  };
  const moved = moveClip([second, first], 'b', -1);
  expect(moved).toEqual([
    { ...second, startMs: 1000 },
    { ...first, startMs: 4000 },
  ]);
  expect(moveClip(moved, 'b', 1)).toEqual([first, second]);
});

test('media revisions invalidate edited output only when referenced sources change', () => {
  const clip: StoryboardClip = {
    id: 'c',
    asset: 'assets/one.png',
    startMs: 0,
    trimMs: 0,
    durationMs: 500,
  };
  const asset = { path: clip.asset, kind: 'video' as const, bytes: 42, revision: 'before' };
  const other = { ...asset, path: 'assets/unused.png' };
  const first = referencedMediaRevision([clip], [asset, other]);
  expect(referencedMediaRevision([clip, clip], [{ ...other, revision: 'changed' }, asset])).toBe(
    first,
  );
  expect(referencedMediaRevision([clip], [{ ...asset, revision: 'after' }])).not.toBe(first);
});
