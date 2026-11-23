import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { ClipboardCheck, Maximize2, Minimize2, Play, RefreshCw, X } from 'lucide-react';
import { useCallback, useEffect, useId, useRef, useState } from 'react';

import type { VerificationRun, VerificationSnapshot } from '../../shared/verification-runs';
import { useTranslation } from '../i18n';

const mobile = '@media (max-width: 640px)';
const styles = stylex.create({
  button: {
    appearance: 'none',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    minHeight: { default: 36, [mobile]: 44 },
    paddingInline: 10,
    border: '1px solid',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: 6,
    backgroundColor: { 'default': cssVar.colorBgContainer, ':hover': cssVar.colorFillTertiary },
    color: cssVar.colorText,
    cursor: { 'default': 'pointer', ':disabled': 'wait' },
    opacity: { 'default': 1, ':disabled': 0.56 },
  },
  toolbarLabel: { display: { default: 'inline', [mobile]: 'none' } },
  drawer: {
    boxSizing: 'border-box',
    position: 'fixed',
    insetBlock: 0,
    insetInlineStart: 'auto',
    insetInlineEnd: 0,
    margin: 0,
    width: 'min(29rem, 100vw)',
    maxWidth: '100vw',
    height: '100dvh',
    maxHeight: '100dvh',
    padding: 0,
    border: 0,
    borderInlineStart: '1px solid',
    borderColor: cssVar.colorBorderSecondary,
    backgroundColor: cssVar.colorBgElevated,
    color: cssVar.colorText,
    fontFamily: cssVar.fontFamily,
    overflow: 'auto',
  },
  wide: { width: 'min(48rem, 100vw)' },
  header: {
    position: 'sticky',
    insetBlockStart: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    padding: '12px 16px',
    backgroundColor: cssVar.colorBgElevated,
    borderBottom: '1px solid',
    borderColor: cssVar.colorBorderSecondary,
  },
  title: { margin: 0, fontSize: 16, fontWeight: 600 },
  controls: { display: 'flex', gap: 6 },
  resize: { display: { default: 'inline-flex', [mobile]: 'none' } },
  body: { padding: '12px 16px 24px' },
  checks: { display: 'grid', gap: 4, margin: 0, padding: 0, listStyle: 'none' },
  check: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingBlock: 8,
    borderBottom: '1px solid',
    borderColor: cssVar.colorBorderSecondary,
  },
  checkTitle: { minWidth: 0, overflowWrap: 'anywhere' },
  meta: { color: cssVar.colorTextSecondary, fontSize: 12, overflowWrap: 'anywhere' },
  details: {
    paddingBlock: 10,
    borderBottom: '1px solid',
    borderColor: cssVar.colorBorderSecondary,
  },
  summary: { cursor: 'pointer', overflowWrap: 'anywhere' },
  log: {
    marginBlock: 8,
    overflow: 'auto',
    whiteSpace: 'pre-wrap',
    overflowWrap: 'anywhere',
    padding: 12,
    borderRadius: 6,
    backgroundColor: cssVar.colorFillTertiary,
  },
});

