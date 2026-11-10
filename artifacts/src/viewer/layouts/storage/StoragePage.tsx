import { Button } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { useCallback, useEffect, useRef, useState } from 'react';
import { StorageMigration } from './StorageMigration';
import { useAccount } from '../../hooks/useAccount';
import { useTranslation } from '../../i18n';
import { deviceStyles as styles } from '../devices/device-styles';

interface TestResult { ok: boolean; checkedAt: number; steps: { write: boolean; read: boolean; delete: boolean }; error?: string; cleanupKey?: string }
interface Settings { endpoint: string; bucket: string; region: string; prefix: string; forcePathStyle: boolean }
interface Profile extends Settings { id: string; credentialsConfigured: boolean; test?: TestResult | null }
interface Usage { artifacts: number; history: number; trash: number; shares: number; retained: number; total: number; checkedAt: number }
interface SyncStatus { state: 'local' | 'recovery' | 'pending' | 'syncing' | 'ready' | 'error'; lastSyncedAt: number | null }
interface Summary { recoveryPending?: boolean; usage: Usage | null; profile: Profile | null; configured: boolean; backend: 'local' | 's3'; sharedLimitBytes?: number | null; sync?: SyncStatus }
const blank: Settings = { endpoint: '', bucket: '', region: 'auto', prefix: 'anjian', forcePathStyle: true };
const emptyCredentials = { accessKeyId: '', secretAccessKey: '', sessionToken: '' };
const GIB = 1024 ** 3;
const storageStyles = stylex.create({
  usageGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 16, marginTop: 20, marginBottom: 16 },
  usageValue: { margin: 0, marginTop: 4, fontVariantNumeric: 'tabular-nums', fontWeight: 600 },
  credentialHeading: { marginTop: 28 },
  input: { marginTop: 6, fontWeight: 400, letterSpacing: 'normal' },
});

export function StoragePage() {
  const account = useAccount();
  const { t } = useTranslation();
  const [selection, setSelection] = useState<'shared' | 'personal' | null>(null);
  const [busy, setBusy] = useState(false);
  if (!account) return <p role="status">{t('common.loading')}</p>;
  const scope = account.role === 'owner' ? selection ?? 'shared' : 'personal';
  return <section {...stylex.props(styles.page)}>
    <h1 {...stylex.props(styles.title)}>{t('storage.title')}</h1>
    <p {...stylex.props(styles.rowMeta)}>{t('storage.description')}</p>
    {account.role === 'owner' && <div role="tablist" aria-label={t('storage.title')} {...stylex.props(styles.toolbar)}>
      <div {...stylex.props(styles.tabs)}>{(['shared', 'personal'] as const).map((value) => <button key={value} type="button" role="tab" aria-selected={scope === value} disabled={busy} {...stylex.props(styles.tab, scope === value && styles.tabActive)} onClick={() => setSelection(value)}>{t(`storage.${value}`)}</button>)}</div>
    </div>}
    {account.role === 'member' && <p {...stylex.props(styles.note)}>{t('storage.memberQuota', { amount: (account.quotaBytes ?? 0) / GIB })}</p>}
    <StorageForm key={scope} scope={scope} onBusy={setBusy} />
  </section>;
}

