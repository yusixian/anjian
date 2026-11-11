import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { anjianMarkBody } from '../src/shared/brand';
import { AnjianMark } from '../src/viewer/components/AnjianMark';

describe('Anjian C2 mark', () => {
  it('keeps both masks local to each mark rendered in the same document', () => {
    const html = renderToStaticMarkup(
      createElement(
        'div',
        null,
        createElement(AnjianMark),
        createElement(AnjianMark),
        createElement(AnjianMark),
      ),
    );
    const ids = [...html.matchAll(/<mask id="([^"]+)"/g)].map((match) => match[1]);
    expect(ids).toHaveLength(6);
    expect(new Set(ids).size).toBe(6);
    for (const svg of html.matchAll(/<svg\b[^>]*>(.*?)<\/svg>/g)) {
      const body = svg[1]!;
      const localIds = [...body.matchAll(/<mask id="([^"]+)"/g)].map((match) => match[1]);
      const references = [...body.matchAll(/mask="url\(#([^)]+)\)"/g)].map((match) => match[1]);
      expect(references).toHaveLength(2);
      expect(references.every((id) => localIds.includes(id))).toBe(true);
    }
  });

  it('encodes caller identifiers without merging distinct IDs or injecting markup', () => {
    const ids = [':R1:', '_3a_R1_3a_', 'browser-login', '"><script>'];
    const outputs = ids.map((id) => anjianMarkBody(id));
    expect(new Set(outputs).size).toBe(ids.length);
    for (const output of outputs) {
      expect(output).not.toContain('<script>');
      expect(output).toContain('maskUnits="userSpaceOnUse"');
      expect(output).toContain('fill="#000"');
    }
  });
});
