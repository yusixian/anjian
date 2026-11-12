import * as stylex from '@stylexjs/stylex';
import { useEffect, useState } from 'react';

import { useTranslation } from '../i18n';
import { type FeedbackTask } from './api';
import { useFeedbackApi } from './FeedbackProvider';
import { styles } from './styles';

export function FeedbackTaskCard({
  artifact,
  task,
  targetName,
  busy,
  onAction,
  onOpenThread,
}: {
  artifact: string;
  task: FeedbackTask;
  targetName: string;
  busy: boolean;
  onAction: (id: string, action: 'accept' | 'retry' | 'cancel') => Promise<void>;
  onOpenThread: (id: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const api = useFeedbackApi(artifact);
  const [detail, setDetail] = useState<FeedbackTask | null>(null);
  const [resultOpen, setResultOpen] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    void api
      .task(task.id)
      .then(({ task: next }) => {
        if (active) {
          setDetail(next);
          setFailed(false);
        }
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, [api, task.id, task.state, task.attempt, task.outputRevision, retry]);
  const summary = detail?.threads
    ?.flatMap((thread) =>
      thread.messages
        .filter((message) => !message.deleted)
        .slice(0, 1)
        .map((message) => message.text),
    )
    .join(' · ');
  const button = stylex.props(styles.button);
  return (
    <article {...stylex.props(styles.task)}>
      <div {...stylex.props(styles.row)}>
        <strong>
          {t(`feedback.states.${task.needsRecovery ? 'needs_attention' : task.state}`)}
        </strong>
        <span>{targetName}</span>
        <time dateTime={new Date(task.createdAt).toISOString()} {...stylex.props(styles.secondary)}>
          {new Date(task.createdAt).toLocaleString(i18n.language, {
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          })}
        </time>
      </div>
      <p {...stylex.props(styles.summary)}>
        {detail?.roundContext?.title ||
          (task.roundId
            ? detail?.roundContext
              ? t('feedback.roundSummary', { count: detail.roundContext.groups.length })
              : t('feedback.roundTitle')
            : summary) ||
          t('feedback.taskSummary')}
      </p>
      {task.state === 'queued' && (
        <p {...stylex.props(styles.secondary)}>{t('feedback.queuedHint')}</p>
      )}
      {task.needsRecovery && <p {...stylex.props(styles.error)}>{t('feedback.recoveryHint')}</p>}
      {task.state === 'awaiting_review' && (
        <p {...stylex.props(styles.secondary)}>{t('feedback.readyHint')}</p>
      )}
      {failed && (
        <p role="alert">
          {t('feedback.detailFailed')}{' '}
          <button type="button" {...button} onClick={() => setRetry((value) => value + 1)}>
            {t('feedback.refresh')}
          </button>
        </p>
      )}
      <div {...stylex.props(styles.row)}>
        {(task.outputRevision || task.state === 'awaiting_review' || task.state === 'accepted') && (
          <button
            type="button"
            {...button}
            aria-expanded={resultOpen}
            onClick={() => setResultOpen((value) => !value)}
          >
            {t(resultOpen ? 'feedback.closeResult' : 'feedback.viewResult')}
          </button>
        )}
        {task.state === 'awaiting_review' && (
          <button
            type="button"
            {...button}
            disabled={busy}
            onClick={() => void onAction(task.id, 'accept')}
          >
            {t('feedback.accept')}
          </button>
        )}
        {(task.needsRecovery || task.state === 'queued') && (
          <button
            type="button"
            {...button}
            disabled={busy}
            onClick={() => void onAction(task.id, 'retry')}
          >
            {t('feedback.retry')}
          </button>
        )}
        {['queued', 'running', 'needs_attention'].includes(task.state) && (
          <button type="button" {...button} disabled={busy} onClick={() => setConfirmCancel(true)}>
            {t('feedback.cancelTask')}
          </button>
        )}
      </div>
      {confirmCancel && (
        <div aria-label={t('feedback.cancelTask')} role="group" {...stylex.props(styles.stack)}>
          <p>{t('feedback.cancelHint')}</p>
          <div {...stylex.props(styles.row)}>
            <button
              type="button"
              {...button}
              disabled={busy}
              onClick={async () => {
                await onAction(task.id, 'cancel');
                setConfirmCancel(false);
              }}
            >
              {t('feedback.confirmCancel')}
            </button>
            <button type="button" {...button} onClick={() => setConfirmCancel(false)}>
              {t('common.cancel')}
            </button>
          </div>
        </div>
      )}
      {resultOpen && (
        <div {...stylex.props(styles.stack)}>
          <p {...stylex.props(styles.secondary)}>{t('feedback.resultHint')}</p>
          {detail?.roundContext && (
            <div>
              <strong>{t('feedback.roundSelection')}</strong>
              <ul>
                {detail.roundContext.groups.map((group) => (
                  <li key={group.id}>
                    {group.title || group.id}:{' '}
                    {group.choice
                      ? detail.roundContext?.canvas?.boards[group.choice]?.title || group.choice
                      : t('feedback.unanswered')}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {detail?.operation?.replies?.map((reply) => (
            <div key={reply.messageId}>
              <p {...stylex.props(styles.reply)}>{reply.text}</p>
              <button type="button" {...button} onClick={() => onOpenThread(reply.threadId)}>
                {t('feedback.originalThread')}
              </button>
            </div>
          ))}
          {!detail && !failed ? (
            <p>{t('common.loading')}</p>
          ) : (
            !detail?.operation?.replies?.length && (
              <p>{t(task.roundId ? 'feedback.roundNoReplies' : 'feedback.noReplies')}</p>
            )
          )}
        </div>
      )}
      <details {...stylex.props(styles.secondary)}>
        <summary>{t('feedback.diagnostics')}</summary>
        <dl {...stylex.props(styles.code)}>
          <dt>{t('feedback.taskId')}</dt>
          <dd>{task.id}</dd>
          <dt>{t('feedback.inputRevision')}</dt>
          <dd>{task.inputRevision}</dd>
          {task.outputRevision && (
            <>
              <dt>{t('feedback.revision')}</dt>
              <dd>{task.outputRevision}</dd>
            </>
          )}
          {task.errorCode && (
            <>
              <dt>{t('feedback.errorCode')}</dt>
              <dd>{task.errorCode}</dd>
            </>
          )}
        </dl>
      </details>
    </article>
  );
}
