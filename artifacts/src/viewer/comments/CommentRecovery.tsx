import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { FileUp } from 'lucide-react';
import { useId, useRef, useState } from 'react';

import type { CommentsFile } from '../../shared/comments';
import { useTranslation } from '../i18n';

type RecoveryArtifact = 'document' | 'artboard' | 'slides' | 'storyboard' | 'whiteboard';
interface CommentRecoveryPreview {
  backup: CommentsFile<unknown>;
  revision: string;
}

const styles = stylex.create({
  button: {
    position: 'relative',
    display: 'grid',
    placeItems: 'center',
    width: 36,
    height: 36,
    flexShrink: 0,
    border: 0,
    borderRadius: 6,
    backgroundColor: { 'default': 'transparent', ':hover': cssVar.colorFillTertiary },
    color: cssVar.colorText,
    cursor: 'pointer',
  },
  compact: { width: 44, height: 44 },
  dot: {
    position: 'absolute',
    insetBlockStart: 5,
    insetInlineEnd: 6,
    width: 6,
    height: 6,
    borderRadius: '50%',
    backgroundColor: cssVar.colorWarning,
  },
  dialog: {
    boxSizing: 'border-box',
    width: 'min(32rem, calc(100% - 2rem))',
    maxHeight: 'min(42rem, calc(100dvh - 2rem))',
    padding: 20,
    border: '1px solid',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: 12,
    backgroundColor: cssVar.colorBgElevated,
    color: cssVar.colorText,
    fontFamily: cssVar.fontFamily,
    overflow: 'auto',
  },
  message: { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' },
  actions: { display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 16 },
  action: {
    minHeight: 44,
    paddingInline: 12,
    border: '1px solid',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: 6,
    backgroundColor: { 'default': cssVar.colorBgContainer, ':hover': cssVar.colorFillTertiary },
    color: cssVar.colorText,
    cursor: { 'default': 'pointer', ':disabled': 'default' },
  },
});

export function CommentRecovery<A>({
  id,
  type,
  compact,
  pending,
  onRestore,
}: {
  id: string;
  type: RecoveryArtifact;
  compact?: boolean;
  pending?: boolean;
  onRestore?: (comments: CommentsFile<A>) => void;
}) {
  const { t } = useTranslation();
  const heading = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const reviewRequest = useRef(0);
  const [preview, setPreview] = useState<CommentRecoveryPreview | null>(null);
  const [status, setStatus] = useState<
    'loading' | 'ready' | 'saving' | 'done' | 'failed' | 'importFailed'
  >('loading');

  async function post<Result>(action: string, body: BodyInit) {
    const response = await fetch(`/api/${type}/${encodeURIComponent(id)}/comments/${action}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
    if (!response.ok) throw new Error(`Comment recovery failed (${response.status})`);
    return (await response.json()) as Result;
  }

  async function open() {
    dialog.current?.showModal();
    const request = ++reviewRequest.current;
    setStatus('loading');
    setPreview(null);
    try {
      const { recovery } = await post<{ recovery: CommentRecoveryPreview | null }>(
        'recovery/review',
        '{}',
      );
      if (request !== reviewRequest.current) return;
      setPreview(recovery);
      setStatus('ready');
    } catch {
      if (request === reviewRequest.current) setStatus('failed');
    }
  }

  async function restore(action: string, body: BodyInit, failure: 'failed' | 'importFailed') {
    setStatus('saving');
    try {
      const { comments } = await post<{ comments: CommentsFile<A> }>(action, body);
      onRestore?.(comments);
      setPreview(null);
      setStatus('done');
    } catch {
      setStatus(failure);
    }
  }

  return (
    <>
      <button
        aria-haspopup="dialog"
        aria-label={t(pending ? 'comments.pendingRecovery' : 'comments.restoreBackup')}
        title={t(pending ? 'comments.pendingRecovery' : 'comments.restoreBackup')}
        type="button"
        onClick={() => void open()}
        {...stylex.props(styles.button, compact === true && styles.compact)}
      >
        <FileUp aria-hidden="true" size={17} />
        {pending && <span aria-hidden="true" {...stylex.props(styles.dot)} />}
      </button>
      <dialog
        aria-labelledby={heading}
        ref={dialog}
        onCancel={(event) => {
          if (status === 'saving') event.preventDefault();
        }}
        {...stylex.props(styles.dialog)}
      >
        <h2 id={heading}>{t('comments.restoreBackup')}</h2>
        {type === 'artboard' && <p>{t('comments.reviewRecordsRecovery')}</p>}
        <div role="status">
          {status === 'loading' && t('common.loading')}
          {status === 'ready' && !preview && t('comments.noPendingRecovery')}
          {status === 'saving' && t('comments.restoringBackup')}
          {status === 'done' && t('comments.backupRestored')}
          {status === 'failed' && t('comments.recoveryFailed')}
          {status === 'importFailed' && t('comments.backupRestoreFailed')}
        </div>
        {status === 'ready' && preview && (
          <>
            <p>{t('comments.reviewPendingRecovery')}</p>
            <ul>
              {preview.backup.threads.flatMap((thread) =>
                thread.messages.map((message) => (
                  <li key={thread.id + ':' + message.id} {...stylex.props(styles.message)}>
                    <strong>{message.name || t('comments.recoveryAnonymousAuthor')}</strong>
                    {' · '}
                    <time dateTime={message.editedAt ?? message.at}>
                      {new Date(message.editedAt ?? message.at).toLocaleString()}
                    </time>
                    <p>{message.deleted ? t('common.deleted') : message.text}</p>
                  </li>
                )),
              )}
            </ul>
          </>
        )}
        <div {...stylex.props(styles.actions)}>
          {status === 'ready' && preview ? (
            <button
              type="button"
              {...stylex.props(styles.action)}
              onClick={() =>
                void restore(
                  'recovery/apply',
                  JSON.stringify({ revision: preview.revision }),
                  'failed',
                )
              }
            >
              {t('comments.applyPendingRecovery')}
            </button>
          ) : null}
          <button
            type="button"
            {...stylex.props(styles.action)}
            disabled={status === 'saving'}
            onClick={() => input.current?.click()}
          >
            {t('comments.importBackupFile')}
          </button>
          <button
            type="button"
            {...stylex.props(styles.action)}
            disabled={status === 'saving'}
            onClick={() => dialog.current?.close()}
          >
            {t(status === 'done' ? 'common.close' : 'common.cancel')}
          </button>
        </div>
        <input
          hidden
          accept=".json,application/json"
          ref={input}
          type="file"
          onChange={(event) => {
            const backup = event.currentTarget.files?.[0];
            event.currentTarget.value = '';
            if (backup) void restore('restore', backup, 'importFailed');
          }}
        />
      </dialog>
    </>
  );
}
