import { allNodes } from '@haklex/rich-editor/static';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import type { LexicalEditor } from 'lexical';
import { LoroDoc } from 'loro-crdt';
import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react';

import { type CommentsFile, emptyComments, type HumanOp } from '../../shared/comments';
import { WarningsBadge } from '../components/WarningsBadge';
import { PHONE_QUERY, useMedia } from '../hooks/useMedia';
import { useTypeFavicon } from '../hooks/useTypeFavicon';
import { t } from '../i18n';
import { agentActivity } from './agentActivity';
import type { AgentPlaybackState } from './AgentPlayback';
import type { ThreadActions } from './CommentCard';
import { DesktopDocument } from './DesktopDocument';
import { DocumentEditor, extraNodes } from './DocumentEditor';
import { useDocumentHistory } from './DocumentHistory';
import { type DynamicHost, DynamicHostContext } from './DynamicBlock';
import { decodeBase64 } from './LoroSync';
import { PendingContext, type PendingProgress } from './PendingBlock';
import { PhoneLayout } from './PhoneLayout';
import { TopBar } from './TopBar';
import type { DocumentMeta, DocumentState, DocumentTransport } from './transport';
import { useDocumentSelectionSync } from './useDocumentSelectionSync';
import { useNow, usePendingBlocks } from './usePendingBlocks';
import { type SelectionTarget, useSelectionComment } from './useSelectionComment';

const styles = stylex.create({
  root: { minHeight: '100%', backgroundColor: cssVar.colorBgContainer, color: cssVar.colorText },
  quotaNotice: {
    paddingBlock: 12,
    paddingInline: 24,
    backgroundColor: cssVar.colorWarningBg,
    color: cssVar.colorWarningText,
    fontSize: 13,
    lineHeight: 1.6,
    fontFamily: cssVar.fontFamily,
  },
  message: {
    padding: 48,
    textAlign: 'center',
    color: cssVar.colorTextSecondary,
    fontFamily: cssVar.fontFamily,
    fontSize: 14,
  },
});
const historyNodes = [
  ...allNodes.filter(
    (node) =>
      !extraNodes.some(
        (extra) =>
          extra.getType() === ('getType' in node ? node.getType() : node.replace.getType()),
      ),
  ),
  ...extraNodes,
];

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

function useAssetBase(contentBase: string | undefined) {
  useEffect(() => {
    if (!contentBase) return;
    const base = document.createElement('base');
    base.href = contentBase;
    document.head.prepend(base);
    return () => base.remove();
  }, [contentBase]);
}

const IDLE_PLAYBACK: AgentPlaybackState = { playing: false, section: null };

