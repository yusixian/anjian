import { $reconcileRoot, createLoroBinding } from '@haklex/rich-collab-loro';
import { $getRoot } from 'lexical';
import { LoroDoc } from 'loro-crdt';
import { describe, expect, test } from 'vitest';

import {
  boxDrawingDiagrams,
  documentQuestions,
  documentTitle,
  parseDocument,
  serializeDocument,
  stampBlockIds,
} from '../src/server/document-codec';
import { createDocumentHeadlessEditor } from '../src/server/document-headless';

const sample = `<doc>
  <h2 id="h1">Relay <b>sync</b></h2>
  <p>Events carry a <code>seq</code>.</p>
  <ul><li>one</li></ul>
  <table><tr><th>a</th></tr><tr><td>b</td></tr></table>
  <codeblock lang="ts"><![CDATA[const a = 1 < 2]]></codeblock>
  <mermaid><![CDATA[graph TD; A-->B]]></mermaid>
  <alert type="note"><p>n</p></alert>
  <math display="block">x^2</math>
  <excalidraw>assets/flow.excalidraw</excalidraw>
  <img src="assets/a.png" alt="a"/>
</doc>`;

describe('parseDocument', () => {
  test('reads every node a document allows and serializes it back', () => {
    const state = parseDocument(sample);
    expect(state.root.children.map((node) => node.type)).toEqual([
      'heading',
      'paragraph',
      'list',
      'table',
      'code-block',
      'mermaid',
      'alert-quote',
      'katex-block',
      'excalidraw',
      'image',
    ]);
    const again = parseDocument(serializeDocument(state));
    expect(again.root.children.map((node) => node.type)).toEqual(
      state.root.children.map((node) => node.type),
    );
    expect(serializeDocument(again)).toContain('const a = 1 &lt; 2');
  });

  test('round trips presets and open questions with stable keys independent of block ids', () => {
    const state = parseDocument(`<doc>
      <p>请回答两个问题。</p>
      <ask key="delivery" prompt="A &amp; B &lt; C？"
        options='[{"id":"now","label":"现在 &amp; 今日"},{"id":"later","label":"稍后"}]'
        recommended="now"/>
      <ask key="notes" prompt="还有什么需要补充？"/>
    </doc>`);
    const stamped = stampBlockIds(state);
    const xml = serializeDocument(stamped);
    const reloaded = parseDocument(xml);
    expect(reloaded).toEqual(stamped);
    expect(documentQuestions(reloaded)).toEqual([
      {
        id: 'delivery',
        prompt: 'A & B < C？',
        options: [
          { id: 'now', label: '现在 & 今日' },
          { id: 'later', label: '稍后' },
        ],
        recommended: 'now',
      },
      { id: 'notes', prompt: '还有什么需要补充？' },
    ]);
  });

  test('reconciles a question edit through Loro without replacing its node', () => {
    const editor = createDocumentHeadlessEditor();
    const doc = new LoroDoc();
    const binding = createLoroBinding(editor, doc);
    const question = (prompt: string) =>
      parseDocument(`<doc><ask id="b1" key="question" prompt="${prompt}"/></doc>`);
    editor.update(() => $reconcileRoot(question('Before').root as never), { discrete: true });
    const peer = new LoroDoc();
    peer.import(doc.export({ mode: 'snapshot' }));
    const peerEditor = createDocumentHeadlessEditor();
    const peerBinding = createLoroBinding(peerEditor, peer);
    const key = () => peerEditor.getEditorState().read(() => $getRoot().getFirstChild()?.getKey());

    try {
      const originalKey = key();
      expect(originalKey).toBeDefined();

      const from = doc.oplogVersion();
      try {
        editor.update(() => $reconcileRoot(question('After').root as never), { discrete: true });
        peerBinding.import(doc.export({ mode: 'update', from }));
      } finally {
        from.free();
      }
      expect(key()).toBe(originalKey);
      const reloaded = parseDocument(serializeDocument(peerEditor.getEditorState().toJSON()));
      expect(documentQuestions(reloaded)).toEqual([{ id: 'question', prompt: 'After' }]);
    } finally {
      peerBinding.dispose();
      binding.dispose();
    }
  });

  test.each([
    ['<ask prompt="缺少标识"/>', 'key must contain'],
    ['<ask key="empty" prompt="  "/>', 'prompt must contain'],
    ['<ask key="bad" prompt="Bad" options="{"/>', 'options must be a JSON array'],
    ['<ask key="open" prompt="Why?" recommended="a"/>', 'recommended must match'],
    [
      `<ask key="bad" prompt="Bad" options='[{"id":"a","label":"1"},{"id":"a","label":"2"}]'/>`,
      'duplicate option id',
    ],
    ['<p><ask key="nested" prompt="Why?"/></p>', 'top-level block'],
    ['<ask key="same" prompt="First"/><ask key="same" prompt="Second"/>', 'duplicate key'],
    ['<ask key="nonempty" prompt="First"><p>Body</p></ask>', 'must be empty'],
  ])('rejects malformed questions in %s', (xml, error) => {
    expect(() => parseDocument(xml)).toThrow(error);
  });

  test('a chart keeps its spec and block id through a round trip', () => {
    const spec =
      '{"version":1,"type":"bar","x":"day","series":[{"key":"n"}],"data":[{"day":"10-09","n":14}]}';
    const state = parseDocument(`<doc><chart id="c1"><![CDATA[${spec}]]></chart></doc>`);
    expect(state.root.children[0]?.type).toBe('chart');
    const xml = serializeDocument(stampBlockIds(state));
    expect(xml).toContain('<chart id="c1">');
    expect(JSON.parse(xml.match(/<!\[CDATA\[(.*)\]\]>/s)![1]!)).toEqual(JSON.parse(spec));
  });

  test('reads details and footnotes and serializes them back', () => {
    const xml = `<doc>
      <details summary="Alternatives" open="true"><p>dropped</p></details>
      <p>Loro<footnote ref="1"/> merges.</p>
      <footnote-section><def ref="1">Loro docs.</def></footnote-section>
    </doc>`;
    const state = parseDocument(xml);
    expect(state.root.children.map((node) => node.type)).toEqual([
      'details',
      'paragraph',
      'footnote-section',
    ]);
    const out = serializeDocument(state);
    expect(out).toContain('summary="Alternatives"');
    expect(out).toContain('<footnote ref="1"');
    expect(out).toContain('<def ref="1">Loro docs.</def>');
  });

  test('steps keep their ids, titles and content through a round trip', () => {
    const state = parseDocument(
      `<doc><steps id="s"><step id="a" title="安装"><p>下载 <code>anjian</code>。</p></step><step id="b" title="Run"><p>go</p></step></steps></doc>`,
    );
    expect(state.root.children[0]).toMatchObject({
      type: 'steps',
      steps: [
        { id: 'a', title: '安装' },
        { id: 'b', title: 'Run' },
      ],
    });
    const out = serializeDocument(state);
    expect(out).toContain('<step id="a" title="安装">');
    expect(out).toContain('<code>anjian</code>');
    expect(parseDocument(out).root.children[0]).toMatchObject({
      type: 'steps',
      steps: [{ id: 'a' }, { id: 'b' }],
    });
  });

  test('rejects a grid: edits inside its cells do not reach doc.xml', () => {
    expect(() => parseDocument('<doc><grid><cell><p>A</p></cell></grid></doc>')).toThrow(
      '<grid> is not supported in documents',
    );
  });

  test('a dynamic block keeps its url, height and props', () => {
    const state = parseDocument(
      '<doc><dynamic id="d1" url="assets/tuner.html" initial-height="240"><![CDATA[{"radius":8}]]></dynamic></doc>',
    );
    expect(state.root.children[0]).toMatchObject({
      type: 'dynamic',
      url: 'assets/tuner.html',
      initialHeight: 240,
      props: { radius: 8 },
    });
    const out = serializeDocument(state);
    expect(out).toContain('url="assets/tuner.html"');
    expect(out).toContain('"radius":8');
  });

  test('a pending block keeps its intent and block id through a round trip', () => {
    const state = parseDocument(
      '<doc><h2 id="h1">存储</h2><pending id="p1" intent="讲清三类存储与 R2 key 前缀"/></doc>',
    );
    expect(state.root.children[1]).toMatchObject({
      type: 'pending',
      intent: '讲清三类存储与 R2 key 前缀',
    });
    const out = serializeDocument(state);
    expect(out).toContain('<pending id="p1" intent="讲清三类存储与 R2 key 前缀" />');
    expect(parseDocument(out).root.children[1]).toMatchObject({
      type: 'pending',
      intent: '讲清三类存储与 R2 key 前缀',
    });
  });

  test('rejects a pending block that is not a top-level block', () => {
    expect(() =>
      parseDocument('<doc><details summary="x"><pending intent="later"/></details></doc>'),
    ).toThrow('<pending> must be a top-level block');
    expect(() =>
      parseDocument('<doc><blockquote><pending intent="later"/></blockquote></doc>'),
    ).toThrow('<pending> must be a top-level block');
  });

  test.each([
    'https://example.com/x.html',
    'assets/../doc.xml',
    '/assets/x.html',
    'assets/x.js',
    'assets/sub/x.html',
    '',
  ])('rejects a dynamic url outside assets/<name>.html: %s', (url) => {
    expect(() => parseDocument(`<doc><dynamic url="${url}"></dynamic></doc>`)).toThrow(
      '<dynamic> url must be assets/<name>.html',
    );
  });

  test('rejects a dynamic url hidden behind a decoy in another attribute', () => {
    expect(() =>
      parseDocument(
        `<doc><dynamic x=" url='assets/a.html'" url="../../html/other/index.html"></dynamic></doc>`,
      ),
    ).toThrow('<dynamic> url must be assets/<name>.html');
  });

  test.each(['{bad json', '[1,2]', '"text"'])(
    'rejects dynamic props that are not a JSON object: %s',
    (props) => {
      expect(() =>
        parseDocument(`<doc><dynamic url="assets/a.html"><![CDATA[${props}]]></dynamic></doc>`),
      ).toThrow('<dynamic> props must be a JSON object');
    },
  );

  test('rejects a <def> outside <footnote-section>', () => {
    expect(() => parseDocument('<doc><p>a</p><def ref="1">x</def></doc>')).toThrow(
      '<def> belongs inside <footnote-section>',
    );
    expect(() =>
      parseDocument('<doc><footnote-section><def ref="1">x</def></footnote-section></doc>'),
    ).not.toThrow();
  });

  test('rejects a mismatched tag and names it', () => {
    expect(() => parseDocument('<doc><p>a</h2></doc>')).toThrow('</h2> closes <p>');
  });

  test('rejects a LiteXML tag documents do not support', () => {
    expect(() => parseDocument('<doc><poll><p>x</p></poll></doc>')).toThrow(
      '<poll> is not supported in documents',
    );
  });

  test('rejects a tag LiteXML does not know instead of dropping it', () => {
    expect(() => parseDocument('<doc><callout>x</callout></doc>')).toThrow(
      '<callout> is not a LiteXML tag',
    );
  });

  test('a paragraph with <strike> keeps the spaces between its inline tags', () => {
    expect(
      serializeDocument(parseDocument('<doc><p>a <strike>x</strike> <b>b</b> <i>c</i></p></doc>')),
    ).toContain('<p>a <s>x</s> <b>b</b> <i>c</i></p>');
  });

  test('ignores tag-like text inside CDATA', () => {
    expect(() =>
      parseDocument('<doc><codeblock><![CDATA[<poll></div>]]></codeblock></doc>'),
    ).not.toThrow();
  });
});