function StorageForm({ scope, onBusy }: { scope: 'shared' | 'personal'; onBusy: (busy: boolean) => void }) {
  const { t, i18n } = useTranslation();
  const [data, setData] = useState<Summary | null>(null);
  const [settings, setSettings] = useState<Settings>(blank);
  const [credentials, setCredentials] = useState(emptyCredentials);
  const [limit, setLimit] = useState('');
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [operation, setOperation] = useState('');
  const [confirmRecovery, setConfirmRecovery] = useState(false);
  const lock = useRef(false);
  const url = `/api/storage?scope=${scope}`;
  const request = useCallback(async <T,>(body?: object, signal?: AbortSignal): Promise<T> => {
    const response = await fetch(url, { cache: 'no-store', signal, ...(body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? `HTTP ${response.status}`);
    return result as T;
  }, [url]);
  const apply = (next: Summary) => {
    setData(next);
    if (next.profile) setSettings({ endpoint: next.profile.endpoint, bucket: next.profile.bucket, region: next.profile.region, prefix: next.profile.prefix, forcePathStyle: next.profile.forcePathStyle });
    setLimit(next.sharedLimitBytes === null || next.sharedLimitBytes === undefined ? '' : String(next.sharedLimitBytes / GIB));
    setDirty(false);
  };
  useEffect(() => {
    const controller = new AbortController();
    void request<Summary>(undefined, controller.signal).then((next) => { if (!controller.signal.aborted) apply(next); }).catch((failure: Error) => { if (!controller.signal.aborted) setError(failure.message); });
    return () => controller.abort();
  }, [request]);
  useEffect(() => {
    if (data?.backend !== 's3') return;
    const controller = new AbortController();
    const timer = window.setInterval(() => {
      void request<Summary>(undefined, controller.signal).then((next) => {
        if (!controller.signal.aborted) setData((old) => old ? { ...old, sync: next.sync, recoveryPending: next.recoveryPending } : next);
      }).catch(() => undefined);
    }, 30_000);
    return () => { window.clearInterval(timer); controller.abort(); };
  }, [data?.backend, request]);
  const run = async (body: object, success: () => void) => {
    if (lock.current) return;
    lock.current = true; setBusy(true); setOperation((body as { action: string }).action); onBusy(true); setError(''); setNotice('');
    try { await request(body); success(); apply(await request<Summary>()); }
    catch (failure) { setError((failure as Error).message); }
    finally { lock.current = false; setBusy(false); onBusy(false); }
  };
  const change = <K extends keyof Settings>(key: K, value: Settings[K]) => { setSettings((old) => ({ ...old, [key]: value })); setDirty(true); setNotice(''); };
  const save = () => {
    const replacing = Object.values(credentials).some(Boolean);
    if ((!data?.profile || replacing) && (!credentials.accessKeyId || !credentials.secretAccessKey)) { setError(t('storage.credentialsRequired')); return; }
    void run({ action: 'save', settings, ...((!data?.profile || replacing) ? { credentials: { accessKeyId: credentials.accessKeyId, secretAccessKey: credentials.secretAccessKey, ...(credentials.sessionToken ? { sessionToken: credentials.sessionToken } : {}) } } : {}) }, () => { setCredentials(emptyCredentials); setNotice(t('storage.saved')); });
  };
  const updateSyncStatus = (next: Summary) => setData((old) => old ? { ...old, sync: next.sync, recoveryPending: next.recoveryPending } : next);
  const syncNow = async (recovering = false) => {
    if (lock.current || (recovering ? !confirmRecovery : data?.recoveryPending || data?.sync?.state === 'recovery')) return;
    lock.current = true; setBusy(true); setOperation('sync'); onBusy(true); setError(''); setNotice('');
    try {
      await request(recovering ? { action: 'recover-local', confirm: 'use-retained-local-files' } : { action: 'sync' });
      updateSyncStatus(await request<Summary>());
      setNotice(t(recovering ? 'storage.recovery.completed' : 'storage.sync.completed'));
      setConfirmRecovery(false);
    } catch (failure) {
      setError((failure as Error).message);
      try { updateSyncStatus(await request<Summary>()); } catch { /* Keep the action error visible if status refresh also fails. */ }
    } finally { lock.current = false; setBusy(false); onBusy(false); }
  };
  const test = data?.profile?.test;
  const sync = data?.backend === 's3' ? data.sync : undefined;
  return <>
    <div {...stylex.props(styles.preview)}><strong>{t(data?.backend === 's3' ? 'storage.s3' : 'storage.local')}</strong><p {...stylex.props(styles.rowMeta)}>{t(data?.backend === 's3' ? 'storage.s3Help' : 'storage.localHelp')}</p></div>
    {(data?.recoveryPending || sync?.state === 'recovery') && <section {...stylex.props(styles.preview)} aria-label={t('storage.recovery.title')}>
      <h2 {...stylex.props(styles.dialogTitle)}>{t('storage.recovery.title')}</h2>
      <p role="alert" {...stylex.props(styles.error)}>{t('storage.recoveryPending')}</p>
      <p {...stylex.props(styles.rowMeta)}>{t('storage.recovery.help')}</p>
      <label {...stylex.props(styles.projectOption)}><input type="checkbox" checked={confirmRecovery} disabled={busy} onChange={(event) => setConfirmRecovery(event.target.checked)} {...stylex.props(styles.check)} />{t('storage.recovery.confirm')}</label>
      <Button disabled={busy || !confirmRecovery} loading={busy && operation === 'sync'} onClick={() => void syncNow(true)}>{t('storage.recovery.action')}</Button>
    </section>}
    {sync && !data?.recoveryPending && sync.state !== 'recovery' && <section {...stylex.props(styles.preview)} aria-label={t('storage.sync.title')}>
      <strong>{t('storage.sync.title')}</strong>
      <p role={sync.state === 'error' ? 'alert' : 'status'} {...stylex.props(styles.rowMeta, sync.state === 'error' && styles.error)}>{sync.state === 'ready' ? sync.lastSyncedAt ? t('storage.sync.ready', { time: new Date(sync.lastSyncedAt).toLocaleString(i18n.language) }) : t('storage.sync.readyUnknown') : t(`storage.sync.${sync.state}`)}</p>
      {(sync.state === 'pending' || sync.state === 'ready' || sync.state === 'error' || (sync.state === 'syncing' && busy && operation === 'sync')) && <Button disabled={busy || sync.state === 'syncing'} loading={busy && operation === 'sync'} onClick={() => void syncNow()}>{t(sync.state === 'error' ? 'storage.sync.retry' : sync.state === 'syncing' ? 'storage.sync.syncing' : 'storage.sync.syncNow')}</Button>}
    </section>}
    {error && <div role="alert" {...stylex.props(styles.status, styles.error)}>{error} {!data && <Button onClick={() => { setError(''); void request<Summary>().then(apply).catch((failure: Error) => setError(failure.message)); }}>{t('devices.retry')}</Button>}</div>}
    {busy && operation === 'test' && <p role="status" {...stylex.props(styles.note)}>{t('storage.testing')}</p>}
    {notice && <p role="status" {...stylex.props(styles.note)}>{notice}</p>}
    {!data && !error && <p role="status">{t('common.loading')}</p>}
    {data && <>
      <section {...stylex.props(styles.preview)} aria-label={t('storage.usage.title')}>
        <h2 {...stylex.props(styles.dialogTitle)}>{t('storage.usage.title')}</h2>
        {data.usage ? <>
          <strong>{formatUsage(data.usage.total, i18n.language)}</strong>
          <dl {...stylex.props(storageStyles.usageGrid)}>{(['artifacts', 'history', 'trash', 'shares', ...(scope === 'shared' ? ['retained'] as const : [])] as const).map((category) => <div key={category}><dt {...stylex.props(styles.rowMeta)}>{t(`storage.usage.${category}`)}</dt><dd {...stylex.props(storageStyles.usageValue)}>{formatUsage(data.usage![category], i18n.language)}</dd></div>)}</dl>
          <p {...stylex.props(styles.rowMeta)}>{t('storage.usage.checked', { time: new Date(data.usage.checkedAt).toLocaleTimeString(i18n.language) })}</p>
        </> : <p role="status" {...stylex.props(styles.rowMeta)}>{t('storage.usage.unavailable')}</p>}
        <p {...stylex.props(styles.rowMeta)}>{t('storage.usage.help')}</p>
        <Button disabled={busy} loading={busy && operation === 'usage'} onClick={async () => {
          if (lock.current) return;
          lock.current = true; setBusy(true); setOperation('usage'); onBusy(true); setError('');
          try { const next = await request<Summary>(); setData((old) => old ? { ...old, usage: next.usage } : next); }
          catch (failure) { setError((failure as Error).message); }
          finally { lock.current = false; setBusy(false); onBusy(false); }
        }}>{t('storage.usage.refresh')}</Button>
      </section>
      <form {...stylex.props(styles.form)} onSubmit={(event) => { event.preventDefault(); save(); }}>
        <h2 {...stylex.props(styles.dialogTitle)}>{t('storage.s3Config')}</h2>
        {(['endpoint', 'bucket', 'region', 'prefix'] as const).map((key) => <label key={key} {...stylex.props(styles.label)}>{t(`storage.${key}`)}<input required={key !== 'prefix'} type={key === 'endpoint' ? 'url' : 'text'} autoComplete="off" value={settings[key]} disabled={busy} placeholder={key === 'endpoint' ? 'https://s3.example.com' : undefined} onChange={(event) => change(key, event.target.value)} {...stylex.props(styles.input, storageStyles.input)} /></label>)}
        <label {...stylex.props(styles.projectOption)}><input type="checkbox" checked={settings.forcePathStyle} disabled={busy} onChange={(event) => change('forcePathStyle', event.target.checked)} {...stylex.props(styles.check)} />{t('storage.pathStyle')}</label>
        <p {...stylex.props(styles.rowMeta)}>{t('storage.endpointHelp')}</p>
        <h2 {...stylex.props(styles.dialogTitle, storageStyles.credentialHeading)}>{t('storage.credentials')}</h2>
        <p {...stylex.props(styles.rowMeta)}>{t(data.profile ? 'storage.credentialsSaved' : 'storage.credentialsHelp')}</p>
        {(['accessKeyId', 'secretAccessKey', 'sessionToken'] as const).map((key) => <label key={key} {...stylex.props(styles.label)}>{t(`storage.${key}`)}<input type="password" autoComplete="new-password" value={credentials[key]} disabled={busy} onChange={(event) => { setCredentials((old) => ({ ...old, [key]: event.target.value })); setDirty(true); }} {...stylex.props(styles.input, storageStyles.input)} /></label>)}
        <div {...stylex.props(styles.actions)}><Button type="primary" htmlType="submit" disabled={busy} loading={busy && operation === 'save'}>{t('storage.save')}</Button><Button loading={busy && operation === 'test'} disabled={busy || dirty || !data.profile} onClick={() => void run({ action: 'test', id: data.profile!.id }, () => {})}>{t('storage.test')}</Button></div>
        {dirty && data.profile && <p {...stylex.props(styles.note)}>{t('storage.saveFirst')}</p>}
      </form>
      {test && <section {...stylex.props(styles.preview)} aria-label={t('storage.testResult')}>
        <strong>{t(test.ok ? 'storage.testPassed' : 'storage.testFailed')}</strong><p {...stylex.props(styles.rowMeta)}>{new Date(test.checkedAt).toLocaleString(i18n.language)}</p>
        <ul {...stylex.props(styles.projectList)}>{(['write', 'read', 'delete'] as const).map((step) => <li key={step} {...stylex.props(styles.projectOption)}>{t(`storage.step.${step}`)} · {t(test.steps[step] ? 'storage.passed' : 'storage.notPassed')}</li>)}</ul>
        {test.error && <p role="alert" {...stylex.props(styles.error)}>{test.error}</p>}
        {test.cleanupKey && <><p {...stylex.props(styles.rowMeta)}>{t('storage.cleanup')}</p><code {...stylex.props(styles.code)}>{test.cleanupKey}</code></>}
        {test.ok && <p {...stylex.props(styles.rowMeta)}>{t('storage.notMigrated')}</p>}
      </section>}
      <StorageMigration scope={scope} profileId={data.profile?.id} enabled={Boolean(test?.ok) && !dirty} disabled={busy || Boolean(data.recoveryPending)} onBusy={onBusy} />
      {scope === 'shared' && <form {...stylex.props(styles.form)} onSubmit={(event) => {
        event.preventDefault();
        const bytes = data.sharedLimitBytes !== null && data.sharedLimitBytes !== undefined && limit === String(data.sharedLimitBytes / GIB) ? data.sharedLimitBytes : Math.round(Number(limit) * GIB);
        if (!/^\d+(?:\.\d{1,3})?$/.test(limit) || !Number.isSafeInteger(bytes) || bytes < 0) { setError(t('members.invalidQuota')); return; }
        void run({ action: 'limit', bytes }, () => setNotice(t('storage.limitSaved')));
      }}>
        <h2 {...stylex.props(styles.dialogTitle)}>{t('storage.totalLimit')}</h2><label {...stylex.props(styles.label)}>{t('storage.limitGiB')}<input required inputMode="decimal" value={limit} disabled={busy} onChange={(event) => setLimit(event.target.value)} {...stylex.props(styles.input, storageStyles.input)} /></label><p {...stylex.props(styles.rowMeta)}>{t('storage.limitHelp')}</p><div {...stylex.props(styles.actions)}><Button htmlType="submit" disabled={busy || dirty}>{t('storage.saveLimit')}</Button></div>
      </form>}
    </>}
  </>;
}

function formatUsage(bytes: number, language: string) {
  const unit = bytes < 1024 ? 0 : Math.min(4, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${new Intl.NumberFormat(language, { maximumFractionDigits: unit ? 2 : 0 }).format(bytes / 1024 ** unit)} ${['B', 'KiB', 'MiB', 'GiB', 'TiB'][unit]}`;
}
