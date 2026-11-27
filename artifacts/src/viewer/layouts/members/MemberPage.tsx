import { Button } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { useCallback, useEffect, useRef, useState } from 'react';

import { useTranslation } from '../../i18n';
import { deviceStyles as styles } from '../devices/device-styles';

interface Member {
  id: string;
  login: string;
  quotaBytes: number;
  status: 'active' | 'suspended';
}
interface Application {
  createdAt: number;
  id: string;
  login: string;
  note?: string;
}
interface Members {
  applications: Application[];
  enabled: boolean;
  members: Member[];
}
const GIB = 1024 ** 3;
const quotaOf = (value: string) => {
  if (!/^\d+(?:\.\d{1,3})?$/.test(value)) return null;
  const bytes = Math.round(Number(value) * GIB);
  return Number.isSafeInteger(bytes) && bytes >= 0 ? bytes : null;
};

async function request<T>(body?: object): Promise<T> {
  const response = await fetch('/api/hub/members', {
    cache: 'no-store',
    ...(body
      ? {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }
      : {}),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`);
  return data as T;
}

export function MemberPage() {
  const { t, i18n } = useTranslation();
  const [data, setData] = useState<Members | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const lockRef = useRef(false);
  const tabTouchedRef = useRef(false);
  const [tab, setTab] = useState<'applications' | 'members'>('applications');
  const [approving, setApproving] = useState<Application | null>(null);
  const [quota, setQuota] = useState('1');
  const [selected, setSelected] = useState<Member | null>(null);
  const [confirmation, setConfirmation] = useState<Member | Application | null>(null);
  const applyData = useCallback((next: Members) => {
    setData(next);
    if (!tabTouchedRef.current) {
      setTab(next.applications.length > 0 ? 'applications' : 'members');
    }
  }, []);
  const reload = useCallback(async () => {
    applyData(await request<Members>());
  }, [applyData]);
  useEffect(() => {
    let active = true;
    void request<Members>()
      .then((next) => {
        if (active) applyData(next);
      })
      .catch((failure: Error) => {
        if (active) setError(failure.message);
      });
    return () => {
      active = false;
    };
  }, [applyData]);
  const run = async (body: object, done?: () => void) => {
    if (lockRef.current) return;
    lockRef.current = true;
    setBusy(true);
    setError('');
    try {
      await request(body);
      done?.();
      await reload();
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      lockRef.current = false;
      setBusy(false);
    }
  };
  const save = (action: 'approve-application' | 'update') => {
    const quotaBytes =
      action === 'update' && quota === String(selected!.quotaBytes / GIB)
        ? selected!.quotaBytes
        : quotaOf(quota);
    if (quotaBytes === null) {
      setError(t('members.invalidQuota'));
      return;
    }
    void run(
      action === 'approve-application'
        ? { action, id: approving!.id, quotaBytes }
        : { action, id: selected!.id, quotaBytes },
      () => {
        if (action === 'approve-application') setApproving(null);
        else setSelected(null);
      },
    );
  };
  const editing = approving !== null || selected !== null;
  return (
    <section {...stylex.props(styles.page)}>
      <div {...stylex.props(styles.heading)}>
        <h1 {...stylex.props(styles.title)}>{t('members.title')}</h1>
      </div>
      <p {...stylex.props(styles.rowMeta)}>{t('members.description')}</p>
      {error && (
        <div role="alert" {...stylex.props(styles.status, styles.error)}>
          {error}{' '}
          <Button
            disabled={busy}
            size="small"
            onClick={() => {
              setError('');
              void reload().catch((failure: Error) => setError(failure.message));
            }}
          >
            {t('devices.retry')}
          </Button>
        </div>
      )}
      {!data && !error && <p role="status">{t('common.loading')}</p>}
      {data && (
        <>
          <div {...stylex.props(styles.toolbar)}>
            <div {...stylex.props(styles.tabs)} aria-label={t('members.title')} role="tablist">
              {(['applications', 'members'] as const).map((name) => (
                <button
                  aria-selected={tab === name}
                  key={name}
                  role="tab"
                  type="button"
                  {...stylex.props(styles.tab, tab === name && styles.tabActive)}
                  onClick={() => {
                    tabTouchedRef.current = true;
                    setTab(name);
                  }}
                >
                  {t(`members.${name}`)} · {data[name].length}
                </button>
              ))}
            </div>
            <Button
              disabled={busy}
              onClick={() => {
                setError('');
                void reload().catch((failure: Error) => setError(failure.message));
              }}
            >
              {t('members.refresh')}
            </Button>
          </div>
          {!data.enabled && <p {...stylex.props(styles.note)}>{t('members.githubRequired')}</p>}
          <div role="tabpanel" {...stylex.props(styles.panel)}>
            <ul {...stylex.props(styles.list)}>
              {tab === 'applications'
                ? data.applications.map((application) => (
                    <li key={application.id} {...stylex.props(styles.row)}>
                      <div {...stylex.props(styles.rowContent)}>
                        <strong {...stylex.props(styles.rowTitle)}>{application.login}</strong>
                        <p {...stylex.props(styles.rowMeta)}>
                          {t('members.appliedAt', {
                            date: new Date(application.createdAt).toLocaleDateString(i18n.language),
                          })}
                          {application.note ? ` · ${application.note}` : ''}
                        </p>
                      </div>
                      <Button
                        disabled={busy}
                        type="primary"
                        onClick={() => {
                          setApproving(application);
                          setSelected(null);
                          setConfirmation(null);
                          setQuota('1');
                        }}
                      >
                        {t('members.approve')}
                      </Button>
                      <Button
                        danger
                        disabled={busy}
                        onClick={() => {
                          setConfirmation(application);
                          setApproving(null);
                          setSelected(null);
                        }}
                      >
                        {t('members.reject')}
                      </Button>
                    </li>
                  ))
                : data.members.map((member) => (
                    <li key={member.id} {...stylex.props(styles.row)}>
                      <div {...stylex.props(styles.rowContent)}>
                        <strong {...stylex.props(styles.rowTitle)}>{member.login}</strong>
                        <p {...stylex.props(styles.rowMeta)}>
                          {t(`members.${member.status}`)} ·{' '}
                          {t('members.quotaValue', { amount: member.quotaBytes / GIB })}
                        </p>
                      </div>
                      <Button
                        disabled={busy}
                        onClick={() => {
                          setSelected(member);
                          setApproving(null);
                          setConfirmation(null);
                          setQuota(String(member.quotaBytes / GIB));
                        }}
                      >
                        {t('members.manage')}
                      </Button>
                      <Button
                        danger={member.status === 'active'}
                        disabled={busy}
                        onClick={() => {
                          setConfirmation(member);
                          setApproving(null);
                          setSelected(null);
                        }}
                      >
                        {t(member.status === 'active' ? 'members.suspend' : 'members.restore')}
                      </Button>
                    </li>
                  ))}
            </ul>
            {data[tab].length === 0 && (
              <p {...stylex.props(styles.empty)}>
                {t(tab === 'applications' ? 'members.noApplications' : 'members.noMembers')}
              </p>
            )}
          </div>
          {confirmation && (
            <section {...stylex.props(styles.form)} aria-label={t('members.confirmTitle')}>
              <h2 {...stylex.props(styles.dialogTitle)}>
                {t('members.confirmTitle')} · {confirmation.login}
              </h2>
              <p {...stylex.props(styles.dialogCopy)}>
                {t(
                  'status' in confirmation
                    ? confirmation.status === 'active'
                      ? 'members.suspendImpact'
                      : 'members.restoreImpact'
                    : 'members.rejectImpact',
                )}
              </p>
              <div {...stylex.props(styles.dialogActions)}>
                <Button disabled={busy} onClick={() => setConfirmation(null)}>
                  {t('devices.cancel')}
                </Button>
                <Button
                  danger
                  disabled={busy}
                  loading={busy}
                  onClick={() =>
                    void run(
                      'status' in confirmation
                        ? {
                            action: 'update',
                            id: confirmation.id,
                            status: confirmation.status === 'active' ? 'suspended' : 'active',
                          }
                        : { action: 'reject-application', id: confirmation.id },
                      () => {
                        setConfirmation(null);
                      },
                    )
                  }
                >
                  {t('members.confirm')}
                </Button>
              </div>
            </section>
          )}
          {editing && (
            <form
              {...stylex.props(styles.form)}
              onSubmit={(event) => {
                event.preventDefault();
                save(approving ? 'approve-application' : 'update');
              }}
            >
              <h2 {...stylex.props(styles.dialogTitle)}>
                {approving
                  ? t('members.approveTitle', { name: approving.login })
                  : t('members.edit', { name: selected!.login })}
              </h2>
              <label {...stylex.props(styles.label)}>
                {t('members.quota')}
                <input
                  autoFocus
                  required
                  disabled={busy}
                  inputMode="decimal"
                  value={quota}
                  onChange={(event) => setQuota(event.target.value)}
                  {...stylex.props(styles.input)}
                />
              </label>
              <p {...stylex.props(styles.rowMeta)}>
                {t(approving ? 'members.approveHelp' : 'members.quotaHelp')}
              </p>
              <div {...stylex.props(styles.dialogActions)}>
                <Button
                  disabled={busy}
                  onClick={() => {
                    setApproving(null);
                    setSelected(null);
                  }}
                >
                  {t('devices.cancel')}
                </Button>
                <Button disabled={busy} htmlType="submit" loading={busy} type="primary">
                  {t(approving ? 'members.confirmApprove' : 'members.save')}
                </Button>
              </div>
            </form>
          )}
        </>
      )}
    </section>
  );
}