describe('artifact reference blocks', () => {
  const target = 'AB12ab12ab12ab12ab12x';
  const board = `type="artboard" target="${target}"`;

  test('round-trips whole artifacts and artboard focus with independent block IDs', () => {
    const state = stampBlockIds(
      parseDocument(
        `<ref id="review" ${board} group="review" label="对比 A &amp; B > C" />
      <ref ${board} board="details-v2" />
      <ref type="document" target="${target}" />
      <ref type="html" target="${target}" />`,
      ),
    );
    expect(state.root.children).toEqual([
      {
        $: { blockId: 'review' },
        type: 'artifact-reference',
        reference: {
          type: 'artboard',
          target,
          focus: { kind: 'group', id: 'review' },
          label: '对比 A & B > C',
        },
        version: 1,
      },
      expect.objectContaining({
        reference: { type: 'artboard', target, focus: { kind: 'board', id: 'details-v2' } },
      }),
      expect.objectContaining({ reference: { type: 'document', target } }),
      expect.objectContaining({ reference: { type: 'html', target } }),
    ]);
    expect(parseDocument(serializeDocument(state))).toEqual(state);
  });

  test.each([
    ['<blockquote><ref ' + board + ' /></blockquote>', 'top-level'],
    ['<footnote-section><def ref="1"><ref ' + board + ' /></def></footnote-section>', 'top-level'],
    ['<p><ref ' + board + ' /></p>', 'top-level'],
    ['<ref ' + board + '>text</ref>', 'empty'],
    ['<ref ' + board + '><p>text</p></ref>', 'empty'],
    ['<ref ' + board + ' board="b" group="g" />', 'either board or group'],
    [`<ref type="document" target="${target}" board="b" />`, 'only supported for artboards'],
    ['<ref ' + board + ' group="x?key=private" />', 'URL-safe ID'],
    ['<ref ' + board + ' group="' + 'a'.repeat(129) + '" />', 'URL-safe ID'],
    ['<ref ' + board + ' label=" " />', '1–160 characters'],
    ['<ref ' + board + ' key="private" />', 'invalid or repeated attributes'],
    ['<ref ' + board + ' target="slug" />', 'invalid or repeated attributes'],
    ['<ref type="html" target="slug" />', 'stable artifact ID'],
    ['<ref type="html" target="https://example.com/x?key=private" />', 'stable artifact ID'],
    ['<ref type="other" target="' + target + '" />', 'type must be'],
  ])('rejects malformed source %s', (xml, message) => {
    expect(() => parseDocument(xml)).toThrow(message);
  });

  test('retains references and block IDs through Loro snapshot and updates', () => {
    const xml = `<ref id="ref-a" ${board} group="review" label="Review" />`;
    const state = parseDocument(xml);
    const doc = new LoroDoc();
    const editor = createDocumentHeadlessEditor();
    const binding = createLoroBinding(editor, doc);
    const copy = new LoroDoc();
    try {
      editor.update(() => $reconcileRoot(state.root as never), { discrete: true });
      copy.import(doc.export({ mode: 'snapshot' }));
      const copyEditor = createDocumentHeadlessEditor();
      const copyBinding = createLoroBinding(copyEditor, copy);
      try {
        expect(parseDocument(serializeDocument(copyEditor.getEditorState().toJSON()))).toEqual(
          state,
        );
        const updated = parseDocument(xml.replace('label="Review"', 'label="Updated review"'));
        const from = doc.oplogVersion();
        editor.update(() => $reconcileRoot(updated.root as never), { discrete: true });
        copyBinding.import(doc.export({ mode: 'update', from }));
        expect(parseDocument(serializeDocument(copyEditor.getEditorState().toJSON()))).toEqual(
          updated,
        );
      } finally {
        copyBinding.dispose();
      }
    } finally {
      copy.free();
      binding.dispose();
      doc.free();
    }
  });
});