export function DocumentView({
  id,
  transport,
  live,
  fallback,
  actions: barActions,
}: {
  id: string;
  transport: DocumentTransport;
  live: boolean;
  fallback?: ReactNode;
  actions?: ReactNode;
}) {
  const [meta, setMeta] = useState<DocumentMeta | null>(null);
  const [doc, setDoc] = useState<LoroDoc | null>(null);
  const [comments, setComments] = useState<CommentsFile>(emptyComments);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [streaming, setStreaming] = useState(false);
  const [agentActiveAt, setAgentActiveAt] = useState<number | undefined>(undefined);
  const [clockOffset, setClockOffset] = useState(0);
  const syncClock = useCallback((serverNow: number | undefined) => {
    if (serverNow !== undefined) setClockOffset(serverNow - Date.now());
  }, []);
  const [playback, setPlayback] = useState<AgentPlaybackState>(IDLE_PLAYBACK);
  const [offline, setOffline] = useState(false);
  const [quotaExceeded, setQuotaExceeded] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const historyVisible = historyOpen;
  const [editor, setEditor] = useState<LexicalEditor | null>(null);
  const [mainEl, setMainEl] = useState<HTMLElement | null>(null);
  const dark = usePrefersDark();
  const { artifact, channel } = transport;
  const canComment = true;
  const canEdit = true;
  const phone = useMedia(PHONE_QUERY);
  const [editing, setEditing] = useState(false);
  const editable = phone ? editing && canEdit : canEdit;

  const refreshMeta = useCallback(async () => {
    const next = await transport.meta();
    if (next) setMeta(next);
  }, [transport]);

  const preserveScroll = fallback != null;
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        await refreshMeta();
        const state = await transport.state();
        if (cancelled) return;
        const loro = new LoroDoc();
        loro.setRecordTimestamp(true);
        loro.setChangeMergeInterval(20);
        loro.import(decodeBase64(state.snapshot));
        setStreaming(Boolean(state.streaming));
        setAgentActiveAt(state.agentActiveAt);
        syncClock(state.now);
        setComments(state.comments ?? emptyComments());
        const scroll = preserveScroll
          ? { left: window.scrollX, top: window.scrollY, behavior: 'instant' as const }
          : null;
        setDoc(loro);
        // The editor binding fills its initially empty DOM after mounting.
        if (scroll)
          requestAnimationFrame(() => {
            if (!cancelled) window.scrollTo(scroll);
          });
      } catch (err) {
        if (!cancelled) setLoadError((err as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [transport, refreshMeta, syncClock, preserveScroll]);

  useEffect(
    () =>
      channel.subscribe((event) => {
        if (event.type === 'change') void refreshMeta();
        else if (event.type === 'doc-status') {
          setStreaming(event.streaming);
          setAgentActiveAt(event.agentActiveAt);
          syncClock(event.now);
        } else if (event.type === 'doc-comments') setComments(event.comments);
      }),
    [channel, refreshMeta, syncClock],
  );

  useEffect(() => {
    editor?.setEditable(editable && !historyVisible);
  }, [editor, editable, historyVisible]);
  useEffect(() => {
    if (!canEdit) setEditing(false);
  }, [canEdit]);
  const onState = useCallback(
    (state: DocumentState) => {
      setStreaming(Boolean(state.streaming));
      setAgentActiveAt(state.agentActiveAt);
      syncClock(state.now);
      if (state.comments) setComments(state.comments);
    },
    [syncClock],
  );

  useAssetBase(meta?.contentBase);
  useDocumentSelectionSync(editor, artifact, live && !historyVisible, transport.send);
  const dynamicHost = useMemo<DynamicHost>(
    () => ({ artifact, contentBase: meta?.contentBase ?? '', channel, send: transport.send }),
    [artifact, meta?.contentBase, channel, transport],
  );
  useEffect(() => {
    document.title = meta?.title || id;
  }, [meta?.title, id]);
  useTypeFavicon('document');
  const pendingBlocks = usePendingBlocks(editor);
  const now = useNow(pendingBlocks.count > 0 && !streaming);
  const activity = agentActivity({
    editing: playback.playing || streaming,
    pending: pendingBlocks.count,
    agentActiveAt,
    now: now + clockOffset,
  });
  const agentName = meta?.agent ?? 'Agent';
  const pendingProgress = useMemo<PendingProgress>(
    () => ({ nextKey: pendingBlocks.firstKey, agent: agentName, activity: activity.kind }),
    [pendingBlocks.firstKey, agentName, activity.kind],
  );

  const openComments = comments.threads.filter((thread) => thread.status === 'open').length;
  const [selection, clearSelection] = useSelectionComment(editor, mainEl);
  const closeHistory = useCallback(() => setHistoryOpen(false), []);
  const historyView = useDocumentHistory({
    doc,
    nodes: historyNodes,
    streaming,
    theme: dark ? 'dark' : 'light',
    title: meta?.title || id,
    open: historyVisible,
    onClose: closeHistory,
  });

  const send = useCallback(
    async (op: HumanOp) => {
      try {
        setComments(await transport.comment(op));
        return true;
      } catch {
        return false;
      }
    },
    [transport],
  );
  const actions = useMemo<ThreadActions>(
    () => ({
      reply: (threadId, text) => send({ op: 'reply', threadId, text }),
      edit: (threadId, messageId, text) => void send({ op: 'edit', threadId, messageId, text }),
      remove: (threadId, messageId) => void send({ op: 'delete', threadId, messageId }),
      resolve: (threadId) => void send({ op: 'resolve', threadId }),
      reopen: (threadId) => void send({ op: 'reopen', threadId }),
    }),
    [send],
  );

  const create = useCallback(
    (target: SelectionTarget, text: string) =>
      send({
        op: 'create',
        blockId: target.blockId,
        ...(target.blockIds ? { blockIds: target.blockIds } : {}),
        ...(target.textRanges ? { textRanges: target.textRanges } : {}),
        quote: target.quote,
        text,
      }),
    [send],
  );
  const startEditing = useCallback(
    (target: SelectionTarget) => {
      if (!editor) return;
      editor.setEditable(true);
      setEditing(true);
      editor.getRootElement()?.focus({ preventScroll: true });
      const dom = window.getSelection();
      dom?.removeAllRanges();
      dom?.addRange(target.range);
    },
    [editor],
  );

  if (loadError) return <div {...stylex.props(styles.message)}>{loadError}</div>;
  if (!doc) return fallback ?? <div {...stylex.props(styles.message)}>{t('common.loading')}</div>;

  const editorView = (
    <DynamicHostContext.Provider value={dynamicHost}>
      <PendingContext.Provider value={pendingProgress}>
        <DocumentEditor
          agent={meta?.agent}
          doc={doc}
          theme={dark ? 'dark' : 'light'}
          transport={transport}
          onAgentPlayback={setPlayback}
          onEditorReady={setEditor}
          onOffline={setOffline}
          onQuotaExceeded={setQuotaExceeded}
          onState={onState}
        />
      </PendingContext.Provider>
    </DynamicHostContext.Provider>
  );

  return (
    <div
      {...stylex.props(styles.root)}
      className={`anjian-doc ${stylex.props(styles.root).className ?? ''}`}
    >
      <TopBar
        actions={barActions}
        activity={activity}
        agent={meta?.agent}
        agentSection={playback.section}
        compact={phone}
        id={id}
        offline={offline && !quotaExceeded}
        openComments={openComments}
        history={{
          available: true,
          open: historyVisible,
          toggle: () => setHistoryOpen((open) => !open),
          close: closeHistory,
        }}
        onDone={phone && editing ? () => setEditing(false) : undefined}
      />
      {quotaExceeded && (
        <div role="alert" {...stylex.props(styles.quotaNotice)}>
          <strong>{t('document.quotaExceeded')}</strong>{' '}
          {t('document.quotaRecovery')}
        </div>
      )}
      {phone ? (
        <PhoneLayout
          actions={actions}
          agent={meta?.agent}
          canComment={canComment}
          canEdit={canEdit}
          clearSelection={clearSelection}
          editor={editor}
          history={historyView}
          offline={false}
          selection={editing ? null : selection}
          threads={comments.threads}
          onCreate={create}
          onEdit={startEditing}
          onMain={setMainEl}
        >
          {editorView}
        </PhoneLayout>
      ) : (
        <DesktopDocument
          actions={actions}
          agent={meta?.agent}
          canComment={canComment}
          clearSelection={clearSelection}
          editor={editor}
          history={historyView}
          selection={selection}
          threads={comments.threads}
          onCreate={create}
          onMain={setMainEl}
        >
          {editorView}
        </DesktopDocument>
      )}
      <WarningsBadge warnings={meta?.warnings ?? []} />
    </div>
  );
}
