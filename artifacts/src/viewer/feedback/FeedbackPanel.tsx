import * as stylex from '@stylexjs/stylex';
import { useState } from 'react';

import { useTranslation } from '../i18n';
import { type FeedbackTask, selectableInput } from './api';
import { useFeedbackEnabled } from './FeedbackProvider';
import { FeedbackTaskCard } from './FeedbackTaskCard';
import { styles } from './styles';
import { useFeedback } from './useFeedback';

export interface FeedbackPanelProps {
  artifact: string;
  onOpenThread?: (id: string) => void;
}

export function FeedbackPanel(props: FeedbackPanelProps) {
  return useFeedbackEnabled() ? <ConnectedFeedbackPanel {...props} /> : null;
}
function ConnectedFeedbackPanel({ artifact, onOpenThread }: FeedbackPanelProps) {
  const { t } = useTranslation();
  const feedback = useFeedback(artifact);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [copyState, setCopyState] = useState<'copied' | 'copyFailed' | null>(null);
  const eligible = feedback.input ? selectableInput(feedback.input) : [];
  const target = feedback.connections.find((connection) => connection.id === feedback.target);
  const button = stylex.props(styles.button);
  const tasks = [...feedback.tasks].sort((a, b) => b.createdAt - a.createdAt);
  const history = tasks.filter((task) => task.state === 'accepted' || task.state === 'cancelled');
  const active = tasks.filter((task) => task.state !== 'accepted' && task.state !== 'cancelled');
  const connectionGuide = t('feedback.connectionGuide', {
    artifact,
    origin: window.location.origin,
  });
  const openThread = (id: string) => {
    onOpenThread?.(id);
    requestAnimationFrame(() =>
      document
        .querySelector(`[data-thread="${CSS.escape(id)}"]`)
        ?.scrollIntoView({ block: 'center', behavior: 'smooth' }),
    );
  };
  const card = (task: FeedbackTask) => (
    <FeedbackTaskCard
      artifact={artifact}
      busy={feedback.busy}
      key={task.id}
      task={task}
      targetName={
        feedback.connections.find((connection) => connection.id === task.connectionId)
          ?.displayName ?? t('feedback.previousConnection')
      }
      onAction={feedback.act}
      onOpenThread={openThread}
    />
  );
  return (
    <section aria-label={t('feedback.title')} {...stylex.props(styles.root)}>
      <strong>{t('feedback.title')}</strong>
      {feedback.error && (
        <div role="alert" {...stylex.props(styles.error)}>
          {t(`feedback.errors.${feedback.error}`)}{' '}
          <button type="button" {...button} disabled={feedback.busy} onClick={feedback.refresh}>
            {t('feedback.refresh')}
          </button>
        </div>
      )}
      {feedback.notice && (
        <p role="status" {...stylex.props(styles.secondary)}>
          {t(`feedback.${feedback.notice}`)}
        </p>
      )}
      {!feedback.loaded ? (
        <p {...stylex.props(styles.secondary)}>{t('common.loading')}</p>
      ) : feedback.connections.length === 0 ? (
        <div {...stylex.props(styles.stack)}>
          <p {...stylex.props(styles.secondary)}>{t('feedback.notConnected')}</p>
          <button
            type="button"
            {...button}
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(connectionGuide);
                setCopyState('copied');
              } catch {
                setCopyState('copyFailed');
              }
            }}
          >
            {t('feedback.copyGuide')}
          </button>
          {copyState && <p role="status">{t(`feedback.${copyState}`)}</p>}
          <details>
            <summary>{t('feedback.connectHelp')}</summary>
            <textarea
              readOnly
              aria-label={t('feedback.connectHelp')}
              rows={7}
              value={connectionGuide}
              {...stylex.props(styles.guide)}
            />
          </details>
        </div>
      ) : (
        <div {...stylex.props(styles.stack)}>
          <label>
            {t('feedback.target')}
            <select
              {...stylex.props(styles.select)}
              disabled={feedback.busy || !!feedback.intent}
              value={feedback.target}
              onChange={(event) => feedback.setTarget(event.target.value)}
            >
              <option value="">{t('feedback.chooseTarget')}</option>
              {feedback.connections.map((connection) => (
                <option disabled={!connection.authorized} key={connection.id} value={connection.id}>
                  {connection.displayName} ·{' '}
                  {t(
                    !connection.authorized
                      ? 'feedback.unauthorized'
                      : connection.enabled
                        ? 'feedback.configured'
                        : 'feedback.paused',
                  )}
                </option>
              ))}
            </select>
          </label>
          <strong>{t('feedback.selectThreads')}</strong>
          {eligible.length === 0 && (
            <p {...stylex.props(styles.secondary)}>{t('feedback.noThreads')}</p>
          )}
          <div {...stylex.props(styles.list)}>
            {eligible.map((selection) => {
              const thread = feedback.input?.threads.find((item) => item.id === selection.threadId);
              return (
                <label key={selection.threadId} {...stylex.props(styles.label)}>
                  <input
                    checked={feedback.selected.includes(selection.threadId)}
                    disabled={feedback.busy || !!feedback.intent}
                    type="checkbox"
                    onChange={(event) =>
                      feedback.setSelected((current) =>
                        event.target.checked
                          ? [...current, selection.threadId]
                          : current.filter((id) => id !== selection.threadId),
                      )
                    }
                  />
                  <span>{thread?.messages.find((message) => !message.deleted)?.text}</span>
                </label>
              );
            })}
          </div>
          {feedback.intent && (
            <p role="status" {...stylex.props(styles.secondary)}>
              {t('feedback.unknownSubmission')}
            </p>
          )}
          <button
            type="button"
            {...stylex.props(styles.button, styles.primary)}
            disabled={
              feedback.busy ||
              (!feedback.intent &&
                (!target?.authorized ||
                  !eligible.some((s) => feedback.selected.includes(s.threadId))))
            }
            onClick={() => void feedback.submit()}
          >
            {t(feedback.intent ? 'feedback.retrySubmission' : 'feedback.submit')}
          </button>
          {artifact.startsWith('artboard/') && (
            <p {...stylex.props(styles.secondary)}>{t('feedback.roundHint')}</p>
          )}
          <details>
            <summary>{t('feedback.manage')}</summary>
            <div {...stylex.props(styles.stack)}>
              {feedback.connections.map((connection) => (
                <div key={connection.id}>
                  <strong>{connection.displayName}</strong>
                  <p {...stylex.props(styles.secondary)}>
                    {t('feedback.scope', { count: connection.artifacts.length })}
                  </p>
                  <button
                    type="button"
                    {...button}
                    disabled={feedback.busy || !connection.authorized}
                    onClick={() => void feedback.pause(connection.id, connection.enabled)}
                  >
                    {t(connection.enabled ? 'feedback.pause' : 'feedback.resume')}
                  </button>
                </div>
              ))}
              <p {...stylex.props(styles.secondary)}>{t('feedback.pauseHint')}</p>
            </div>
          </details>
        </div>
      )}
      {active.length > 0 && <div {...stylex.props(styles.stack)}>{active.map(card)}</div>}
      {history.length > 0 && (
        <div {...stylex.props(styles.stack)}>
          <button
            type="button"
            {...button}
            aria-expanded={historyOpen}
            onClick={() => setHistoryOpen((value) => !value)}
          >
            {t(historyOpen ? 'feedback.hideHistory' : 'feedback.showHistory', {
              count: history.length,
            })}
          </button>
          {historyOpen && history.map(card)}
        </div>
      )}
    </section>
  );
}