describe('stampBlockIds', () => {
  test('gives every top-level block a unique id and keeps existing ones', () => {
    const state = stampBlockIds(parseDocument('<doc><h2 id="keep">a</h2><p>b</p><p>c</p></doc>'));
    const ids = state.root.children.map(
      (node) => (node as { $?: { blockId?: string } }).$?.blockId,
    );
    expect(ids[0]).toBe('keep');
    expect(ids[1]).toMatch(/^[\w-]{8}$/);
    expect(new Set(ids).size).toBe(3);
    expect(serializeDocument(state)).toContain(`<p id="${ids[1]}">b</p>`);
  });

  test('replaces a duplicated id on the later block', () => {
    const state = stampBlockIds(parseDocument('<doc><p id="x">a</p><p id="x">b</p></doc>'));
    const ids = state.root.children.map(
      (node) => (node as { $?: { blockId?: string } }).$?.blockId,
    );
    expect(ids[0]).toBe('x');
    expect(ids[1]).not.toBe('x');
  });
});

test('the title is the text of the first heading', () => {
  expect(
    documentTitle(parseDocument('<doc><p>intro</p><h3>Relay <i>sync</i></h3><h1>later</h1></doc>')),
  ).toBe('Relay sync');
  expect(documentTitle(parseDocument('<doc><p>no heading</p></doc>'))).toBeNull();
});

