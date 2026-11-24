import { blockIdState } from '@haklex/rich-editor';
import { $getRoot, $getState, type LexicalEditor } from 'lexical';
import { useEffect } from 'react';

export interface DocumentBlockTarget {
  blockId: string | null;
  scrollY?: number;
}

export function useDocumentBlockTarget(
  editor: LexicalEditor | null,
  targetRequest: DocumentBlockTarget,
) {
  useEffect(() => {
    const { blockId, scrollY } = targetRequest;
    if (scrollY !== undefined) {
      const frame = requestAnimationFrame(() =>
        window.scrollTo({ top: scrollY, behavior: 'instant' }),
      );
      return () => cancelAnimationFrame(frame);
    }
    if (!editor || !blockId) return;
    let frame = 0;
    let target: HTMLElement | null = null;
    let flash: Animation | undefined;
    const jump = () => {
      if (target || frame) return;
      const key = editor.getEditorState().read(() =>
        $getRoot()
          .getChildren()
          .find((node) => $getState(node, blockIdState) === blockId)
          ?.getKey(),
      );
      const element = key ? editor.getElementByKey(key) : null;
      if (!element) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        if (!element.isConnected || !element.getClientRects().length) return;
        target = element;
        element.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
        const outline = { outline: '2px solid Highlight', outlineOffset: '4px' };
        flash = element.animate?.([outline, outline], { duration: 1600 });
      });
    };
    jump();
    const unsubscribe = editor.registerUpdateListener(jump);
    return () => {
      unsubscribe();
      cancelAnimationFrame(frame);
      flash?.cancel();
    };
  }, [editor, targetRequest]);
}
