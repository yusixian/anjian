import './whiteboard.css';

import { MessageSquare, Save } from 'lucide-react';
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';

import {
  WHITEBOARD_DEFAULT_PAGE,
  type WhiteboardPage as Sheet,
  type WhiteboardSnapshot,
} from '../../shared/whiteboard';
import { LibraryLink, LibraryNavigation } from '../components/LibraryNavigation';
import { ShareButton } from '../components/ShareButton';
import { NativeFeedback, NativeFeedbackButton } from '../feedback/NativeFeedback';
import { useTranslation } from '../i18n';
import {
  createWhiteboardDrafts,
  useWhiteboard,
  type WhiteboardCommentAction,
  type WhiteboardDrafts,
} from './useWhiteboard';
import { useWhiteboardLocation } from './useWhiteboardLocation';
import type { WhiteboardCanvasHandle } from './WhiteboardCanvas';
import { WhiteboardComments } from './WhiteboardComments';
import { WhiteboardFrames } from './WhiteboardFrames';
import { WhiteboardPagePicker } from './WhiteboardPagePicker';

const Canvas = lazy(() =>
  import('../document/shims')
    .then(() => import('./WhiteboardCanvas'))
    .then(({ WhiteboardCanvas }) => ({ default: WhiteboardCanvas })),
);

function WhiteboardPage({
  id,
  page,
  frame,
  drafts,
  pages,
  onFrame,
  onPage,
  onPages,
  commentsOpen,
  toggleComments,
  focusRequest,
  onFocused,
  missingThread,
}: {
  id: string;
  page: string;
  frame: string | null;
  drafts: WhiteboardDrafts;
  pages: Sheet[];
  onFrame: (id: string | null) => void;
  onPage: (id: string) => void;
  onPages: (pages: Sheet[]) => void;
  commentsOpen: boolean;
  toggleComments: () => void;
  missingThread: string | null;
  focusRequest: string[] | undefined;
  onFocused: (found: boolean) => void;
}) {
  const { t } = useTranslation();
  const {
    busy,
    changed,
    conflict,
    dirty,
    failure,
    generation,
    load,
    postComment,
    save,
    savePage,
    view,
  } = useWhiteboard(id, page, drafts);
  const [selection, setSelection] = useState<{ generation: number; ids: string[] }>({
    generation: 0,
    ids: [],
  });
  const canvasRef = useRef<WhiteboardCanvasHandle>(null);
  const selected = selection.generation === generation ? selection.ids : [];
  const status = dirty ? t('whiteboard.unsaved') : t('whiteboard.saved');
  const currentPages = view?.pages;

  useEffect(() => {
    if (currentPages) onPages(currentPages);
  }, [currentPages, onPages]);

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
              onClick={toggleComments}
            >
              <MessageSquare aria-hidden="true" size={15} />
              {t('chrome.comments')}
            </button>
            <NativeFeedbackButton />
            <ShareButton id={id} type="whiteboard" />
          </div>
        )}
      </header>
      {(view || pages.length > 0 || failure === 'loadFailed') && (
        <div className="anjian-whiteboard-navigation">
          <WhiteboardPagePicker
            disabled={busy}
            drafts={drafts.pages}
            page={page}
            pages={currentPages ?? pages}
            onPage={onPage}
            onSave={
              view
                ? async (title, rename) => {
                    const result = await savePage(title, rename);
                    if (!result) return false;
                    onPages(result.pages);
                    if (!rename) onPage(result.page);
                    return true;
                  }
                : undefined
            }
          />
          {view && <WhiteboardFrames frame={frame} scene={view.scene} onFrame={onFrame} />}
        </div>
      )}
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
              focusRequest={focusRequest}
              frameId={frame}
              key={generation}
              scene={view.scene}
              onFocused={onFocused}
              onSceneChange={changed}
              onSelectionChange={(ids) => setSelection({ generation, ids })}
            />
          </Suspense>
          {commentsOpen && (
            <WhiteboardComments
              busy={busy}
              locate={(ids) => canvasRef.current?.focusElements(ids) ?? false}
              missingThread={missingThread}
              post={addComment}
              selected={selected}
              comments={{
                ...view.comments,
                threads: view.comments.threads.filter(
                  (thread) => (thread.anchor.page ?? WHITEBOARD_DEFAULT_PAGE) === page,
                ),
              }}
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

function WhiteboardArtifact({ id }: { id: string }) {
  const { page, frame, navigate } = useWhiteboardLocation();
  const [drafts] = useState(createWhiteboardDrafts);
  const [pages, setPages] = useState<Sheet[]>([]);
  const [anchor, setAnchor] = useState<{ page: string; threadId: string; ids: string[] } | null>(
    null,
  );
  const [missingThread, setMissingThread] = useState<string | null>(null);
  const onFocused = useCallback(
    (found: boolean) => {
      setMissingThread(found ? null : (anchor?.threadId ?? null));
      setAnchor(null);
    },
    [anchor],
  );
  const [commentsOpen, setCommentsOpen] = useState(
    () => window.matchMedia('(min-width: 760px)').matches,
  );

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (drafts.pages.size > 0) event.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [drafts]);

  return (
    <NativeFeedback<WhiteboardSnapshot>
      id={id}
      type="whiteboard"
      locate={(snapshot, threadId) => {
        const thread = snapshot.comments.threads.find((item) => item.id === threadId);
        if (!thread) return false;
        const next = thread.anchor.page ?? WHITEBOARD_DEFAULT_PAGE;
        if (!snapshot.pages.some((item) => item.id === next)) return false;
        setMissingThread(null);
        setAnchor({ threadId, page: next, ids: thread.anchor.elementIds });
        setCommentsOpen(true);
        navigate(next, null);
        return true;
      }}
    >
      <WhiteboardPage
        commentsOpen={commentsOpen}
        drafts={drafts}
        focusRequest={anchor?.page === page ? anchor.ids : undefined}
        frame={frame}
        id={id}
        key={page}
        missingThread={missingThread}
        page={page}
        pages={pages}
        toggleComments={() => setCommentsOpen((open) => !open)}
        onFocused={onFocused}
        onFrame={(next) => navigate(page, next)}
        onPages={setPages}
        onPage={(next) => {
          setAnchor(null);
          setMissingThread(null);
          navigate(next, null);
        }}
      />
    </NativeFeedback>
  );
}

export function WhiteboardLayout({ id }: { id: string }) {
  return (
    <LibraryNavigation>
      <WhiteboardArtifact id={id} key={id} />
    </LibraryNavigation>
  );
}