export function VerificationRuns({
  documentId,
  onRefreshReport,
}: {
  documentId: string;
  onRefreshReport: () => void;
}) {
  const { t, i18n } = useTranslation();
  const titleId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [snapshot, setSnapshot] = useState<VerificationSnapshot | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [wide, setWide] = useState(false);
  const [failed, setFailed] = useState(false);
  const [details, setDetails] = useState<Record<string, VerificationRun | null>>({});
  const endpoint = '/api/document/' + encodeURIComponent(documentId) + '/verification';
  const refresh = useCallback(
    (signal?: AbortSignal) =>
      fetch(endpoint, { cache: 'no-store', signal })
        .then(async (response) => {
          if (signal?.aborted) return;
          if (response.ok) {
            const data: VerificationSnapshot = await response.json();
            if (!signal?.aborted) setSnapshot(data);
          } else if (response.status === 404) {
            dialogRef.current?.close();
            setSnapshot(null);
          } else setFailed(true);
        })
        .catch(() => {
          if (!signal?.aborted) setFailed(true);
        }),
    [endpoint],
  );

  useEffect(() => {
    const abort = new AbortController();
    void refresh(abort.signal);
    return () => abort.abort();
  }, [refresh]);

  const running = pending ?? snapshot?.running;
  useEffect(() => {
    if (!running) return;
    const abort = new AbortController();
    const timer = setInterval(() => void refresh(abort.signal), 1000);
    return () => {
      abort.abort();
      clearInterval(timer);
    };
  }, [refresh, running]);

  async function start(check: string) {
    setPending(check);
    setFailed(false);
    try {
      const response = await fetch(endpoint + '/' + check, { method: 'POST' });
      if (!response.ok && response.status !== 409) setFailed(true);
      await refresh();
    } catch {
      setFailed(true);
    } finally {
      setPending(null);
    }
  }

  async function loadResult(id: string) {
    try {
      const response = await fetch(endpoint + '/runs/' + id, { cache: 'no-store' });
      const run: VerificationRun | null = response.ok ? await response.json() : null;
      setDetails((current) => ({ ...current, [id]: run }));
    } catch {
      setDetails((current) => ({ ...current, [id]: null }));
    }
  }

  if (!snapshot) return null;
  return (
    <>
      <button
        aria-label={t('verification.title')}
        type="button"
        {...stylex.props(styles.button)}
        onClick={() => {
          dialogRef.current?.showModal();
          setFailed(false);
          void refresh();
        }}
      >
        <ClipboardCheck aria-hidden="true" size={16} />
        <span {...stylex.props(styles.toolbarLabel)}>{t('verification.title')}</span>
      </button>
      <dialog
        aria-labelledby={titleId}
        ref={dialogRef}
        {...stylex.props(styles.drawer, wide && styles.wide)}
      >
        <header {...stylex.props(styles.header)}>
          <h2 id={titleId} {...stylex.props(styles.title)}>
            {t('verification.title')}
          </h2>
          <div {...stylex.props(styles.controls)}>
            <button
              type="button"
              {...stylex.props(styles.button)}
              aria-label={t('verification.refreshReport')}
              title={t('verification.refreshReport')}
              onClick={() => {
                setFailed(false);
                onRefreshReport();
                void refresh();
              }}
            >
              <RefreshCw aria-hidden="true" size={16} />
            </button>
            <button
              type="button"
              {...stylex.props(styles.button, styles.resize)}
              aria-label={t(wide ? 'verification.narrow' : 'verification.widen')}
              onClick={() => setWide(!wide)}
            >
              {wide ? (
                <Minimize2 aria-hidden="true" size={16} />
              ) : (
                <Maximize2 aria-hidden="true" size={16} />
              )}
            </button>
            <button
              type="button"
              {...stylex.props(styles.button)}
              aria-label={t('verification.close')}
              onClick={() => dialogRef.current?.close()}
            >
              <X aria-hidden="true" size={16} />
            </button>
          </div>
        </header>
        <div {...stylex.props(styles.body)}>
          {(failed || snapshot.writeFailed) && (
            <p role="alert">
              {t(snapshot.writeFailed ? 'verification.writeFailed' : 'verification.requestFailed')}
            </p>
          )}
          <ul {...stylex.props(styles.checks)}>
            {snapshot.checks.map(({ id, title }) => (
              <li key={id} {...stylex.props(styles.check)}>
                <strong {...stylex.props(styles.checkTitle)}>{title}</strong>
                <button
                  type="button"
                  {...stylex.props(styles.button)}
                  aria-label={t('verification.runNamed', { title })}
                  disabled={Boolean(running)}
                  onClick={() => void start(id)}
                >
                  <Play aria-hidden="true" size={14} />
                  <span aria-live="polite">
                    {t(running === id ? 'verification.running' : 'verification.run')}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <h3>{t('verification.history')}</h3>
          {!snapshot.runs.length && <p {...stylex.props(styles.meta)}>{t('verification.empty')}</p>}
          {snapshot.runs.map((run) => (
            <details
              key={run.id}
              {...stylex.props(styles.details)}
              onToggle={(event) => {
                if (event.currentTarget.open && !details[run.id]) void loadResult(run.id);
              }}
            >
              <summary {...stylex.props(styles.summary)}>
                {run.title} · {t('verification.' + run.status)}{' '}
                <time dateTime={run.finishedAt} {...stylex.props(styles.meta)}>
                  {new Date(run.finishedAt).toLocaleString(i18n.language)}
                </time>
              </summary>
              <p {...stylex.props(styles.meta)}>SHA-256 {run.sha256}</p>
              <pre {...stylex.props(styles.log)}>
                {details[run.id]?.output ??
                  t(
                    details[run.id] === null
                      ? 'verification.requestFailed'
                      : 'verification.loading',
                  )}
              </pre>
            </details>
          ))}
        </div>
      </dialog>
    </>
  );
}
