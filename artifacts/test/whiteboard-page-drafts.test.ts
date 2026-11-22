import { describe, expect, test } from 'vitest';

import { emptyWhiteboardScene } from '../src/shared/whiteboard';
import { createWhiteboardDrafts } from '../src/viewer/whiteboard/useWhiteboard';

const scene = emptyWhiteboardScene();
const submitted = { key: 'submitted', scene };
const newer = { key: 'newer', scene };
const receipt = { before: 'prior-revision', revision: 'saved-revision', submitted: submitted.key };

function unsaved(edit: typeof submitted) {
  return { baseline: 'saved', edit, revision: receipt.before };
}

describe('whiteboard page save acknowledgement', () => {
  test('clears the submitted draft when its page has unmounted', () => {
    const drafts = createWhiteboardDrafts();
    drafts.pages.set('main', unsaved(submitted));
    drafts.pages.set('secondary', unsaved(newer));
    drafts.confirm('main', receipt);
    expect(drafts.pages.has('main')).toBe(false);
    expect(drafts.pages.get('secondary')).toEqual(unsaved(newer));
  });

  test('rebases a newer draft and delivers the receipt to a returning page', () => {
    const drafts = createWhiteboardDrafts();
    drafts.pages.set('main', unsaved(newer));
    drafts.confirm('main', receipt);

    const received: (typeof receipt)[] = [];
    const unlisten = drafts.listen('main', (value) => received.push(value));
    expect(received).toEqual([receipt]);
    expect(drafts.pages.get('main')).toEqual({
      baseline: submitted.key,
      edit: newer,
      revision: receipt.revision,
    });

    unlisten();
    drafts.confirm('main', { ...receipt, revision: 'stale' });
    expect(received).toEqual([receipt]);
    expect(drafts.pages.get('main')?.revision).toBe(receipt.revision);
  });
});