describe('boxDrawingDiagrams', () => {
  const diagram =
    '┌──────────┐\n│ Cloud    │\n└────┬─────┘\n     ▼\n┌──────────┐\n│ Market   │\n└──────────┘';

  test('names code blocks drawn with box-drawing characters', () => {
    const state = parseDocument(
      `<doc><p>x</p><codeblock id="c1" lang="text"><![CDATA[${diagram}]]></codeblock></doc>`,
    );
    expect(boxDrawingDiagrams(state)).toEqual(['c1']);
  });

  test('names the top-level block that holds a nested diagram', () => {
    const state = parseDocument(
      `<doc><details id="d1" summary="Design"><codeblock lang="text"><![CDATA[${diagram}]]></codeblock></details></doc>`,
    );
    expect(boxDrawingDiagrams(state)).toEqual(['d1']);
  });

  test('leaves boxed program output alone', () => {
    const table =
      '┌─────────┬─────────┐\n│ Package │ Latest  │\n├─────────┼─────────┤\n│ vite    │ 8.3.5   │\n└─────────┴─────────┘';
    const notice =
      '╭──────────────────────────────╮\n│   Update available! 9 → 10   │\n│   Run pnpm add -g pnpm       │\n╰──────────────────────────────╯';
    const state = parseDocument(
      `<doc><codeblock id="t1"><![CDATA[${table}]]></codeblock><codeblock id="n1"><![CDATA[${notice}]]></codeblock></doc>`,
    );
    expect(boxDrawingDiagrams(state)).toEqual([]);
  });

  test('leaves code and a stray box character alone', () => {
    const tree = 'src/\n├─ a.ts\n└─ b.ts';
    const code = 'const a = 1;\n// │ not a diagram\nconst b = 2;';
    const state = parseDocument(
      `<doc><codeblock id="t1"><![CDATA[${tree}]]></codeblock><codeblock id="k1" lang="ts"><![CDATA[${code}]]></codeblock></doc>`,
    );
    expect(boxDrawingDiagrams(state)).toEqual([]);
  });
});
