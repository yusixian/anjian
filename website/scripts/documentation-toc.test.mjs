import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

for (const [locale, purpose, title] of [
  ['zh', '目录', '开源与许可'],
  ['en', 'Table of contents', 'Source and licensing'],
]) {
  test(`${locale} mobile TOC has a localized name before hydration`, async () => {
    const html = await readFile(`out/${locale}/docs/about/index.html`, 'utf8');
    const button = html.match(/<button [^>]*data-toc-popover-trigger[^>]*>/)?.[0];
    assert(button, 'The mobile TOC trigger must be rendered');
    const id = button.match(/aria-labelledby="([^"]+)"/)?.[1];
    assert(id, 'The button must reference its accessible label');
    const escapedId = id.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const label = html.match(new RegExp(`<span[^>]*id="${escapedId}"[^>]*>(.*?)</span>`))?.[1];
    assert(label, 'The referenced label must exist in the exported page');
    const labelElement = html.match(new RegExp(`<span[^>]*id="${escapedId}"[^>]*>`))?.[0];
    assert.match(labelElement, / hidden(?:="")?(?: |>)/);
    const name = label.replaceAll(/<!--.*?-->/g, '');
    assert.equal(name, `${purpose}${locale === 'zh' ? '：' : ': '}${title}`);
    assert.match(button, /aria-expanded="false"/);
  });
}
