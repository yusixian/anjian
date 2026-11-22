import './whiteboard.css';

import { MessageSquare, Save } from 'lucide-react';
import { lazy, Suspense, useRef, useState } from 'react';

import { LibraryLink, LibraryNavigation } from '../components/LibraryNavigation';
import { ShareButton } from '../components/ShareButton';
import { useTranslation } from '../i18n';
import { useWhiteboard, type WhiteboardCommentAction } from './useWhiteboard';
import { useWhiteboardFrame } from './useWhiteboardFrame';
import type { WhiteboardCanvasHandle } from './WhiteboardCanvas';
import { WhiteboardComments } from './WhiteboardComments';
import { WhiteboardFrames } from './WhiteboardFrames';

const Canvas = lazy(() =>
  import('../document/shims')
    .then(() => import('./WhiteboardCanvas'))
    .then(({ WhiteboardCanvas }) => ({ default: WhiteboardCanvas })),
);

function WhiteboardPage({ id }: { id: string }) {
  const { t } = useTranslation();
  const { busy, changed, conflict, dirty, failure, generation, load, postComment, save, view } =
    useWhiteboard(id);
  const [commentsOpen, setCommentsOpen] = useState(
    () => window.matchMedia('(min-width: 760px)').matches,
  );
  const [selection, setSelection] = useState<{ generation: number; ids: string[] }>({
    generation: 0,
    ids: [],
  });
  const canvasRef = useRef<WhiteboardCanvasHandle>(null);
  const [frame, setFrame] = useWhiteboardFrame();
  const selected = selection.generation === generation ? selection.ids : [];
  const status = dirty ? t('whiteboard.unsaved') : t('whiteboard.saved');

  const addComment = async (action: WhiteboardCommentAction) => {
    if (action.op === 'create' && dirty && !(await save())) return false;
    return postComment(action);
  };

  return (
    <main className="anjian-whiteboard">
      <header className="anjian-whiteboard-toolbar">
        <LibraryLink />
        <h1 title={view?.title}>{view?.title || id}</h1>
        {view && (
          <div className="anjian-whiteboard-actions">
            <span role="status">{status}</span>
            <button disabled={busy || !dirty || conflict} type="button" onClick={() => void save()}>
              <Save aria-hidden="true" size={15} />
              {t('whiteboard.save')}
            </button>
            <button
              aria-controls="whiteboard-comments"
              aria-expanded={commentsOpen}
              type="button"
              onClick={() => setCommentsOpen(!commentsOpen)}
            >
              <MessageSquare aria-hidden="true" size={15} />
              {t('chrome.comments')}
            </button>
            <ShareButton id={id} type="whiteboard" />
          </div>
        )}
      </header>
      {view && <WhiteboardFrames frame={frame} scene={view.scene} onFrame={setFrame} />}
      {conflict && (
        <div className="anjian-whiteboard-notice" role="alert">
          <span>{t('whiteboard.conflict')}</span>
          <button
            disabled={busy}
            type="button"
            onClick={() => {
              if (!dirty || window.confirm(t('whiteboard.discardConfirm')))
                void load({ discard: true, report: true });
            }}
          >
            {t('whiteboard.reload')}
          </button>
        </div>
      )}
      {failure && (
        <div className="anjian-whiteboard-notice" role="alert">
          <span>{t(`whiteboard.${failure}`)}</span>
          {failure === 'loadFailed' && (
            <button type="button" onClick={() => void load({ report: true })}>
              {t('common.retry')}
            </button>
          )}
        </div>
      )}
      {view?.commentsWarning && (
        <div className="anjian-whiteboard-notice" role="alert">
          {t('whiteboard.commentsWarning')}
        </div>
      )}
      {view ? (
        <div
          className={`anjian-whiteboard-workspace${commentsOpen ? ' anjian-whiteboard-with-comments' : ''}`}
        >
          <Suspense
            fallback={
              <div className="anjian-whiteboard-loading" role="status">
                {t('common.loading')}
              </div>
            }
          >
            <Canvas
              canvasRef={canvasRef}
              frameId={frame}
              key={generation}
              scene={view.scene}
              onSceneChange={changed}
              onSelectionChange={(ids) => setSelection({ generation, ids })}
            />
          </Suspense>
          {commentsOpen && (
            <WhiteboardComments
              busy={busy}
              comments={view.comments}
              locate={(ids) => canvasRef.current?.focusElements(ids) ?? false}
              post={addComment}
              selected={selected}
            />
          )}
        </div>
      ) : (
        !failure && (
          <div className="anjian-whiteboard-loading" role="status">
            {t('common.loading')}
          </div>
        )
      )}
    </main>
  );
}

export function WhiteboardLayout({ id }: { id: string }) {
  return (
    <LibraryNavigation>
      <WhiteboardPage id={id} key={id} />
    </LibraryNavigation>
  );
}
