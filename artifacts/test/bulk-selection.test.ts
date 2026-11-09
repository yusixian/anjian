import { expect, test } from 'vitest';

import type { HubArtifact } from '../src/shared/hub';
import { artifactSelectionKey } from '../src/shared/trash';
import { chunks, rangeForVisible, selectionForVisible } from '../src/viewer/layouts/home/bulk-trash';

const artifact = (project: string, id: string): HubArtifact => ({
  project, id, type: 'artboard', title: id, updatedAt: 1, url: `/artboard/${id}`,
});

test('selects only the current filtered results and leaves prior choices intact', () => {
  const hidden = artifact('other', 'hidden');
  const visible = [artifact('project', 'one'), artifact('project', 'two')];
  const current = new Set([artifactSelectionKey(hidden)]);
  const selected = selectionForVisible(current, visible, true);
  expect(selected).toEqual(new Set([artifactSelectionKey(hidden), ...visible.map(artifactSelectionKey)]));
  expect(selectionForVisible(selected, visible, false)).toEqual(current);
});

test('shift range follows visible order without discarding existing selections', () => {
  const visible = ['a', 'b', 'c', 'd'].map((id) => artifact('project', id));
  const old = artifact('other', 'old');
  const current = new Set([artifactSelectionKey(old)]);
  const next = rangeForVisible(current, visible, artifactSelectionKey(visible[1]!), artifactSelectionKey(visible[3]!));
  expect(next).toEqual(new Set([artifactSelectionKey(old), ...visible.slice(1).map(artifactSelectionKey)]));
  expect(rangeForVisible(current, visible, 'missing', artifactSelectionKey(visible[0]!)))
    .toEqual(new Set([artifactSelectionKey(old), artifactSelectionKey(visible[0]!)]));
});

test('splits destructive requests into server-sized batches', () => {
  expect(chunks(Array.from({ length: 205 }, (_, index) => index)).map((batch) => batch.length))
    .toEqual([100, 100, 5]);
});
