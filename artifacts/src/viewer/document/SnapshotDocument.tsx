import './styles';

import { RichEditor } from '@haklex/rich-editor';
import { ExcalidrawPlugin } from '@haklex/rich-ext-excalidraw';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import type { LexicalEditor, SerializedEditorState } from 'lexical';
import { useEffect, useMemo, useState } from 'react';

import { type CommentsFile, emptyComments } from '../../shared/comments';
import { createChannel } from './channel';
import { extraNodes, rendererConfig } from './DocumentEditor';
import { DocumentLayout } from './DocumentLayout';
import { type DynamicHost, DynamicHostContext } from './DynamicBlock';

const styles = stylex.create({
  root: { minHeight: '100%', backgroundColor: cssVar.colorBgContainer, color: cssVar.colorText },
});

function usePrefersDark() {
  const query = useMemo(() => window.matchMedia('(prefers-color-scheme: dark)'), []);
  const [dark, setDark] = useState(query.matches);
  useEffect(() => {
    const onChange = () => setDark(query.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, [query]);
  return dark;
}

interface Props {
  comments?: CommentsFile;
  contentBase: string;
  id: string;
  state: SerializedEditorState;
}

export default function SnapshotDocument({
  id,
  state,
  contentBase,
  comments = emptyComments(),
}: Props) {
  const dark = usePrefersDark();
  const [editor, setEditor] = useState<LexicalEditor | null>(null);
  const host = useMemo<DynamicHost>(
    () => ({
      artifact: `document/${id}`,
      contentBase,
      channel: createChannel(),
      send: () => undefined,
    }),
    [id, contentBase],
  );
  useEffect(() => {
    const base = document.createElement('base');
    base.href = contentBase;
    document.head.prepend(base);
    return () => base.remove();
  }, [contentBase]);

  return (
    <div
      {...stylex.props(styles.root)}
      className={`anjian-doc ${stylex.props(styles.root).className ?? ''}`}
    >
      <DocumentLayout editor={editor} threads={comments.threads}>
        <DynamicHostContext.Provider value={host}>
          <RichEditor
            extraNodes={extraNodes}
            initialValue={state}
            rendererConfig={rendererConfig}
            theme={dark ? 'dark' : 'light'}
            variant="article"
            onEditorReady={(ready) => {
              ready?.setEditable(false);
              setEditor(ready ?? null);
            }}
          >
            <ExcalidrawPlugin />
          </RichEditor>
        </DynamicHostContext.Provider>
      </DocumentLayout>
    </div>
  );
}
