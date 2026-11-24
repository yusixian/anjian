import './codex-tasks.css';

import { type FormEvent, useEffect, useId, useState } from 'react';

import type { CommandApprovalDecision, PendingCommandApproval } from '../../shared/codex-approvals';
import { useTranslation } from '../i18n';

type Task = {
  threadId: string;
  title: string;
  documentUrl?: string;
  status: 'running' | 'completed' | 'failed' | 'interrupted';
  output: string;
  plan: string;
};

type Pending = {
  requestId: string | number;
  threadId: string;
  questions: {
    id: string;
    header: string;
    question: string;
    options: { label: string; description: string }[];
  }[];
};

function QuestionForm({
  pending,
  submit,
}: {
  pending: Pending;
  submit: (answers: Record<string, string>) => Promise<boolean>;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const formId = useId();
  async function answer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const answers = Object.fromEntries(new FormData(event.currentTarget)) as Record<string, string>;
    setBusy(true);
    if (!(await submit(answers))) setBusy(false);
  }
  return (
    <form onSubmit={answer}>
      <fieldset disabled={busy}>
        <legend>{t('codexTasks.session', { id: pending.threadId.slice(-6) })}</legend>
        {pending.questions.map(({ id, question, options }, index) => (
          <div key={id}>
            <label htmlFor={formId + index}>{question}</label>
            {options.length > 0 && (
              <ul id={formId + index + '-options'}>
                {options.map(({ label, description }) => (
                  <li key={label}>
                    <strong>{label}</strong> {description}
                  </li>
                ))}
              </ul>
            )}
            <textarea
              required
              aria-describedby={options.length ? formId + index + '-options' : undefined}
              id={formId + index}
              maxLength={16000}
              name={id}
              rows={2}
            />
          </div>
        ))}
        <button type="submit">{t('codexTasks.reply')}</button>
      </fieldset>
    </form>
  );
}

