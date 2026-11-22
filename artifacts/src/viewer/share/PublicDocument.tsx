import '../document/styles';

import { RichEditor } from '@haklex/rich-editor';
import { ExcalidrawPlugin } from '@haklex/rich-ext-excalidraw';
import type { SerializedEditorState } from 'lexical';
import { useLayoutEffect, useMemo, useState } from 'react';

import {
  PUBLIC_ARTIFACT_REFERENCE,
  type SerializedPublicArtifactReference,
} from '../../shared/public-artifact-reference';
import { createChannel } from '../document/channel';
import { extraNodes, rendererConfig } from '../document/DocumentEditor';
import { type DynamicHost, DynamicHostContext } from '../document/DynamicBlock';
import { ReferenceNode } from '../document/ReferenceNode';
import { PublicReferenceNode } from './PublicReferenceNode';

const publicNodes = [...extraNodes.filter((node) => node !== ReferenceNode), PublicReferenceNode];

export function PublicDocument({ contentBase, state }: {
  contentBase: string;
  state: SerializedEditorState;
}) {
  const dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const [baseReady, setBaseReady] = useState(false);
  const host = useMemo<DynamicHost>(() => ({
    artifact: '', contentBase, channel: createChannel(), send: () => undefined,
  }), [contentBase]);
  // Publishing a different choice of references can leave the document revision unchanged.
  const referencesKey = useMemo(() => state.root.children.map((node) =>
    node.type === PUBLIC_ARTIFACT_REFERENCE ? (node as SerializedPublicArtifactReference).token ?? '' : '',
  ).join(','), [state]);
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
          extraNodes={publicNodes}
          initialValue={state}
          key={referencesKey}
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
