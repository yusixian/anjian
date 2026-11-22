import '@excalidraw/excalidraw/index.css';
import './whiteboard.css';

import { CaptureUpdateAction, Excalidraw } from '@excalidraw/excalidraw';
import type {
  ExcalidrawImperativeAPI,
  ExcalidrawInitialDataState,
  ExcalidrawProps,
} from '@excalidraw/excalidraw/types';
import { type Ref, useImperativeHandle, useRef, useState } from 'react';

import type { WhiteboardScene } from '../../shared/whiteboard';
import { useTranslation } from '../i18n';

export interface WhiteboardCanvasHandle {
  focusElements: (elementIds: string[]) => boolean;
}

const canvasActions = {
  export: false,
  loadScene: false,
  saveToActiveFile: false,
  toggleTheme: false,
} as const;

type CanvasChange = NonNullable<ExcalidrawProps['onChange']>;

export function WhiteboardCanvas({
  scene,
  readOnly = false,
  canvasRef,
  onSceneChange,
  onSelectionChange,
}: {
  scene: WhiteboardScene;
  readOnly?: boolean;
  canvasRef?: Ref<WhiteboardCanvasHandle>;
  onSceneChange?: (scene: WhiteboardScene, contentKey: string) => void;
  onSelectionChange?: (ids: string[]) => void;
}) {
  const { i18n, t } = useTranslation();
  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null);
  const [initialData] = useState(
    () => ({ ...scene, scrollToContent: true }) as unknown as ExcalidrawInitialDataState,
  );
  const selectionKeyRef = useRef('');
  const contentKeyRef = useRef<string | null>(null);

  useImperativeHandle(
    canvasRef,
    () => ({
      focusElements(ids) {
        const current = apiRef.current;
        if (!current) return false;
        const wanted = new Set(ids);
        const elements = current.getSceneElements().filter((element) => wanted.has(element.id));
        if (!elements.length) return false;
        current.updateScene({
          appState: {
            selectedElementIds: Object.fromEntries(elements.map(({ id }) => [id, true])),
          },
          captureUpdate: CaptureUpdateAction.NEVER,
        });
        current.scrollToContent(elements, { fitToViewport: true, viewportZoomFactor: 0.6 });
        return true;
      },
    }),
    [],
  );

  const changed: CanvasChange = (elements, appState, files) => {
    const ids = Object.keys(appState.selectedElementIds).filter(
      (id) => appState.selectedElementIds[id],
    );
    const key = ids.join('\0');
    if (key !== selectionKeyRef.current) {
      selectionKeyRef.current = key;
      onSelectionChange?.(ids);
    }
    if (!onSceneChange) return;
    const { gridModeEnabled, gridSize, gridStep, viewBackgroundColor } = appState;
    const presentation = { gridModeEnabled, gridSize, gridStep, viewBackgroundColor };
    // Excalidraw updates the element version for edits and derives file IDs from their content.
    const nextKey = JSON.stringify([
      elements.map(({ id, version, versionNonce, index, isDeleted }) => [
        id,
        version,
        versionNonce,
        index,
        isDeleted,
      ]),
      Object.keys(files).sort(),
      presentation,
    ]);
    if (contentKeyRef.current === nextKey) return;
    contentKeyRef.current = nextKey;
    // Store presentation settings, not ephemeral editor state such as selection or zoom.
    onSceneChange(
      {
        ...scene,
        elements: elements as unknown as WhiteboardScene['elements'],
        files,
        appState: { ...scene.appState, ...presentation },
      },
      nextKey,
    );
  };

  return (
    <div aria-label={t('whiteboard.canvas')} className="anjian-whiteboard-canvas" role="region">
      <Excalidraw
        UIOptions={{ canvasActions }}
        autoFocus={false}
        initialData={initialData}
        langCode={i18n.language === 'zh' ? 'zh-CN' : 'en'}
        validateEmbeddable={false}
        viewModeEnabled={readOnly || undefined}
        excalidrawAPI={(instance) => {
          apiRef.current = instance;
        }}
        onChange={readOnly ? undefined : changed}
      />
    </div>
  );
}
