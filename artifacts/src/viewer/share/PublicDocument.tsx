import '../document/styles';

import { RichEditor } from '@haklex/rich-editor';
import { ExcalidrawPlugin } from '@haklex/rich-ext-excalidraw';
import type { SerializedEditorState } from 'lexical';
import { useLayoutEffect, useMemo, useState } from 'react';

import { createChannel } from '../document/channel';
import { extraNodes, rendererConfig } from '../document/DocumentEditor';
import { type DynamicHost, DynamicHostContext } from '../document/DynamicBlock';

export function PublicDocument({ contentBase, state }: {
  contentBase: string;
  state: SerializedEditorState;
}) {
  const dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const [baseReady, setBaseReady] = useState(false);
  const host = useMemo<DynamicHost>(() => ({
    artifact: '', contentBase, channel: createChannel(), send: () => undefined,
  }), [contentBase]);
  useLayoutEffect(() => {
    const base = document.createElement('base');
    base.href = contentBase;
    document.head.prepend(base);
    setBaseReady(true);
    return () => { setBaseReady(false); base.remove(); };
  }, [contentBase]);
  return (
    <article className="share-document">
      {baseReady && <DynamicHostContext.Provider value={host}>
        <RichEditor
          extraNodes={extraNodes}
          initialValue={state}
          rendererConfig={rendererConfig}
          theme={dark ? 'dark' : 'light'}
          variant="article"
          onEditorReady={(editor) => editor?.setEditable(false)}
        >
          <ExcalidrawPlugin />
        </RichEditor>
      </DynamicHostContext.Provider>}
    </article>
  );
}
