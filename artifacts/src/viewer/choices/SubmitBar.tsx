import * as stylex from '@stylexjs/stylex';
import { useState } from 'react';

import type { RoundFeedback } from '../feedback/useRoundFeedback';
import type { RoundSummary } from '../hooks/useChoices';
import { useTranslation } from '../i18n';
import { brand, color } from '../tokens.stylex';

const styles = stylex.create({
  bar: {
    position: 'absolute',
    left: '50%',
    bottom: 20,
    transform: 'translateX(-50%)',
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    width: 'max-content',
    boxSizing: 'border-box',
    maxWidth: 'calc(100% - 32px)',
    minHeight: 44,
    paddingBlock: 6,
    flexWrap: 'wrap',
    paddingInlineStart: 16,
    paddingInlineEnd: 6,
    borderRadius: 12,
    backgroundColor: color.overlay,
    color: color.overlayText,
    boxShadow: `0 8px 24px ${color.overlayShadow}`,
    fontSize: 13,
    whiteSpace: 'normal',
    zIndex: 10,
  },
  title: { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 220 },
  rule: { width: 1, height: 16, flexShrink: 0, backgroundColor: color.overlayActive },
  dim: { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', opacity: 0.65 },
  primary: {
    height: 32,
    flexShrink: 0,
    paddingInline: 14,
    borderWidth: 0,
    borderRadius: 8,
    backgroundColor: { 'default': brand.accent, ':hover': brand.accentStrong },
    color: color.onStrong,
    fontFamily: 'inherit',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
  },
  quiet: {
    height: 32,
    flexShrink: 0,
    paddingInline: 10,
    borderWidth: 0,
    borderRadius: 8,
    backgroundColor: { 'default': 'transparent', ':hover': color.overlayActive },
    color: 'inherit',
    fontFamily: 'inherit',
    fontSize: 13,
    cursor: 'pointer',
  },
});

const clock = (time: string, locale: string) =>
  new Date(time).toLocaleTimeString(locale, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

interface Props {
  agent?: string;
  bottom?: number;
  canAct: boolean;
  feedback?: RoundFeedback;
  listening: boolean;
  onSubmit: () => void;
  onWithdraw: () => void;
  summary: RoundSummary;
}

export function SubmitBar({ summary, feedback, bottom, canAct, onSubmit, onWithdraw }: Props) {
  const { t, i18n } = useTranslation();
  const [confirmCancel, setConfirmCancel] = useState(false);
  const place = bottom === undefined ? undefined : { bottom, pointerEvents: 'auto' as const };
  const list = (groups: string[]) => groups.join(', ');
  if (feedback && feedback.mode !== 'legacy') {
    const task = feedback.taskFor(summary.round.id);
    const round = feedback.rounds.find((item) => item.id === summary.round.id);
    const target = feedback.connections.find((connection) => connection.id === feedback.target);
    const retry = feedback.intent?.round.id === summary.round.id;
    const blocked = feedback.mode === 'blocked';
    const canSubmit =
      canAct &&
      !feedback.busy &&
      !blocked &&
      !task &&
      (retry ||
        (!feedback.intent && !feedback.error && round?.state === 'open' && target?.authorized));
    return (
      <div data-submit-bar data-chrome="submit-bar" {...stylex.props(styles.bar)} style={place}>
        <span {...stylex.props(styles.title)}>
          {summary.round.title || t('feedback.roundTitle')}
        </span>
        {task ? (
          <strong>
            {t(`feedback.states.${task.needsRecovery ? 'needs_attention' : task.state}`)}
          </strong>
        ) : (
          <span>{t('choices.chosen', { count: summary.chosen, total: summary.total })}</span>
        )}
        {!task && feedback.connections.length > 1 ? (
          <select
            aria-label={t('feedback.target')}
            disabled={feedback.busy || !!feedback.intent}
            value={feedback.target}
            onChange={(event) => feedback.setTarget(event.target.value)}
          >
            <option value="">{t('feedback.chooseTarget')}</option>
            {feedback.connections.map((connection) => (
              <option disabled={!connection.authorized} key={connection.id} value={connection.id}>
                {connection.displayName}
              </option>
            ))}
          </select>
        ) : (
          target && (
            <span {...stylex.props(styles.dim)}>
              {target.displayName} ·{' '}
              {t(
                !target.authorized
                  ? 'feedback.unauthorized'
                  : target.enabled
                    ? 'feedback.configured'
                    : 'feedback.paused',
              )}
            </span>
          )
        )}
        {blocked && !feedback.error && <span>{t('feedback.checkingConnection')}</span>}
        {feedback.error && <span role="alert">{t(`feedback.errors.${feedback.error}`)}</span>}
        {feedback.error && (
          <button
            type="button"
            {...stylex.props(styles.quiet)}
            disabled={feedback.busy}
            onClick={() => void feedback.refresh()}
          >
            {t('feedback.refresh')}
          </button>
        )}
        {!task && (
          <button
            type="button"
            {...stylex.props(styles.primary)}
            disabled={!canSubmit}
            onClick={onSubmit}
          >
            {t(retry ? 'feedback.retrySubmission' : 'feedback.submit')}
          </button>
        )}
        {!task && !blocked && round?.state === 'submitted' && (
          <span>{t('feedback.roundAlreadySubmitted')}</span>
        )}
        {task && <span {...stylex.props(styles.dim)}>{t('feedback.roundResultHint')}</span>}
        {task && ['queued', 'running', 'needs_attention'].includes(task.state) && (
          <button
            type="button"
            {...stylex.props(styles.quiet)}
            disabled={feedback.busy}
            onClick={() => setConfirmCancel(true)}
          >
            {t('feedback.cancelTask')}
          </button>
        )}
        {confirmCancel && task && (
          <div aria-label={t('feedback.cancelTask')} role="group">
            <span>{t('feedback.cancelHint')}</span>
            <button
              type="button"
              {...stylex.props(styles.quiet)}
              disabled={feedback.busy}
              onClick={async () => {
                await feedback.cancel(task.id);
                setConfirmCancel(false);
              }}
            >
              {t('feedback.confirmCancel')}
            </button>
            <button
              type="button"
              {...stylex.props(styles.quiet)}
              onClick={() => setConfirmCancel(false)}
            >
              {t('common.cancel')}
            </button>
          </div>
        )}
      </div>
    );
  }
  if (summary.state === 'submitted')
    return (
      <div data-submit-bar data-chrome="submit-bar" {...stylex.props(styles.bar)} style={place}>
        <span>
          {summary.submittedAt
            ? t('choices.submittedAt', { time: clock(summary.submittedAt, i18n.language) })
            : t('choices.submitted')}
        </span>
        <span {...stylex.props(styles.dim)}>{t('choices.sayDone')}</span>
        {canAct && (
          <button type="button" onClick={onWithdraw} {...stylex.props(styles.quiet)}>
            {t('choices.withdraw')}
          </button>
        )}
      </div>
    );
  const notes = [
    summary.comments ? t('choices.comments', { count: summary.comments }) : '',
    summary.byRecommendation.length
      ? t('choices.byRecommendation', { groups: list(summary.byRecommendation) })
      : '',
    summary.unanswered.length ? t('choices.unanswered', { groups: list(summary.unanswered) }) : '',
  ].filter(Boolean);
  return (
    <div data-submit-bar data-chrome="submit-bar" {...stylex.props(styles.bar)} style={place}>
      {summary.round.title && <span {...stylex.props(styles.title)}>{summary.round.title}</span>}
      {summary.round.title && <span {...stylex.props(styles.rule)} />}
      <span>{t('choices.chosen', { count: summary.chosen, total: summary.total })}</span>
      {notes.length > 0 && <span {...stylex.props(styles.dim)}>{notes.join(' · ')}</span>}
      {canAct && (
        <button type="button" onClick={onSubmit} {...stylex.props(styles.primary)}>
          {t('choices.submit')}
        </button>
      )}
    </div>
  );
}