function CommandApproval({
  approval,
  submit,
}: {
  approval: PendingCommandApproval;
  submit: (decision: CommandApprovalDecision) => Promise<boolean>;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  return (
    <fieldset disabled={busy}>
      <legend>{t('codexTasks.commandApproval', { id: approval.threadId.slice(-6) })}</legend>
      <pre>
        <code>{approval.command}</code>
      </pre>
      {approval.cwd && <p>{t('codexTasks.commandDirectory', { directory: approval.cwd })}</p>}
      {approval.reason && <p>{approval.reason}</p>}
      <div className="codex-approval-actions">
        {approval.decisions.map((decision) => (
          <button
            key={decision}
            type="button"
            onClick={async () => {
              setBusy(true);
              if (!(await submit(decision))) setBusy(false);
            }}
          >
            {t('codexTasks.approvalDecision.' + decision)}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

export function CodexTasks({ artifact }: { artifact: string }) {
  const { t } = useTranslation();
  const [approvals, setApprovals] = useState<PendingCommandApproval[]>([]);
  const [pending, setPending] = useState<Pending[] | null>(null);
  const [sharedAvailable, setSharedAvailable] = useState(false);
  const [threadId, setThreadId] = useState('');
  const [attaching, setAttaching] = useState(false);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [newDocument, setNewDocument] = useState(false);
  const [documentUrl, setDocumentUrl] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const endpoint = '/api/hub/codex-tasks?' + new URLSearchParams({ artifact });

  useEffect(() => {
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      try {
        const response = await fetch(open ? endpoint + '&results=1' : endpoint, {
          signal: abort.signal,
        });
        if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) {
          if (response.status === 403 || response.status === 404 || response.ok) {
            if (!abort.signal.aborted) setPending(null);
            return;
          }
          throw new Error('Task status unavailable');
        }
        const value = (await response.json()) as {
          pending: Pending[];
          tasks?: Task[];
          sharedAvailable?: boolean;
          approvals?: PendingCommandApproval[];
        };
        if (!Array.isArray(value.pending)) return;
        if (!abort.signal.aborted) {
          setPending(value.pending);
          setApprovals(Array.isArray(value.approvals) ? value.approvals : []);
          setSharedAvailable(value.sharedAvailable === true);
          setTasks(Array.isArray(value.tasks) ? value.tasks : []);
        }
      } catch {
        if (!abort.signal.aborted) {
          setPending((previous) => (previous === null ? null : []));
          setApprovals([]);
        }
      }
      if (!abort.signal.aborted) timer = setTimeout(refresh, 2000);
    }
    void refresh();
    return () => {
      abort.abort();
      clearTimeout(timer);
    };
  }, [endpoint, open]);

  async function post(payload: object, success: string, failure: string) {
    setNotice('');
    setError('');
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const result = (await response.json()) as { error?: string; documentUrl?: string };
      if (result.documentUrl) setDocumentUrl(result.documentUrl);
      if (!response.ok) {
        setError(t(result.error === 'question_unavailable' ? 'codexTasks.expired' : failure));
        return false;
      }
      setNotice(t(success));
      return true;
    } catch {
      setError(t(failure));
      return false;
    }
  }

  async function start(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!prompt.trim()) return;
    setBusy(true);
    setDocumentUrl('');
    try {
      if (
        await post(
          { action: newDocument ? 'start-document' : 'start', prompt },
          'codexTasks.started',
          'codexTasks.startFailed',
        )
      )
        setPrompt('');
    } finally {
      setBusy(false);
    }
  }

  async function attach(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const id = threadId.trim();
    if (!id) return;
    setAttaching(true);
    try {
      await post(
        { action: 'attach', threadId: id },
        'codexTasks.attached',
        'codexTasks.attachFailed',
      );
    } finally {
      setAttaching(false);
    }
  }

  if (!pending) return null;
  return (
    <aside aria-label={t('codexTasks.title')} className="codex-tasks">
      <button
        aria-controls="codex-task-panel"
        aria-expanded={open}
        type="button"
        onClick={() => setOpen(!open)}
      >
        {t('codexTasks.title')}
        <span role="status">
          {pending.length > 0 && t('codexTasks.pending', { count: pending.length })}
          {pending.length > 0 && approvals.length > 0 && ' · '}
          {approvals.length > 0 && t('codexTasks.approvalsPending', { count: approvals.length })}
        </span>
      </button>
      <div className="codex-task-panel" hidden={!open} id="codex-task-panel">
        <form onSubmit={start}>
          <label>
            {t('codexTasks.prompt')}
            <textarea
              required
              maxLength={16000}
              rows={3}
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
            />
          </label>
          <label>
            <input
              checked={newDocument}
              type="checkbox"
              onChange={(event) => setNewDocument(event.target.checked)}
            />
            {t('codexTasks.createDocument')}
          </label>
          <button disabled={busy} type="submit">
            {t('codexTasks.start')}
          </button>
        </form>
        {sharedAvailable && (
          <form onSubmit={attach}>
            <label>
              {t('codexTasks.threadId')}
              <input
                required
                autoCapitalize="none"
                autoComplete="off"
                maxLength={36}
                spellCheck={false}
                type="text"
                value={threadId}
                onChange={(event) => setThreadId(event.target.value)}
              />
            </label>
            <button disabled={attaching} type="submit">
              {t('codexTasks.attach')}
            </button>
          </form>
        )}
        <div role="status">{notice}</div>
        {documentUrl && <a href={documentUrl}>{t('codexTasks.openDocument')}</a>}
        {error && <p role="alert">{error}</p>}
        {approvals.map((approval) => (
          <CommandApproval
            approval={approval}
            key={JSON.stringify([approval.threadId, approval.requestId])}
            submit={(decision) =>
              post(
                {
                  action: 'decide',
                  threadId: approval.threadId,
                  requestId: approval.requestId,
                  decision,
                },
                'codexTasks.approvalSent',
                'codexTasks.approvalFailed',
              )
            }
          />
        ))}
        {pending.map((item) => (
          <QuestionForm
            key={JSON.stringify([item.threadId, item.requestId])}
            pending={item}
            submit={(answers) =>
              post(
                { action: 'answer', threadId: item.threadId, requestId: item.requestId, answers },
                'codexTasks.sent',
                'codexTasks.replyFailed',
              )
            }
          />
        ))}
        {tasks.length > 0 && (
          <section aria-label={t('codexTasks.recent')}>
            <h2>{t('codexTasks.recent')}</h2>
            {tasks.map((task) => (
              <details key={task.threadId}>
                <summary>
                  {task.title} · {t('codexTasks.' + task.status)}
                </summary>
                <p>{t('codexTasks.session', { id: task.threadId.slice(-6) })}</p>
                {task.documentUrl && <a href={task.documentUrl}>{t('codexTasks.openDocument')}</a>}
                {(task.plan || task.output) && <pre>{task.plan || task.output}</pre>}
              </details>
            ))}
          </section>
        )}
      </div>
    </aside>
  );
}
