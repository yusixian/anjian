// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import type { ArtifactReference } from '../src/shared/artifact-reference';
import {
  ArtifactReferenceCard,
  type ArtifactReferenceResolver,
  LiveReferenceContext,
} from '../src/viewer/document/ArtifactReferenceCard';

vi.mock('@stylexjs/stylex', () => ({ create: (v: unknown) => v, props: () => ({}) }));
vi.mock('@lobehub/ui/stylex/cssVar.stylex', () => ({ cssVar: {} }));

const target = '0123456789abcdefghijk';
const reference: ArtifactReference = {
  type: 'artboard',
  target,
  label: 'Design review',
  focus: { kind: 'group', id: 'cover' },
};
const href = '/artboard/' + target + '?ref=1&group=cover';
const resolve = vi.fn<ArtifactReferenceResolver>();
let root: Root;

beforeEach(() => {
  root = createRoot(document.body.appendChild(document.createElement('div')));
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
});

afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
  resolve.mockReset();
});

async function render(live = false, entry = reference) {
  await act(async () =>
    root.render(
      <LiveReferenceContext.Provider value={live ? resolve : null}>
        <ArtifactReferenceCard reference={entry} />
      </LiveReferenceContext.Provider>,
    ),
  );
}

test('a missing block links to the authorized document and never accepts another block', async () => {
  const documentHref = '/document/' + target + '?ref=1';
  const entry: ArtifactReference = {
    type: 'document',
    target,
    focus: { kind: 'block', id: 'intro' },
  };
  resolve.mockResolvedValueOnce({ title: 'Plan', href: documentHref, blockMissing: true });
  await render(true, entry);
  expect(document.querySelector('a')?.href).toBe(window.location.origin + documentHref);
  resolve.mockResolvedValueOnce({
    title: 'Plan',
    href: documentHref + '&block=elsewhere',
    blockMissing: true,
  });
  await act(async () => window.dispatchEvent(new Event('focus')));
  expect(document.querySelector('a')).toBeNull();
});

test('snapshots show authored text without looking up or exposing the target', async () => {
  await render();
  expect(resolve).not.toHaveBeenCalled();
  expect(document.body.textContent).toContain('Design review');
  expect(document.body.innerHTML).not.toContain(target);
  expect(document.querySelector('a')).toBeNull();
});

test('only the private card uses the resolver and its approved same-origin destination', async () => {
  resolve.mockResolvedValue({ title: 'Target', href, review: 'pass' });
  await render(true);
  expect(resolve).toHaveBeenCalledWith(
    { type: 'artboard', target, focus: { kind: 'group', id: 'cover' } },
    expect.any(AbortSignal),
  );
  expect(document.querySelector('a')?.href).toBe(window.location.origin + href);
  await render();
  expect(document.querySelector('a')).toBeNull();
  expect(document.body.innerHTML).not.toContain(target);
});

test('returning to the source rechecks destination access and removes a stale link', async () => {
  resolve.mockResolvedValueOnce({ title: 'Target', href, review: 'pass' });
  await render(true);
  expect(document.querySelector('a')?.href).toBe(window.location.origin + href);
  resolve.mockResolvedValueOnce(null);
  await act(async () => window.dispatchEvent(new Event('pageshow')));
  expect(resolve).toHaveBeenCalledTimes(2);
  expect(document.querySelector('a')).toBeNull();
});

test.each([href + '&key=secret', 'https://outside.example' + href, href.replace('cover', 'other')])(
  'an unexpected destination yields static text',
  async (destination) => {
    resolve.mockResolvedValue({ title: 'Hidden', href: destination });
    await render(true);
    expect(document.querySelector('a')).toBeNull();
    expect(document.body.innerHTML).not.toContain('Hidden');
    expect(document.body.innerHTML).not.toContain(target);
  },
);
