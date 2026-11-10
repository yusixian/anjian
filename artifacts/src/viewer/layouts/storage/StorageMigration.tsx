import { Button } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from '../../i18n';
import { deviceStyles as styles } from '../devices/device-styles';

interface Job {
  id: string; profileId: string; state: 'prepared' | 'copying' | 'verified' | 'failed';
  createdAt: number; files: number; bytes: number; verifiedFiles: number; verifiedBytes: number;
  error: string | null; running: boolean; active?: boolean;
}
const layout = stylex.create({
  jobs: { listStyleType: 'none', margin: 0, padding: 0 },
  job: { paddingBlock: 16, borderTopWidth: 1, borderTopStyle: 'solid', borderTopColor: 'var(--lobe-color-border-secondary)' },
  progress: { display: 'block', width: '100%', height: 6, marginBlock: 12, accentColor: 'currentColor' },
});

export function StorageMigration({ scope, profileId, enabled, disabled, onBusy, onActivated }: {
  scope: 'shared' | 'personal'; profileId?: string; enabled: boolean; disabled: boolean; onBusy: (value: boolean) => void; onActivated?: () => Promise<void>;
}) {
  const { t, i18n } = useTranslation();
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmJob, setConfirmJob] = useState<string | null>(null);
  const lock = useRef(false);
  const sequence = useRef(0);
  const lifetime = useRef<AbortController | null>(null);
  const url = `/api/storage/migrations?scope=${scope}`;
  const load = useCallback(async (signal?: AbortSignal) => {
    const current = ++sequence.current;
    const response = await fetch(url, { cache: 'no-store', signal });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? `HTTP ${response.status}`);
    if (!signal?.aborted && current === sequence.current) { setJobs(result.jobs); setError(''); }
  }, [url]);
  useEffect(() => {
    const controller = new AbortController(); lifetime.current = controller;
    void load(controller.signal).catch((failure: Error) => { if (!controller.signal.aborted) setError(failure.message); });
    return () => controller.abort();
  }, [load]);
  const running = jobs?.some((job) => job.running) ?? false;
  useEffect(() => {
    if (!running) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try { await load(controller.signal); }
      catch (failure) { if (!controller.signal.aborted) setError((failure as Error).message); }
      if (!controller.signal.aborted) timer = setTimeout(() => void poll(), 2000);
    };
    timer = setTimeout(() => void poll(), 2000);
    return () => { controller.abort(); clearTimeout(timer); };
  }, [load, running]);
  const run = async (body?: { action: string; profileId?: string; id?: string; confirm?: string }) => {
    if (lock.current) return;
    lock.current = true; setBusy(true); onBusy(true); setError('');
    const signal = lifetime.current?.signal;
    try {
      if (body) {
        const response = await fetch(url, { method: 'POST', cache: 'no-store', signal,
          headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error ?? `HTTP ${response.status}`);
        if (body.action === 'activate') { setConfirmJob(null); await onActivated?.(); }
      }
      await load(signal);
    } catch (failure) {
      if (!signal?.aborted) setError((failure as Error).message);
    } finally {
      lock.current = false;
      if (!signal?.aborted) { setBusy(false); onBusy(false); }
    }
  };
  return <section {...stylex.props(styles.preview)} aria-label={t('storage.migration.title')}>
    <h2 {...stylex.props(styles.dialogTitle)}>{t('storage.migration.title')}</h2>
    <p {...stylex.props(styles.rowMeta)}>{t('storage.migration.help')}</p>
    <div {...stylex.props(styles.actions)}>
      <Button disabled={disabled || busy || running || !enabled || !profileId} onClick={() => void run({ action: 'prepare', profileId })}>{t('storage.migration.prepare')}</Button>
      <Button disabled={busy} onClick={() => void run()}>{t('storage.migration.refresh')}</Button>
    </div>
    {!enabled && <p {...stylex.props(styles.note)}>{t('storage.migration.testFirst')}</p>}
    {error && <p role="alert" {...stylex.props(styles.error)}>{error}</p>}
    {!jobs && !error && <p role="status">{t('common.loading')}</p>}
    {jobs?.length === 0 && <p {...stylex.props(styles.rowMeta)}>{t('storage.migration.empty')}</p>}
    <ul {...stylex.props(layout.jobs)}>{jobs?.map((job) => {
      const state = job.running ? 'copying' : job.state === 'copying' ? 'interrupted' : job.state;
      return <li key={job.id} {...stylex.props(layout.job)}>
        <strong>{t(`storage.migration.${job.active ? 'active' : state}`)}</strong>
        <p {...stylex.props(styles.rowMeta)}>{new Date(job.createdAt).toLocaleString(i18n.language)}</p>
        <p {...stylex.props(styles.rowMeta)}>{t('storage.migration.progress', { done: job.verifiedFiles, total: job.files,
          size: new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 2 }).format(job.bytes / 1024 ** 2) })}</p>
        <progress {...stylex.props(layout.progress)} aria-label={t('storage.migration.copying')} max={job.files || 1} value={job.state === 'verified' ? job.files || 1 : job.verifiedFiles} />
        {job.profileId !== profileId && <p {...stylex.props(styles.rowMeta)}>{t('storage.migration.previousProfile')}</p>}
        {job.error && <p {...stylex.props(styles.error)}>{t(job.error === 'source_changed' ? 'storage.migration.sourceChanged' : 'storage.migration.copyFailed')}</p>}
        {state === 'verified' ? job.active ? <p {...stylex.props(styles.note)}>{t('storage.migration.activeHelp')}</p> : <>
          <p {...stylex.props(styles.note)}>{t('storage.migration.verifiedHelp')}</p>
          <label {...stylex.props(styles.projectOption)}><input type="checkbox" checked={confirmJob === job.id} disabled={disabled || busy || running || !enabled || job.profileId !== profileId} onChange={(event) => setConfirmJob(event.target.checked ? job.id : null)} {...stylex.props(styles.check)} />{t('storage.migration.confirmActivate')}</label>
          <Button disabled={disabled || busy || running || !enabled || job.profileId !== profileId || confirmJob !== job.id} loading={busy && confirmJob === job.id} onClick={() => void run({ action: 'activate', id: job.id, confirm: 'retain-original-files' })}>{t('storage.migration.activate')}</Button>
        </> :
          <Button disabled={disabled || busy || running || job.running || job.error === 'source_changed'} onClick={() => void run({ action: 'resume', id: job.id })}>{t(state === 'prepared' ? 'storage.migration.copy' : 'storage.migration.retry')}</Button>}
      </li>;
    })}</ul>
  </section>;
}
