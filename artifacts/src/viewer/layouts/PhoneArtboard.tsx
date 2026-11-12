import { ActionIcon } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { MessageSquare, ScanSearch } from 'lucide-react';
import {
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  useCallback,
  useMemo,
  useRef,
  useState,
} from 'react';

import type { BoardHumanOp } from '../../shared/board-comments';
import { type CanvasLayout, type CanvasSpec, isMediaBoard } from '../../shared/types';
import { SubmitBar } from '../choices/SubmitBar';
import { Canvas } from '../components/Canvas';
import { CanvasErrorBoundary } from '../components/CanvasErrorBoundary';
import { Labels } from '../components/Labels';
import { PhoneArtboardBar } from '../components/PhoneArtboardBar';
import { PhoneBoard } from '../components/PhoneBoard';
import { QuestionSheet, SHEET_PEEK } from '../components/QuestionSheet';
import { useFeedbackEnabled } from '../feedback/FeedbackProvider';
import { FeedbackSheet } from '../feedback/FeedbackSheet';
import { useArtboardPage } from '../hooks/useArtboardPage';
import { useBoardLifecycle } from '../hooks/useBoardLifecycle';
import { useBoardOrigin } from '../hooks/useBoardOrigin';
import { useChoices } from '../hooks/useChoices';
import { useCulledBoards } from '../hooks/useCulledBoards';
import { useInspector } from '../hooks/useInspector';
import { usePanZoom } from '../hooks/usePanZoom';
import { useVerdicts } from '../hooks/useVerdicts';
import { t } from '../i18n';
import { InspectorPanel } from '../inspector/InspectorPanel';
import type { BoardCommentsState } from '../lib/board-comments';
import {
  openingQuestion,
  type Question,
  questionList,
  roundsOf,
  stepQuestion,
} from '../lib/questions';
import type { Insets } from '../lib/view';

const INSETS: Insets = { top: 16, right: 16, bottom: SHEET_PEEK + 16, left: 16 };
const TAP_SLOP = 8;
const NOTHING = new Set<string>();
const noLoad = () => {};

const styles = stylex.create({
  root: {
    position: 'fixed',
    inset: 0,
    display: 'flex',
    flexDirection: 'column',
    backgroundColor: cssVar.colorBgLayout,
  },
  viewport: {
    position: 'relative',
    flex: 1,
    minHeight: 0,
    overflow: 'hidden',
    touchAction: 'none',
    userSelect: 'none',
    fontFamily: cssVar.fontFamily,
    color: cssVar.colorText,
  },
  dock: { position: 'absolute', inset: 0, zIndex: 10, pointerEvents: 'none' },
  empty: {
    position: 'absolute',
    inset: 0,
    display: 'grid',
    placeItems: 'center',
    padding: 24,
    color: cssVar.colorTextSecondary,
    fontSize: 14,
    textAlign: 'center',
  },
});

interface Props {
  actions?: ReactNode;
  agent?: string;
  artifact: string | null;
  boardOrigin?: string;
  boardPath?: string;
  boardPort?: number;
  canvas: CanvasSpec | null;
  comment?: (op: BoardHumanOp) => Promise<unknown>;
  comments?: BoardCommentsState | null;
  contentBase: string;
  id: string;
  layout: CanvasLayout | null;
  live?: boolean;
  loaded: boolean;
  pending: string[];
  readOnly?: boolean;
  versions: Record<string, number>;
  warnings: string[];
}

const NO_THREADS: never[] = [];

