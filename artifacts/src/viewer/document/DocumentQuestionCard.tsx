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

const localHostNames = { agy: 'Antigravity', codex: 'Codex', dsh: 'DeepSeek Harness', pi: 'Pi' };

type AnswerMutation = Exclude<QuestionMutation, { action: 'decide' }>;

export function DocumentQuestionCard({ definition }: { definition: DocumentQuestion }) {
  const { t, i18n } = useTranslation();
  const store = useDocumentQuestions();
  const group = useId();
  const snapshot = store?.items.find((entry) => entry.id === definition.id);
  const item = snapshot && sameDocumentQuestion(definition, snapshot.definition) ? snapshot : null;
  const [edit, setEdit] = useState<{ value: string; version: string } | null>(null);
  const [pick, setPick] = useState<{
    assetsRevision: string;
    choice: string;
    revision: string;
    version: string;
    viewVersion: string;
  } | null>(null);
  const [target, setTarget] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const intent = useRef<AnswerMutation | null>(null);
  const isApproval = definition.approve !== undefined;
  const approval = item?.approval;
  const decision = approval?.decision;
  const currentRevision = approval?.currentRevision;
  const loadedAssetsRevision = store?.getAssetsRevision();
  const assetsMatch =
    !!loadedAssetsRevision && loadedAssetsRevision === approval?.currentAssetsRevision;
  const canDecide = !!currentRevision && assetsMatch && !busy;
  const pickedOption = assetsMatch
    ? definition.options?.find((option) => option.id === pick?.choice)
    : undefined;
  const previous = item?.previousDefinition;
  const previousAnswer = previous?.options?.find((option) => option.id === item?.answer)?.label;
  const value = edit?.value ?? (previous ? '' : item?.answer) ?? '';
  const dirty = edit !== null;
  const conflict = dirty && item && edit.version !== item.version;
  const task = item?.task;
  const localSubmission = item?.localSubmission;
  const locked = !!localSubmission || (!!task && task.state !== 'cancelled');
  const destinations = [
    ...(store?.localRecipients ?? []).map(({ host, id, label }) => ({
      key: `local:${id}`,
      name: t('question.localSession', { host: localHostNames[host], label }),
      recipient: { localRecipient: id },
    })),
    ...(store?.connections ?? [])
      .filter((c) => c.enabled && c.authorized)
      .map((c) => ({
        key: `lody:${c.id}`,
        name: c.displayName,
        recipient: { connectionId: c.id },
      })),
  ];
  const destination =
    destinations.find((item) => item.key === target) ??
    (!target && destinations.length === 1 ? destinations[0] : undefined);
  const valid = definition.options
    ? definition.options.some((o) => o.id === value)
    : !!value.trim();
  function change(next: string) {
    if (!item) return;
    setEdit({ value: next, version: edit?.version ?? item.version });
    intent.current = null;
    setNotice('');
  }
  function chooseApproval(choice: string) {
    const assetsRevision = store?.getAssetsRevision();
    const viewVersion = store?.getViewVersion();
    if (
      !item ||
      !viewVersion ||
      !currentRevision ||
      busy ||
      !assetsRevision ||
      assetsRevision !== approval?.currentAssetsRevision
    ) {
      return;
    }
    setPick({
      assetsRevision,
      choice,
      revision: currentRevision,
      version: item.version,
      viewVersion,
    });
    setNotice('');
  }
  async function decide() {
    if (!store || !item || !canDecide || !pick || !pickedOption) return;
    if (
      pick.assetsRevision !== store.getAssetsRevision() ||
      pick.assetsRevision !== approval?.currentAssetsRevision ||
      pick.revision !== currentRevision ||
      pick.version !== item.version ||
      pick.viewVersion !== store.getViewVersion()
    ) {
      setPick(null);
      setNotice('question.approvalChanged');
      await store.refresh();
      return;
    }
    setBusy(true);
    setNotice('');
    try {
      await store.mutate({
        id: definition.id,
        action: 'decide',
        answer: pick.choice,
        assetsRevision: pick.assetsRevision,
        revision: pick.revision,
        version: pick.version,
        viewVersion: pick.viewVersion,
      });
      setPick(null);
    } catch (error) {
      if (error instanceof FeedbackError && error.status === 409) {
        setPick(null);
        setNotice('question.approvalChanged');
      } else {
        setNotice('question.approvalFailed');
      }
      await store.refresh();
    } finally {
      setBusy(false);
    }
  }
  async function act(action: AnswerMutation['action']) {
    if (
      !store ||
      !item ||
      busy ||
      (action === 'submit' && !destination) ||
      (conflict && action !== 'withdraw')
    )
      return;
    setBusy(true);
    setNotice('');
    const request: AnswerMutation = { id: definition.id, version: item.version, action };
    if (action !== 'withdraw') request.answer = value;
    if (action === 'submit' && destination) {
      Object.assign(request, destination.recipient);
      const last = intent.current;
      request.submissionKey =
        last &&
        last.answer === value &&
        last.connectionId === request.connectionId &&
        last.localRecipient === request.localRecipient &&
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
        error instanceof FeedbackError && error.code === 'recipient_unavailable'
          ? 'question.recipientUnavailable'
          : error instanceof FeedbackError && error.status === 409
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
                  checked={option.id === (isApproval ? pickedOption?.id : value)}
                  disabled={isApproval ? !canDecide : !item || locked || busy}
                  name={group}
                  type="radio"
                  value={option.id}
                  onChange={() => (isApproval ? chooseApproval(option.id) : change(option.id))}
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
      {store && isApproval && (
        <>
          <div role="status" {...stylex.props(styles.hint)}>
            {approval && <div>{t(`question.approvalState.${approval.state}`)}</div>}
            {decision && (
              <div>
                {t('question.approvalRecorded', {
                  choice:
                    decision.question.options?.find((option) => option.id === decision.choice)
                      ?.label ?? decision.choice,
                  reviewer:
                    decision.by.login ??
                    (decision.by.id === 'owner' ? t('question.approvalOwner') : decision.by.id),
                  time: new Date(decision.at).toLocaleString(i18n.language),
                })}
              </div>
            )}
          </div>
          {currentRevision && !assetsMatch && (
            <div role="status" {...stylex.props(feedback.row)}>
              {t('question.approvalAssetsChanged')}
              <button type="button" {...button} onClick={() => window.location.reload()}>
                {t('question.reopenDocument')}
              </button>
            </div>
          )}
          <div>
            <button
              type="button"
              {...stylex.props(feedback.button, feedback.primary)}
              disabled={!canDecide || !pickedOption}
              onClick={() => void decide()}
            >
              {t('question.recordApproval')}
            </button>
          </div>
        </>
      )}
      {store && !isApproval && (
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
          {localSubmission && (
            <div role="status">
              <strong>
                {t(
                  localSubmission.state === 'delivered'
                    ? 'question.localDelivered'
                    : 'question.localQueued',
                )}
              </strong>
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
              {(destinations.length > 1 || (destinations.length === 1 && !destination)) && (
                <select
                  {...stylex.props(feedback.select)}
                  aria-label={t('question.target')}
                  value={destination?.key ?? ''}
                  onChange={(e) => setTarget(e.target.value)}
                >
                  <option value="">{t('question.target')}</option>
                  {destinations.map(({ key, name }) => (
                    <option key={key} value={key}>
                      {name}
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
                  disabled={!item || !valid || busy || !!conflict || !destination}
                  onClick={() => void act('submit')}
                >
                  {t('question.submit', {
                    agent: destination?.name ?? 'Agent',
                  })}
                </button>
              </div>
              {item && !destinations.length && (
                <small {...stylex.props(styles.hint)}>{t('question.noAgent')}</small>
              )}
            </>
          )}
          {(task?.withdrawable || localSubmission?.withdrawable) && (
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
        </>
      )}
      {store && (
        <>
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
