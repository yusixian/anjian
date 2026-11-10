import { Button } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from '../../i18n';
import { deviceStyles as styles } from '../devices/device-styles';

interface Member { id: string; login: string; status: 'active' | 'suspended'; quotaBytes: number }
interface Invitation { id: string; login: string; quotaBytes: number; expiresAt: number }
interface Members { enabled: boolean; members: Member[]; invitations: Invitation[] }
const GIB = 1024 ** 3;
const quotaOf = (value: string) => {
  if (!/^\d+(?:\.\d{1,3})?$/.test(value)) return null;
  const bytes = Math.round(Number(value) * GIB);
  return Number.isSafeInteger(bytes) && bytes >= 0 ? bytes : null;
};

async function request<T>(body?: object): Promise<T> {
  const response = await fetch('/api/hub/members', { cache: 'no-store', ...(body ? {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  } : {}) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`);
  return data as T;
}

export function MemberPage() {
  const { t, i18n } = useTranslation();
  const [data, setData] = useState<Members | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [tab, setTab] = useState<'members' | 'invitations'>('members');
  const [invite, setInvite] = useState(false);
  const [login, setLogin] = useState('');
  const [quota, setQuota] = useState('1');
  const [created, setCreated] = useState('');
  const [copied, setCopied] = useState(false);
  const [selected, setSelected] = useState<Member | null>(null);
  const [confirmation, setConfirmation] = useState<Member | Invitation | null>(null);
  const reload = useCallback(async () => { setData(await request<Members>()); }, []);
  useEffect(() => { void reload().catch((failure: Error) => setError(failure.message)); }, [reload]);
  const run = async (body: object, done?: (result: { url?: string }) => void) => {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError('');
    try {
      const result = await request<{ url?: string }>(body);
      done?.(result);
      await reload();
    } catch (failure) { setError((failure as Error).message); }
    finally { lock.current = false; setBusy(false); }
  };
  const save = (action: 'invite' | 'update') => {
    const quotaBytes = action === 'update' && quota === String(selected!.quotaBytes / GIB) ? selected!.quotaBytes : quotaOf(quota);
    if (quotaBytes === null) { setError(t('members.invalidQuota')); return; }
    void run(action === 'invite' ? { action, login: login.trim(), quotaBytes } : { action, id: selected!.id, quotaBytes }, (result) => {
      if (action === 'invite') { setCreated(result.url ?? ''); setCopied(false); setTab('invitations'); setInvite(false); }
      else setSelected(null);
    });
  };
  const editing = invite || selected !== null;
  return <section {...stylex.props(styles.page)}>
    <div {...stylex.props(styles.heading)}><h1 {...stylex.props(styles.title)}>{t('members.title')}</h1></div>
    <p {...stylex.props(styles.rowMeta)}>{t('members.description')}</p>
    {error && <div role="alert" {...stylex.props(styles.status, styles.error)}>{error} <Button size="small" disabled={busy} onClick={() => { setError(''); void reload().catch((failure: Error) => setError(failure.message)); }}>{t('devices.retry')}</Button></div>}
    {!data && !error && <p role="status">{t('common.loading')}</p>}
    {data && <>
      <div {...stylex.props(styles.toolbar)}>
        <div {...stylex.props(styles.tabs)} role="tablist" aria-label={t('members.title')}>
          {(['members', 'invitations'] as const).map((name) => <button key={name} role="tab" aria-selected={tab === name} type="button" {...stylex.props(styles.tab, tab === name && styles.tabActive)} onClick={() => setTab(name)}>{t(`members.${name}`)} · {data[name].length}</button>)}
        </div>
        <Button type="primary" disabled={busy || !data.enabled} onClick={() => { setInvite(true); setSelected(null); setQuota('1'); setCreated(''); }}>{t('members.invite')}</Button>
      </div>
      {!data.enabled && <p {...stylex.props(styles.note)}>{t('members.githubRequired')}</p>}
      <div role="tabpanel" {...stylex.props(styles.panel)}>
        <ul {...stylex.props(styles.list)}>
          {tab === 'members' ? data.members.map((member) => <li key={member.id} {...stylex.props(styles.row)}>
            <div {...stylex.props(styles.rowContent)}><strong {...stylex.props(styles.rowTitle)}>{member.login}</strong><p {...stylex.props(styles.rowMeta)}>{t(`members.${member.status}`)} · {t('members.quotaValue', { amount: member.quotaBytes / GIB })}</p></div>
            <Button disabled={busy} onClick={() => { setSelected(member); setInvite(false); setQuota(String(member.quotaBytes / GIB)); setCreated(''); }}>{t('members.manage')}</Button>
            <Button danger={member.status === 'active'} disabled={busy} onClick={() => setConfirmation(member)}>{t(member.status === 'active' ? 'members.suspend' : 'members.restore')}</Button>
          </li>) : data.invitations.map((invitation) => <li key={invitation.id} {...stylex.props(styles.row)}>
            <div {...stylex.props(styles.rowContent)}><strong {...stylex.props(styles.rowTitle)}>{invitation.login}</strong><p {...stylex.props(styles.rowMeta)}>{t('members.expires', { date: new Date(invitation.expiresAt).toLocaleDateString(i18n.language) })} · {t('members.quotaValue', { amount: invitation.quotaBytes / GIB })}</p></div>
            <Button disabled={busy} onClick={() => setConfirmation(invitation)}>{t('members.revoke')}</Button>
          </li>)}
        </ul>
        {data[tab].length === 0 && <p {...stylex.props(styles.empty)}>{t(tab === 'members' ? 'members.noMembers' : 'members.noInvitations')}</p>}
      </div>
      {confirmation && <section {...stylex.props(styles.form)} aria-label={t('members.confirmTitle')}>
        <h2 {...stylex.props(styles.dialogTitle)}>{t('members.confirmTitle')} · {confirmation.login}</h2>
        <p {...stylex.props(styles.dialogCopy)}>{t('status' in confirmation ? confirmation.status === 'active' ? 'members.suspendImpact' : 'members.restoreImpact' : 'members.revokeImpact')}</p>
        <div {...stylex.props(styles.dialogActions)}><Button disabled={busy} onClick={() => setConfirmation(null)}>{t('devices.cancel')}</Button><Button danger loading={busy} disabled={busy} onClick={() => void run('status' in confirmation ? { action: 'update', id: confirmation.id, status: confirmation.status === 'active' ? 'suspended' : 'active' } : { action: 'revoke-invitation', id: confirmation.id }, () => { setConfirmation(null); if (!('status' in confirmation)) setCreated(''); })}>{t('members.confirm')}</Button></div>
      </section>}
      {editing && <form {...stylex.props(styles.form)} onSubmit={(event) => { event.preventDefault(); save(invite ? 'invite' : 'update'); }}>
        <h2 {...stylex.props(styles.dialogTitle)}>{invite ? t('members.invite') : t('members.edit', { name: selected!.login })}</h2>
        {invite && <label {...stylex.props(styles.label)}>{t('members.githubLogin')}<input autoFocus autoComplete="off" required maxLength={39} value={login} disabled={busy} onChange={(event) => setLogin(event.target.value)} {...stylex.props(styles.input)} /></label>}
        <label {...stylex.props(styles.label)}>{t('members.quota')}<input inputMode="decimal" required value={quota} disabled={busy} onChange={(event) => setQuota(event.target.value)} {...stylex.props(styles.input)} /></label>
        <p {...stylex.props(styles.rowMeta)}>{t(invite ? 'members.inviteHelp' : 'members.quotaHelp')}</p>
        <div {...stylex.props(styles.dialogActions)}><Button disabled={busy} onClick={() => { setInvite(false); setSelected(null); }}>{t('devices.cancel')}</Button><Button htmlType="submit" type="primary" loading={busy} disabled={busy}>{t(invite ? 'members.create' : 'members.save')}</Button></div>
      </form>}
      {created && <section {...stylex.props(styles.form)}><label {...stylex.props(styles.label)}>{t('members.created')}<input readOnly value={created} onFocus={(event) => event.target.select()} {...stylex.props(styles.input)} /></label><p {...stylex.props(styles.rowMeta)}>{t('members.copyHelp')}</p><Button onClick={() => { void navigator.clipboard.writeText(created).then(() => setCopied(true)).catch(() => setError(t('members.copyFailed'))); }}>{t(copied ? 'members.copied' : 'members.copy')}</Button></section>}
    </>}
  </section>;
}
