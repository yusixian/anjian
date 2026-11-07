import { describe, expect, test } from 'vitest';

import { injectRuntime } from '../src/server/inject';
import { stripRuntime } from '../src/server/strip-runtime';

const page =
  '<!doctype html><html><head><title>Arrow</title><script>window.mine = 1</script></head><body><anjian-button>Go</anjian-button><anjian-icon> name="x"></anjian-icon></body></html>';

describe('stripRuntime', () => {
  test.each([
    ['an artboard page', { uiRuntimeUrl: '/_anjian/runtime/anjian-ui.js', inspector: true }],
    ['an HTML page with UI and icons', { uiRuntimeUrl: '/_anjian/runtime/anjian-ui.js' }],
    ['a document live block', { uiRuntimeUrl: '/_anjian/runtime/anjian-ui.js', embedded: true }],
    ['a page without a runtime URL', {}],
  ])('gives back the authored source of %s', (_name, options) => {
    expect(stripRuntime(injectRuntime(page, options))).toBe(page);
  });

  test('works without a <head>', () => {
    const bare = '<p>hello</p>';
    expect(stripRuntime(injectRuntime(bare, { inspector: true }))).toBe(bare);
  });

  test('leaves a page that was never injected alone', () => {
    expect(stripRuntime(page)).toBe(page);
  });
});