export function PhoneArtboard({
  artifact,
  id,
  canvas,
  layout,
  warnings,
  pending,
  contentBase,
  boardOrigin,
  boardPort,
  boardPath,
  versions,
  live,
  loaded,
  agent,
  comment,
  comments,
  actions,
  readOnly = false,
}: Props) {
  const {
    viewportRef,
    worldRef,
    overlayRef,
    view,
    viewNow,
    size,
    gesturing,
    fit,
    handlers,
    wheelAt,
    panBy,
  } = usePanZoom('hand');
  const feedbackEnabled = useFeedbackEnabled();
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [current, setCurrent] = useState<string | null>(null);
  const [snap, setSnap] = useState(SHEET_PEEK);
  const [open, setOpen] = useState<string | null>(null);
  const tap = useRef<{ pointer: number; x: number; y: number } | null>(null);

  const show = useCallback(
    (question: Question | null, animate = false) => {
      if (!question) return false;
      setCurrent(question.id);
      fit(question.bounds, INSETS, { animate });
      return true;
    },
    [fit],
  );
  const fitPage = useCallback(
    (page: string) => {
      const pageLayout = layout?.pages[page];
      if (!canvas || !pageLayout) return false;
      if (show(openingQuestion(roundsOf(canvas, layout, page), canvas.focus?.target))) return true;
      setCurrent(null);
      if (pageLayout.bounds) fit(pageLayout.bounds, INSETS);
      return true;
    },
    [canvas, layout, fit, show],
  );
  const { page, changePage } = useArtboardPage({
    canvas,
    layout,
    fitPage,
    startAtFocus: true,
  });

  const rounds = useMemo(
    () => (canvas && layout && page ? roundsOf(canvas, layout, page) : []),
    [canvas, layout, page],
  );
  const list = useMemo(() => questionList(rounds), [rounds]);
  const question = list.find((q) => q.id === current) ?? null;
  const pick = (next: Question) => {
    show(next, true);
    setSnap(SHEET_PEEK);
  };

  const allBoards = canvas?.boards ?? {};
  const boards = useMemo(
    () => Object.entries(canvas?.boards ?? {}).filter(([, b]) => b.page === page),
    [canvas, page],
  );
  const groups = Object.entries(canvas?.groups ?? {}).filter(([, g]) =>
    g.boards.some((boardId) => allBoards[boardId]?.page === page),
  );
  const notes = Object.entries(canvas?.notes ?? {}).filter(([, n]) => n.page === page);
  const pendingBoards = useMemo(() => new Set(pending), [pending]);
  const source = useBoardOrigin({ contentBase, boardOrigin, boardPort, boardPath });
  const inspector = useInspector({
    enabled: readOnly && inspectorOpen,
    readOnly,
    playing: NOTHING,
    onInput: (boardId, input) => {
      const board = canvas?.boards[boardId];
      if (!board) return;
      if (input.type === 'anjian:inspect:wheel') {
        const now = viewNow();
        wheelAt({
          ...input,
          x: now.x + (board.x + input.x) * now.k,
          y: now.y + (board.y + input.y) * now.k,
        });
      } else if (input.type === 'anjian:inspect:pan') panBy(input.deltaX, input.deltaY);
    },
  });
  const waiting = useMemo(
    () => (source ? pendingBoards : new Set(boards.map(([board]) => board))),
    [source, pendingBoards, boards],
  );
  const lifecycle = useBoardLifecycle({
    boards,
    versions,
    pending: waiting,
    view,
    viewport: size,
    active: NOTHING,
    gesturing,
  });
  const frameRef = useMemo(() => {
    const refs = new Map<string, (element: HTMLIFrameElement | null) => void>();
    return (boardId: string) => {
      if (!refs.has(boardId))
        refs.set(boardId, (element) => {
          if (readOnly) inspector.refFor(boardId)(element);
          lifecycle.frameRef(boardId)(element);
        });
      return refs.get(boardId)!;
    };
  }, [readOnly, inspector.refFor, lifecycle.frameRef]);
  const frameLoaded = useCallback(
    (boardId: string) => {
      if (readOnly) inspector.loaded(boardId);
    },
    [readOnly, inspector.loaded],
  );
  const culled = useCulledBoards(boards, view, size);
  const stale = useMemo(() => new Set(comments?.stale ?? []), [comments]);
  const verdicts = useVerdicts({
    canvas,
    page,
    threads: comments?.comments.threads ?? NO_THREADS,
    stale,
    versions,
  });
  const choices = useChoices({
    artifact: readOnly ? null : artifact,
    canvas,
    layout,
    page,
    threads: comments?.comments.threads ?? NO_THREADS,
    listening: comments?.listening === true,
    comment: readOnly || live === false ? undefined : comment,
  });
  const chose = Object.fromEntries(
    list.flatMap((q) => {
      const found = choices.choiceOf(q.id);
      return found?.choice && !found.byRecommendation ? [[q.id, found.choice]] : [];
    }),
  );

  const boardAt = (event: { clientX: number; clientY: number }) => {
    const rect = viewportRef.current!.getBoundingClientRect();
    const now = viewNow();
    const x = (event.clientX - rect.left - now.x) / now.k;
    const y = (event.clientY - rect.top - now.y) / now.k;
    return (
      boards.find(([, b]) => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h)?.[0] ?? null
    );
  };
  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    handlers.onPointerDown(event);
    const outside =
      !event.currentTarget.contains(event.target as Node) ||
      (event.target as Element).closest('[data-chrome]');
    tap.current =
      tap.current || outside
        ? null
        : { pointer: event.pointerId, x: event.clientX, y: event.clientY };
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    handlers.onPointerMove(event);
    const start = tap.current;
    if (
      start &&
      (start.pointer !== event.pointerId ||
        Math.hypot(event.clientX - start.x, event.clientY - start.y) > TAP_SLOP)
    )
      tap.current = null;
  };
  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    handlers.onPointerUp(event);
    const start = tap.current;
    tap.current = null;
    if (start?.pointer !== event.pointerId) return;
    const hit = boardAt(event);
    if (hit) setOpen(hit);
  };

  const openBoard = open ? allBoards[open] : undefined;
  const box = viewportRef.current?.getBoundingClientRect();
  const origin =
    openBoard && box
      ? {
          x: box.left + view.x + openBoard.x * view.k,
          y: box.top + view.y + openBoard.y * view.k,
          w: openBoard.w * view.k,
          h: openBoard.h * view.k,
        }
      : undefined;
  const loose = (q: Question) => !canvas?.groups?.[q.id];
  const openRound = open
    ? rounds.find((r) => r.questions.some((q) => q.boards.includes(open)))
    : undefined;
  const openQuestion = openRound?.questions.find((q) => q.boards.includes(open!));
  const siblings = !open
    ? []
    : !openQuestion
      ? [open]
      : loose(openQuestion)
        ? openRound!.questions.filter(loose).map((q) => q.id)
        : openQuestion.boards;

  return (
    <div {...stylex.props(styles.root)} style={readOnly ? { position: 'absolute' } : undefined}>
      <PhoneArtboardBar
        live={readOnly ? undefined : live}
        page={page}
        pages={canvas?.pages ?? []}
        title={readOnly ? '' : canvas?.title || id}
        actions={
          <>
            {actions}
            {feedbackEnabled && !readOnly && artifact && comment && (
              <ActionIcon
                aria-label={t('feedback.title')}
                icon={MessageSquare}
                size="small"
                title={t('feedback.title')}
                onClick={() => setFeedbackOpen(true)}
              />
            )}
            {readOnly && (
              <ActionIcon
                aria-label={t('inspector.label')}
                icon={ScanSearch}
                size="small"
                title={t('inspector.label')}
                onClick={() => setInspectorOpen(true)}
              />
            )}
          </>
        }
        onPageChange={changePage}
      />
      <div
        ref={viewportRef}
        {...stylex.props(styles.viewport)}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={(event) => {
          handlers.onPointerCancel(event);
          tap.current = null;
        }}
      >
        {canvas && layout ? (
          <CanvasErrorBoundary resetKey={canvas}>
            <Canvas
              agent={agent}
              boardBase={source?.base}
              boardSandbox={readOnly ? 'allow-scripts' : source?.sandbox}
              boards={boards}
              contentBase={contentBase}
              culled={culled}
              frameLoaded={readOnly ? frameLoaded : noLoad}
              frameRef={frameRef}
              gesturing={gesturing}
              images={lifecycle.images}
              inspecting={readOnly && inspectorOpen}
              live={live}
              notes={notes}
              pending={waiting}
              phases={lifecycle.phases}
              playing={NOTHING}
              replays={{}}
              versions={versions}
              view={view}
              worldRef={worldRef}
              writing={live ? canvas.writing : undefined}
            />
            <Labels
              allBoards={allBoards}
              boards={boards}
              choices={!readOnly && choices.active ? choices : undefined}
              contentBase={contentBase}
              groups={groups}
              overlayRef={overlayRef}
              pending={pendingBoards}
              playing={NOTHING}
              verdicts={readOnly ? undefined : verdicts}
              versions={versions}
              view={view}
              onExpand={setOpen}
              onReplay={() => {}}
              onTogglePlay={setOpen}
            />
          </CanvasErrorBoundary>
        ) : (
          <div {...stylex.props(styles.empty)}>
            {loaded
              ? (warnings[0] ?? 'Waiting for the agent to write canvas.json…')
              : 'Connecting…'}
          </div>
        )}
        {list.length > 0 ? (
          <div data-chrome {...stylex.props(styles.dock)}>
            {!readOnly && choices.current && (
              <SubmitBar
                agent={agent}
                bottom={SHEET_PEEK + 12}
                canAct={choices.canAct}
                feedback={choices.feedback}
                listening={choices.listening}
                summary={choices.current}
                onSubmit={choices.submit}
                onWithdraw={choices.withdraw}
              />
            )}
            <QuestionSheet
              chose={chose}
              current={question}
              next={current ? stepQuestion(list, current, 1) : null}
              page={page}
              pages={canvas?.pages ?? []}
              previous={current ? stepQuestion(list, current, -1) : null}
              rounds={rounds}
              snap={snap}
              verdicts={verdicts.states}
              onPageChange={changePage}
              onPick={pick}
              onSnap={setSnap}
            />
          </div>
        ) : null}
      </div>
      {open && openBoard ? (
        <PhoneBoard
          board={openBoard}
          choice={readOnly ? undefined : choices.boardChoice(open)}
          contained={readOnly}
          id={open}
          origin={origin}
          siblings={siblings}
          src={`${isMediaBoard(openBoard) ? contentBase : (source?.base ?? contentBase)}${openBoard.file}?v=${versions[openBoard.file] ?? 0}`}
          sandbox={
            isMediaBoard(openBoard) ? undefined : readOnly ? 'allow-scripts' : source?.sandbox
          }
          onChoose={readOnly ? undefined : () => choices.choose(open)}
          onClose={() => setOpen(null)}
          onOpen={setOpen}
        />
      ) : null}
      {feedbackEnabled && !readOnly && artifact && comment && feedbackOpen && (
        <FeedbackSheet
          artifact={artifact}
          threads={comments?.comments.threads ?? []}
          onClose={() => setFeedbackOpen(false)}
          onReply={(threadId, text) => comment({ op: 'reply', threadId, text })}
        />
      )}
      {readOnly && inspectorOpen && (
        <InspectorPanel
          fullScreen
          readOnly
          boards={boards}
          change={inspector.change}
          enabled={true}
          frames={inspector.frames}
          hoverNode={inspector.hoverNode}
          playing={NOTHING}
          reset={inspector.reset}
          select={inspector.select}
          selection={inspector.selection}
          targets={inspector.targets}
          onClose={() => setInspectorOpen(false)}
        />
      )}
    </div>
  );
}
