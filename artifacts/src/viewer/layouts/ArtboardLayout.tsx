import { ActionIcon } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { Move } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';

import { type ArtboardMove, applyArtboardPositions } from '../../shared/artboard-positions';
import { computeLayout } from '../../shared/geometry';
import { CommentRecovery } from '../comments/CommentRecovery';
import { LibraryNavigation } from '../components/LibraryNavigation';
import { ShareButton } from '../components/ShareButton';
import { FeedbackProvider } from '../feedback/FeedbackProvider';
import { feedbackApi } from '../feedback/localApi';
import { useLocalFeed } from '../hooks/useArtifactFeed';
import { useCanvasData } from '../hooks/useCanvasData';
import { t } from '../i18n';
import { ArtboardView } from './ArtboardView';

const styles = stylex.create({
  status: {
    position: 'fixed',
    top: 58,
    left: '50%',
    transform: 'translateX(-50%)',
    width: 'max-content',
    maxWidth: 'calc(100vw - 32px)',
    zIndex: 20,
    pointerEvents: 'none',
    backgroundColor: cssVar.colorBgContainer,
    color: cssVar.colorText,
    border: `1px solid ${cssVar.colorBorderSecondary}`,
    borderRadius: 8,
    margin: 0,
    padding: '6px 10px',
    fontFamily: cssVar.fontFamily,
    fontSize: 12,
  },
});

export function ArtboardLayout({ id }: { id: string }) {
  const feed = useLocalFeed('artboard', id);
  const data = useCanvasData(feed);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<ArtboardMove | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const saving = useRef(false);
  const canvas = useMemo(() => data.canvas && draft
    ? applyArtboardPositions(data.canvas, {
        [`${draft.target.kind}/${draft.target.id}`]: {
          page: draft.expected.page, x: draft.x, y: draft.y,
        },
      })
    : data.canvas, [data.canvas, draft]);
  const layout = useMemo(() => canvas && draft ? computeLayout(canvas) : data.layout, [canvas, draft, data.layout]);

  async function save(move: ArtboardMove) {
    if (saving.current) return;
    saving.current = true;
    setDraft(move);
    setBusy(true);
    setStatus('artboardLayout.saving');
    try {
      const result = await fetch(`/api/artboard/${encodeURIComponent(id)}/positions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(move),
      });
      setStatus(result.ok ? 'artboardLayout.saved'
        : result.status === 409 ? 'artboardLayout.conflict' : 'artboardLayout.saveFailed');
    } catch {
      setStatus('artboardLayout.saveFailed');
    } finally {
      saving.current = false;
      setBusy(false);
      setDraft(null);
      feed.refresh();
    }
  }

  const toggle = editing ? t('artboardLayout.done') : t('artboardLayout.edit');
  return (
    <LibraryNavigation>
      <FeedbackProvider createApi={feedbackApi}>
        <ArtboardView
          {...data}
          artifact={`artboard/${id}`}
          canvas={canvas}
          id={id}
          layout={layout}
          positionEditor={editing ? { busy, preview: setDraft, save } : undefined}
          actions={
            <>
              <ActionIcon
                active={editing}
                aria-label={toggle}
                aria-pressed={editing}
                disabled={busy || !data.canvas || data.stale}
                icon={Move}
                size="small"
                title={toggle}
                onClick={() => {
                  setEditing(!editing);
                  setDraft(null);
                  setStatus(editing ? '' : 'artboardLayout.instructions');
                }}
              />
              <CommentRecovery
                preserveReviewRecords
                url={`/api/artboard/${encodeURIComponent(id)}/comments`}
              />
              <ShareButton id={id} type="artboard" />
            </>
          }
        />
        {status && <p {...stylex.props(styles.status)} role="status">{t(status)}</p>}
      </FeedbackProvider>
    </LibraryNavigation>
  );
}
