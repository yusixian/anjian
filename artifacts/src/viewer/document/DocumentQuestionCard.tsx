import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { nanoid } from 'nanoid';
import { useId, useRef, useState } from 'react';

import { type DocumentQuestion, sameDocumentQuestion } from '../../shared/document-questions';
import { FeedbackError, type QuestionMutation } from '../feedback/api';
import { styles as feedback } from '../feedback/styles';
import { useTranslation } from '../i18n';
import { useDocumentQuestions } from './DocumentQuestions';

const styles = stylex.create({
  card: {
    marginBlock: 16,
    padding: 16,
    display: 'grid',
    gap: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: cssVar.colorBorderSecondary,
    backgroundColor: cssVar.colorBgContainer,
    color: cssVar.colorText,
    fontFamily: cssVar.fontFamily,
    fontSize: 14,
    lineHeight: 1.5,
    overflowWrap: 'anywhere',
  },
  prompt: { fontSize: 16, whiteSpace: 'pre-wrap' },
  choices: { display: 'grid', gap: 4 },
  option: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    minHeight: { 'default': 32, '@media (max-width: 640px)': 44 },
  },
  hint: { color: cssVar.colorTextSecondary, fontSize: 13 },
});

export function DocumentQuestionCard({ definition }: { definition: DocumentQuestion }) {
  const { t } = useTranslation();
  const store = useDocumentQuestions();
  const group = useId();
  const snapshot = store?.items.find((entry) => entry.id === definition.id);
  const item = snapshot && sameDocumentQuestion(definition, snapshot.definition) ? snapshot : null;
  const [edit, setEdit] = useState<{ value: string; version: string } | null>(null);
  const [target, setTarget] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const intent = useRef<QuestionMutation | null>(null);
  const previous = item?.previousDefinition;
  const previousAnswer = previous?.options?.find((option) => option.id === item?.answer)?.label;
  const value = edit?.value ?? (previous ? '' : item?.answer) ?? '';
  const dirty = edit !== null;
  const conflict = dirty && item && edit.version !== item.version;
  const task = item?.task;
  const locked = !!task && task.state !== 'cancelled';
  const connections = store?.connections.filter((c) => c.enabled && c.authorized) ?? [];
  const connectionId =
    connections.find((c) => c.id === target)?.id ??
    (connections.length === 1 ? (connections[0]?.id ?? '') : '');
  const valid = definition.options
    ? definition.options.some((o) => o.id === value)
    : !!value.trim();
  function change(next: string) {
    if (!item) return;
    setEdit({ value: next, version: edit?.version ?? item.version });
    intent.current = null;
    setNotice('');
  }
  async function act(action: QuestionMutation['action']) {
    if (!store || !item || busy || (conflict && action !== 'withdraw')) return;
    setBusy(true);
    setNotice('');
    const request: QuestionMutation = { id: definition.id, version: item.version, action };
    if (action !== 'withdraw') request.answer = value;
    if (action === 'submit') {
      request.connectionId = connectionId;
      const last = intent.current;
      request.submissionKey =
        last &&
        last.answer === value &&
        last.connectionId === connectionId &&
        last.version === item.version
          ? last.submissionKey
          : nanoid();
      intent.current = request;
    }
    try {
      await store.mutate(request);
      if (action !== 'withdraw') setEdit(null);
      intent.current = null;
      setNotice(action === 'draft' ? 'question.saved' : '');
    } catch (error) {
      setNotice(
        error instanceof FeedbackError && error.status === 409
          ? 'question.changed'
          : 'question.failed',
      );
      await store.refresh();
    } finally {
      setBusy(false);
    }
  }
  const button = stylex.props(feedback.button);
  return (
    <section aria-labelledby={group} contentEditable={false} {...stylex.props(styles.card)}>
      <strong id={group} {...stylex.props(styles.prompt)}>
        {definition.prompt}
      </strong>
      {definition.options && (
        <div
          aria-labelledby={group}
          role={store ? 'radiogroup' : 'group'}
          {...stylex.props(styles.choices)}
        >
          {definition.options.map((option) => (
            <label key={option.id} {...stylex.props(styles.option)}>
              {store && (
                <input
                  checked={option.id === value}
                  disabled={!item || locked || busy}
                  name={group}
                  type="radio"
                  value={option.id}
                  onChange={() => change(option.id)}
                />
              )}
              <span>{option.label}</span>
              {definition.recommended === option.id && (
                <small {...stylex.props(styles.hint)}>{t('question.recommended')}</small>
              )}
            </label>
          ))}
        </div>
      )}
      {store && (
        <>
          {!definition.options && (
            <textarea
              {...stylex.props(feedback.guide)}
              aria-labelledby={group}
              disabled={!item || busy || locked}
              maxLength={4000}
              placeholder={t('question.placeholder')}
              rows={3}
              value={value}
              onChange={(e) => change(e.target.value)}
            />
          )}
          {previous && (
            <div {...stylex.props(styles.hint)}>
              <div>{t('question.previous')}</div>
              <div>{previousAnswer ?? item?.answer}</div>
            </div>
          )}
          {task && (
            <div role="status">
              <strong>{t('feedback.states.' + task.state)}</strong>
              {task.reply && <div {...stylex.props(feedback.reply)}>{task.reply}</div>}
            </div>
          )}
          {conflict && (
            <div {...stylex.props(feedback.stack)}>
              <span>
                {t('question.conflict', {
                  answer:
                    previousAnswer ??
                    (previous
                      ? undefined
                      : definition.options?.find((o) => o.id === item.answer)?.label) ??
                    (item.answer || t('question.empty')),
                })}
              </span>
              <div {...stylex.props(feedback.row)}>
                <button type="button" {...button} onClick={() => setEdit(null)}>
                  {t('question.restore')}
                </button>
                <button
                  type="button"
                  {...button}
                  onClick={() => setEdit({ ...edit, version: item.version })}
                >
                  {t('question.keep')}
                </button>
              </div>
            </div>
          )}
          {!locked && (
            <>
              {connections.length > 1 && (
                <select
                  {...stylex.props(feedback.select)}
                  aria-label={t('question.target')}
                  value={connectionId}
                  onChange={(e) => setTarget(e.target.value)}
                >
                  <option value="">{t('question.target')}</option>
                  {connections.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.displayName}
                    </option>
                  ))}
                </select>
              )}
              <div {...stylex.props(feedback.row)}>
                <button
                  type="button"
                  {...button}
                  disabled={!item || !dirty || busy || !!conflict}
                  onClick={() => void act('draft')}
                >
                  {t('question.save')}
                </button>
                <button
                  type="button"
                  {...stylex.props(feedback.button, feedback.primary)}
                  disabled={!item || !valid || busy || !!conflict || !connectionId}
                  onClick={() => void act('submit')}
                >
                  {t('question.submit', {
                    agent: connections.find((c) => c.id === connectionId)?.displayName ?? 'Agent',
                  })}
                </button>
              </div>
              {item && !connections.length && (
                <small {...stylex.props(styles.hint)}>{t('question.noAgent')}</small>
              )}
            </>
          )}
          {task?.withdrawable && (
            <div>
              <button
                type="button"
                {...button}
                disabled={busy}
                onClick={() => void act('withdraw')}
              >
                {t('question.withdraw')}
              </button>
            </div>
          )}
          {snapshot && !item && <span role="status">{t('question.syncing')}</span>}
          {notice && <span role="status">{t(notice)}</span>}
          {store.failed && (
            <div role="status" {...stylex.props(feedback.row)}>
              {t('question.loadFailed')}{' '}
              <button type="button" {...button} onClick={() => void store.refresh()}>
                {t('question.reload')}
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
